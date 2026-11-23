import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OfferStatus, Prisma, ReportStatus, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateReportDto,
  ListReportsDto,
  ReportTargetType,
  ResolveReportDto,
} from './dto/reports.dto.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const QUARANTINE_DAYS = 60;

const REPORT_INCLUDE = {
  reporter: { select: { id: true, fullName: true, email: true } },
  offer: {
    select: {
      id: true,
      title: true,
      status: true,
      creator: { select: { id: true, fullName: true } },
      images: { select: { url: true }, orderBy: { createdAt: 'asc' }, take: 1 },
    },
  },
  review: {
    select: {
      id: true,
      rating: true,
      comment: true,
      author: { select: { id: true, fullName: true } },
    },
  },
  reportedUser: { select: { id: true, fullName: true, email: true } },
} satisfies Prisma.ReportInclude;

type ReportWithTarget = Prisma.ReportGetPayload<{ include: typeof REPORT_INCLUDE }>;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(reporter: User, dto: CreateReportDto) {
    await this.assertReportable(dto.targetType, dto.targetId, reporter.id);
    const data: Prisma.ReportUncheckedCreateInput = {
      reporterId: reporter.id,
      reason: dto.reason,
      details: dto.details,
      status: ReportStatus.UNDER_REVIEW,
      ...(dto.targetType === ReportTargetType.OFFER ? { offerId: dto.targetId } : {}),
      ...(dto.targetType === ReportTargetType.REVIEW ? { reviewId: dto.targetId } : {}),
      ...(dto.targetType === ReportTargetType.USER
        ? { reportedUserId: dto.targetId }
        : {}),
    };
    try {
      return await this.prisma.report.create({ data });
    } catch (error) {
      // Les index uniques (reporterId + cible) tranchent les créations concurrentes.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Target already reported by this user');
      }
      throw error;
    }
  }

  async findAll(dto: ListReportsDto) {
    const where: Prisma.ReportWhereInput = {
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.reason ? { reason: dto.reason } : {}),
      ...(dto.targetType === ReportTargetType.OFFER ? { offerId: { not: null } } : {}),
      ...(dto.targetType === ReportTargetType.REVIEW ? { reviewId: { not: null } } : {}),
      ...(dto.targetType === ReportTargetType.USER
        ? { reportedUserId: { not: null } }
        : {}),
    };
    const [reports, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        include: REPORT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (dto.page - 1) * dto.limit,
        take: dto.limit,
      }),
      this.prisma.report.count({ where }),
    ]);
    return {
      items: reports.map((report) => this.toListItem(report)),
      total,
      page: dto.page,
      limit: dto.limit,
    };
  }

  async resolve(id: string, dto: ResolveReportDto) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      select: {
        status: true,
        offerId: true,
        reviewId: true,
        reportedUserId: true,
        offer: { select: { creatorId: true } },
        review: { select: { authorId: true } },
      },
    });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    if (report.status !== ReportStatus.UNDER_REVIEW) {
      throw new ConflictException('Report is already resolved');
    }
    if (dto.status === ReportStatus.REJECTED) {
      return this.prisma.report.update({
        where: { id },
        data: { status: ReportStatus.REJECTED, adminNote: dto.adminNote },
        include: REPORT_INCLUDE,
      });
    }

    const offenderId =
      report.offer?.creatorId ?? report.review?.authorId ?? report.reportedUserId;
    if (!offenderId) {
      throw new NotFoundException('Report target not found');
    }
    return this.prisma.$transaction(async (tx) => {
      if (report.offerId && dto.hideTarget !== false) {
        await tx.offer.update({
          where: { id: report.offerId },
          data: { status: OfferStatus.SUSPENDED },
        });
      }
      const offender = await tx.user.findUniqueOrThrow({
        where: { id: offenderId },
        select: { phone: true, acceptedReportsCount: true },
      });
      const acceptedReportsCount = offender.acceptedReportsCount + 1;
      const data: Prisma.UserUpdateInput = { acceptedReportsCount };
      const now = new Date();
      // 3 -> 7j, 5 -> 14j, 6 et plus -> bannissement définitif.
      if (acceptedReportsCount === 3 || acceptedReportsCount >= 5) {
        if (acceptedReportsCount >= 6) {
          data.isPermanentlyBanned = true;
        } else {
          const days = acceptedReportsCount === 3 ? 7 : 14;
          data.suspendedUntil = new Date(now.getTime() + days * DAY_MS);
        }
        await tx.refreshToken.deleteMany({ where: { userId: offenderId } });
        await tx.offer.updateMany({
          where: { creatorId: offenderId, status: OfferStatus.ACTIVE },
          data: { status: OfferStatus.SUSPENDED },
        });
        if (acceptedReportsCount >= 6) {
          const availableAfter = new Date(
            now.getTime() + QUARANTINE_DAYS * DAY_MS,
          );
          await tx.phoneCooldown.upsert({
            where: { phone: offender.phone },
            create: {
              phone: offender.phone,
              reason: 'PERMANENT_BAN',
              availableAfter,
            },
            update: { reason: 'PERMANENT_BAN', availableAfter },
          });
        }
      }
      await tx.user.update({ where: { id: offenderId }, data });
      return tx.report.update({
        where: { id },
        data: { status: ReportStatus.ACCEPTED, adminNote: dto.adminNote },
        include: REPORT_INCLUDE,
      });
    });
  }

  private async assertReportable(
    targetType: ReportTargetType,
    targetId: string,
    reporterId: string,
  ): Promise<void> {
    if (targetType === ReportTargetType.OFFER) {
      const offer = await this.prisma.offer.findUnique({
        where: { id: targetId },
        select: { creatorId: true },
      });
      if (!offer) {
        throw new NotFoundException('Offer not found');
      }
      if (offer.creatorId === reporterId) {
        throw new ForbiddenException('You cannot report your own offer');
      }
      return;
    }
    if (targetType === ReportTargetType.REVIEW) {
      const review = await this.prisma.review.findUnique({
        where: { id: targetId },
        select: { authorId: true },
      });
      if (!review) {
        throw new NotFoundException('Review not found');
      }
      if (review.authorId === reporterId) {
        throw new ForbiddenException('You cannot report your own review');
      }
      return;
    }
    const user = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.id === reporterId) {
      throw new ForbiddenException('You cannot report yourself');
    }
  }

  private toListItem(report: ReportWithTarget) {
    const targetType = report.offerId
      ? ReportTargetType.OFFER
      : report.reviewId
        ? ReportTargetType.REVIEW
        : ReportTargetType.USER;
    return {
      id: report.id,
      targetType,
      target: report.offer ?? report.review ?? report.reportedUser,
      reporter: report.reporter,
      reason: report.reason,
      details: report.details,
      status: report.status,
      adminNote: report.adminNote,
      createdAt: report.createdAt,
    };
  }
}
