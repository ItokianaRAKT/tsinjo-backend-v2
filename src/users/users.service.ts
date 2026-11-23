import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OfferStatus, Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BlockUserDto,
  ListUsersDto,
  UpdateProfileDto,
} from './dto/users.dto.js';

const PHONE_QUARANTINE_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { merchant: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.sanitize(user);
  }

  async updateMe(userId: string, dto: UpdateProfileDto) {
    if (dto.email) {
      const existing = await this.prisma.user.findFirst({
        where: { email: dto.email, NOT: { id: userId } },
      });
      if (existing) {
        throw new ConflictException('Email already in use');
      }
    }
    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: dto,
      });
      return this.sanitize(user);
    } catch (error) {
      // Course possible avec un PUT concurrent : la contrainte unique tranche
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email already in use');
      }
      throw error;
    }
  }

  async deleteMe(userId: string): Promise<{ message: string }> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { deletedAt: new Date() },
      });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.offer.updateMany({
        where: { creatorId: userId, status: OfferStatus.ACTIVE },
        data: { status: OfferStatus.SUSPENDED },
      });
      const availableAfter = new Date(
        Date.now() + PHONE_QUARANTINE_DAYS * DAY_MS,
      );
      await tx.phoneCooldown.upsert({
        where: { phone: user.phone },
        create: {
          phone: user.phone,
          reason: 'ACCOUNT_DELETED',
          availableAfter,
        },
        update: { reason: 'ACCOUNT_DELETED', availableAfter },
      });
    });
    return { message: 'Account deleted' };
  }

  async list(dto: ListUsersDto) {
    const where: Prisma.UserWhereInput = {
      role: dto.role,
      isManuallyBlocked: dto.isManuallyBlocked,
      isPermanentlyBanned: dto.isPermanentlyBanned,
      ...(dto.search
        ? {
            OR: [
              { fullName: { contains: dto.search, mode: 'insensitive' } },
              { phone: { contains: dto.search } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: (dto.page - 1) * dto.limit,
        take: dto.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: items.map((user) => this.sanitize(user)),
      total,
      page: dto.page,
      limit: dto.limit,
    };
  }

  async block(id: string, dto: BlockUserDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException('User not found');
      }
      const user = await tx.user.update({
        where: { id },
        data: { isManuallyBlocked: true, blockReason: dto.blockReason },
      });
      await tx.refreshToken.deleteMany({ where: { userId: id } });
      await tx.offer.updateMany({
        where: { creatorId: id, status: OfferStatus.ACTIVE },
        data: { status: OfferStatus.SUSPENDED },
      });
      return this.sanitize(user);
    });
  }

  async unblock(id: string) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('User not found');
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: { isManuallyBlocked: false, blockReason: null },
    });
    return this.sanitize(user);
  }

  private sanitize<T extends User>(user: T): Omit<T, 'passwordHash'> {
    const { passwordHash: _passwordHash, ...safe } = user;
    return safe;
  }
}
