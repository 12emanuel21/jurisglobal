/**
 * Reglas de las campañas recurrentes (hora local de Colombia). Colombia es UTC-5 todo el año (sin
 * horario de verano), así que la conversión es un desfase fijo.
 */
export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface RecurrenceRule {
  frequency: Frequency;
  /** WEEKLY: 0 (domingo) … 6 (sábado) */
  daysOfWeek: number[];
  /** MONTHLY: 1–28 (todos los meses lo tienen) */
  dayOfMonth: number | null;
  /** "HH:MM" en hora de Colombia */
  timeOfDay: string;
  /** YYYY-MM-DD (hora de Colombia), inclusivas */
  startDate: string | null;
  endDate: string | null;
}

const OFFSET_MS = 5 * 60 * 60 * 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const isRealDate = (value: string) =>
  DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** Valida y normaliza la regla; lanza Error con un mensaje para el panel */
export function validateRule(raw: Partial<RecurrenceRule>): RecurrenceRule {
  const frequency = raw.frequency;
  if (frequency !== 'DAILY' && frequency !== 'WEEKLY' && frequency !== 'MONTHLY')
    throw new Error('Elige la frecuencia: diaria, semanal o mensual');
  const timeOfDay = String(raw.timeOfDay ?? '');
  if (!TIME.test(timeOfDay)) throw new Error('Escribe la hora en formato HH:MM (hora de Colombia)');
  const daysOfWeek =
    frequency === 'WEEKLY'
      ? [...new Set((raw.daysOfWeek ?? []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort()
      : [];
  if (frequency === 'WEEKLY' && !daysOfWeek.length) throw new Error('Elige al menos un día de la semana');
  const dayOfMonth = frequency === 'MONTHLY' ? Number(raw.dayOfMonth) : null;
  if (frequency === 'MONTHLY' && !(Number.isInteger(dayOfMonth) && dayOfMonth! >= 1 && dayOfMonth! <= 28))
    throw new Error('El día del mes debe estar entre 1 y 28 (para que exista en todos los meses)');
  const startDate = raw.startDate || null;
  const endDate = raw.endDate || null;
  if (startDate && !isRealDate(startDate)) throw new Error('Fecha de inicio no válida');
  if (endDate && !isRealDate(endDate)) throw new Error('Fecha de fin no válida');
  if (startDate && endDate && endDate < startDate)
    throw new Error('La fecha de fin no puede ser anterior a la de inicio');
  return { frequency, daysOfWeek, dayOfMonth, timeOfDay, startDate, endDate };
}

/** Próxima ejecución estrictamente posterior a `after` (null = ya no hay más, p. ej. pasó la fecha de fin) */
export function nextRunAfter(rule: RecurrenceRule, after: Date): Date | null {
  const [hh, mm] = rule.timeOfDay.split(':').map(Number);
  const local = new Date(after.getTime() - OFFSET_MS);
  for (let i = 0; i <= 400; i++) {
    const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + i));
    const key = day.toISOString().slice(0, 10);
    if (rule.endDate && key > rule.endDate) return null;
    if (rule.startDate && key < rule.startDate) continue;
    const matches =
      rule.frequency === 'DAILY' ||
      (rule.frequency === 'WEEKLY' && rule.daysOfWeek.includes(day.getUTCDay())) ||
      (rule.frequency === 'MONTHLY' && day.getUTCDate() === rule.dayOfMonth);
    if (!matches) continue;
    const at = new Date(day.getTime() + (hh * 60 + mm) * 60_000 + OFFSET_MS);
    if (at.getTime() > after.getTime()) return at;
  }
  return null;
}

/** Las próximas `count` ejecuciones a partir de `after` */
export function upcomingRuns(rule: RecurrenceRule, after: Date, count: number): Date[] {
  const runs: Date[] = [];
  let cursor = after;
  while (runs.length < count) {
    const next = nextRunAfter(rule, cursor);
    if (!next) break;
    runs.push(next);
    cursor = next;
  }
  return runs;
}

const joinEs = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`;
const dateEs = (key: string) => {
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
};

/** Descripción legible: «Cada semana: lunes y jueves a las 08:00 (desde 01/12/2026)» */
export function describeRule(rule: RecurrenceRule): string {
  const base =
    rule.frequency === 'DAILY'
      ? `Todos los días a las ${rule.timeOfDay}`
      : rule.frequency === 'WEEKLY'
        ? `Cada semana: ${joinEs(rule.daysOfWeek.map((d) => DAY_NAMES[d]))} a las ${rule.timeOfDay}`
        : `Cada mes, el día ${rule.dayOfMonth} a las ${rule.timeOfDay}`;
  const range = [
    rule.startDate && `desde ${dateEs(rule.startDate)}`,
    rule.endDate && `hasta ${dateEs(rule.endDate)}`,
  ].filter(Boolean);
  return range.length ? `${base} (${range.join(' ')})` : base;
}

/** Fecha corta para el nombre de cada campaña creada: «24/11/2026» */
export function runLabel(at: Date): string {
  return dateEs(new Date(at.getTime() - OFFSET_MS).toISOString().slice(0, 10));
}
