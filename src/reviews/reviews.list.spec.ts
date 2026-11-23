import type { User } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListReviewsDto } from './dto/reviews.dto.js';
import { ReviewsService } from './reviews.service.js';

const user = { id: 'voter-1' } as User;

const makeReview = (
  id: string,
  helpful: number,
  unhelpful: number,
  createdAt: string,
  ownVote?: boolean,
) => ({
  id,
  author: { id: `author-${id}`, fullName: `Auteur ${id}` },
  rating: 4,
  comment: `Commentaire ${id}`,
  reply: id === 'r2' ? { id: 'reply-1', content: 'Merci !' } : null,
  createdAt: new Date(createdAt),
  votes: [
    ...Array.from({ length: helpful }, (_, index) => ({
      userId: `like-${id}-${index}`,
      isHelpful: true,
    })),
    ...Array.from({ length: unhelpful }, (_, index) => ({
      userId: `dislike-${id}-${index}`,
      isHelpful: false,
    })),
    ...(ownVote === undefined
      ? []
      : [{ userId: user.id, isHelpful: ownVote }]),
  ],
});

const prismaMock = () => ({
  review: { findMany: vi.fn() },
});

describe('ReviewsService listings', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let service: ReviewsService;

  beforeEach(() => {
    prisma = prismaMock();
    prisma.review.findMany.mockResolvedValue([
      makeReview('r1', 2, 1, '2026-11-20T10:00:00.000Z'),
      makeReview('r2', 3, 0, '2026-11-21T10:00:00.000Z', true),
      makeReview('r3', 2, 0, '2026-11-22T10:00:00.000Z', false),
    ]);
    service = new ReviewsService(prisma as unknown as PrismaService);
  });

  it('filters by offer and sorts by net helpful score then most recent', async () => {
    const result = await service.findByOffer('offer-1', user, new ListReviewsDto());

    expect(prisma.review.findMany).toHaveBeenCalledWith({
      where: { offerId: 'offer-1' },
      include: expect.objectContaining({
        author: { select: { id: true, fullName: true } },
        votes: { select: { userId: true, isHelpful: true } },
      }),
    });
    expect(result.items.map((item) => item.id)).toEqual(['r2', 'r3', 'r1']);
    expect(result.total).toBe(3);
  });

  it('exposes the reply, vote counters and the current user vote', async () => {
    const { items } = await service.findByMerchant(
      'merchant-1',
      user,
      new ListReviewsDto(),
    );

    expect(prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { merchantId: 'merchant-1' } }),
    );
    expect(items[0]).toMatchObject({
      author: { id: 'author-r2', fullName: 'Auteur r2' },
      reply: { content: 'Merci !' },
      helpfulCount: 4,
      unhelpfulCount: 0,
      userVote: true,
    });
    expect(items[1]).toMatchObject({ userVote: false, reply: null });
    expect(items[2]).toMatchObject({ userVote: null });
  });

  it('paginates after sorting', async () => {
    const pageTwo = Object.assign(new ListReviewsDto(), { page: 2, limit: 2 });

    const result = await service.findByMerchant('merchant-1', user, pageTwo);

    expect(result.items.map((item) => item.id)).toEqual(['r1']);
    expect(result).toMatchObject({ total: 3, page: 2, limit: 2 });
  });

  it('breaks equal scores with the most recent review first', async () => {
    prisma.review.findMany.mockResolvedValue([
      makeReview('old', 2, 1, '2026-11-20T10:00:00.000Z'),
      makeReview('new', 2, 1, '2026-11-22T10:00:00.000Z'),
    ]);

    const { items } = await service.findByOffer('offer-1', user, new ListReviewsDto());

    expect(items.map((item) => item.id)).toEqual(['new', 'old']);
  });
});
