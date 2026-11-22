import { describe, expect, it } from 'vitest';
import { EMPTY_LEAD_FORM, normalizeColombianPhone, toLeadPayload, validateLeadForm } from './lead-form';
import { formatCop } from './public-config';
import { displayPhone, whatsappUrl } from './site';

describe('Validación del formulario', () => {
  it.each([
    ['300 123 4567', '3001234567'],
    ['+57 300 123 4567', '3001234567'],
    ['(601) 555-1234', '6015551234'],
    ['0300 123 4567', '3001234567'],
  ])('normaliza %s', (input, expected) => {
    expect(normalizeColombianPhone(input)).toBe(expected);
  });

  it.each(['', '12345', '200 123 4567', '+1 305 555 0100', '300 123 45678'])('rechaza %s', (input) => {
    expect(normalizeColombianPhone(input)).toBeNull();
  });

  it('formulario vacío: un error por campo obligatorio', () => {
    expect(Object.keys(validateLeadForm(EMPTY_LEAD_FORM)).sort()).toEqual(
      ['contactAndDataProcessing', 'email', 'fullName', 'motivo', 'phone', 'privacyAndTerms'].sort(),
    );
  });

  it('payload: nombre limpio, +57, correo en minúsculas y honeypot', () => {
    expect(
      toLeadPayload({
        ...EMPTY_LEAD_FORM,
        fullName: ' Luis  Gómez ',
        phone: '310-555-0000',
        email: ' LUIS@Correo.CO ',
        motivo: 'm1',
        privacyAndTerms: true,
        contactAndDataProcessing: true,
      }),
    ).toMatchObject({ fullName: 'Luis Gómez', phone: '+573105550000', email: 'luis@correo.co', origin: 'web', website: '' });
  });

  it('formatos de presentación', () => {
    expect(formatCop(100000)).toBe('$100.000 COP');
    expect(formatCop(1250000)).toBe('$1.250.000 COP');
    expect(displayPhone('573001234567')).toBe('+57 300 123 4567');
    expect(whatsappUrl('Hola, JurisGlobal', '573001234567')).toBe('https://wa.me/573001234567?text=Hola%2C%20JurisGlobal');
    expect(whatsappUrl('x', '')).toBeNull();
  });
});
