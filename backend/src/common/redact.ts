/**
 * Enmascarado de datos personales para logs (Ley 1581): nunca se escribe el payload completo de
 * WhatsApp ni teléfonos/correos en claro.
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  return digits.length <= 4 ? '****' : `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function maskEmail(email: string | null | undefined): string {
  if (!email || !email.includes('@')) return '—';
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
