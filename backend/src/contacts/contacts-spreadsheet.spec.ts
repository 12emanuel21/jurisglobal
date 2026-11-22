import * as XLSX from 'xlsx';
import { parseConsent, parseContactSpreadsheet } from './contacts-spreadsheet';

const csv = (text: string) => Buffer.from(text, 'utf8');

describe('Importador de contactos (xlsx/csv)', () => {
  it('CSV con BOM, alias de cabecera y normalización de teléfonos', () => {
    const file = csv(
      '﻿Nombre;Teléfono;Correo;Etiquetas;Origen;Autorización\n'.replace(/;/g, ',') +
        'Ana Pérez,300 123 4567,ana@correo.co,tránsito;2025,Consultoría X,Sí\n' +
        'Luis,+57 310 555 0000,,,Consultoría X,\n',
    );
    const r = parseContactSpreadsheet(file, 'base.csv');
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      {
        row: 2,
        phone: '573001234567',
        name: 'Ana Pérez',
        email: 'ana@correo.co',
        tags: ['tránsito', '2025'],
        source: 'Consultoría X',
        consent: 'DOCUMENTED',
      },
      {
        row: 3,
        phone: '573105550000',
        name: 'Luis',
        email: null,
        tags: [],
        source: 'Consultoría X',
        consent: 'UNVERIFIED',
      },
    ]);
  });

  it('exige las columnas Teléfono, Origen y Autorización', () => {
    const r = parseContactSpreadsheet(csv('Nombre,Telefono\nAna,3001234567\n'), 'x.csv');
    expect(r.rows).toEqual([]);
    expect(r.errors[0]).toMatch(/Faltan columnas obligatorias: Origen, Autorización/);
  });

  it('errores por fila, duplicados y correo inválido', () => {
    const r = parseContactSpreadsheet(
      csv(
        'telefono,origen,autorizacion,correo\n123,Base,si,\n3001234567,,si,\n3001234567,Base,si,malo@\n300 123 4567,Base,no,\n',
      ),
      'x.csv',
    );
    expect(r.errors).toEqual(['Fila 2: el Teléfono "123" no es válido', 'Fila 3: el Origen está vacío']);
    expect(r.rows).toHaveLength(1);
    expect(r.warnings).toEqual([
      'Fila 4: el correo "malo@" no es válido y se ignoró',
      'Fila 5: teléfono repetido (ya está en la fila 4); se ignora',
    ]);
  });

  it('lee xlsx (los teléfonos numéricos no pierden dígitos)', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Teléfono', 'Origen', 'Autorización'],
      [3001234567, 'Feria', 'documentada'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    expect(parseContactSpreadsheet(buffer, 'base.xlsx').rows[0]).toMatchObject({
      phone: '573001234567',
      consent: 'DOCUMENTED',
    });
  });

  it('parseConsent', () => {
    expect(parseConsent('SÍ')).toBe('DOCUMENTED');
    expect(parseConsent('pendiente')).toBe('UNVERIFIED');
    expect(parseConsent('')).toBe('UNVERIFIED');
  });
});
