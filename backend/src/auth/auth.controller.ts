import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginThrottlerGuard } from './guards/login-throttler.guard';
import { TwoFactorThrottlerGuard } from './guards/two-factor-throttler.guard';
import { AsesorAccess } from './decorators/asesor-access.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedUser } from './strategies/jwt.strategy';
import { SESSION_COOKIE, sessionCookieOptions } from './session-cookie';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** Máximo 5 intentos por minuto por IP. La sesión viaja en una cookie httpOnly (no en el cuerpo). */
  @UseGuards(LoginThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { accessToken, user } = await this.authService.login(dto, req.ip);
    res.cookie(SESSION_COOKIE, accessToken, sessionCookieOptions());
    return { user };
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    const { maxAge, ...options } = sessionCookieOptions();
    void maxAge;
    res.clearCookie(SESSION_COOKIE, options);
    return { ok: true };
  }

  @AsesorAccess()
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  profile(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @AsesorAccess()
  @UseGuards(JwtAuthGuard)
  @Post('2fa/generate')
  generate2FA(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.generateTwoFactorSecret(user.id, user.email);
  }

  @AsesorAccess()
  @UseGuards(JwtAuthGuard, TwoFactorThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('2fa/enable')
  enable2FA(@CurrentUser() user: AuthenticatedUser, @Body('code') code: unknown) {
    return this.authService.enableTwoFactor(user.id, code);
  }

  /** Sudo Mode: código válido -> sudoToken de 30 min (header x-sudo-token en rutas sensibles) */
  @AsesorAccess()
  @UseGuards(JwtAuthGuard, TwoFactorThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('2fa/verify-sudo')
  verifySudo(@CurrentUser() user: AuthenticatedUser, @Body('code') code: unknown) {
    return this.authService.issueSudoToken(user.id, code);
  }
}
