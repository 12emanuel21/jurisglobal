import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { TwoFactorAuthService } from '../auth/two-factor-auth.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateUserDto } from './dto/create-user.dto';

/** Campos que se devuelven de un usuario (nunca el hash ni el secreto 2FA) */
const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  isTwoFactorEnabled: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

/** Usuarios del panel. Solo ADMIN gestiona (lo exige el controlador); cada quien cambia su contraseña. */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authService: AuthService,
    private readonly twoFactorAuth: TwoFactorAuthService,
    private readonly realtime: RealtimeGateway,
  ) {}

  list() {
    return this.prisma.user.findMany({ select: userSelect, orderBy: { createdAt: 'asc' } });
  }

  async create(actor: AuthenticatedUser, dto: CreateUserDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true } });
    if (exists) throw new ConflictException('El correo electrónico ya se encuentra registrado');
    const user = await this.prisma.user.create({
      data: { name: dto.name, email: dto.email, role: dto.role, passwordHash: await bcrypt.hash(dto.password, 10) },
      select: userSelect,
    });
    await this.audit.record({
      userId: actor.id,
      action: 'USER_CREATED',
      entity: 'User',
      entityId: user.id,
      data: { role: user.role },
    });
    return user;
  }

  /**
   * El panel nunca se queda sin administrador: no se desactiva ni se degrada al último ADMIN activo.
   * (Se consulta al cambiar estado o rol; las cuentas propias tampoco se desactivan.)
   */
  private async assertNotLastActiveAdmin(target: { id: string; role: Role; isActive: boolean }) {
    if (target.role !== Role.ADMIN || !target.isActive) return;
    const others = await this.prisma.user.count({
      where: { role: Role.ADMIN, isActive: true, id: { not: target.id } },
    });
    if (!others) {
      throw new BadRequestException('Debe quedar al menos un administrador activo: crea o activa otro ADMIN antes');
    }
  }

  async update(actor: AuthenticatedUser, targetId: string, dto: { name?: string; role?: Role }) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, isActive: true },
    });
    if (!target) throw new NotFoundException('Usuario no encontrado');
    if (dto.role && dto.role !== target.role && target.role === Role.ADMIN) await this.assertNotLastActiveAdmin(target);
    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { ...(dto.name ? { name: dto.name } : {}), ...(dto.role ? { role: dto.role } : {}) },
      select: userSelect,
    });
    if (dto.role && dto.role !== target.role) {
      // El rol se lee de la BD en cada petición; los sockets abiertos se cierran para reconectar con el nuevo
      this.realtime.disconnectUser(targetId, 'Tu rol cambió: vuelve a iniciar sesión');
      await this.audit.record({
        userId: actor.id,
        action: 'USER_ROLE_CHANGED',
        entity: 'User',
        entityId: targetId,
        data: { from: target.role, to: dto.role },
      });
    }
    return updated;
  }

  async updateStatus(actor: AuthenticatedUser, targetId: string, isActive: boolean) {
    if (targetId === actor.id) throw new ForbiddenException('No puedes cambiar el acceso de tu propia cuenta');
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, isActive: true },
    });
    if (!target) throw new NotFoundException('Usuario no encontrado');
    if (!isActive) await this.assertNotLastActiveAdmin(target);
    const updated = await this.prisma.user.update({ where: { id: targetId }, data: { isActive }, select: userSelect });
    // Revocación inmediata: los JWT fallan en la siguiente petición; los sockets se cierran ya
    if (!isActive) this.realtime.disconnectUser(targetId);
    await this.audit.record({
      userId: actor.id,
      action: 'USER_STATUS_CHANGED',
      entity: 'User',
      entityId: targetId,
      data: { isActive },
    });
    return updated;
  }

  /** Nueva contraseña para otro usuario. Con 2FA activo en la cuenta del ADMIN exige Sudo Mode. */
  async resetPassword(actor: AuthenticatedUser, targetId: string, password: string, sudoToken?: string | string[]) {
    if (actor.isTwoFactorEnabled) await this.twoFactorAuth.assertSudo({ user: actor, sudoToken });
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!target) throw new NotFoundException('Usuario no encontrado');
    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { passwordHash: await bcrypt.hash(password, 10), passwordChangedAt: new Date() },
      select: userSelect,
    });
    this.realtime.disconnectUser(targetId, 'Tu contraseña cambió: inicia sesión de nuevo');
    await this.audit.record({ userId: actor.id, action: 'USER_PASSWORD_RESET', entity: 'User', entityId: targetId });
    return updated;
  }

  /**
   * Cambio de la propia contraseña: exige la actual o, si la cuenta tiene 2FA, Sudo Mode. Cierra las
   * demás sesiones y devuelve un token nuevo para que la sesión actual siga abierta.
   */
  async changeOwnPassword(
    userId: string,
    dto: { currentPassword?: string; newPassword: string },
    sudoToken?: string | string[],
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    if (dto.currentPassword) {
      // 400 y no 401: el frontend cierra la sesión ante un 401
      if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
        throw new BadRequestException('La contraseña actual no es correcta');
      }
    } else if (user.isTwoFactorEnabled) {
      await this.twoFactorAuth.assertSudo({ user, sudoToken });
    } else {
      throw new BadRequestException('Ingresa tu contraseña actual');
    }
    if (await bcrypt.compare(dto.newPassword, user.passwordHash)) {
      throw new BadRequestException('La nueva contraseña debe ser distinta de la actual');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 10), passwordChangedAt: new Date() },
    });
    this.realtime.disconnectUser(user.id, 'Tu contraseña cambió: inicia sesión de nuevo');
    await this.audit.record({ userId: user.id, action: 'OWN_PASSWORD_CHANGED', entity: 'User', entityId: user.id });
    return this.authService.issueAccessToken(user);
  }
}
