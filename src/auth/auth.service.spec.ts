import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role, User } from '@prisma/client';
import bcrypt from 'bcrypt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto.js';

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  email: null,
  phone: '+261341234567',
  isPhoneVerified: true,
  passwordHash: 'hash',
  fullName: 'Test User',
  role: Role.USER,
  consecutiveCancellations: 0,
  creatorCancellationCount: 0,
  acceptedReportsCount: 0,
  suspensionCount: 0,
  suspendedUntil: null,
  isPermanentlyBanned: false,
  isManuallyBlocked: false,
  blockReason: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const prismaMock = () => ({
  user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  phoneCooldown: { findUnique: vi.fn() },
  phoneVerification: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
  refreshToken: { create: vi.fn(), findFirst: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(),
});

const jwtMock = () => ({ signAsync: vi.fn().mockResolvedValue('signed-access-token') });

const registerDto: RegisterDto = {
  fullName: 'Test User',
  phone: '+261341234567',
  password: 'password123',
  role: Role.USER,
};

describe('AuthService', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let jwt: ReturnType<typeof jwtMock>;
  let service: AuthService;

  beforeEach(() => {
    prisma = prismaMock();
    jwt = jwtMock();
    // Le mock de $transaction exécute le callback avec les mêmes mocks
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
    service = new AuthService(prisma as unknown as PrismaService, jwt as unknown as JwtService);
  });

  describe('register', () => {
    it('creates an unverified user with a hashed password and a 6-char code', async () => {
      prisma.phoneCooldown.findUnique.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.phoneVerification.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(makeUser({ isPhoneVerified: false }));
      prisma.phoneVerification.create.mockResolvedValue({});

      const result = await service.register(registerDto);

      expect(result).not.toHaveProperty('passwordHash');
      expect(result.isPhoneVerified).toBe(false);
      expect(result.role).toBe(Role.USER);

      const createdData = prisma.user.create.mock.calls[0][0].data;
      expect(await bcrypt.compare('password123', createdData.passwordHash)).toBe(true);

      const verificationData = prisma.phoneVerification.create.mock.calls[0][0].data;
      expect(verificationData.code).toMatch(/^[A-Z0-9]{6}$/);
      expect(verificationData.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(verificationData.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000);
    });

    it('rejects registration during phone cooldown', async () => {
      prisma.phoneCooldown.findUnique.mockResolvedValue({
        phone: registerDto.phone,
        availableAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      await expect(service.register(registerDto)).rejects.toThrow(ForbiddenException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects registration when phone already exists', async () => {
      prisma.phoneCooldown.findUnique.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(makeUser());

      await expect(service.register(registerDto)).rejects.toThrow('already registered');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('verifyPhoneWebhook', () => {
    it('verifies the phone and deletes the code', async () => {
      const verification = {
        id: 'pv-1',
        userId: 'user-1',
        phone: '+261341234567',
        code: 'A8F9K2',
        expiresAt: new Date(Date.now() + 60_000),
      };
      prisma.phoneVerification.findFirst.mockResolvedValue(verification);
      prisma.user.update.mockResolvedValue({});
      prisma.phoneVerification.delete.mockResolvedValue({});

      const result = await service.verifyPhoneWebhook({ phone: verification.phone, code: verification.code });

      expect(result.message).toBe('Phone number verified');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isPhoneVerified: true },
      });
      expect(prisma.phoneVerification.delete).toHaveBeenCalledWith({ where: { id: 'pv-1' } });
    });

    it('rejects a wrong code', async () => {
      prisma.phoneVerification.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyPhoneWebhook({ phone: '+261341234567', code: 'XXXXXX' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired code and deletes it', async () => {
      const verification = {
        id: 'pv-1',
        userId: 'user-1',
        phone: '+261341234567',
        code: 'A8F9K2',
        expiresAt: new Date(Date.now() - 1000),
      };
      prisma.phoneVerification.findFirst.mockResolvedValue(verification);
      prisma.phoneVerification.delete.mockResolvedValue({});

      await expect(
        service.verifyPhoneWebhook({ phone: verification.phone, code: verification.code }),
      ).rejects.toThrow('expired');
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.phoneVerification.delete).toHaveBeenCalledWith({ where: { id: 'pv-1' } });
    });
  });

  describe('login', () => {
    const loginDto: LoginDto = { identifier: '+261341234567', password: 'password123' };
    let passwordHash: string;

    beforeEach(async () => {
      passwordHash = await bcrypt.hash('password123', 4);
      prisma.user.findFirst.mockResolvedValue(makeUser({ passwordHash }));
      prisma.user.update.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});
    });

    it('returns access and refresh tokens', async () => {
      const result = await service.login(loginDto);

      expect(result).toEqual({ accessToken: 'signed-access-token', refreshToken: expect.any(String) });
      expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'user-1', role: Role.USER });
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });

    it('rejects wrong credentials', async () => {
      await expect(service.login({ identifier: loginDto.identifier, password: 'bad' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects unverified phone', async () => {
      prisma.user.findFirst.mockResolvedValue(makeUser({ passwordHash, isPhoneVerified: false }));

      await expect(service.login(loginDto)).rejects.toThrow('Phone number not verified');
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('rejects permanently banned account', async () => {
      prisma.user.findFirst.mockResolvedValue(makeUser({ passwordHash, isPermanentlyBanned: true }));

      await expect(service.login(loginDto)).rejects.toThrow('Account permanently banned');
    });

    it('rejects manually blocked account', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeUser({ passwordHash, isManuallyBlocked: true, blockReason: 'spam' }),
      );

      await expect(service.login(loginDto)).rejects.toThrow('Account blocked: spam');
    });

    it('rejects currently suspended account', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeUser({ passwordHash, suspendedUntil: new Date(Date.now() + 60_000) }),
      );

      await expect(service.login(loginDto)).rejects.toThrow('Account suspended until');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('resets an expired suspension and allows login', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeUser({ passwordHash, suspendedUntil: new Date(Date.now() - 60_000) }),
      );

      const result = await service.login(loginDto);

      expect(result.accessToken).toBe('signed-access-token');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { suspendedUntil: null },
      });
    });
  });

  describe('refresh', () => {
    const refreshDto: RefreshDto = { refreshToken: 'raw-refresh-token' };

    it('rotates the refresh token', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        tokenHash: 'hash',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
        user: makeUser(),
      });
      prisma.refreshToken.delete.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.refresh(refreshDto);

      expect(result).toEqual({ accessToken: 'signed-access-token', refreshToken: expect.any(String) });
      expect(result.refreshToken).not.toBe(refreshDto.refreshToken);
      // Rotation : l'ancien jeton est supprimé, un nouveau est stocké haché
      expect(prisma.refreshToken.delete).toHaveBeenCalledWith({ where: { id: 'rt-1' } });
      const created = prisma.refreshToken.create.mock.calls[0][0].data;
      expect(created.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(created.tokenHash).not.toBe(refreshDto.refreshToken);
    });

    it('rejects an unknown refresh token', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue(null);

      await expect(service.refresh(refreshDto)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects and deletes an expired refresh token', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        tokenHash: 'hash',
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 1000),
        user: makeUser(),
      });
      prisma.refreshToken.delete.mockResolvedValue({});

      await expect(service.refresh(refreshDto)).rejects.toThrow('Invalid refresh token');
      expect(prisma.refreshToken.delete).toHaveBeenCalledWith({ where: { id: 'rt-1' } });
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('refuses to refresh for a banned user', async () => {
      prisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        tokenHash: 'hash',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
        user: makeUser({ isPermanentlyBanned: true }),
      });

      await expect(service.refresh(refreshDto)).rejects.toThrow('Account permanently banned');
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('deletes the stored refresh token', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.logout({ refreshToken: 'raw-refresh-token' });

      expect(result.message).toBe('Logged out');
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) },
      });
    });
  });
});
