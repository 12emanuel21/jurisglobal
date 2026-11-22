/**
 * Ventanas de envío de masivos (ESP §7.2) — adaptado de restaurants/business-hours.ts de KovalCloud:
 * una franja por día de la semana, evaluada en la zona horaria de Colombia, con festivos bloqueados.
 * Fuera de la ventana no se envía: el mensaje espera a nextOpening().
 *
 * Valores iniciales (Ley 2300 de 2023, art. 3 + art. 5 parágrafo 3): L–V 07:00–19:00,
 * sáb 08:00–15:00, domingos y festivos sin envíos.
 */
export interface SendWindowRule {
  /** 0 = domingo … 6 = sábado */
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
  enabled: boolean;
}

export const DEFAULT_TIMEZONE = 'America/Bogota';
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Valida una franja; lanza con un mensaje legible */
export function assertValidWindow(rule: SendWindowRule): void {
  if (!Number.isInteger(rule.dayOfWeek) || rule.dayOfWeek < 0 || rule.dayOfWeek > 6)
    throw new Error('Día de la semana inválido');
  if (!TIME_PATTERN.test(rule.opensAt) || !TIME_PATTERN.test(rule.closesAt))
    throw new Error('Usa horas en formato HH:MM (24 h)');
  if (toMinutes(rule.opensAt) >= toMinutes(rule.closesAt))
    throw new Error('La hora de apertura debe ser anterior a la de cierre');
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
  minute: number;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    dayOfWeek: WEEKDAY_INDEX[get('weekday')],
    minute: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
export const dateKey = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Fecha civil local (YYYY-MM-DD) de un instante */
export function localDateKey(date: Date, timeZone = DEFAULT_TIMEZONE): string {
  const p = localParts(date, timeZone);
  return dateKey(p.year, p.month, p.day);
}

/** Instante UTC de una hora local (y, m, d, minuto) en la zona indicada */
function zonedToUtc(y: number, m: number, d: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, Math.floor(minute / 60), minute % 60);
  const p = localParts(new Date(guess), timeZone);
  const asLocal = Date.UTC(p.year, p.month - 1, p.day, Math.floor(p.minute / 60), p.minute % 60);
  return new Date(guess - (asLocal - guess));
}

/** 00:00 local del día de `date` (instante UTC) */
export function startOfLocalDay(date: Date, timeZone = DEFAULT_TIMEZONE): Date {
  const p = localParts(date, timeZone);
  return zonedToUtc(p.year, p.month, p.day, 0, timeZone);
}

/** 00:00 local del día siguiente al de `date` */
export function startOfNextLocalDay(date: Date, timeZone = DEFAULT_TIMEZONE): Date {
  const p = localParts(date, timeZone);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, timeZone);
}

/** ¿Se puede enviar en este instante? Festivo o día deshabilitado = no. */
export function isWithinSendWindow(
  windows: SendWindowRule[],
  holidays: ReadonlySet<string>,
  now = new Date(),
  timeZone = DEFAULT_TIMEZONE,
): boolean {
  const p = localParts(now, timeZone);
  if (holidays.has(dateKey(p.year, p.month, p.day))) return false;
  const rule = windows.find((w) => w.dayOfWeek === p.dayOfWeek && w.enabled);
  return Boolean(rule && p.minute >= toMinutes(rule.opensAt) && p.minute < toMinutes(rule.closesAt));
}

/**
 * Próximo instante en que se puede enviar (ahora mismo si la ventana está abierta). null si no hay
 * ninguna ventana habilitada en el próximo año (configuración vacía).
 */
export function nextOpening(
  windows: SendWindowRule[],
  holidays: ReadonlySet<string>,
  now = new Date(),
  timeZone = DEFAULT_TIMEZONE,
): Date | null {
  if (isWithinSendWindow(windows, holidays, now, timeZone)) return now;
  const today = localParts(now, timeZone);
  for (let offset = 0; offset <= 370; offset++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    if (holidays.has(dateKey(y, m, d))) continue;
    const rule = windows.find((w) => w.dayOfWeek === day.getUTCDay() && w.enabled);
    if (!rule) continue;
    const open = toMinutes(rule.opensAt);
    if (offset === 0 && today.minute >= open) continue; // hoy ya abrió y cerró (si siguiera abierta, habría retornado)
    return zonedToUtc(y, m, d, open, timeZone);
  }
  return null;
}

/** Ventanas iniciales (semilla) según la Ley 2300 de 2023 */
export const LEY_2300_DEFAULT_WINDOWS: SendWindowRule[] = [
  { dayOfWeek: 0, opensAt: '08:00', closesAt: '15:00', enabled: false },
  ...[1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, opensAt: '07:00', closesAt: '19:00', enabled: true })),
  { dayOfWeek: 6, opensAt: '08:00', closesAt: '15:00', enabled: true },
];
