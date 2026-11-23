import { ConflictException, NotFoundException } from '@nestjs/common';
import { OfferStatus, Role, User } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BlockUserDto,
  ListUsersDto,
  UpdateProfileDto,
} from './dto/users.dto.js';
import { UsersService } from './users.service.js';

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  email: null,
  phone: '+261341234567',
  isPhoneVerified: true,
  passwordHash: 'hash',
  fullName: 'Test User',
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

const prismaMock = () => ({
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
  refreshToken: { deleteMany: vi.fn() },
  offer: { updateMany: vi.fn() },
  phoneCooldown: { upsert: vi.fn() },
  $transaction: vi.fn(),
});

const listDto = (overrides: Partial<ListUsersDto> = {}): ListUsersDto => ({
  page: 1,
  limit: 20,
  ...overrides,
});

describe('UsersService', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let service: UsersService;

  beforeEach(() => {
    prisma = prismaMock();
    // Forme callback et forme tableau de $transaction partagent les mêmes mocks
    prisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => unknown)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    );
    service = new UsersService(prisma as unknown as PrismaService);
  });

  describe('getMe', () => {
    it('returns the profile without passwordHash, with the merchant shop', async () => {
      const merchant = {
        id: 'merchant-1',
        ownerId: 'user-1',
        businessName: 'Chez Jean',
      };
      prisma.user.findUnique.mockResolvedValue({ ...makeUser(), merchant });

      const result = await service.getMe('user-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        include: { merchant: true },
      });
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).toHaveProperty('merchant', merchant);
      expect(result).toHaveProperty('acceptedReportsCount', 0);
    });

    it('throws when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getMe('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateMe', () => {
    it('updates fullName and email without passwordHash in the response', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue(
        makeUser({ fullName: 'New Name', email: 'new@example.mg' }),
      );

      const dto: UpdateProfileDto = {
        fullName: 'New Name',
        email: 'new@example.mg',
      };
      const result = await service.updateMe('user-1', dto);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: dto,
      });
      expect(result).not.toHaveProperty('passwordHash');
      expect(result.fullName).toBe('New Name');
    });

    it('rejects an email already used by another account', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeUser({ id: 'user-2', email: 'taken@example.mg' }),
      );

      await expect(
        service.updateMe('user-1', { email: 'taken@example.mg' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteMe (soft delete)', () => {
    beforeEach(() => {
      prisma.user.update.mockResolvedValue(makeUser());
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });
      prisma.offer.updateMany.mockResolvedValue({ count: 2 });
      prisma.phoneCooldown.upsert.mockResolvedValue({});
    });

    it('soft-deletes, revokes tokens, suspends offers and quarantines the phone for 60 days', async () => {
      const result = await service.deleteMe('user-1');

      expect(result).toEqual({ message: 'Account deleted' });
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(prisma.offer.updateMany).toHaveBeenCalledWith({
        where: { creatorId: 'user-1', status: OfferStatus.ACTIVE },
        data: { status: OfferStatus.SUSPENDED },
      });

      const cooldown = prisma.phoneCooldown.upsert.mock.calls[0][0];
      expect(cooldown.create.reason).toBe('ACCOUNT_DELETED');
      expect(cooldown.create.phone).toBe('+261341234567');
      const remainingMs = cooldown.create.availableAfter.getTime() - Date.now();
      expect(remainingMs).toBeGreaterThan(59 * 24 * 60 * 60 * 1000);
      expect(remainingMs).toBeLessThanOrEqual(60 * 24 * 60 * 60 * 1000);
    });

    it('replaces an existing cooldown on the same phone', async () => {
      await service.deleteMe('user-1');

      const cooldown = prisma.phoneCooldown.upsert.mock.calls[0][0];
      expect(cooldown.where.phone).toBe('+261341234567');
      expect(cooldown.update.reason).toBe('ACCOUNT_DELETED');
    });
  });

  describe('list', () => {
    it('paginates and strips passwordHash', async () => {
      prisma.user.findMany.mockResolvedValue([makeUser()]);
      prisma.user.count.mockResolvedValue(1);

      const result = await service.list(listDto({ page: 2, limit: 10 }));

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result.total).toBe(1);
      expect(result.page).toBe(2);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).not.toHaveProperty('passwordHash');
    });

    it('applies role, block and search filters', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.list(
        listDto({
          role: Role.MERCHANT,
          isManuallyBlocked: true,
          isPermanentlyBanned: false,
          search: 'Rak',
        }),
      );

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            role: Role.MERCHANT,
            isManuallyBlocked: true,
            isPermanentlyBanned: false,
            OR: [
              { fullName: { contains: 'Rak', mode: 'insensitive' } },
              { phone: { contains: 'Rak' } },
            ],
          },
        }),
      );
    });

    it('omits undefined filters', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.list(listDto());

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            role: undefined,
            isManuallyBlocked: undefined,
            isPermanentlyBanned: undefined,
          },
        }),
      );
    });
  });

  describe('block', () => {
    const dto: BlockUserDto = { blockReason: 'Signalement de fraude' };

    it('blocks the user, revokes tokens and suspends active offers in one transaction', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.user.update.mockResolvedValue(
        makeUser({ isManuallyBlocked: true, blockReason: dto.blockReason }),
      );
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });
      prisma.offer.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.block('user-1', dto);

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isManuallyBlocked: true, blockReason: dto.blockReason },
      });
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(prisma.offer.updateMany).toHaveBeenCalledWith({
        where: { creatorId: 'user-1', status: OfferStatus.ACTIVE },
        data: { status: OfferStatus.SUSPENDED },
      });
      expect(result).not.toHaveProperty('passwordHash');
      expect(result.isManuallyBlocked).toBe(true);
    });

    it('throws when the target user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.block('missing', dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('unblock', () => {
    it('clears the manual block and the reason', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ isManuallyBlocked: true, blockReason: 'spam' }),
      );
      prisma.user.update.mockResolvedValue(
        makeUser({ isManuallyBlocked: false, blockReason: null }),
      );

      const result = await service.unblock('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isManuallyBlocked: false, blockReason: null },
      });
      expect(result.isManuallyBlocked).toBe(false);
      expect(result.blockReason).toBeNull();
    });

    it('throws when the target user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.unblock('missing')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
