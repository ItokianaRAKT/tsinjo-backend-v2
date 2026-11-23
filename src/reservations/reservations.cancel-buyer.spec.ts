import { ForbiddenException } from '@nestjs/common';
import { OfferStatus, ReservationStatus, Role, type User } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OffersSyncService } from '../offers/offers-sync.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReservationsService } from './reservations.service.js';

const NOW = new Date('2026-11-23T12:00:00.000Z');
const days = (count: number) => new Date(NOW.getTime() + count * 86_400_000);

const makeUser = (overrides: Partial<User> = {}): User =>
  ({ id: 'buyer-1', role: Role.USER, ...overrides }) as User;

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
    pickupDeadline: days(1),
    expirationDate: days(2),
  },
  buyer: { id: 'buyer-1', fullName: 'Aina' },
  ...overrides,
});

const makeBuyerForSanction = (overrides: Record<string, unknown> = {}) => ({
  id: 'buyer-1',
  phone: '+261340000000',
  consecutiveCancellations: 0,
  suspensionCount: 0,
  ...overrides,
});

const prismaMock = () => ({
  $transaction: vi.fn(),
  reservation: { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  offer: { update: vi.fn(), updateMany: vi.fn() },
  user: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  phoneCooldown: { upsert: vi.fn() },
});

describe('ReservationsService.cancelByBuyer', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let sync: OffersSyncService;
  let service: ReservationsService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    prisma = prismaMock();
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
    sync = new OffersSyncService(prisma as unknown as PrismaService);
    vi.spyOn(sync, 'syncCatalogState').mockResolvedValue(undefined);
    service = new ReservationsService(prisma as unknown as PrismaService, sync);
    prisma.reservation.findUnique.mockResolvedValue(makeReservation());
    prisma.reservation.updateMany.mockResolvedValue({ count: 1 });
    prisma.reservation.findUniqueOrThrow.mockResolvedValue(makeReservation());
    prisma.user.findUniqueOrThrow.mockResolvedValue(makeBuyerForSanction());
    prisma.user.update.mockResolvedValue({});
  });

  afterEach(() => vi.useRealTimers());

  it('restocks the offer and increments consecutiveCancellations', async () => {
    await service.cancelByBuyer('reservation-1', makeUser());

    expect(prisma.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'reservation-1', status: ReservationStatus.PENDING },
      data: { status: ReservationStatus.CANCELLED_BY_BUYER },
    });
    expect(prisma.offer.update).toHaveBeenCalledWith({
      where: { id: 'offer-1' },
      data: { quantityAvailable: { increment: 2 }, status: OfferStatus.ACTIVE },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'buyer-1' },
      data: { consecutiveCancellations: 1 },
    });
    expect(prisma.phoneCooldown.upsert).not.toHaveBeenCalled();
  });

  it('suspends for 7 days at the third cancellation', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue(
      makeBuyerForSanction({ consecutiveCancellations: 2, suspensionCount: 0 }),
    );

    await service.cancelByBuyer('reservation-1', makeUser());

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'buyer-1' },
      data: {
        consecutiveCancellations: 0,
        suspensionCount: 1,
        suspendedUntil: days(7),
      },
    });
  });

  it('suspends for 14 days at the next threshold', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue(
      makeBuyerForSanction({ consecutiveCancellations: 2, suspensionCount: 1 }),
    );

    await service.cancelByBuyer('reservation-1', makeUser());

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'buyer-1' },
      data: {
        consecutiveCancellations: 0,
        suspensionCount: 2,
        suspendedUntil: days(14),
      },
    });
  });

  it('bans permanently, quarantines the phone for 60 days and suspends active offers', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue(
      makeBuyerForSanction({ consecutiveCancellations: 2, suspensionCount: 2 }),
    );

    await service.cancelByBuyer('reservation-1', makeUser());

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'buyer-1' },
      data: { isPermanentlyBanned: true, consecutiveCancellations: 0, suspensionCount: 3 },
    });
    expect(prisma.phoneCooldown.upsert).toHaveBeenCalledWith({
      where: { phone: '+261340000000' },
      create: { phone: '+261340000000', reason: 'PERMANENT_BAN', availableAfter: days(60) },
      update: { reason: 'PERMANENT_BAN', availableAfter: days(60) },
    });
    expect(prisma.offer.updateMany).toHaveBeenCalledWith({
      where: { creatorId: 'buyer-1', status: OfferStatus.ACTIVE },
      data: { status: OfferStatus.SUSPENDED },
    });
  });

  it('does not restock an expired offer and rejects non-buyers', async () => {
    prisma.reservation.findUnique.mockResolvedValue(
      makeReservation({
        offer: {
          id: 'offer-1',
          creatorId: 'seller-1',
          status: OfferStatus.SOLD_OUT,
          quantityAvailable: 0,
          pickupDeadline: days(-1),
          expirationDate: days(2),
        },
      }),
    );

    await service.cancelByBuyer('reservation-1', makeUser());

    expect(prisma.offer.update).toHaveBeenCalledWith({
      where: { id: 'offer-1' },
      data: { quantityAvailable: { increment: 2 } },
    });

    prisma.reservation.findUnique.mockResolvedValue(makeReservation());
    await expect(
      service.cancelByBuyer('reservation-1', makeUser({ id: 'seller-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
