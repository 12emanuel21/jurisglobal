import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { ASESOR_ACCESS_KEY } from '../decorators/asesor-access.decorator';

/**
 * Autenticación (cookie httpOnly o Bearer) + política base de RBAC:
 * ASESOR solo usa los endpoints marcados con @AsesorAccess() (denegado por defecto).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated = (await super.canActivate(context)) as boolean;
    if (!authenticated) return false;

    const { user } = context.switchToHttp().getRequest();
    if (user?.role === Role.ASESOR) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ASESOR_ACCESS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) throw new ForbiddenException('Tu rol no tiene acceso a esta sección');
    }
    return true;
  }
}
