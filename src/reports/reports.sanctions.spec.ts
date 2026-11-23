import { OfferStatus, ReportStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { ResolveReportDto } from './dto/reports.dto.js';
import { ReportsService } from './reports.service.js';

const reportId = '9c1d5e70-5a2b-4cd3-8f21-0b6f4a2e9d11';
const now = new Date('2026-11-23T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const phone = '+261320000009';

const dto = plainToInstance(ResolveReportDto, {
  status: ReportStatus.ACCEPTED,
  adminNote: 'Signalement fondé',
});

const makeReport = (overrides: Record<string, unknown> = {}) => ({
  status: ReportStatus.UNDER_REVIEW,
  offerId: 'offer-1',
  reviewId: null,
  reportedUserId: null,
  offer: { creatorId: 'offender-1' },
  review: null,
  ...overrides,
});

const prismaMock = () => ({
  report: { findUnique: vi.fn(), update: vi.fn() },
  offer: { update: vi.fn(), updateMany: vi.fn() },
  user: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  refreshToken: { deleteMany: vi.fn() },
  phoneCooldown: { upsert: vi.fn() },
  $transaction: vi.fn(),
});

describe('ReportsService.resolve sanctions', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let service: ReportsService;

  const acceptWithCount = async (
    acceptedReportsCount: number,
    overrides: Record<string, unknown> = {},
  ) => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      phone,
      acceptedReportsCount,
    });
    prisma.report.findUnique.mockResolvedValue(makeReport(overrides));
    await service.resolve(reportId, dto);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    prisma = prismaMock();
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(prisma),
    );
    prisma.report.update.mockResolvedValue({ id: reportId });
    service = new ReportsService(prisma as unknown as PrismaService);
  });

  afterEach(() => vi.useRealTimers());

  it('suspends for 7 days at the third accepted report', async () => {
    await acceptWithCount(2);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'offender-1' },
      data: {
        acceptedReportsCount: 3,
        suspendedUntil: new Date(now.getTime() + 7 * DAY_MS),
      },
    });
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'offender-1' },
    });
    expect(prisma.offer.updateMany).toHaveBeenCalledWith({
      where: { creatorId: 'offender-1', status: OfferStatus.ACTIVE },
      data: { status: OfferStatus.SUSPENDED },
    });
    expect(prisma.phoneCooldown.upsert).not.toHaveBeenCalled();
  });

  it('does not sanction at the fourth accepted report', async () => {
    await acceptWithCount(3);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'offender-1' },
      data: { acceptedReportsCount: 4 },
    });
    expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
    expect(prisma.offer.updateMany).not.toHaveBeenCalled();
  });

  it('suspends for 14 days at the fifth accepted report', async () => {
    await acceptWithCount(4);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'offender-1' },
      data: {
        acceptedReportsCount: 5,
        suspendedUntil: new Date(now.getTime() + 14 * DAY_MS),
      },
    });
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalled();
    expect(prisma.phoneCooldown.upsert).not.toHaveBeenCalled();
  });

  it('bans permanently and quarantines the phone for 60 days at the sixth accepted report', async () => {
    await acceptWithCount(5);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'offender-1' },
      data: {
        acceptedReportsCount: 6,
        isPermanentlyBanned: true,
      },
    });
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'offender-1' },
    });
    expect(prisma.offer.updateMany).toHaveBeenCalled();
    expect(prisma.phoneCooldown.upsert).toHaveBeenCalledWith({
      where: { phone },
      create: {
        phone,
        reason: 'PERMANENT_BAN',
        availableAfter: new Date(now.getTime() + 60 * DAY_MS),
      },
      update: {
        reason: 'PERMANENT_BAN',
        availableAfter: new Date(now.getTime() + 60 * DAY_MS),
      },
    });
  });

  it('sanctions the reported user for a USER report and the review author for a REVIEW report', async () => {
    await acceptWithCount(2, {
      offerId: null,
      offer: null,
      reportedUserId: 'offender-2',
    });
    expect(prisma.user.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: 'offender-2' } }),
    );

    await acceptWithCount(2, {
      offerId: null,
      offer: null,
      reviewId: 'review-1',
      review: { authorId: 'offender-3' },
    });
    expect(prisma.user.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: 'offender-3' } }),
    );
  });
});
