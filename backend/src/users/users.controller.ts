import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AsesorAccess } from '../auth/decorators/asesor-access.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SUDO_HEADER } from '../auth/sudo';
import { SESSION_COOKIE, sessionCookieOptions } from '../auth/session-cookie';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateUserPasswordDto } from './dto/update-user-password.dto';
import { UpdateOwnPasswordDto } from './dto/update-own-password.dto';

/** Gestión de usuarios del panel: solo ADMIN (el ASESOR solo cambia su propia contraseña) */
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateUserDto) {
    return this.users.create(actor, dto);
  }

  /** Va antes de ':id/password' (ParseUUIDPipe rechazaría "me") */
  @Patch('me/password')
  @AsesorAccess()
  @Roles(Role.ADMIN, Role.ASESOR)
  async changeOwnPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateOwnPasswordDto,
    @Res({ passthrough: true }) res: Response,
    @Headers(SUDO_HEADER) sudoToken?: string,
  ) {
    const accessToken = await this.users.changeOwnPassword(user.id, dto, sudoToken);
    res.cookie(SESSION_COOKIE, accessToken, sessionCookieOptions());
    return { ok: true };
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.users.updateStatus(actor, id, dto.isActive);
  }

  @Patch(':id/password')
  resetPassword(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserPasswordDto,
    @Headers(SUDO_HEADER) sudoToken?: string,
  ) {
    return this.users.resetPassword(actor, id, dto.password, sudoToken);
  }
}
