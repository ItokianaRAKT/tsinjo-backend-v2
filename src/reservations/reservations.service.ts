import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OfferStatus,
  Prisma,
  ReservationStatus,
  Role,
  type User,
} from '@prisma/client';
import { OffersSyncService } from '../offers/offers-sync.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateReservationDto, ListReservationsDto } from './dto/reservations.dto.js';

const RESERVATION_INCLUDE = {
  offer: true,
  buyer: { select: { id: true, fullName: true } },
} satisfies Prisma.ReservationInclude;

type ReservationWithRelations = Prisma.ReservationGetPayload<{
  include: typeof RESERVATION_INCLUDE;
}>;

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: OffersSyncService,
  ) {}

  async create(buyer: User, dto: CreateReservationDto) {
    await this.sync.syncCatalogState();
    const now = new Date();
    if (dto.estimatedPickupTime <= now) {
      throw new BadRequestException('estimatedPickupTime must be strictly after now');
    }
    const offer = await this.prisma.offer.findUnique({ where: { id: dto.offerId } });
    if (!offer) {
      throw new NotFoundException('Offer not found');
    }
    if (offer.creatorId === buyer.id) {
      throw new ForbiddenException('You cannot reserve your own offer');
    }
    if (
      offer.status !== OfferStatus.ACTIVE ||
      offer.quantityAvailable < dto.quantity ||
      offer.pickupDeadline <= now ||
      offer.expirationDate <= now
    ) {
      throw new BadRequestException('Offer is not available for reservation');
    }
    if (dto.estimatedPickupTime > offer.pickupDeadline) {
      throw new BadRequestException('estimatedPickupTime must not exceed pickupDeadline');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.offer.updateMany({
        where: {
          id: offer.id,
          status: OfferStatus.ACTIVE,
          quantityAvailable: { gte: dto.quantity },
        },
        data: { quantityAvailable: { decrement: dto.quantity } },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Offer is no longer available');
      }
      await tx.offer.updateMany({
        where: { id: offer.id, quantityAvailable: 0 },
        data: { status: OfferStatus.SOLD_OUT },
      });
      return tx.reservation.create({
        data: {
          buyerId: buyer.id,
          offerId: offer.id,
          quantity: dto.quantity,
          estimatedPickupTime: dto.estimatedPickupTime,
          status: ReservationStatus.PENDING,
        },
      });
    });
  }

  async findMine(user: User, dto: ListReservationsDto) {
    await this.sync.syncCatalogState();
    const where: Prisma.ReservationWhereInput = {
      ...(dto.role === 'buyer'
        ? { buyerId: user.id }
        : dto.role === 'creator'
          ? { offer: { creatorId: user.id } }
          : { OR: [{ buyerId: user.id }, { offer: { creatorId: user.id } }] }),
      ...(dto.status ? { status: dto.status } : {}),
    };
    return this.prisma.reservation.findMany({
      where,
      include: RESERVATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: User) {
    await this.sync.syncCatalogState();
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: RESERVATION_INCLUDE,
    });
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }
    if (
      user.role !== Role.ADMIN &&
      reservation.buyerId !== user.id &&
      reservation.offer.creatorId !== user.id
    ) {
      throw new ForbiddenException('You cannot access this reservation');
    }
    return reservation;
  }

  async confirmPickup(id: string, user: User) {
    const reservation = await this.getPartyReservation(id, user);
    return this.prisma.$transaction(async (tx) => {
      const confirmation: Prisma.ReservationUpdateManyMutationInput =
        reservation.buyerId === user.id
          ? { buyerConfirmed: true }
          : { creatorConfirmed: true };
      const updated = await tx.reservation.updateMany({
        where: { id, status: ReservationStatus.PENDING },
        data: confirmation,
      });
      if (updated.count !== 1) {
        throw new ConflictException('Reservation is no longer pending');
      }
      const fresh = await tx.reservation.findUniqueOrThrow({ where: { id } });
      if (fresh.buyerConfirmed && fresh.creatorConfirmed) {
        await tx.reservation.update({
          where: { id },
          data: { status: ReservationStatus.COMPLETED },
        });
        await tx.user.update({
          where: { id: reservation.buyerId },
          data: { consecutiveCancellations: 0 },
        });
      }
      return tx.reservation.findUniqueOrThrow({
        where: { id },
        include: RESERVATION_INCLUDE,
      });
    });
  }

  async cancelByBuyer(id: string, user: User) {
    const reservation = await this.getPartyReservation(id, user);
    if (reservation.buyerId !== user.id) {
      throw new ForbiddenException('Only the buyer can cancel this reservation');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.reservation.updateMany({
        where: { id, status: ReservationStatus.PENDING },
        data: { status: ReservationStatus.CANCELLED_BY_BUYER },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Reservation is no longer pending');
      }
      const now = new Date();
      await this.sync.restockOffer(tx, reservation, now);
      const buyer = await tx.user.findUniqueOrThrow({
        where: { id: reservation.buyerId },
        select: {
          id: true,
          phone: true,
          consecutiveCancellations: true,
          suspensionCount: true,
        },
      });
      await this.sync.penalizeBuyer(tx, buyer, now);
      return tx.reservation.findUniqueOrThrow({
        where: { id },
        include: RESERVATION_INCLUDE,
      });
    });
  }

  async cancelByCreator(id: string, user: User) {
    const reservation = await this.getPartyReservation(id, user);
    if (reservation.offer.creatorId !== user.id) {
      throw new ForbiddenException('Only the creator can cancel this reservation');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.reservation.updateMany({
        where: { id, status: ReservationStatus.PENDING },
        data: { status: ReservationStatus.CANCELLED_BY_CREATOR },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Reservation is no longer pending');
      }
      await this.sync.restockOffer(tx, reservation, new Date());
      await tx.user.update({
        where: { id: reservation.offer.creatorId },
        data: { creatorCancellationCount: { increment: 1 } },
      });
      return tx.reservation.findUniqueOrThrow({
        where: { id },
        include: RESERVATION_INCLUDE,
      });
    });
  }

  private async getPartyReservation(
    id: string,
    user: User,
  ): Promise<ReservationWithRelations> {
    await this.sync.syncCatalogState();
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: RESERVATION_INCLUDE,
    });
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }
    if (reservation.status !== ReservationStatus.PENDING) {
      throw new BadRequestException('Reservation is not pending');
    }
    if (reservation.buyerId !== user.id && reservation.offer.creatorId !== user.id) {
      throw new ForbiddenException('You cannot access this reservation');
    }
    return reservation;
  }
}
