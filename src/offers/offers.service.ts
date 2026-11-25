import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Offer,
  OfferStatus,
  Prisma,
  Role,
  User,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateOfferDto, ListOffersDto, UpdateOfferDto } from './dto/offers.dto.js';
import { OffersSyncService } from './offers-sync.service.js';
import { discountPercentage, haversineKm, sortOffers } from './offers.utils.js';

const OFFER_INCLUDE = {
  images: true,
  creator: { select: { id: true, fullName: true, creatorCancellationCount: true } },
  merchant: { select: { id: true, businessName: true } },
} satisfies Prisma.OfferInclude;

type OfferWithRelations = Prisma.OfferGetPayload<{ include: typeof OFFER_INCLUDE }>;

const visibleCreator = (now: Date): Prisma.UserWhereInput => ({
  isPermanentlyBanned: false,
  isManuallyBlocked: false,
  deletedAt: null,
  OR: [{ suspendedUntil: null }, { suspendedUntil: { lt: now } }],
});

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: OffersSyncService,
  ) {}

  async create(
    user: User,
    dto: CreateOfferDto,
  ): Promise<Offer & { discountPercentage: number | null }> {
    if (user.role !== Role.USER && user.role !== Role.MERCHANT) {
      throw new ForbiddenException('Only USER and MERCHANT accounts can publish offers');
    }
    const now = new Date();
    if (dto.pickupDeadline <= now) {
      throw new BadRequestException('pickupDeadline must be strictly after now');
    }
    if (dto.pickupDeadline >= dto.expirationDate) {
      throw new BadRequestException('pickupDeadline must be strictly before expirationDate');
    }

    const merchant =
      user.role === Role.MERCHANT
        ? await this.prisma.merchant.findUnique({ where: { ownerId: user.id } })
        : null;

    // originalPrice réservée aux marchands avec boutique : un USER la voit ignorée
    let originalPrice = dto.originalPrice ?? null;
    if (!merchant) {
      originalPrice = null;
    } else if (originalPrice != null && originalPrice < dto.price) {
      throw new BadRequestException('originalPrice must be greater than or equal to price');
    }

    const address = dto.address ?? merchant?.address;
    const latitude = dto.latitude ?? merchant?.latitude;
    const longitude = dto.longitude ?? merchant?.longitude;
    if (address == null || latitude == null || longitude == null) {
      throw new BadRequestException(
        'address and GPS coordinates are required when the creator has no shop',
      );
    }

    const offer = await this.prisma.offer.create({
      data: {
        creatorId: user.id,
        merchantId: merchant?.id ?? null,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        originalPrice,
        price: dto.price,
        quantityAvailable: dto.quantityAvailable ?? 1,
        address,
        quartier: dto.quartier ?? merchant?.quartier ?? null,
        latitude,
        longitude,
        expirationDate: dto.expirationDate,
        pickupDeadline: dto.pickupDeadline,
        images: { create: dto.images },
      },
      include: { images: true },
    });
    return { ...offer, discountPercentage: discountPercentage(offer) };
  }

  async findAll(dto: ListOffersDto): Promise<
    Array<OfferWithRelations & { discountPercentage: number | null; distanceKm?: number }>
  > {
    const now = new Date();
    if ((dto.lat == null) !== (dto.lng == null)) {
      throw new BadRequestException('lat and lng must be provided together');
    }
    if (dto.sortBy === 'distance' && dto.lat == null) {
      throw new BadRequestException('sortBy=distance requires lat and lng');
    }
    if (dto.maxDistanceKm != null && dto.lat == null) {
      throw new BadRequestException('maxDistanceKm requires lat and lng');
    }
    await this.sync.syncCatalogState();

    const where: Prisma.OfferWhereInput = {
      status: OfferStatus.ACTIVE,
      quantityAvailable: { gt: 0 },
      pickupDeadline: { gt: now },
      expirationDate: { gt: now },
      creator: visibleCreator(now),
      ...(dto.category ? { category: dto.category } : {}),
      ...(dto.quartier ? { quartier: { equals: dto.quartier, mode: 'insensitive' } } : {}),
      ...(dto.merchantId ? { merchantId: dto.merchantId } : {}),
      ...(dto.onlyFree ? { price: 0 } : {}),
      ...(dto.q
        ? {
            OR: [
              { title: { contains: dto.q, mode: 'insensitive' } },
              { description: { contains: dto.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const offers = await this.prisma.offer.findMany({
      where,
      include: OFFER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    let enriched = offers.map((offer) => ({
      ...offer,
      discountPercentage: discountPercentage(offer),
      ...(dto.lat != null && dto.lng != null
        ? { distanceKm: haversineKm(dto.lat, dto.lng, offer.latitude, offer.longitude) }
        : {}),
    }));

    if (dto.maxDistanceKm != null) {
      enriched = enriched.filter(
        (offer) => offer.distanceKm != null && offer.distanceKm <= dto.maxDistanceKm!,
      );
    }

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    // shortcut: pagination après tri/filtre en mémoire (maxDistanceKm), passer en SQL si le catalogue grossit
    return sortOffers(enriched, dto.sortBy ?? 'default', dto.lat, dto.lng, now).slice(
      (page - 1) * limit,
      page * limit,
    );
  }

  async findOne(id: string): Promise<
    OfferWithRelations & { discountPercentage: number | null }
  > {
    await this.sync.syncCatalogState();
    const offer = await this.prisma.offer.findFirst({
      where: { id, creator: visibleCreator(new Date()) },
      include: OFFER_INCLUDE,
    });
    if (!offer) {
      throw new NotFoundException('Offer not found');
    }
    return { ...offer, discountPercentage: discountPercentage(offer) };
  }

  async update(
    id: string,
    user: User,
    dto: UpdateOfferDto,
  ): Promise<Offer & { discountPercentage: number | null }> {
    const offer = await this.getOwnedOffer(id, user);
    const now = new Date();
    const pickupDeadline = dto.pickupDeadline ?? offer.pickupDeadline;
    const expirationDate = dto.expirationDate ?? offer.expirationDate;
    if (dto.pickupDeadline && pickupDeadline <= now) {
      throw new BadRequestException('pickupDeadline must be strictly after now');
    }
    if (pickupDeadline >= expirationDate) {
      throw new BadRequestException('pickupDeadline must be strictly before expirationDate');
    }

    const merchant =
      user.role === Role.MERCHANT
        ? await this.prisma.merchant.findUnique({ where: { ownerId: user.id } })
        : null;
    const price = dto.price ?? offer.price;
    let originalPrice = offer.originalPrice;
    if (dto.originalPrice !== undefined) {
      originalPrice = merchant ? dto.originalPrice : null;
    }
    if (originalPrice != null && originalPrice < price) {
      throw new BadRequestException('originalPrice must be greater than or equal to price');
    }

    const { images, ...rest } = dto;
    const updated = await this.prisma.offer.update({
      where: { id },
      data: {
        ...rest,
        price,
        originalPrice,
        pickupDeadline,
        expirationDate,
        ...(images ? { images: { deleteMany: {}, create: images } } : {}),
      },
      include: { images: true },
    });
    return { ...updated, discountPercentage: discountPercentage(updated) };
  }

  async remove(
    id: string,
    user: User,
  ): Promise<{ id: string; deleted: boolean; status: OfferStatus | null }> {
    const offer = await this.getOwnedOffer(id, user);
    const reservationCount = await this.prisma.reservation.count({
      where: { offerId: id },
    });
    if (reservationCount > 0) {
      // Jamais de DELETE SQL sur une offre réservée : on la retire du catalogue
      const updated = await this.prisma.offer.update({
        where: { id },
        data: { status: OfferStatus.EXPIRED },
      });
      return { id: updated.id, deleted: false, status: updated.status };
    }
    await this.prisma.offer.delete({ where: { id } });
    return { id: offer.id, deleted: true, status: null };
  }

  private async getOwnedOffer(id: string, user: User): Promise<Offer> {
    const offer = await this.prisma.offer.findUnique({ where: { id } });
    if (!offer) {
      throw new NotFoundException('Offer not found');
    }
    if (offer.creatorId !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('You can only modify your own offers');
    }
    return offer;
  }
}
