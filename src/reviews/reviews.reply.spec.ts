import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReplyReviewDto } from './dto/reviews.dto.js';
import { ReviewsService } from './reviews.service.js';

const merchantOwner = { id: 'owner-1' } as User;
const dto = () =>
  plainToInstance(ReplyReviewDto, { content: 'Merci pour votre avis !' });

const makeReview = (overrides: Record<string, unknown> = {}) => ({
  id: 'review-1',
  merchant: { ownerId: 'owner-1' },
  offer: { merchant: { ownerId: 'owner-1' } },
  reply: null,
  ...overrides,
});

const prismaMock = () => ({
  review: { findUnique: vi.fn() },
  reviewReply: { create: vi.fn() },
});

describe('ReviewsService.reply', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let service: ReviewsService;

  beforeEach(() => {
    prisma = prismaMock();
    prisma.review.findUnique.mockResolvedValue(makeReview());
    prisma.reviewReply.create.mockResolvedValue({ id: 'reply-1' });
    service = new ReviewsService(prisma as unknown as PrismaService);
  });

  it('validates the reply content', async () => {
    expect(await validate(plainToInstance(ReplyReviewDto, { content: '' }))).toHaveLength(
      1,
    );
    expect(await validate(dto())).toHaveLength(0);
  });

  it('lets the direct merchant owner reply once', async () => {
    const result = await service.reply('review-1', merchantOwner, dto());

    expect(prisma.review.findUnique).toHaveBeenCalledWith({
      where: { id: 'review-1' },
      include: {
        reply: true,
        merchant: { select: { ownerId: true } },
        offer: { select: { merchant: { select: { ownerId: true } } } },
      },
    });
    expect(prisma.reviewReply.create).toHaveBeenCalledWith({
      data: {
        reviewId: 'review-1',
        authorId: 'owner-1',
        content: 'Merci pour votre avis !',
      },
    });
    expect(result).toEqual({ id: 'reply-1' });
  });

  it('lets the owner of the reviewed offer reply', async () => {
    prisma.review.findUnique.mockResolvedValue(
      makeReview({
        merchant: null,
        offer: { merchant: { ownerId: 'owner-1' } },
      }),
    );

    await service.reply('review-1', merchantOwner, dto());

    expect(prisma.reviewReply.create).toHaveBeenCalledOnce();
  });

  it('rejects a second reply', async () => {
    prisma.review.findUnique.mockResolvedValue(
      makeReview({ reply: { id: 'reply-1' } }),
    );

    await expect(service.reply('review-1', merchantOwner, dto())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.reviewReply.create).not.toHaveBeenCalled();
  });

  it('rejects a merchant that is not concerned by the review', async () => {
    await expect(
      service.reply('review-1', { id: 'other-owner' } as User, dto()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.reviewReply.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown review', async () => {
    prisma.review.findUnique.mockResolvedValue(null);

    await expect(service.reply('review-1', merchantOwner, dto())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('maps a concurrent unique violation to a conflict', async () => {
    prisma.reviewReply.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.reply('review-1', merchantOwner, dto())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
