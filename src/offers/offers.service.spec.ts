import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, type User } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateOfferDto, ListOffersDto, UpdateOfferDto } from './dto/offers.dto.js';
import { OffersSyncService } from './offers-sync.service.js';
import { OffersService } from './offers.service.js';

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  email: null,
  phone: '+261341234567',
  isPhoneVerified: true,
  passwordHash: 'hash',
  fullName: 'Jean Rakoto',
  role: Role.USER,
  consecutiveCancellations: 0,
  creatorCancellationCount: 0,
  acceptedReportsCount: 0,
  suspensionCount: 0,
  suspendedUntil: null,
  isPermanentlyBanned: false,
  isManuallyBlocked: false,
  blockReason: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const future = (hours: number): Date => new Date(Date.now() + hours * 3_600_000);

const validDto = {
  title: 'Panier surprise',
  description: 'Pains et viennoiseries du jour',
  category: 'PANIER_SURPRISE',
  images: [{ url: '/uploads/offers/abc.jpg', isMain: true }],
  price: 2000,
  expirationDate: future(48).toISOString(),
  pickupDeadline: future(24).toISOString(),
  address: '12 rue de l\'Indépendance',
  quartier: 'Analakely',
  latitude: -18.9092,
  longitude: 47.5237,
};

const prismaMock = () => ({
  $transaction: vi.fn(),
  offer: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  reservation: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
  user: { update: vi.fn() },
  phoneCooldown: { upsert: vi.fn() },
  merchant: { findUnique: vi.fn() },
});

const makeOffer = (overrides: Record<string, unknown> = {}) => ({
  id: 'offer-1',
  creatorId: 'user-1',
  merchantId: null,
  title: 'Panier surprise',
  description: null,
  category: 'PANIER_SURPRISE',
  originalPrice: null,
  price: 2000,
  quantityAvailable: 1,
  address: 'Rue',
  quartier: 'Analakely',
  latitude: -18.9,
  longitude: 47.5,
  expirationDate: future(48),
  pickupDeadline: future(24),
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
  images: [],
  creator: { id: 'user-1', fullName: 'Jean Rakoto', creatorCancellationCount: 0 },
  merchant: null,
  ...overrides,
});

const makeMerchant = () => ({
  id: 'merchant-1',
  ownerId: 'user-1',
  businessName: 'Boulangerie Fiangonana',
  description: null,
  address: '12 rue de l\'Indépendance',
  quartier: 'Analakely',
  latitude: -18.9092,
  longitude: 47.5237,
  isVerified: false,
  averageRating: 0,
  reviewCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('OffersService', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let service: OffersService;
  let sync: OffersSyncService;

  beforeEach(() => {
    prisma = prismaMock();
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(prisma),
    );
    prisma.reservation.findMany.mockResolvedValue([]);
    sync = new OffersSyncService(prisma as unknown as PrismaService);
    service = new OffersService(prisma as unknown as PrismaService, sync);
  });

  describe('CreateOfferDto validation', () => {
    it('rejects an offer without any photo', async () => {
      const dto = plainToInstance(CreateOfferDto, { ...validDto, images: [] });
      const errors = await validate(dto);

      expect(errors.map((error) => error.property)).toContain('images');
    });

    it('accepts an offer with one photo', async () => {
      const dto = plainToInstance(CreateOfferDto, validDto);
      const errors = await validate(dto);

      expect(errors).toHaveLength(0);
    });
  });

  describe('create', () => {
    const validInstance = () => plainToInstance(CreateOfferDto, validDto);

    it('rejects pickupDeadline greater than or equal to expirationDate', async () => {
      const dto = plainToInstance(CreateOfferDto, {
        ...validDto,
        pickupDeadline: future(48).toISOString(),
        expirationDate: future(48).toISOString(),
      });

      await expect(service.create(makeUser(), dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.offer.create).not.toHaveBeenCalled();
    });

    it('rejects pickupDeadline in the past', async () => {
      const dto = plainToInstance(CreateOfferDto, {
        ...validDto,
        pickupDeadline: new Date(Date.now() - 1000).toISOString(),
      });

      await expect(service.create(makeUser(), dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('forces originalPrice to null for a simple USER', async () => {
      prisma.offer.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'offer-1', ...data }),
      );
      const dto = plainToInstance(CreateOfferDto, {
        ...validDto,
        originalPrice: 5000,
      });

      const result = await service.create(makeUser({ role: Role.USER }), dto);

      expect(prisma.offer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ originalPrice: null }),
        }),
      );
      expect(result.originalPrice).toBeNull();
    });

    it('keeps originalPrice for a MERCHANT with a shop when >= price', async () => {
      prisma.merchant.findUnique.mockResolvedValue(makeMerchant());
      prisma.offer.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'offer-1', ...data }),
      );
      const dto = plainToInstance(CreateOfferDto, {
        ...validDto,
        originalPrice: 2000,
      });

      await service.create(makeUser({ role: Role.MERCHANT }), dto);

      expect(prisma.offer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            originalPrice: 2000,
            merchantId: 'merchant-1',
            address: '12 rue de l\'Indépendance',
          }),
        }),
      );
    });

    it('rejects originalPrice lower than price for a MERCHANT', async () => {
      prisma.merchant.findUnique.mockResolvedValue(makeMerchant());
      const dto = plainToInstance(CreateOfferDto, {
        ...validDto,
        originalPrice: 1500,
      });

      await expect(
        service.create(makeUser({ role: Role.MERCHANT }), dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an ADMIN account', async () => {
      await expect(
        service.create(makeUser({ role: Role.ADMIN }), validInstance()),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findAll', () => {
    it('runs the lazy sync before reading the catalogue', async () => {
      prisma.reservation.findMany.mockResolvedValue([]);
      prisma.offer.findMany.mockResolvedValue([]);

      await service.findAll(plainToInstance(ListOffersDto, {}));

      expect(prisma.reservation.findMany).toHaveBeenCalled();
      expect(prisma.offer.findMany).toHaveBeenCalled();
    });

    it('requires lat and lng together', async () => {
      await expect(
        service.findAll(plainToInstance(ListOffersDto, { lat: -18.9 })),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires lat and lng for sortBy=distance', async () => {
      await expect(
        service.findAll(plainToInstance(ListOffersDto, { sortBy: 'distance' })),
      ).rejects.toThrow(BadRequestException);
    });

    it('keeps existing filters and hides banned creators', async () => {
      prisma.offer.findMany.mockResolvedValue([]);

      await service.findAll(plainToInstance(ListOffersDto, { category: 'BOULANGERIE' }));

      expect(prisma.offer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            category: 'BOULANGERIE',
            creator: expect.objectContaining({
              isPermanentlyBanned: false,
              isManuallyBlocked: false,
              deletedAt: null,
            }),
          }),
        }),
      );
    });

    it('paginates with default page 1 and limit 20', async () => {
      const offers = Array.from({ length: 25 }, (_, i) =>
        makeOffer({ id: `offer-${i}`, expirationDate: future(48 + i) }),
      );
      prisma.offer.findMany.mockResolvedValue(offers);

      const result = await service.findAll(
        plainToInstance(ListOffersDto, { sortBy: 'dlc' }),
      );

      expect(result).toHaveLength(20);
      expect(result[0].id).toBe('offer-0');
    });

    it('paginates after sorting', async () => {
      prisma.offer.findMany.mockResolvedValue([
        makeOffer({ id: 'a', expirationDate: future(30) }),
        makeOffer({ id: 'b', expirationDate: future(10) }),
        makeOffer({ id: 'c', expirationDate: future(20) }),
      ]);

      const result = await service.findAll(
        plainToInstance(ListOffersDto, { sortBy: 'dlc', page: 2, limit: 1 }),
      );

      expect(result.map((offer) => offer.id)).toEqual(['c']);
    });

    it('rejects limit above 100', async () => {
      const errors = await validate(plainToInstance(ListOffersDto, { limit: 101 }));

      expect(errors.map((error) => error.property)).toContain('limit');
    });
  });

  describe('findOne', () => {
    it('returns the offer with its discount percentage', async () => {
      prisma.offer.findFirst.mockResolvedValue(
        makeOffer({ price: 2000, originalPrice: 5000 }),
      );

      const result = await service.findOne('offer-1');

      expect(result.discountPercentage).toBe(60);
    });

    it('returns 404 when the creator is banned, blocked, suspended or deleted', async () => {
      prisma.offer.findFirst.mockResolvedValue(null);

      await expect(service.findOne('offer-1')).rejects.toThrow(NotFoundException);
      expect(prisma.offer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'offer-1',
            creator: expect.objectContaining({
              isPermanentlyBanned: false,
              isManuallyBlocked: false,
              deletedAt: null,
            }),
          }),
        }),
      );
    });
  });

  describe('update', () => {
    it('returns 404 when the offer does not exist', async () => {
      prisma.offer.findUnique.mockResolvedValue(null);

      await expect(
        service.update('offer-1', makeUser(), plainToInstance(UpdateOfferDto, {})),
      ).rejects.toThrow(NotFoundException);
    });

    it('forbids a user who does not own the offer', async () => {
      prisma.offer.findUnique.mockResolvedValue(makeOffer({ creatorId: 'other' }));

      await expect(
        service.update('offer-1', makeUser(), plainToInstance(UpdateOfferDto, {})),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a pickupDeadline after the expirationDate', async () => {
      prisma.offer.findUnique.mockResolvedValue(makeOffer());

      await expect(
        service.update(
          'offer-1',
          makeUser(),
          plainToInstance(UpdateOfferDto, {
            pickupDeadline: future(72).toISOString(),
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates fields and replaces images', async () => {
      const offer = makeOffer();
      prisma.offer.findUnique.mockResolvedValue(offer);
      prisma.offer.update.mockResolvedValue({
        ...offer,
        price: 1500,
        images: [{ url: '/uploads/offers/new.jpg', isMain: true }],
      });
      const images = [{ url: '/uploads/offers/new.jpg', isMain: true }];

      const result = await service.update(
        'offer-1',
        makeUser(),
        plainToInstance(UpdateOfferDto, { price: 1500, images }),
      );

      expect(prisma.offer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'offer-1' },
          data: expect.objectContaining({
            price: 1500,
            images: { deleteMany: {}, create: images },
          }),
        }),
      );
      expect(result.price).toBe(1500);
    });

    it('allows an ADMIN to update someone else\'s offer', async () => {
      const offer = makeOffer({ creatorId: 'other' });
      prisma.offer.findUnique.mockResolvedValue(offer);
      prisma.offer.update.mockResolvedValue(offer);

      await expect(
        service.update('offer-1', makeUser({ role: Role.ADMIN }), plainToInstance(UpdateOfferDto, {})),
      ).resolves.toBeDefined();
    });
  });

  describe('remove', () => {
    it('soft-expires an offer that has reservations', async () => {
      prisma.offer.findUnique.mockResolvedValue(makeOffer());
      prisma.reservation.count.mockResolvedValue(2);
      prisma.offer.update.mockResolvedValue(makeOffer({ status: 'EXPIRED' }));

      const result = await service.remove('offer-1', makeUser());

      expect(prisma.offer.delete).not.toHaveBeenCalled();
      expect(prisma.offer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'EXPIRED' } }),
      );
      expect(result).toEqual({ id: 'offer-1', deleted: false, status: 'EXPIRED' });
    });

    it('physically deletes an offer without reservations', async () => {
      prisma.offer.findUnique.mockResolvedValue(makeOffer());
      prisma.reservation.count.mockResolvedValue(0);
      prisma.offer.delete.mockResolvedValue(makeOffer());

      const result = await service.remove('offer-1', makeUser());

      expect(prisma.offer.delete).toHaveBeenCalledWith({ where: { id: 'offer-1' } });
      expect(result).toEqual({ id: 'offer-1', deleted: true, status: null });
    });
  });
});
