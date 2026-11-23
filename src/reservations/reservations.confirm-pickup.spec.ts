import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OfferStatus, ReservationStatus, Role, type User } from '@prisma/client';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { OffersSyncService } from '../offers/offers-sync.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReservationsService } from './reservations.service.js';

const makeUser = (overrides: Partial<User> = {}): User =>
  ({ id: 'buyer-1', role: Role.USER, ...overrides }) as User;

const makeReservation = (overrides: Record<string, unknown> = {}) => ({
  id: 'reservation-1',
  buyerId: 'buyer-1',
  offerId: 'offer-1',
  quantity: 1,
  status: ReservationStatus.PENDING,
  buyerConfirmed: false,
  creatorConfirmed: false,
  offer: {
    id: 'offer-1',
    creatorId: 'seller-1',
    status: OfferStatus.ACTIVE,
    quantityAvailable: 0,
    pickupDeadline: new Date(Date.now() + 86_400_000),
    expirationDate: new Date(Date.now() + 172_800_000),
  },
  buyer: { id: 'buyer-1', fullName: 'Aina' },
  ...overrides,
});

const prismaMock = () => ({
  $transaction: vi.fn(),
  reservation: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  },
  user: { update: vi.fn() },
});

describe('ReservationsService.confirmPickup', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let sync: OffersSyncService;
  let syncSpy: MockInstance;
  let service: ReservationsService;
  const reservation = makeReservation();

  beforeEach(() => {
    prisma = prismaMock();
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
    sync = new OffersSyncService(prisma as unknown as PrismaService);
    syncSpy = vi.spyOn(sync, 'syncCatalogState').mockResolvedValue(undefined);
    service = new ReservationsService(prisma as unknown as PrismaService, sync);
    prisma.reservation.findUnique.mockResolvedValue(reservation);
    prisma.reservation.updateMany.mockResolvedValue({ count: 1 });
    prisma.reservation.findUniqueOrThrow.mockResolvedValue(reservation);
    prisma.reservation.update.mockResolvedValue({});
    prisma.user.update.mockResolvedValue({});
  });

  it('sets buyerConfirmed without completing on the first confirmation', async () => {
    prisma.reservation.findUniqueOrThrow
      .mockResolvedValueOnce(makeReservation({ buyerConfirmed: true }))
      .mockResolvedValueOnce(makeReservation({ buyerConfirmed: true }));

    await service.confirmPickup('reservation-1', makeUser());

    expect(syncSpy).toHaveBeenCalledOnce();
    expect(prisma.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'reservation-1', status: ReservationStatus.PENDING },
      data: { buyerConfirmed: true },
    });
    expect(prisma.reservation.update).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('sets creatorConfirmed when the seller validates first', async () => {
    prisma.reservation.findUniqueOrThrow
      .mockResolvedValueOnce(makeReservation({ creatorConfirmed: true }))
      .mockResolvedValueOnce(makeReservation({ creatorConfirmed: true }));

    await service.confirmPickup('reservation-1', makeUser({ id: 'seller-1' }));

    expect(prisma.reservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { creatorConfirmed: true } }),
    );
    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('completes and resets consecutiveCancellations once both confirmed', async () => {
    prisma.reservation.findUniqueOrThrow
      .mockResolvedValueOnce(
        makeReservation({ buyerConfirmed: true, creatorConfirmed: true }),
      )
      .mockResolvedValueOnce(
        makeReservation({
          buyerConfirmed: true,
          creatorConfirmed: true,
          status: ReservationStatus.COMPLETED,
        }),
      );

    await service.confirmPickup('reservation-1', makeUser({ id: 'seller-1' }));

    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'reservation-1' },
      data: { status: ReservationStatus.COMPLETED },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'buyer-1' },
      data: { consecutiveCancellations: 0 },
    });
  });

  it('rejects an unrelated caller and a non-pending reservation', async () => {
    await expect(
      service.confirmPickup('reservation-1', makeUser({ id: 'stranger-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);

    prisma.reservation.findUnique.mockResolvedValue(
      makeReservation({ status: ReservationStatus.COMPLETED }),
    );
    await expect(
      service.confirmPickup('reservation-1', makeUser()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
