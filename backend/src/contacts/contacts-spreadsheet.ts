import * as XLSX from 'xlsx';
import { isColombianMobile, toColombianPhone } from '../common/phone';

/**
 * Importador de contactos para masivos (adaptado de restaurants/menu-spreadsheet.ts de KovalCloud).
 * Lee la primera hoja de un .xlsx/.xls/.csv y valida cada fila; no toca la base de datos.
 *
 * Columnas obligatorias: Teléfono, Origen y Autorización (salvaguarda acordada en la Etapa 0: cada
 * contacto debe declarar de dónde viene y si hay soporte documental de su autorización para JurisGlobal).
 * Opcionales: Nombre, Correo, Etiquetas (separadas por coma o punto y coma).
 */
export const CONTACT_SPREADSHEET_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;
export const MAX_CONTACT_ROWS = 5000;
const MAX_REPORTED_ISSUES = 50;

export type ImportConsent = 'DOCUMENTED' | 'UNVERIFIED';

export interface ContactImportRow {
  row: number;
  phone: string;
  name: string | null;
  email: string | null;
  tags: string[];
  source: string;
  consent: ImportConsent;
}

export interface ParsedContactSpreadsheet {
  rows: ContactImportRow[];
  /** Problemas por fila (o el problema del archivo si `fatal`), máx. 50 en la lista */
  errors: string[];
  warnings: string[];
  /** El archivo no se puede importar (formato, columnas, tamaño): no se toca la base */
  fatal: boolean;
  /** Filas descartadas por datos inválidos y por teléfono repetido dentro del archivo (totales reales) */
  invalidRows: number;
  duplicateRows: number;
}

const fatal = (message: string): ParsedContactSpreadsheet => ({
  rows: [],
  errors: [message],
  warnings: [],
  fatal: true,
  invalidRows: 0,
  duplicateRows: 0,
});

type Column = 'name' | 'phone' | 'email' | 'tags' | 'source' | 'consent';

const HEADER_ALIASES: Record<string, Column> = {
  nombre: 'name',
  'nombre completo': 'name',
  name: 'name',
  telefono: 'phone',
  celular: 'phone',
  whatsapp: 'phone',
  movil: 'phone',
  phone: 'phone',
  correo: 'email',
  'correo electronico': 'email',
  email: 'email',
  etiquetas: 'tags',
  tags: 'tags',
  origen: 'source',
  fuente: 'source',
  source: 'source',
  autorizacion: 'consent',
  'autorizacion datos': 'consent',
  'autorizacion de datos': 'consent',
  consentimiento: 'consent',
  consent: 'consent',
};

const REQUIRED: Array<[Column, string]> = [
  ['phone', 'Teléfono'],
  ['source', 'Origen'],
  ['consent', 'Autorización'],
];

/** Valores que cuentan como "hay soporte documental de la autorización" */
const DOCUMENTED_VALUES = new Set(['si', 'documentada', 'documentado', 'x', 'true', '1', 'yes', 'soporte']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();
}

const cellText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return value instanceof Date ? value.toISOString() : '';
};

export function parseConsent(value: unknown): ImportConsent {
  return DOCUMENTED_VALUES.has(normalizeHeader(cellText(value))) ? 'DOCUMENTED' : 'UNVERIFIED';
}

const capped = (list: string[]) =>
  list.length > MAX_REPORTED_ISSUES
    ? [...list.slice(0, MAX_REPORTED_ISSUES), `…y ${list.length - MAX_REPORTED_ISSUES} más`]
    : list;

export function parseContactSpreadsheet(buffer: Buffer, filename: string): ParsedContactSpreadsheet {
  const isCsv = filename.toLowerCase().endsWith('.csv');
  let workbook: XLSX.WorkBook;
  try {
    // CSV como texto UTF-8 sin BOM y sin interpretar valores (los teléfonos no se vuelven números)
    workbook = isCsv
      ? XLSX.read(buffer.toString('utf8').replace(/^\uFEFF/, ''), { type: 'string', raw: true })
      : XLSX.read(buffer, { type: 'buffer' });
  } catch {
    return fatal('No se pudo leer el archivo: verifica que sea un Excel (.xlsx/.xls) o CSV válido');
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return fatal('El archivo no tiene hojas');

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true, raw: false });
  while (matrix.length > 1 && (matrix[matrix.length - 1] ?? []).every((c) => cellText(c) === '')) matrix.pop();
  if (matrix.length < 2) return fatal('El archivo está vacío: se esperaba una cabecera y al menos un contacto');

  const columnIndex = new Map<Column, number>();
  (matrix[0] ?? []).forEach((header, index) => {
    const column = HEADER_ALIASES[normalizeHeader(cellText(header).replace(/^\uFEFF/, ''))];
    if (column && !columnIndex.has(column)) columnIndex.set(column, index);
  });
  const missing = REQUIRED.filter(([c]) => !columnIndex.has(c)).map(([, label]) => label);
  if (missing.length) {
    return fatal(
      `Faltan columnas obligatorias: ${missing.join(', ')}. Columnas esperadas: Nombre, Teléfono, Correo, Etiquetas, Origen, Autorización`,
    );
  }
  const dataRows = matrix.slice(1);
  if (dataRows.length > MAX_CONTACT_ROWS) {
    return fatal(`El archivo supera el máximo de ${MAX_CONTACT_ROWS} contactos por importación`);
  }

  const get = (cells: unknown[], c: Column) => {
    const i = columnIndex.get(c);
    return i === undefined ? '' : cells[i];
  };
  const rows: ContactImportRow[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const duplicates: string[] = [];
  const seen = new Map<string, number>();

  dataRows.forEach((cells, i) => {
    const row = i + 2;
    if (cells.every((c) => cellText(c) === '')) return;
    const rawPhone = cellText(get(cells, 'phone'));
    // Solo celulares de Colombia (57 + 3xx + 7 dígitos): WhatsApp de personas, no fijos ni otros países
    const normalized = toColombianPhone(rawPhone);
    const phone = normalized && isColombianMobile(normalized) ? normalized : null;
    const source = cellText(get(cells, 'source'));
    const rowErrors: string[] = [];
    if (!phone) rowErrors.push(`el Teléfono "${rawPhone}" no es un celular colombiano válido`);
    if (!source) rowErrors.push('el Origen está vacío');
    if (rowErrors.length) {
      errors.push(`Fila ${row}: ${rowErrors.join(', ')}`);
      return;
    }
    const firstRow = seen.get(phone!);
    if (firstRow) {
      duplicates.push(`Fila ${row}: teléfono repetido (ya está en la fila ${firstRow}); se ignora`);
      return;
    }
    seen.set(phone!, row);

    const rawEmail = cellText(get(cells, 'email')).toLowerCase();
    if (rawEmail && !EMAIL_PATTERN.test(rawEmail))
      warnings.push(`Fila ${row}: el correo "${rawEmail}" no es válido y se ignoró`);
    const name = cellText(get(cells, 'name'));
    const tags = cellText(get(cells, 'tags'))
      .split(/[;,]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20);
    rows.push({
      row,
      phone: phone!,
      name: name ? name.slice(0, 150) : null,
      email: rawEmail && EMAIL_PATTERN.test(rawEmail) ? rawEmail : null,
      tags,
      source: source.slice(0, 150),
      consent: parseConsent(get(cells, 'consent')),
    });
  });

  if (!errors.length && !rows.length) return fatal('El archivo no contiene contactos para importar');
  return {
    rows,
    errors: capped(errors),
    warnings: capped([...duplicates, ...warnings]),
    fatal: false,
    invalidRows: errors.length,
    duplicateRows: duplicates.length,
  };
}
