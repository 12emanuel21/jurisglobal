import { authenticator } from 'otplib';
import * as qrcode from 'qrcode';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { encryptField } from '../common/crypto';
import { LoginDto } from './dto/login.dto';
import { sanitizeUser, type JwtPayload } from './strategies/jwt.strategy';
import { SUDO_SCOPE, SUDO_TOKEN_TTL_SECONDS, sudoTokenSecret, type SudoTokenPayload } from './sudo';
import { isValidTotp } from './totp';

/** Respuestas del login con 2FA (401 + code): el frontend pide o vuelve a pedir el código */
export const LOGIN_TWO_FACTOR_REQUIRED = 'TWO_FACTOR_REQUIRED';
export const LOGIN_TWO_FACTOR_INVALID = 'TWO_FACTOR_INVALID';

const INVALID_CREDENTIALS = 'Credenciales incorrectas (correo o contraseña no válidos)';
/** Hash de relleno: el login tarda lo mismo exista o no el correo (no revela cuentas) */
let dummyHash: string | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync('jurisglobal-dummy-password', 10));

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(dto: LoginDto, ip?: string) {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });

    const valid = await bcrypt.compare(dto.password, user?.passwordHash ?? getDummyHash());
    if (!user || !valid) throw new UnauthorizedException(INVALID_CREDENTIALS);

    // Tras validar la contraseña, para no revelar a terceros si el correo existe
    if (!user.isActive) {
      throw new ForbiddenException('Tu acceso al sistema fue desactivado. Contacta a un administrador.');
    }

    // 2FA activo: la contraseña sola no basta (el código se pide DESPUÉS de validar la contraseña)
    if (user.isTwoFactorEnabled && user.twoFactorSecret) {
      const code = dto.totpCode?.replace(/\s/g, '') ?? '';
      if (!code) {
        throw new UnauthorizedException({
          statusCode: 401,
          error: 'Unauthorized',
          code: LOGIN_TWO_FACTOR_REQUIRED,
          message: 'Ingresa el código de 6 dígitos de tu app de autenticación.',
        });
      }
      if (!isValidTotp(code, user.twoFactorSecret)) {
        throw new UnauthorizedException({
          statusCode: 401,
          error: 'Unauthorized',
          code: LOGIN_TWO_FACTOR_INVALID,
          message: 'El código de verificación no es válido o ya expiró.',
        });
      }
    }

    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({ userId: user.id, action: 'LOGIN', entity: 'User', entityId: user.id, ip });
    return { accessToken: await this.issueAccessToken(updated), user: sanitizeUser(updated) };
  }

  issueAccessToken(user: Pick<User, 'id' | 'email' | 'role'>): Promise<string> {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    return this.jwtService.signAsync(payload);
  }

  /**
   * Paso 1 del 2FA: genera un secreto pendiente (cifrado) y su QR. Si el 2FA ya está activo se
   * rechaza: regenerarlo con solo la sesión permitiría a quien robe la sesión anular el Sudo Mode.
   */
  async generateTwoFactorSecret(userId: string, email: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { isTwoFactorEnabled: true } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.isTwoFactorEnabled) throw new ConflictException('La autenticación en 2 pasos ya está activa');

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(email, 'JurisGlobal', secret);
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: encryptField(secret) } });
    return { secret, qrCodeUrl: await qrcode.toDataURL(otpauthUrl) };
  }

  /** Paso 2: confirma el secreto pendiente con un código de la app y activa el 2FA */
  async enableTwoFactor(userId: string, code: unknown) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.isTwoFactorEnabled) throw new ConflictException('La autenticación en 2 pasos ya está activa');
    if (!user.twoFactorSecret) throw new BadRequestException('Primero genera el código QR');
    if (!isValidTotp(code, user.twoFactorSecret)) throw new UnauthorizedException('Código 2FA inválido');

    await this.prisma.user.update({ where: { id: userId }, data: { isTwoFactorEnabled: true } });
    await this.audit.record({ userId, action: 'TWO_FACTOR_ENABLED', entity: 'User', entityId: userId });
    return { isTwoFactorEnabled: true };
  }

  /** Sudo Mode: con un código válido emite un sudoToken de 30 minutos (header x-sudo-token) */
  async issueSudoToken(userId: string, code: unknown) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isTwoFactorEnabled: true, twoFactorSecret: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (!user.isTwoFactorEnabled || !user.twoFactorSecret) {
      throw new ForbiddenException('Activa la autenticación en 2 pasos para usar el modo seguro');
    }
    if (!isValidTotp(code, user.twoFactorSecret)) throw new UnauthorizedException('Código 2FA inválido');

    const payload: SudoTokenPayload = { sub: user.id, scope: SUDO_SCOPE };
    const sudoToken = await this.jwtService.signAsync(payload, {
      secret: sudoTokenSecret(),
      expiresIn: SUDO_TOKEN_TTL_SECONDS,
    });
    return { sudoToken, expiresAt: new Date(Date.now() + SUDO_TOKEN_TTL_SECONDS * 1000).toISOString() };
  }
}
