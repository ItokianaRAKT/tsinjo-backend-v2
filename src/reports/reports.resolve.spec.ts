import { ConflictException, NotFoundException } from '@nestjs/common';
import { OfferStatus, ReportStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { ResolveReportDto } from './dto/reports.dto.js';
import { ReportsService } from './reports.service.js';

const reportId = '9c1d5e70-5a2b-4cd3-8f21-0b6f4a2e9d11';

const makeDto = (overrides: Record<string, unknown> = {}) =>
  plainToInstance(ResolveReportDto, {
    status: ReportStatus.ACCEPTED,
    ...overrides,
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

describe('ReportsService.resolve', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let service: ReportsService;

  beforeEach(() => {
    prisma = prismaMock();
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(prisma),
    );
    prisma.report.findUnique.mockResolvedValue(makeReport());
    prisma.report.update.mockResolvedValue({ id: reportId });
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      phone: '+261320000009',
      acceptedReportsCount: 1,
    });
    service = new ReportsService(prisma as unknown as PrismaService);
  });

  it('rejects an unknown report', async () => {
    prisma.report.findUnique.mockResolvedValueOnce(null);
    await expect(service.resolve(reportId, makeDto())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses to resolve an already resolved report', async () => {
    for (const status of [ReportStatus.ACCEPTED, ReportStatus.REJECTED]) {
      prisma.report.findUnique.mockResolvedValueOnce(makeReport({ status }));
      await expect(
        service.resolve(reportId, makeDto()),
      ).rejects.toBeInstanceOf(ConflictException);
    }
    expect(prisma.report.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects without sanctioning anybody', async () => {
    await service.resolve(
      reportId,
      makeDto({ status: ReportStatus.REJECTED, adminNote: 'Infondé' }),
    );

    expect(prisma.report.update).toHaveBeenCalledWith({
      where: { id: reportId },
      data: { status: ReportStatus.REJECTED, adminNote: 'Infondé' },
      include: expect.any(Object),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('hides the reported offer by default when accepting', async () => {
    await service.resolve(
      reportId,
      makeDto({ adminNote: 'Offre périmée' }),
    );

    expect(prisma.offer.update).toHaveBeenCalledWith({
      where: { id: 'offer-1' },
      data: { status: OfferStatus.SUSPENDED },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'offender-1' },
      data: { acceptedReportsCount: 2 },
    });
    expect(prisma.report.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: ReportStatus.ACCEPTED, adminNote: 'Offre périmée' },
      }),
    );
  });

  it('keeps the offer visible when hideTarget is false', async () => {
    await service.resolve(reportId, makeDto({ hideTarget: false }));

    expect(prisma.offer.update).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalled();
  });
});
