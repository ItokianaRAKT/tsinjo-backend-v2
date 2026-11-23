import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReportReason, ReportStatus, type User } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateReportDto, ReportTargetType } from './dto/reports.dto.js';
import { ReportsService } from './reports.service.js';

const reporter = { id: 'reporter-1' } as User;
const targetId = '9c1d5e70-5a2b-4cd3-8f21-0b6f4a2e9d11';

const makeDto = (overrides: Record<string, unknown> = {}) =>
  plainToInstance(CreateReportDto, {
    targetType: ReportTargetType.OFFER,
    targetId,
    reason: ReportReason.EXPIRED_PRODUCT,
    details: 'Produit déjà périmé.',
    ...overrides,
  });

const prismaMock = () => ({
  offer: { findUnique: vi.fn() },
  review: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  report: { create: vi.fn() },
});

describe('ReportsService.create', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let service: ReportsService;

  beforeEach(() => {
    prisma = prismaMock();
    prisma.offer.findUnique.mockResolvedValue({ creatorId: 'merchant-1' });
    prisma.review.findUnique.mockResolvedValue({ authorId: 'author-1' });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
    prisma.report.create.mockResolvedValue({ id: 'report-1' });
    service = new ReportsService(prisma as unknown as PrismaService);
  });

  it('validates the DTO fields', async () => {
    const errors = await validate(
      makeDto({ targetType: 'PRODUCT', targetId: 'nope', reason: 'NOPE', details: 42 }),
    );

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['targetType', 'targetId', 'reason', 'details']),
    );
  });

  it('rejects a missing target', async () => {
    prisma.offer.findUnique.mockResolvedValueOnce(null);
    await expect(service.create(reporter, makeDto())).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.review.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.create(
        reporter,
        makeDto({ targetType: ReportTargetType.REVIEW }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.create(reporter, makeDto({ targetType: ReportTargetType.USER })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it('rejects self-reports on offers, reviews and users', async () => {
    prisma.offer.findUnique.mockResolvedValueOnce({ creatorId: reporter.id });
    await expect(service.create(reporter, makeDto())).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    prisma.review.findUnique.mockResolvedValueOnce({ authorId: reporter.id });
    await expect(
      service.create(
        reporter,
        makeDto({ targetType: ReportTargetType.REVIEW }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    prisma.user.findUnique.mockResolvedValueOnce({ id: reporter.id });
    await expect(
      service.create(reporter, makeDto({ targetType: ReportTargetType.USER })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it('creates an UNDER_REVIEW report for each target type', async () => {
    await service.create(reporter, makeDto());
    const base = {
      reporterId: reporter.id,
      reason: ReportReason.EXPIRED_PRODUCT,
      details: 'Produit déjà périmé.',
      status: ReportStatus.UNDER_REVIEW,
    };
    expect(prisma.report.create).toHaveBeenLastCalledWith({
      data: { ...base, offerId: targetId },
    });

    await service.create(
      reporter,
      makeDto({ targetType: ReportTargetType.REVIEW }),
    );
    expect(prisma.report.create).toHaveBeenLastCalledWith({
      data: { ...base, reviewId: targetId },
    });

    await service.create(
      reporter,
      makeDto({ targetType: ReportTargetType.USER }),
    );
    expect(prisma.report.create).toHaveBeenLastCalledWith({
      data: { ...base, reportedUserId: targetId },
    });
  });

  it('maps the unique constraint violation to a conflict', async () => {
    prisma.report.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.create(reporter, makeDto())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
