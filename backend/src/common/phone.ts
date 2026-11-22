/**
 * Teléfono en formato internacional E.164 sin "+" (como lo usa WhatsApp Cloud API: 573001234567).
 * Basado en normalizeColombianPhone de KovalCloud, sin contactos LID (solo Cloud API).
 *
 * - Quita espacios, guiones, puntos, paréntesis, el "+" y el prefijo internacional "00".
 * - Celular colombiano de 10 dígitos que empieza por 3 -> antepone 57.
 * - "0300…" (cero de marcación) -> 57300…
 * - Ya trae 57 + 10 dígitos -> igual.
 * - Otros países: se dejan sus dígitos si tienen entre 8 y 15 (E.164).
 * Devuelve null si no es un número utilizable.
 */
export function toE164(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  let digits = input.replace(/\D/g, '');
  if (input.trim().startsWith('00')) digits = digits.replace(/^00/, '');
  if (!digits) return null;

  if (digits.length === 11 && digits.startsWith('03')) digits = digits.slice(1);
  // Celular (3xx) o fijo nacional de 10 dígitos (60x) sin indicativo
  if (digits.length === 10 && (digits.startsWith('3') || digits.startsWith('60'))) return `57${digits}`;
  // Con indicativo de Colombia: 57 + 10 dígitos exactos
  if (digits.startsWith('57')) return digits.length === 12 ? digits : null;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** ¿Es un celular colombiano válido? (57 + 3xx + 7 dígitos) */
export function isColombianMobile(e164: string | null | undefined): boolean {
  return typeof e164 === 'string' && /^573\d{9}$/.test(e164);
}

/** "573001234567" -> "+57 300 123 4567" (solo presentación) */
export function formatPhone(e164: string): string {
  const m = /^57(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+57 ${m[1]} ${m[2]} ${m[3]}` : `+${e164}`;
}

/** Celular (3xx) o fijo nacional (60x) de Colombia: 57 + 10 dígitos */
const COLOMBIAN_E164 = /^57(3\d{9}|60\d{8})$/;

/**
 * Normalización ESTRICTA para leads (ESP §5): solo números de Colombia. Devuelve dígitos E.164
 * sin "+" (como el wa_id de WhatsApp, para deduplicar entre web y bot) o null si no es válido.
 */
export function toColombianPhone(input: string | null | undefined): string | null {
  const e164 = toE164(input);
  return e164 && COLOMBIAN_E164.test(e164) ? e164 : null;
}

/** "573001234567" -> "+573001234567" (formato de salida de la API) */
export const withPlus = (e164: string) => `+${e164}`;
