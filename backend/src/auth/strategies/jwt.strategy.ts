import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { Role, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { requireEnv } from '../../config/secrets';
import { isTokenRevoked } from '../token-revocation';
import { extractSessionToken } from '../session-cookie';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  /** Emitido en (segundos), lo agrega jsonwebtoken al firmar */
  iat?: number;
}

/** Usuario sin campos sensibles (nunca hash, secreto TOTP ni passwordChangedAt) */
export function sanitizeUser(user: User) {
  const { passwordHash, twoFactorSecret, passwordChangedAt, ...safe } = user;
  void passwordHash;
  void twoFactorSecret;
  void passwordChangedAt;
  return safe;
}

export type AuthenticatedUser = ReturnType<typeof sanitizeUser>;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: (req: Request) => extractSessionToken(req),
      ignoreExpiration: false,
      secretOrKey: requireEnv('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // Se consulta la BD en cada request: rol y estado siempre actualizados
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('Usuario no autorizado o no encontrado');
    if (!user.isActive) throw new UnauthorizedException('Tu acceso al sistema fue desactivado');
    if (isTokenRevoked(payload.iat, user.passwordChangedAt)) {
      throw new UnauthorizedException('Tu contraseña cambió: inicia sesión de nuevo');
    }
    return sanitizeUser(user);
  }
}
