export const APP_TIMEZONE = 'America/Bogota';

/** "573001234567" -> "+57 300 123 4567" */
export function formatPhone(e164: string): string {
  const m = /^57(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+57 ${m[1]} ${m[2]} ${m[3]}` : `+${e164}`;
}

const localDay = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: APP_TIMEZONE });

/** Hora si es de hoy, "Ayer", o fecha corta (hora de Colombia) */
export function formatListDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (localDay(date) === localDay(now)) return date.toLocaleTimeString('es-CO', { timeZone: APP_TIMEZONE, hour: 'numeric', minute: '2-digit' });
  if (localDay(date) === localDay(new Date(now.getTime() - 86_400_000))) return 'Ayer';
  return date.toLocaleDateString('es-CO', { timeZone: APP_TIMEZONE, day: '2-digit', month: 'short' });
}

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { timeZone: APP_TIMEZONE, day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
