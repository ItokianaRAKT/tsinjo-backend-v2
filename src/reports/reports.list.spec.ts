import { ReportReason, ReportStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListReportsDto, ReportTargetType } from './dto/reports.dto.js';
import { ReportsService } from './reports.service.js';

const prismaMock = () => ({
  report: { findMany: vi.fn(), count: vi.fn() },
});

describe('ReportsService.findAll', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let service: ReportsService;

  beforeEach(() => {
    prisma = prismaMock();
    prisma.report.findMany.mockResolvedValue([
      {
        id: 'report-1',
        offerId: null,
        reviewId: null,
        reportedUserId: 'offender-1',
        reporter: { id: 'reporter-1', fullName: 'Hery' },
        offer: null,
        review: null,
        reportedUser: { id: 'offender-1', fullName: 'Rado' },
        reason: ReportReason.FAKE_IMAGE,
        details: null,
        status: ReportStatus.ACCEPTED,
        adminNote: null,
        createdAt: new Date('2026-11-23T12:00:00.000Z'),
      },
    ]);
    prisma.report.count.mockResolvedValue(1);
    service = new ReportsService(prisma as unknown as PrismaService);
  });

  it('applies filters and pagination', async () => {
    const result = await service.findAll(
      plainToInstance(ListReportsDto, {
        status: ReportStatus.ACCEPTED,
        reason: ReportReason.FAKE_IMAGE,
        targetType: ReportTargetType.USER,
        page: '2',
        limit: '10',
      }),
    );

    const where = {
      status: ReportStatus.ACCEPTED,
      reason: ReportReason.FAKE_IMAGE,
      reportedUserId: { not: null },
    };
    expect(prisma.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 10, take: 10 }),
    );
    expect(prisma.report.count).toHaveBeenCalledWith({ where });
    expect(result).toMatchObject({
      total: 1,
      page: 2,
      limit: 10,
      items: [{ id: 'report-1', targetType: ReportTargetType.USER }],
    });
    expect(result.items[0].target).toEqual({ id: 'offender-1', fullName: 'Rado' });
  });

  it('uses defaults when no filter is given', async () => {
    const result = await service.findAll(plainToInstance(ListReportsDto, {}));

    expect(prisma.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, skip: 0, take: 20 }),
    );
    expect(result).toMatchObject({ page: 1, limit: 20 });
  });
});
