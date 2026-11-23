import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReservationStatus, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateReviewDto,
  ListReviewsDto,
  ReplyReviewDto,
  ReviewTargetType,
  VoteReviewDto,
} from './dto/reviews.dto.js';

const REVIEW_INCLUDE = {
  author: { select: { id: true, fullName: true } },
  reply: true,
  votes: { select: { userId: true, isHelpful: true } },
} satisfies Prisma.ReviewInclude;

type ReviewWithVotes = Prisma.ReviewGetPayload<{ include: typeof REVIEW_INCLUDE }>;

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(author: User, dto: CreateReviewDto) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: dto.reservationId },
      include: { offer: true, review: true },
    });
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }
    if (reservation.buyerId !== author.id) {
      throw new ForbiddenException('Only the buyer can review this reservation');
    }
    if (reservation.status !== ReservationStatus.COMPLETED) {
      throw new BadRequestException('Reservation is not completed');
    }
    if (reservation.review) {
      throw new ConflictException('This reservation is already reviewed');
    }
    const merchantId = reservation.offer.merchantId;
    if (dto.targetType === ReviewTargetType.MERCHANT && !merchantId) {
      throw new BadRequestException('This offer has no merchant to review');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const review = await tx.review.create({
          data: {
            authorId: author.id,
            reservationId: reservation.id,
            offerId:
              dto.targetType === ReviewTargetType.OFFER ? reservation.offerId : null,
            merchantId:
              dto.targetType === ReviewTargetType.MERCHANT ? merchantId : null,
            rating: dto.rating,
            comment: dto.comment,
          },
        });
        if (merchantId) {
          const stats = await tx.review.aggregate({
            where: { OR: [{ merchantId }, { offer: { merchantId } }] },
            _avg: { rating: true },
            _count: true,
          });
          await tx.merchant.update({
            where: { id: merchantId },
            data: {
              averageRating: Math.round((stats._avg.rating ?? 0) * 100) / 100,
              reviewCount: stats._count,
            },
          });
        }
        return review;
      });
    } catch (error) {
      // L'unicité de reservationId tranche les créations concurrentes
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('This reservation is already reviewed');
      }
      throw error;
    }
  }

  findByOffer(offerId: string, user: User, dto: ListReviewsDto) {
    return this.findMany({ offerId }, user, dto);
  }

  findByMerchant(merchantId: string, user: User, dto: ListReviewsDto) {
    return this.findMany({ merchantId }, user, dto);
  }

  async reply(reviewId: string, user: User, dto: ReplyReviewDto) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: {
        reply: true,
        merchant: { select: { ownerId: true } },
        offer: { select: { merchant: { select: { ownerId: true } } } },
      },
    });
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    const ownerId = review.merchant?.ownerId ?? review.offer?.merchant?.ownerId;
    if (ownerId !== user.id) {
      throw new ForbiddenException('Only the concerned merchant can reply');
    }
    if (review.reply) {
      throw new ConflictException('This review already has a reply');
    }
    try {
      return await this.prisma.reviewReply.create({
        data: { reviewId, authorId: user.id, content: dto.content },
      });
    } catch (error) {
      // reviewId est unique : une seule réponse, même sous concurrence
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('This review already has a reply');
      }
      throw error;
    }
  }

  async vote(reviewId: string, user: User, dto: VoteReviewDto) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { authorId: true },
    });
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    if (review.authorId === user.id) {
      throw new ForbiddenException('You cannot vote on your own review');
    }
    return this.prisma.reviewVote.upsert({
      where: { reviewId_userId: { reviewId, userId: user.id } },
      create: { reviewId, userId: user.id, isHelpful: dto.isHelpful },
      update: { isHelpful: dto.isHelpful },
    });
  }

  private async findMany(
    where: Prisma.ReviewWhereInput,
    user: User,
    dto: ListReviewsDto,
  ) {
    // Le tri par pertinence est calculé côté application : tous les avis de la
    // cible sont nécessaires avant de paginer.
    const reviews = await this.prisma.review.findMany({
      where,
      include: REVIEW_INCLUDE,
    });
    const items = reviews
      .map((review) => this.toListItem(review, user.id))
      .sort(
        (a, b) =>
          b.helpfulCount -
          b.unhelpfulCount -
          (a.helpfulCount - a.unhelpfulCount) ||
          b.createdAt.getTime() - a.createdAt.getTime(),
      );
    return {
      items: items.slice((dto.page - 1) * dto.limit, dto.page * dto.limit),
      total: items.length,
      page: dto.page,
      limit: dto.limit,
    };
  }

  private toListItem(review: ReviewWithVotes, userId: string) {
    const helpfulCount = review.votes.filter((vote) => vote.isHelpful).length;
    const ownVote = review.votes.find((vote) => vote.userId === userId);
    return {
      id: review.id,
      author: review.author,
      rating: review.rating,
      comment: review.comment,
      reply: review.reply,
      helpfulCount,
      unhelpfulCount: review.votes.length - helpfulCount,
      userVote: ownVote ? ownVote.isHelpful : null,
      createdAt: review.createdAt,
    };
  }
}
