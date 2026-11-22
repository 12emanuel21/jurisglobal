import { describeRule, nextRunAfter, runLabel, upcomingRuns, validateRule, type RecurrenceRule } from './recurrence';

const bogota = (iso: string) => new Date(`${iso}-05:00`);
const rule = (over: Partial<RecurrenceRule>): RecurrenceRule => ({
  frequency: 'DAILY',
  daysOfWeek: [],
  dayOfMonth: null,
  timeOfDay: '08:00',
  startDate: null,
  endDate: null,
  ...over,
});

describe('Campañas recurrentes · reglas (hora de Colombia)', () => {
  it('diaria: si la hora de hoy ya pasó, sigue mañana', () => {
    expect(nextRunAfter(rule({}), bogota('2026-11-24T10:00'))).toEqual(bogota('2026-11-25T08:00'));
    expect(nextRunAfter(rule({}), bogota('2026-11-24T07:59'))).toEqual(bogota('2026-11-24T08:00'));
  });

  it('semanal: lunes y jueves', () => {
    const r = rule({ frequency: 'WEEKLY', daysOfWeek: [1, 4] });
    expect(upcomingRuns(r, bogota('2026-11-24T10:00'), 3)).toEqual([
      bogota('2026-11-26T08:00'),
      bogota('2026-11-30T08:00'),
      bogota('2026-12-03T08:00'),
    ]);
  });

  it('mensual: el día indicado, con fechas de inicio y fin', () => {
    const r = rule({
      frequency: 'MONTHLY',
      dayOfMonth: 1,
      timeOfDay: '09:30',
      startDate: '2026-12-01',
      endDate: '2027-01-15',
    });
    expect(upcomingRuns(r, bogota('2026-11-24T10:00'), 5)).toEqual([
      bogota('2026-12-01T09:30'),
      bogota('2027-01-01T09:30'),
    ]);
    expect(nextRunAfter(r, bogota('2027-01-01T09:30'))).toBeNull();
  });

  it('valida la regla con mensajes para el panel', () => {
    expect(() => validateRule({ frequency: 'WEEKLY', timeOfDay: '08:00', daysOfWeek: [] })).toThrow(/al menos un día/);
    expect(() => validateRule({ frequency: 'MONTHLY', timeOfDay: '08:00', dayOfMonth: 31 })).toThrow(/entre 1 y 28/);
    expect(() => validateRule({ frequency: 'DAILY', timeOfDay: '25:00' })).toThrow(/HH:MM/);
    expect(() =>
      validateRule({ frequency: 'DAILY', timeOfDay: '08:00', startDate: '2026-12-10', endDate: '2026-12-01' }),
    ).toThrow(/anterior/);
    expect(() => validateRule({ frequency: 'DAILY', timeOfDay: '08:00', startDate: '2026-02-30' })).toThrow(/inicio/);
    expect(validateRule({ frequency: 'WEEKLY', timeOfDay: '07:15', daysOfWeek: [4, 1, 4] })).toMatchObject({
      daysOfWeek: [1, 4],
      dayOfMonth: null,
    });
  });

  it('descripción legible y etiqueta de cada ejecución', () => {
    expect(describeRule(rule({ frequency: 'WEEKLY', daysOfWeek: [1, 3, 5] }))).toBe(
      'Cada semana: lunes, miércoles y viernes a las 08:00',
    );
    expect(describeRule(rule({ frequency: 'MONTHLY', dayOfMonth: 15, endDate: '2027-06-30' }))).toBe(
      'Cada mes, el día 15 a las 08:00 (hasta 30/06/2027)',
    );
    expect(describeRule(rule({}))).toBe('Todos los días a las 08:00');
    expect(runLabel(bogota('2026-11-26T20:00'))).toBe('26/11/2026'); // 01:00 UTC del 27: sigue siendo el 26 en Colombia
  });
});
