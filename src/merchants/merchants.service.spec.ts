import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role, User } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMerchantDto, VerifyMerchantDto } from './dto/merchants.dto.js';
import { MerchantsService } from './merchants.service.js';

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  email: null,
  phone: '+261341234567',
  isPhoneVerified: true,
  passwordHash: 'hash',
  fullName: 'Jean Rakoto',
  role: Role.MERCHANT,
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

const makeMerchant = (overrides: Record<string, unknown> = {}) => ({
  id: 'merchant-1',
  ownerId: 'user-1',
  businessName: 'Boulangerie Fiangonana',
  description: 'Pains artisanaux',
  address: "12 rue de l'Indépendance",
  quartier: 'Analakely',
  latitude: -18.9092,
  longitude: 47.5237,
  isVerified: false,
  averageRating: 0,
  reviewCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const prismaMock = () => ({
  merchant: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  user: { update: vi.fn() },
  $transaction: vi.fn(),
});

const validDto = {
  businessName: 'Boulangerie Fiangonana',
  address: "12 rue de l'Indépendance",
  quartier: 'Analakely',
  latitude: -18.9092,
  longitude: 47.5237,
  description: 'Pains et viennoiseries',
};

describe('MerchantsService', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let service: MerchantsService;

  beforeEach(() => {
    prisma = prismaMock();
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(prisma),
    );
    service = new MerchantsService(prisma as unknown as PrismaService);
  });

  describe('CreateMerchantDto validation', () => {
    it('accepts a complete shop payload', async () => {
      const errors = await validate(
        plainToInstance(CreateMerchantDto, validDto),
      );

      expect(errors).toHaveLength(0);
    });

    it('requires address, quartier and GPS coordinates', async () => {
      const errors = await validate(
        plainToInstance(CreateMerchantDto, { businessName: 'Chez Jean' }),
      );

      expect(errors.map((error) => error.property)).toEqual(
        expect.arrayContaining([
          'address',
          'quartier',
          'latitude',
          'longitude',
        ]),
      );
    });

    it('rejects out-of-range coordinates', async () => {
      const errors = await validate(
        plainToInstance(CreateMerchantDto, {
          ...validDto,
          latitude: 91,
          longitude: 200,
        }),
      );

      expect(errors.map((error) => error.property)).toEqual(
        expect.arrayContaining(['latitude', 'longitude']),
      );
    });

    it('keeps description optional', async () => {
      const { description: _description, ...required } = validDto;
      const errors = await validate(
        plainToInstance(CreateMerchantDto, required),
      );

      expect(errors).toHaveLength(0);
    });
  });

  describe('create', () => {
    it('promotes a USER to MERCHANT and creates the shop', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue(makeUser({ role: Role.MERCHANT }));
      prisma.merchant.create.mockResolvedValue(makeMerchant());

      const dto = plainToInstance(CreateMerchantDto, validDto);
      const result = await service.create(makeUser({ role: Role.USER }), dto);

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { role: Role.MERCHANT },
      });
      expect(prisma.merchant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ownerId: 'user-1',
          businessName: validDto.businessName,
          address: validDto.address,
          quartier: validDto.quartier,
          latitude: validDto.latitude,
          longitude: validDto.longitude,
        }),
      });
      expect(result.id).toBe('merchant-1');
    });

    it('creates the shop without touching the role of an existing MERCHANT', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null);
      prisma.merchant.create.mockResolvedValue(makeMerchant());

      await service.create(
        makeUser({ role: Role.MERCHANT }),
        plainToInstance(CreateMerchantDto, validDto),
      );

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.merchant.create).toHaveBeenCalled();
    });

    it('rejects a second shop for the same account', async () => {
      prisma.merchant.findUnique.mockResolvedValue(makeMerchant());

      await expect(
        service.create(
          makeUser({ role: Role.MERCHANT }),
          plainToInstance(CreateMerchantDto, validDto),
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.merchant.create).not.toHaveBeenCalled();
    });

    it('rejects an ADMIN account', async () => {
      await expect(
        service.create(
          makeUser({ role: Role.ADMIN }),
          plainToInstance(CreateMerchantDto, validDto),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.merchant.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('getMe / updateMe', () => {
    it('returns the shop of the connected merchant', async () => {
      prisma.merchant.findUnique.mockResolvedValue(makeMerchant());

      const result = await service.getMe('user-1');

      expect(prisma.merchant.findUnique).toHaveBeenCalledWith({
        where: { ownerId: 'user-1' },
      });
      expect(result.businessName).toBe('Boulangerie Fiangonana');
    });

    it('throws when the connected user has no shop', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null);

      await expect(service.getMe('user-1')).rejects.toThrow(NotFoundException);
    });

    it('updates the shop fields', async () => {
      prisma.merchant.findUnique.mockResolvedValue(makeMerchant());
      prisma.merchant.update.mockResolvedValue(
        makeMerchant({ businessName: 'Nouveau Nom' }),
      );

      const result = await service.updateMe('user-1', {
        businessName: 'Nouveau Nom',
      });

      expect(prisma.merchant.update).toHaveBeenCalledWith({
        where: { ownerId: 'user-1' },
        data: { businessName: 'Nouveau Nom' },
      });
      expect(result.businessName).toBe('Nouveau Nom');
    });
  });

  describe('getById', () => {
    it('returns the public profile with rating and verification status', async () => {
      prisma.merchant.findUnique.mockResolvedValue(
        makeMerchant({ isVerified: true, averageRating: 4.5, reviewCount: 12 }),
      );

      const result = await service.getById('merchant-1');

      expect(result).not.toHaveProperty('ownerId');
      expect(result.isVerified).toBe(true);
      expect(result.averageRating).toBe(4.5);
      expect(result.reviewCount).toBe(12);
    });

    it('throws when the shop does not exist', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null);

      await expect(service.getById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('verify', () => {
    it('certifies a shop', async () => {
      prisma.merchant.findUnique.mockResolvedValue(makeMerchant());
      prisma.merchant.update.mockResolvedValue(
        makeMerchant({ isVerified: true }),
      );

      const dto: VerifyMerchantDto = { isVerified: true };
      const result = await service.verify('merchant-1', dto);

      expect(prisma.merchant.update).toHaveBeenCalledWith({
        where: { id: 'merchant-1' },
        data: { isVerified: true },
      });
      expect(result.isVerified).toBe(true);
    });

    it('decertifies a shop', async () => {
      prisma.merchant.findUnique.mockResolvedValue(
        makeMerchant({ isVerified: true }),
      );
      prisma.merchant.update.mockResolvedValue(
        makeMerchant({ isVerified: false }),
      );

      const result = await service.verify('merchant-1', { isVerified: false });

      expect(result.isVerified).toBe(false);
    });

    it('throws when the shop does not exist', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null);

      await expect(
        service.verify('missing', { isVerified: true }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.merchant.update).not.toHaveBeenCalled();
    });
  });
});
