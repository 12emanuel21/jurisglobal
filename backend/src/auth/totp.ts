import { authenticator } from 'otplib';
import { decryptField } from '../common/crypto';

/** TOTP con ±1 ventana de 30 s de tolerancia (relojes de celular desfasados) */
const totp = authenticator.clone({ window: 1 });

/** Código de 6 dígitos válido para el secreto cifrado guardado en la BD */
export function isValidTotp(code: unknown, encryptedSecret: string | null | undefined): boolean {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code) || !encryptedSecret) return false;
  try {
    return totp.verify({ token: code, secret: decryptField(encryptedSecret) });
  } catch {
    return false;
  }
}
