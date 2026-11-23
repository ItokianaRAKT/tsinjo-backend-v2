import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OfferStatus, ReservationStatus, Role, type User } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { OffersSyncService } from '../offers/offers-sync.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListReservationsDto } from './dto/reservations.dto.js';
import { ReservationsService } from './reservations.service.js';

const makeUser = (overrides: Partial<User> = {}): User =>
  ({ id: 'buyer-1', role: Role.USER, ...overrides }) as User;

const makeOffer = () => ({
  id: 'offer-1',
  creatorId: 'seller-1',
  status: OfferStatus.ACTIVE,
  quantityAvailable: 1,
  pickupDeadline: new Date(Date.now() + 86_400_000),
  expirationDate: new Date(Date.now() + 172_800_000),
});

const makeReservation = () => ({
  id: 'reservation-1',
  buyerId: 'buyer-1',
  offerId: 'offer-1',
  quantity: 1,
  status: ReservationStatus.PENDING,
  offer: makeOffer(),
  buyer: { id: 'buyer-1', fullName: 'Aina' },
});

const prismaMock = () => ({
  reservation: { findMany: vi.fn(), findUnique: vi.fn() },
});

describe('ReservationsService reads', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let sync: OffersSyncService;
  let syncSpy: MockInstance;
  let service: ReservationsService;

  beforeEach(() => {
    prisma = prismaMock();
    sync = new OffersSyncService(prisma as unknown as PrismaService);
    syncSpy = vi.spyOn(sync, 'syncCatalogState').mockResolvedValue(undefined);
    service = new ReservationsService(prisma as unknown as PrismaService, sync);
    prisma.reservation.findMany.mockResolvedValue([makeReservation()]);
    prisma.reservation.findUnique.mockResolvedValue(makeReservation());
  });

  it('validates the list filters', async () => {
    const errors = await validate(
      plainToInstance(ListReservationsDto, { status: 'NOPE', role: 'seller' }),
    );

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['status', 'role']),
    );
  });

  it('lists both bought and received reservations by default', async () => {
    await service.findMine(makeUser(), {});

    expect(syncSpy).toHaveBeenCalledOnce();
    expect(prisma.reservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ buyerId: 'buyer-1' }, { offer: { creatorId: 'buyer-1' } }],
        }),
      }),
    );
  });

  it('applies role and status filters', async () => {
    await service.findMine(
      makeUser(),
      plainToInstance(ListReservationsDto, {
        role: 'creator',
        status: ReservationStatus.COMPLETED,
      }),
    );

    expect(prisma.reservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { offer: { creatorId: 'buyer-1' }, status: ReservationStatus.COMPLETED },
      }),
    );
  });

  it.each([
    makeUser(),
    makeUser({ id: 'seller-1' }),
    makeUser({ id: 'admin-1', role: Role.ADMIN }),
  ])('lets the buyer, creator or ADMIN read a reservation', async (user) => {
    await expect(service.findOne('reservation-1', user)).resolves.toBeDefined();
  });

  it('forbids an unrelated user and reports missing reservations', async () => {
    await expect(
      service.findOne('reservation-1', makeUser({ id: 'stranger-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);

    prisma.reservation.findUnique.mockResolvedValue(null);
    await expect(service.findOne('missing', makeUser())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
