import { isIP } from 'net';

/**
 * IP real del visitante detrás de Cloudflare → cloudflared → nginx → API.
 *
 * Solo se confía en cabeceras si la conexión llega desde la red interna (nginx o cloudflared en
 * jurisglobal_net, o loopback en pruebas). Una conexión directa desde una IP pública usa esa IP y
 * se ignoran las cabeceras (no se pueden falsificar para evadir el límite por IP).
 * Prioridad: CF-Connecting-IP (Cloudflare la reescribe siempre en su borde) → X-Real-IP / la
 * última entrada de X-Forwarded-For (la escribe nuestro nginx) → la IP de la conexión.
 */
export function normalizeIp(value: string | undefined | null): string | null {
  if (!value) return null;
  let ip = value.trim();
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'));
  if (ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return isIP(ip) ? ip : null;
}

/** Loopback, redes privadas (RFC 1918), CGNAT, link-local y ULA IPv6 */
export function isInternalIp(value: string | null): boolean {
  const ip = normalizeIp(value);
  if (!ip) return false;
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const lower = ip.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

type HeaderBag = Record<string, string | string[] | undefined>;
const header = (headers: HeaderBag, name: string) => {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
};

export function resolveClientIp(peer: string | undefined | null, headers: HeaderBag): string {
  const direct = normalizeIp(peer) ?? 'unknown';
  if (!isInternalIp(direct)) return direct;
  const cf = normalizeIp(header(headers, 'cf-connecting-ip'));
  if (cf) return cf;
  const real = normalizeIp(header(headers, 'x-real-ip'));
  if (real) return real;
  const chain = (header(headers, 'x-forwarded-for') ?? '')
    .split(',')
    .map((p) => normalizeIp(p))
    .filter(Boolean);
  return chain.at(-1) ?? direct;
}

/** Atajo para un Request de Express */
export function clientIpOf(req: { socket?: { remoteAddress?: string }; headers: HeaderBag }): string {
  return resolveClientIp(req.socket?.remoteAddress, req.headers);
}
