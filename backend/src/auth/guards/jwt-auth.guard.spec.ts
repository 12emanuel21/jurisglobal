import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AsesorAccess } from '../decorators/asesor-access.decorator';

class FakeController {
  @AsesorAccess()
  listLeads() {}

  editSettings() {}
}

describe('JwtAuthGuard — deny-by-default para ASESOR', () => {
  const guard = new JwtAuthGuard(new Reflector());

  /** Handler sin desligar "this" (unbound-method): se toma del descriptor */
  const handler = (name: 'listLeads' | 'editSettings') =>
    Object.getOwnPropertyDescriptor(FakeController.prototype, name)!.value as () => void;

  const contextFor = (role: Role, handler: () => void) =>
    ({
      getHandler: () => handler,
      getClass: () => FakeController,
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate').mockResolvedValue(true);
  });
  afterEach(() => jest.restoreAllMocks());

  it('ASESOR accede a endpoints marcados con @AsesorAccess()', async () => {
    await expect(guard.canActivate(contextFor(Role.ASESOR, handler('listLeads')))).resolves.toBe(true);
  });

  it('ASESOR es rechazado (403) en cualquier endpoint no marcado', async () => {
    await expect(guard.canActivate(contextFor(Role.ASESOR, handler('editSettings')))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('ADMIN no se ve afectado', async () => {
    await expect(guard.canActivate(contextFor(Role.ADMIN, handler('editSettings')))).resolves.toBe(true);
  });
});
