import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { User } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface JwtPayload {
  sub: string;
  role: User['role'];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (user.isPermanentlyBanned) {
      throw new UnauthorizedException('Account permanently banned');
    }
    if (user.isManuallyBlocked) {
      throw new UnauthorizedException('Account blocked');
    }
    if (user.suspendedUntil && user.suspendedUntil > new Date()) {
      throw new UnauthorizedException(`Account suspended until ${user.suspendedUntil.toISOString()}`);
    }
    return user;
  }
}
