/**
 * Exportación de leads a CSV para Excel en Colombia:
 * - UTF-8 con BOM: Excel reconoce la codificación y respeta tildes y eñes.
 * - Separador ";": con la configuración regional es-CO (coma decimal) Excel separa columnas por ";".
 * - Teléfono como fórmula de texto ="+573001234567": Excel no lo convierte en número ni en fórmula
 *   (un "+57…" suelto se interpreta como suma o se pierde el "+").
 * - Inyección de fórmulas (OWASP): un texto que empieza por = + - @ tab o CR se antepone con '.
 */
export const CSV_BOM = '﻿';
export const CSV_DELIMITER = ';';

/** Celda de fórmula controlada por nosotros (no se neutraliza) */
export interface FormulaCell {
  formula: string;
}
export type CsvCell = string | number | null | undefined | FormulaCell;

const FORMULA_START = /^[=+\-@\t\r]/;

function escape(value: string): string {
  return /[";\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function csvCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'object') return escape(cell.formula);
  const text = String(cell);
  return escape(FORMULA_START.test(text) ? `'${text}` : text);
}

/** Teléfono E.164 sin "+" -> ="+573001234567" (texto en Excel); vacío si está anonimizado */
export function phoneCell(e164: string | null | undefined): CsvCell {
  return e164 && /^\d{8,15}$/.test(e164) ? { formula: `="+${e164}"` } : '';
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(CSV_DELIMITER));
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`;
}

/** "2026-11-22 14:05" en hora de Colombia */
export function csvDate(date: Date | null | undefined, timeZone = 'America/Bogota'): string {
  if (!date) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
