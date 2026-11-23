import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { VoteReviewDto } from './dto/reviews.dto.js';
import { ReviewsService } from './reviews.service.js';

const voter = { id: 'voter-1' } as User;
const dto = (isHelpful: boolean) =>
  plainToInstance(VoteReviewDto, { isHelpful });

const prismaMock = () => ({
  review: { findUnique: vi.fn() },
  reviewVote: { upsert: vi.fn() },
});

describe('ReviewsService.vote', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let service: ReviewsService;

  beforeEach(() => {
    prisma = prismaMock();
    prisma.review.findUnique.mockResolvedValue({ authorId: 'author-1' });
    prisma.reviewVote.upsert.mockImplementation(
      ({ create }: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'vote-1', ...create }),
    );
    service = new ReviewsService(prisma as unknown as PrismaService);
  });

  it('validates that isHelpful is a boolean', async () => {
    expect(await validate(plainToInstance(VoteReviewDto, { isHelpful: 'yes' }))).toHaveLength(
      1,
    );
    expect(await validate(dto(false))).toHaveLength(0);
  });

  it('creates a helpful vote', async () => {
    const result = await service.vote('review-1', voter, dto(true));

    expect(prisma.review.findUnique).toHaveBeenCalledWith({
      where: { id: 'review-1' },
      select: { authorId: true },
    });
    expect(prisma.reviewVote.upsert).toHaveBeenCalledWith({
      where: { reviewId_userId: { reviewId: 'review-1', userId: 'voter-1' } },
      create: { reviewId: 'review-1', userId: 'voter-1', isHelpful: true },
      update: { isHelpful: true },
    });
    expect(result).toMatchObject({ isHelpful: true });
  });

  it('changes a like into a dislike with the same upsert', async () => {
    await service.vote('review-1', voter, dto(false));

    expect(prisma.reviewVote.upsert).toHaveBeenCalledWith({
      where: { reviewId_userId: { reviewId: 'review-1', userId: 'voter-1' } },
      create: { reviewId: 'review-1', userId: 'voter-1', isHelpful: false },
      update: { isHelpful: false },
    });
  });

  it('forbids voting on your own review', async () => {
    await expect(
      service.vote('review-1', { id: 'author-1' } as User, dto(true)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.reviewVote.upsert).not.toHaveBeenCalled();
  });

  it('rejects an unknown review', async () => {
    prisma.review.findUnique.mockResolvedValue(null);

    await expect(service.vote('review-1', voter, dto(true))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
