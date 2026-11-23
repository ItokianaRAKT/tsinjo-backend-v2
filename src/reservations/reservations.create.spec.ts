import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { OfferStatus, type Offer, type User } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { OffersSyncService } from '../offers/offers-sync.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateReservationDto } from './dto/reservations.dto.js';
import { ReservationsService } from './reservations.service.js';

const future = (hours: number): Date => new Date(Date.now() + hours * 3_600_000);
const past = (hours: number): Date => new Date(Date.now() - hours * 3_600_000);

const makeUser = (overrides: Partial<User> = {}): User =>
  ({ id: 'buyer-1', role: 'USER' as User['role'], ...overrides }) as User;

const makeOffer = (overrides: Partial<Offer> = {}): Offer =>
  ({
    id: 'offer-1',
    creatorId: 'seller-1',
    status: OfferStatus.ACTIVE,
    quantityAvailable: 1,
    pickupDeadline: future(24),
    expirationDate: future(48),
    ...overrides,
  }) as Offer;

const dto = (overrides: Record<string, unknown> = {}) =>
  plainToInstance(CreateReservationDto, {
    offerId: '9c1d5e70-5a2b-4cd3-8f21-0b6f4a2e9d11',
    quantity: 1,
    estimatedPickupTime: future(2),
    ...overrides,
  });

const prismaMock = () => ({
  $transaction: vi.fn(),
  offer: { findUnique: vi.fn(), updateMany: vi.fn() },
  reservation: { create: vi.fn() },
});

describe('ReservationsService.create', () => {
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
    prisma.offer.findUnique.mockResolvedValue(makeOffer());
    prisma.offer.updateMany.mockResolvedValue({ count: 1 });
    prisma.reservation.create.mockResolvedValue({ id: 'reservation-1' });
  });

  it('validates offerId, quantity and estimatedPickupTime', async () => {
    const errors = await validate(
      plainToInstance(CreateReservationDto, {
        offerId: 'not-a-uuid',
        quantity: 0,
        estimatedPickupTime: 'not-a-date',
      }),
    );

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['offerId', 'quantity', 'estimatedPickupTime']),
    );
  });

  it('syncs the catalog, decrements stock and creates a PENDING reservation', async () => {
    const input = dto();

    const result = await service.create(makeUser(), input);

    expect(syncSpy).toHaveBeenCalledOnce();
    expect(prisma.offer.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'offer-1',
        status: OfferStatus.ACTIVE,
        quantityAvailable: { gte: 1 },
      },
      data: { quantityAvailable: { decrement: 1 } },
    });
    expect(prisma.offer.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'offer-1', quantityAvailable: 0 },
      data: { status: OfferStatus.SOLD_OUT },
    });
    expect(prisma.reservation.create).toHaveBeenCalledWith({
      data: {
        buyerId: 'buyer-1',
        offerId: 'offer-1',
        quantity: 1,
        estimatedPickupTime: input.estimatedPickupTime,
        status: 'PENDING',
      },
    });
    expect(result).toEqual({ id: 'reservation-1' });
  });

  it('keeps the offer ACTIVE while stock remains', async () => {
    prisma.offer.findUnique.mockResolvedValue(makeOffer({ quantityAvailable: 3 }));

    await service.create(makeUser(), dto({ quantity: 1 }));

    expect(prisma.offer.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'offer-1', quantityAvailable: 0 },
      data: { status: OfferStatus.SOLD_OUT },
    });
  });

  it('rejects a reservation on your own offer', async () => {
    prisma.offer.findUnique.mockResolvedValue(makeOffer({ creatorId: 'buyer-1' }));

    await expect(service.create(makeUser(), dto())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: OfferStatus.SOLD_OUT }, {}],
    [{ quantityAvailable: 0 }, {}],
    [{ pickupDeadline: past(1) }, {}],
    [{ expirationDate: past(1) }, {}],
    [{}, { estimatedPickupTime: future(48) }],
  ])('rejects an unavailable offer or an invalid pickup time', async (offer, input) => {
    prisma.offer.findUnique.mockResolvedValue(makeOffer(offer));

    await expect(service.create(makeUser(), dto(input))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  it('rejects a past pickup time', async () => {
    await expect(
      service.create(makeUser(), dto({ estimatedPickupTime: past(1) })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails when stock changed before the transaction', async () => {
    prisma.offer.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.create(makeUser(), dto())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });
});
