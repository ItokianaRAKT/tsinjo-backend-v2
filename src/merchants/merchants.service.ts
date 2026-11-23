import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Merchant, Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateMerchantDto,
  UpdateMerchantDto,
  VerifyMerchantDto,
} from './dto/merchants.dto.js';

@Injectable()
export class MerchantsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: User, dto: CreateMerchantDto): Promise<Merchant> {
    if (user.role !== Role.USER && user.role !== Role.MERCHANT) {
      throw new ForbiddenException(
        'Only USER and MERCHANT accounts can own a shop',
      );
    }
    const existing = await this.prisma.merchant.findUnique({
      where: { ownerId: user.id },
    });
    if (existing) {
      throw new ConflictException('Shop already exists for this account');
    }
    return this.prisma.$transaction(async (tx) => {
      if (user.role === Role.USER) {
        await tx.user.update({
          where: { id: user.id },
          data: { role: Role.MERCHANT },
        });
      }
      return tx.merchant.create({
        data: {
          ownerId: user.id,
          businessName: dto.businessName,
          address: dto.address,
          quartier: dto.quartier,
          latitude: dto.latitude,
          longitude: dto.longitude,
          description: dto.description,
        },
      });
    });
  }

  async getMe(ownerId: string): Promise<Merchant> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { ownerId },
    });
    if (!merchant) {
      throw new NotFoundException('Shop not found');
    }
    return merchant;
  }

  async updateMe(ownerId: string, dto: UpdateMerchantDto): Promise<Merchant> {
    await this.getMe(ownerId);
    return this.prisma.merchant.update({ where: { ownerId }, data: dto });
  }

  async getById(id: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id } });
    if (!merchant) {
      throw new NotFoundException('Shop not found');
    }
    const { ownerId: _ownerId, ...publicProfile } = merchant;
    return publicProfile;
  }

  async verify(id: string, dto: VerifyMerchantDto): Promise<Merchant> {
    const existing = await this.prisma.merchant.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Shop not found');
    }
    return this.prisma.merchant.update({
      where: { id },
      data: { isVerified: dto.isVerified },
    });
  }
}
