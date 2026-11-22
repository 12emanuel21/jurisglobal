import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Lee una variable de entorno obligatoria. Si falta, se lanza: nunca se usan valores por defecto
 * para secretos.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno obligatoria ${name}`);
  }
  return value;
}

/** Comparación en tiempo constante de dos textos (tokens, firmas) */
export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Verifica la firma de un webhook de Meta: x-hub-signature-256 = "sha256=" + HMAC-SHA256(appSecret, rawBody).
 * Debe calcularse sobre los bytes EXACTOS recibidos (no sobre el JSON re-serializado).
 * Sin secreto, sin cuerpo o sin cabecera: rechaza (fail-closed).
 */
export function isValidMetaSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  appSecret: string | null | undefined,
): boolean {
  if (!appSecret || !rawBody || !signatureHeader?.startsWith('sha256=')) return false;
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return safeEqual(signatureHeader, expected);
}
