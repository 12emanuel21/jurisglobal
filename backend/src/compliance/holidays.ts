/**
 * Festivos de Colombia (Ley 51 de 1983 "Ley Emiliani" y fechas que dependen de la Pascua).
 * Se usan como semilla de la tabla Holiday (editable desde el panel).
 *
 * - Fijos: 1 ene, 1 may, 20 jul, 7 ago, 8 dic, 25 dic.
 * - Trasladables al lunes siguiente: 6 ene, 19 mar, 29 jun, 15 ago, 12 oct, 1 nov, 11 nov.
 * - Pascua: Jueves y Viernes Santo (sin traslado); Ascensión (+43), Corpus Christi (+64) y
 *   Sagrado Corazón (+71) ya trasladados a lunes.
 */
export interface HolidayDef {
  /** YYYY-MM-DD (fecha civil en Colombia) */
  date: string;
  name: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const key = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

/** Domingo de Pascua (algoritmo anónimo gregoriano / Meeus) */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

/** Lunes siguiente (o el mismo día si ya es lunes) */
function nextMonday(d: Date): Date {
  const dow = d.getUTCDay();
  return dow === 1 ? d : addDays(d, (8 - dow) % 7);
}

export function colombianHolidays(year: number): HolidayDef[] {
  const easter = easterSunday(year);
  const list: Array<[Date, string]> = [
    [utc(year, 1, 1), 'Año Nuevo'],
    [nextMonday(utc(year, 1, 6)), 'Día de los Reyes Magos'],
    [nextMonday(utc(year, 3, 19)), 'Día de San José'],
    [addDays(easter, -3), 'Jueves Santo'],
    [addDays(easter, -2), 'Viernes Santo'],
    [utc(year, 5, 1), 'Día del Trabajo'],
    [addDays(easter, 43), 'Ascensión del Señor'],
    [addDays(easter, 64), 'Corpus Christi'],
    [addDays(easter, 71), 'Sagrado Corazón de Jesús'],
    [nextMonday(utc(year, 6, 29)), 'San Pedro y San Pablo'],
    [utc(year, 7, 20), 'Día de la Independencia'],
    [utc(year, 8, 7), 'Batalla de Boyacá'],
    [nextMonday(utc(year, 8, 15)), 'La Asunción de la Virgen'],
    [nextMonday(utc(year, 10, 12)), 'Día de la Raza'],
    [nextMonday(utc(year, 11, 1)), 'Todos los Santos'],
    [nextMonday(utc(year, 11, 11)), 'Independencia de Cartagena'],
    [utc(year, 12, 8), 'Día de la Inmaculada Concepción'],
    [utc(year, 12, 25), 'Navidad'],
  ];
  return list.map(([d, name]) => ({ date: key(d), name })).sort((a, b) => a.date.localeCompare(b.date));
}
