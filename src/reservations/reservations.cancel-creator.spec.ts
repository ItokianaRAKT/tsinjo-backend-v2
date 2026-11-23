import { ForbiddenException } from '@nestjs/common';
import { OfferStatus, ReservationStatus, Role, type User } from '@prisma/client';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { OffersSyncService } from '../offers/offers-sync.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReservationsService } from './reservations.service.js';

const makeUser = (overrides: Partial<User> = {}): User =>
  ({ id: 'seller-1', role: Role.MERCHANT, ...overrides }) as User;

const makeReservation = (overrides: Record<string, unknown> = {}) => ({
  id: 'reservation-1',
  buyerId: 'buyer-1',
  offerId: 'offer-1',
  quantity: 2,
  status: ReservationStatus.PENDING,
  offer: {
    id: 'offer-1',
    creatorId: 'seller-1',
    status: OfferStatus.SOLD_OUT,
    quantityAvailable: 0,
    pickupDeadline: new Date(Date.now() + 86_400_000),
    expirationDate: new Date(Date.now() + 172_800_000),
  },
  buyer: { id: 'buyer-1', fullName: 'Aina' },
  ...overrides,
});

const prismaMock = () => ({
  $transaction: vi.fn(),
  reservation: { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  offer: { update: vi.fn(), updateMany: vi.fn() },
  user: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  phoneCooldown: { upsert: vi.fn() },
});

describe('ReservationsService.cancelByCreator', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let sync: OffersSyncService;
  let syncSpy: MockInstance;
  let service: ReservationsService;

  beforeEach(() => {
    prisma = prismaMock();
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
    sync = new OffersSyncService(prisma as unknown as PrismaService);
    syncSpy = vi.spyOn(sync, 'syncCatalogState').mockResolvedValue(undefined);
    service = new ReservationsService(prisma as unknown as PrismaService, sync);
    prisma.reservation.findUnique.mockResolvedValue(makeReservation());
    prisma.reservation.updateMany.mockResolvedValue({ count: 1 });
    prisma.reservation.findUniqueOrThrow.mockResolvedValue(makeReservation());
    prisma.offer.update.mockResolvedValue({});
    prisma.user.update.mockResolvedValue({});
  });

  it('restocks and increments creatorCancellationCount without penalizing the buyer', async () => {
    await service.cancelByCreator('reservation-1', makeUser());

    expect(syncSpy).toHaveBeenCalledOnce();
    expect(prisma.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'reservation-1', status: ReservationStatus.PENDING },
      data: { status: ReservationStatus.CANCELLED_BY_CREATOR },
    });
    expect(prisma.offer.update).toHaveBeenCalledWith({
      where: { id: 'offer-1' },
      data: { quantityAvailable: { increment: 2 }, status: OfferStatus.ACTIVE },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'seller-1' },
      data: { creatorCancellationCount: { increment: 1 } },
    });
    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.phoneCooldown.upsert).not.toHaveBeenCalled();
  });

  it('rejects the buyer trying to use the creator route', async () => {
    await expect(
      service.cancelByCreator('reservation-1', makeUser({ id: 'buyer-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
