import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role, type User } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateOfferDto, ListOffersDto } from './dto/offers.dto.js';
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
  });
});
