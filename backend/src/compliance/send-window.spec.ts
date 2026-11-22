import { colombianHolidays } from './holidays';
import {
  assertValidWindow,
  isWithinSendWindow,
  LEY_2300_DEFAULT_WINDOWS as W,
  localDateKey,
  nextOpening,
  startOfLocalDay,
  startOfNextLocalDay,
} from './send-window';

// Colombia es UTC-5 todo el año: 07:00 Bogotá = 12:00 UTC
const bogota = (iso: string) => new Date(`${iso}-05:00`);
const holidays = new Set([...colombianHolidays(2026), ...colombianHolidays(2027)].map((h) => h.date));

describe('Ventanas de envío (Ley 2300: L–V 7–19, sáb 8–15, sin domingos ni festivos)', () => {
  it('bordes de apertura y cierre entre semana', () => {
    expect(isWithinSendWindow(W, holidays, bogota('2026-11-23T06:59'))).toBe(false); // lunes
    expect(isWithinSendWindow(W, holidays, bogota('2026-11-23T07:00'))).toBe(true);
    expect(isWithinSendWindow(W, holidays, bogota('2026-11-23T18:59'))).toBe(true);
    expect(isWithinSendWindow(W, holidays, bogota('2026-11-23T19:00'))).toBe(false);
  });

  it('sábado 8–15 y domingo bloqueado', () => {
    expect(isWithinSendWindow(W, holidays, bogota('2026-11-28T07:30'))).toBe(false);
    expect(isWithinSendWindow(W, holidays, bogota('2026-11-28T14:59'))).toBe(true);
    expect(isWithinSendWindow(W, holidays, bogota('2026-11-28T15:00'))).toBe(false);
    expect(isWithinSendWindow(W, holidays, bogota('2026-11-29T10:00'))).toBe(false);
  });

  it('festivo trasladado (lunes 16-nov-2026, Independencia de Cartagena) bloqueado', () => {
    expect(isWithinSendWindow(W, holidays, bogota('2026-11-16T10:00'))).toBe(false);
  });

  it('nextOpening: viernes 19:01 -> sábado 08:00', () => {
    expect(nextOpening(W, holidays, bogota('2026-11-27T19:01'))?.toISOString()).toBe(
      bogota('2026-11-28T08:00').toISOString(),
    );
  });

  it('nextOpening: sábado 15:00 -> lunes 07:00 (salta el domingo)', () => {
    expect(nextOpening(W, holidays, bogota('2026-11-28T15:00'))?.toISOString()).toBe(
      bogota('2026-11-30T07:00').toISOString(),
    );
  });

  it('nextOpening: domingo antes de un lunes festivo -> martes 07:00', () => {
    expect(nextOpening(W, holidays, bogota('2026-11-15T09:00'))?.toISOString()).toBe(
      bogota('2026-11-17T07:00').toISOString(),
    );
  });

  it('nextOpening: madrugada del mismo día y ventana abierta', () => {
    expect(nextOpening(W, holidays, bogota('2026-11-24T05:00'))?.toISOString()).toBe(
      bogota('2026-11-24T07:00').toISOString(),
    );
    const now = bogota('2026-11-24T10:00');
    expect(nextOpening(W, holidays, now)).toBe(now);
  });

  it('fin de año: 24-dic 19:30 -> 26-dic 08:00 (25 festivo)', () => {
    expect(nextOpening(W, holidays, bogota('2026-12-24T19:30'))?.toISOString()).toBe(
      bogota('2026-12-26T08:00').toISOString(),
    );
  });

  it('sin ventanas habilitadas -> null; validación de franjas', () => {
    expect(
      nextOpening(
        W.map((w) => ({ ...w, enabled: false })),
        holidays,
        bogota('2026-11-24T10:00'),
      ),
    ).toBeNull();
    expect(() => assertValidWindow({ dayOfWeek: 1, opensAt: '19:00', closesAt: '07:00', enabled: true })).toThrow();
    expect(() => assertValidWindow({ dayOfWeek: 7, opensAt: '07:00', closesAt: '19:00', enabled: true })).toThrow();
    expect(localDateKey(new Date('2026-11-24T03:00:00Z'))).toBe('2026-11-23');
  });

  it('inicio del día en Bogotá (topes diarios): 23:30 local sigue siendo el mismo día', () => {
    expect(startOfLocalDay(bogota('2026-11-24T23:30')).toISOString()).toBe('2026-11-24T05:00:00.000Z');
    expect(startOfNextLocalDay(bogota('2026-11-24T23:30')).toISOString()).toBe('2026-11-25T05:00:00.000Z');
    expect(startOfNextLocalDay(bogota('2026-12-31T10:00')).toISOString()).toBe('2027-01-01T05:00:00.000Z');
    // Tope alcanzado un viernes por la tarde: el siguiente día hábil es el sábado 08:00
    expect(nextOpening(W, holidays, startOfNextLocalDay(bogota('2026-11-27T16:00')))).toEqual(
      bogota('2026-11-28T08:00'),
    );
  });
});
