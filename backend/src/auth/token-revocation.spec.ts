import { UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { isTokenRevoked } from './token-revocation';
import { JwtStrategy } from './strategies/jwt.strategy';

describe('Revocación de sesiones por cambio de contraseña', () => {
  const changedAt = new Date('2026-11-01T12:00:00.500Z');
  const changedSec = Math.floor(changedAt.getTime() / 1000);

  it('isTokenRevoked: solo los tokens emitidos antes del cambio', () => {
    expect(isTokenRevoked(changedSec - 1, changedAt)).toBe(true);
    expect(isTokenRevoked(changedSec, changedAt)).toBe(false);
    expect(isTokenRevoked(changedSec + 60, changedAt)).toBe(false);
    expect(isTokenRevoked(changedSec - 1, null)).toBe(false);
    expect(isTokenRevoked(undefined, changedAt)).toBe(true);
  });

  it('JwtStrategy rechaza el token viejo, un usuario inactivo, y acepta uno posterior sin campos sensibles', async () => {
    process.env.JWT_SECRET ??= 'test-jwt-secret-for-revocation-spec-0000';
    const user = {
      id: 'u1',
      email: 'a@x.co',
      name: 'A',
      role: Role.ASESOR,
      isActive: true,
      passwordChangedAt: changedAt,
      passwordHash: 'h',
      twoFactorSecret: 'enc:v1:x',
      isTwoFactorEnabled: false,
      lastLoginAt: null,
      createdAt: changedAt,
      updatedAt: changedAt,
    };
    const prisma: any = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
    const strategy = new JwtStrategy(prisma);
    const payload = { sub: 'u1', email: 'a@x.co', role: Role.ASESOR };

    await expect(strategy.validate({ ...payload, iat: changedSec - 3600 })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const ok = await strategy.validate({ ...payload, iat: changedSec + 5 });
    expect(ok).not.toHaveProperty('passwordHash');
    expect(ok).not.toHaveProperty('twoFactorSecret');
    expect(ok).not.toHaveProperty('passwordChangedAt');

    prisma.user.findUnique.mockResolvedValue({ ...user, isActive: false });
    await expect(strategy.validate({ ...payload, iat: changedSec + 5 })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
