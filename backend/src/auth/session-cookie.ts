import type { CookieOptions, Request } from 'express';
import { loadEnv } from '../config/env';

/** Cookie de sesión del panel: httpOnly (JS no la lee), SameSite=Lax (no viaja en POST cross-site) */
export const SESSION_COOKIE = 'jg_session';

const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** "12h" -> 43200000 · "7d" -> 604800000 · "3600" (segundos) -> 3600000 */
export function durationToMs(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) throw new Error(`Duración inválida: ${value}`);
  return Number(match[1]) * UNIT_MS[match[2] ?? 's'];
}

export function sessionCookieOptions(): CookieOptions {
  const env = loadEnv();
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: durationToMs(env.JWT_EXPIRES_IN),
  };
}

/** Token de la cookie (navegador) o, en su defecto, Bearer (scripts y pruebas) */
export function extractSessionToken(
  req: Pick<Request, 'headers'> & { cookies?: Record<string, string> },
): string | null {
  const fromCookie = req.cookies?.[SESSION_COOKIE];
  if (typeof fromCookie === 'string' && fromCookie) return fromCookie;
  const header = req.headers?.authorization;
  if (typeof header === 'string' && /^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '');
  return null;
}

/** Lee una cookie de una cabecera Cookie cruda (handshake de Socket.io) */
export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
