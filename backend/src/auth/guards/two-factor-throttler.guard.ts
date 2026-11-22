import { Injectable } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { RealIpThrottlerGuard } from '../../common/real-ip-throttler.guard';

/** Límite de intentos de código 2FA por IP (evita adivinar los 6 dígitos por fuerza bruta) */
@Injectable()
export class TwoFactorThrottlerGuard extends RealIpThrottlerGuard {
  protected throwThrottlingException(): Promise<void> {
    return Promise.reject(
      new ThrottlerException('Demasiados intentos de código. Espera un minuto e intenta de nuevo.'),
    );
  }
}
