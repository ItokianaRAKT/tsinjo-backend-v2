import { OfferStatus, ReservationStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { OffersSyncService } from './offers-sync.service.js';

const future = (hours: number): Date => new Date(Date.now() + hours * 3_600_000);

const prismaMock = () => ({
  $transaction: vi.fn(),
  reservation: { findMany: vi.fn(), update: vi.fn() },
  offer: { update: vi.fn(), updateMany: vi.fn() },
  user: { update: vi.fn() },
  phoneCooldown: { upsert: vi.fn() },
});

const makeStaleReservation = (overrides: Record<string, unknown> = {}) => ({
  id: 'reservation-1',
  buyerId: 'buyer-1',
  offerId: 'offer-1',
  quantity: 2,
  estimatedPickupTime: new Date(Date.now() - 2 * 3_600_000),
  status: ReservationStatus.PENDING,
  buyer: {
    id: 'buyer-1',
    phone: '+261340000000',
    consecutiveCancellations: 0,
    suspensionCount: 0,
  },
  offer: {
    id: 'offer-1',
    status: OfferStatus.SOLD_OUT,
    quantityAvailable: 0,
    pickupDeadline: future(24),
    expirationDate: future(48),
  },
  ...overrides,
});

describe('OffersSyncService (lazy, no cron)', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let sync: OffersSyncService;

  beforeEach(() => {
    prisma = prismaMock();
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
    sync = new OffersSyncService(prisma as unknown as PrismaService);
  });

  it('flags a PENDING reservation older than 1h as NO_SHOW, restocks and increments the buyer counter', async () => {
    prisma.reservation.findMany.mockResolvedValue([makeStaleReservation()]);

    await sync.syncCatalogState();

    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'reservation-1' },
      data: { status: ReservationStatus.NO_SHOW },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'buyer-1' },
      data: { consecutiveCancellations: 1 },
    });
    // Quantité réinjectée + retour en ACTIVE (SOLD_OUT et pickupDeadline future)
    expect(prisma.offer.update).toHaveBeenCalledWith({
      where: { id: 'offer-1' },
      data: { quantityAvailable: { increment: 2 }, status: OfferStatus.ACTIVE },
    });
    expect(prisma.offer.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: { in: [OfferStatus.ACTIVE, OfferStatus.SOLD_OUT] } }),
      data: { status: OfferStatus.EXPIRED },
    });
  });

  it('does not touch reservations picked up less than 1h ago', async () => {
    prisma.reservation.findMany.mockResolvedValue([]);

    await sync.syncCatalogState();

    expect(prisma.reservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          estimatedPickupTime: { lt: expect.any(Date) },
        }),
      }),
    );
    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('suspends the buyer 7 days when consecutiveCancellations reach 3', async () => {
    prisma.reservation.findMany.mockResolvedValue([
      makeStaleReservation({
        buyer: {
          id: 'buyer-1',
          phone: '+261340000000',
          consecutiveCancellations: 2,
          suspensionCount: 0,
        },
      }),
    ]);

    await sync.syncCatalogState();

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'buyer-1' },
      data: expect.objectContaining({
        consecutiveCancellations: 0,
        suspensionCount: 1,
        suspendedUntil: expect.any(Date),
      }),
    });
  });
});
