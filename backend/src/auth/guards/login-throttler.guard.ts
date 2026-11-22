import { Injectable } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { RealIpThrottlerGuard } from '../../common/real-ip-throttler.guard';

/**
 * Límite de intentos de inicio de sesión por IP: frena la fuerza bruta de contraseñas (y del
 * código 2FA del login). Mensaje propio, específico del inicio de sesión.
 */
@Injectable()
export class LoginThrottlerGuard extends RealIpThrottlerGuard {
  protected throwThrottlingException(): Promise<void> {
    return Promise.reject(
      new ThrottlerException('Demasiados intentos de inicio de sesión. Espera un minuto e intenta de nuevo.'),
    );
  }
}
