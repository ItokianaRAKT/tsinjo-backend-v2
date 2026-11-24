import { Injectable } from '@nestjs/common';
import { OfferStatus, Prisma, ReservationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const ONE_HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * ONE_HOUR_MS;
const SUSPENSION_DAYS = [7, 14];
const PHONE_QUARANTINE_DAYS = 60;

/**
 * Synchronisation lazy du catalogue (aucun cron) : no-shows des réservations
 * en retard puis expiration des offres dont les dates sont passées.
 */
@Injectable()
export class OffersSyncService {
  constructor(private readonly prisma: PrismaService) {}

  async syncCatalogState(): Promise<void> {
    const now = new Date();
    const noShowBefore = new Date(now.getTime() - ONE_HOUR_MS);
    await this.prisma.$transaction(async (tx) => {
      const staleReservations = await tx.reservation.findMany({
        where: { status: ReservationStatus.PENDING, estimatedPickupTime: { lt: noShowBefore } },
        include: { offer: true, buyer: true },
      });
      for (const reservation of staleReservations) {
        // Transition conditionnelle : deux synchro concurrentes ne peuvent pas
        // pénaliser/injecter deux fois la même réservation.
        const flagged = await tx.reservation.updateMany({
          where: { id: reservation.id, status: ReservationStatus.PENDING },
          data: { status: ReservationStatus.NO_SHOW },
        });
        if (flagged.count !== 1) {
          continue;
        }
        await this.penalizeBuyer(tx, reservation.buyer, now);
        await this.restockOffer(tx, reservation, now);
      }
      await tx.offer.updateMany({
        where: {
          status: { in: [OfferStatus.ACTIVE, OfferStatus.SOLD_OUT] },
          OR: [{ pickupDeadline: { lte: now } }, { expirationDate: { lte: now } }],
        },
        data: { status: OfferStatus.EXPIRED },
      });
    });
  }

  async penalizeBuyer(
    tx: Prisma.TransactionClient,
    buyer: { id: string; phone: string; consecutiveCancellations: number; suspensionCount: number },
    now: Date,
  ): Promise<void> {
    const nextCount = buyer.consecutiveCancellations + 1;
    const data: Prisma.UserUpdateInput = { consecutiveCancellations: nextCount };
    if (nextCount >= 3) {
      const nextSuspensions = buyer.suspensionCount + 1;
      data.suspensionCount = nextSuspensions;
      if (nextSuspensions === 1) {
        data.suspendedUntil = new Date(now.getTime() + SUSPENSION_DAYS[0] * DAY_MS);
      } else if (nextSuspensions === 2) {
        data.suspendedUntil = new Date(now.getTime() + SUSPENSION_DAYS[1] * DAY_MS);
      } else {
        data.isPermanentlyBanned = true;
        const availableAfter = new Date(now.getTime() + PHONE_QUARANTINE_DAYS * DAY_MS);
        await tx.phoneCooldown.upsert({
          where: { phone: buyer.phone },
          create: { phone: buyer.phone, reason: 'PERMANENT_BAN', availableAfter },
          update: { reason: 'PERMANENT_BAN', availableAfter },
        });
        await tx.offer.updateMany({
          where: { creatorId: buyer.id, status: OfferStatus.ACTIVE },
          data: { status: OfferStatus.SUSPENDED },
        });
      }
      // Reset après sanction : permet l'échelle 7j -> 14j -> ban définitif
      data.consecutiveCancellations = 0;
    }
    await tx.user.update({ where: { id: buyer.id }, data });
  }

  async restockOffer(
    tx: Prisma.TransactionClient,
    reservation: {
      quantity: number;
      offer: {
        id: string;
        status: OfferStatus;
        quantityAvailable: number;
        pickupDeadline: Date;
        expirationDate: Date;
      };
    },
    now: Date,
  ): Promise<void> {
    const offer = reservation.offer;
    const reactivate =
      offer.status === OfferStatus.SOLD_OUT &&
      offer.pickupDeadline > now &&
      offer.expirationDate > now;
    await tx.offer.update({
      where: { id: offer.id },
      data: {
        quantityAvailable: { increment: reservation.quantity },
        ...(reactivate ? { status: OfferStatus.ACTIVE } : {}),
      },
    });
  }
}
