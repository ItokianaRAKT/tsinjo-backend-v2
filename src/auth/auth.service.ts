import { ConflictException, ForbiddenException, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role, User } from '@prisma/client';
import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto, RefreshDto, RegisterDto, VerifyPhoneWebhookDto } from './dto/auth.dto.js';

const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours
const VERIFICATION_CODE_LENGTH = 6;
// Alphabet sans caractères ambigus (0/O, 1/I/L) pour les codes SMS
const VERIFICATION_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<Omit<User, 'passwordHash'>> {
    const cooldown = await this.prisma.phoneCooldown.findUnique({ where: { phone: dto.phone } });
    if (cooldown && cooldown.availableAfter > new Date()) {
      throw new ForbiddenException(`Phone number quarantined until ${cooldown.availableAfter.toISOString()}`);
    }

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ phone: dto.phone }, ...(dto.email ? [{ email: dto.email }] : [])] },
    });
    if (existing) {
      throw new ConflictException('Phone number or email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const code = await this.generateUniqueCode();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            phone: dto.phone,
            email: dto.email,
            fullName: dto.fullName,
            passwordHash,
            role: dto.role ?? Role.USER,
            isPhoneVerified: false,
          },
        });
        await tx.phoneVerification.create({
          data: {
            userId: user.id,
            phone: user.phone,
            code,
            expiresAt: new Date(Date.now() + VERIFICATION_CODE_TTL_MS),
          },
        });
        return this.sanitize(user);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Phone number or email already registered');
      }
      throw error;
    }
  }

  async verifyPhoneWebhook(dto: VerifyPhoneWebhookDto): Promise<{ message: string }> {
    const verification = await this.prisma.phoneVerification.findFirst({
      where: { phone: dto.phone, code: dto.code },
    });
    if (!verification) {
      throw new UnauthorizedException('Invalid verification code');
    }
    if (verification.expiresAt < new Date()) {
      await this.prisma.phoneVerification.delete({ where: { id: verification.id } });
      throw new UnauthorizedException('Verification code expired');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: verification.userId }, data: { isPhoneVerified: true } });
      await tx.phoneVerification.delete({ where: { id: verification.id } });
    });
    return { message: 'Phone number verified' };
  }

  async login(dto: LoginDto): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ phone: dto.identifier }, { email: dto.identifier }], deletedAt: null },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.isPhoneVerified) {
      throw new ForbiddenException('Phone number not verified');
    }
    // Suspension expirée : réinitialisation à la volée (lazy evaluation)
    if (user.suspendedUntil && user.suspendedUntil <= new Date()) {
      await this.prisma.user.update({ where: { id: user.id }, data: { suspendedUntil: null } });
      user.suspendedUntil = null;
    }
    this.assertAccountUsable(user);
    return this.issueTokens(user);
  }

  async refresh(dto: RefreshDto): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = this.hashToken(dto.refreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored || stored.expiresAt < new Date()) {
      if (stored) {
        await this.prisma.refreshToken.delete({ where: { id: stored.id } });
      }
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (stored.user.deletedAt) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    this.assertAccountUsable(stored.user);

    // Rotation : l'ancien jeton est détruit, un nouveau couple est émis
    await this.prisma.refreshToken.delete({ where: { id: stored.id } });
    return this.issueTokens(stored.user);
  }

  async logout(dto: RefreshDto): Promise<{ message: string }> {
    await this.prisma.refreshToken.deleteMany({ where: { tokenHash: this.hashToken(dto.refreshToken) } });
    return { message: 'Logged out' };
  }

  private assertAccountUsable(user: User): void {
    if (user.isPermanentlyBanned) {
      throw new ForbiddenException('Account permanently banned');
    }
    if (user.isManuallyBlocked) {
      throw new ForbiddenException(user.blockReason ? `Account blocked: ${user.blockReason}` : 'Account blocked');
    }
    if (user.suspendedUntil && user.suspendedUntil > new Date()) {
      throw new ForbiddenException(`Account suspended until ${user.suspendedUntil.toISOString()}`);
    }
  }

  private async issueTokens(user: User): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role });
    const refreshToken = randomBytes(48).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    return { accessToken, refreshToken };
  }

  private async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      let code = '';
      for (let i = 0; i < VERIFICATION_CODE_LENGTH; i++) {
        code += VERIFICATION_CODE_ALPHABET[randomBytes(1)[0] % VERIFICATION_CODE_ALPHABET.length];
      }
      const existing = await this.prisma.phoneVerification.findUnique({ where: { code } });
      if (!existing) {
        return code;
      }
    }
    throw new InternalServerErrorException('Could not generate a unique verification code');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private sanitize(user: User): Omit<User, 'passwordHash'> {
    const { passwordHash: _passwordHash, ...safe } = user;
    return safe;
  }
}
