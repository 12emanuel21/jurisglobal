import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { loadEnv } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RolesGuard } from './guards/roles.guard';
import { SudoGuard } from './guards/sudo.guard';
import { TwoFactorAuthService } from './two-factor-auth.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: () => {
        const env = loadEnv();
        return { secret: env.JWT_SECRET, signOptions: { expiresIn: env.JWT_EXPIRES_IN as `${number}h` } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, RolesGuard, SudoGuard, TwoFactorAuthService],
  exports: [AuthService, PassportModule, JwtModule, RolesGuard, SudoGuard, TwoFactorAuthService],
})
export class AuthModule {}
