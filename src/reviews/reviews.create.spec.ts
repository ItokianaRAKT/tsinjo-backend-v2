import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReservationStatus, type User } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateReviewDto, ReviewTargetType } from './dto/reviews.dto.js';
import { ReviewsService } from './reviews.service.js';

const buyer = { id: 'buyer-1' } as User;

const makeDto = (overrides: Record<string, unknown> = {}) =>
  plainToInstance(CreateReviewDto, {
    reservationId: '9c1d5e70-5a2b-4cd3-8f21-0b6f4a2e9d11',
    targetType: ReviewTargetType.MERCHANT,
    rating: 5,
    comment: 'Excellent accueil',
    ...overrides,
  });

const makeReservation = (overrides: Record<string, unknown> = {}) => ({
  id: '9c1d5e70-5a2b-4cd3-8f21-0b6f4a2e9d11',
  buyerId: 'buyer-1',
  offerId: 'offer-1',
  status: ReservationStatus.COMPLETED,
  offer: { id: 'offer-1', merchantId: 'merchant-1' },
  review: null,
  ...overrides,
});

const prismaMock = () => ({
  $transaction: vi.fn(),
  reservation: { findUnique: vi.fn() },
  review: { create: vi.fn(), aggregate: vi.fn() },
  merchant: { update: vi.fn() },
});

describe('ReviewsService.create', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let service: ReviewsService;

  beforeEach(() => {
    prisma = prismaMock();
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.reservation.findUnique.mockResolvedValue(makeReservation());
    prisma.review.create.mockResolvedValue({ id: 'review-1' });
    prisma.review.aggregate.mockResolvedValue({ _avg: { rating: 13 / 3 }, _count: 3 });
    prisma.merchant.update.mockResolvedValue({});
    service = new ReviewsService(prisma as unknown as PrismaService);
  });

  it('validates reservationId, targetType, rating and comment', async () => {
    const errors = await validate(
      makeDto({ reservationId: 'nope', targetType: 'PRODUCT', rating: 6, comment: 42 }),
    );

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['reservationId', 'targetType', 'rating', 'comment']),
    );
  });

  it('rejects a missing reservation and a reservation owned by someone else', async () => {
    prisma.reservation.findUnique.mockResolvedValueOnce(null);
    await expect(service.create(buyer, makeDto())).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.reservation.findUnique.mockResolvedValueOnce(
      makeReservation({ buyerId: 'other-user' }),
    );
    await expect(service.create(buyer, makeDto())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a reservation that is not COMPLETED', async () => {
    prisma.reservation.findUnique.mockResolvedValue(
      makeReservation({ status: ReservationStatus.PENDING }),
    );

    await expect(service.create(buyer, makeDto())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.review.create).not.toHaveBeenCalled();
  });

  it('rejects a reservation that is already reviewed', async () => {
    prisma.reservation.findUnique.mockResolvedValue(
      makeReservation({ review: { id: 'review-1' } }),
    );

    await expect(service.create(buyer, makeDto())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a merchant target when the offer has no merchant', async () => {
    prisma.reservation.findUnique.mockResolvedValue(
      makeReservation({ offer: { id: 'offer-1', merchantId: null } }),
    );

    await expect(service.create(buyer, makeDto())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('creates a merchant review and recalculates the merchant stats from direct and offer reviews', async () => {
    const result = await service.create(buyer, makeDto());

    expect(prisma.review.create).toHaveBeenCalledWith({
      data: {
        authorId: 'buyer-1',
        reservationId: '9c1d5e70-5a2b-4cd3-8f21-0b6f4a2e9d11',
        offerId: null,
        merchantId: 'merchant-1',
        rating: 5,
        comment: 'Excellent accueil',
      },
    });
    expect(prisma.review.aggregate).toHaveBeenCalledWith({
      where: {
        OR: [{ merchantId: 'merchant-1' }, { offer: { merchantId: 'merchant-1' } }],
      },
      _avg: { rating: true },
      _count: true,
    });
    expect(prisma.merchant.update).toHaveBeenCalledWith({
      where: { id: 'merchant-1' },
      data: { averageRating: 4.33, reviewCount: 3 },
    });
    expect(result).toEqual({ id: 'review-1' });
  });

  it('creates an offer review but keeps the owning merchant stats up to date', async () => {
    await service.create(buyer, makeDto({ targetType: ReviewTargetType.OFFER }));

    expect(prisma.review.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ offerId: 'offer-1', merchantId: null }),
    });
    expect(prisma.merchant.update).toHaveBeenCalledWith({
      where: { id: 'merchant-1' },
      data: { averageRating: 4.33, reviewCount: 3 },
    });
  });

  it('skips the merchant update for an offer without a merchant', async () => {
    prisma.reservation.findUnique.mockResolvedValue(
      makeReservation({ offer: { id: 'offer-1', merchantId: null } }),
    );

    await service.create(buyer, makeDto({ targetType: ReviewTargetType.OFFER }));

    expect(prisma.review.aggregate).not.toHaveBeenCalled();
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });

  it('maps a concurrent unique violation to a conflict', async () => {
    prisma.review.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.create(buyer, makeDto())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
