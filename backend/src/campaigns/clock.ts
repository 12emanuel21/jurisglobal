/** Reloj inyectable: las pruebas simulan domingos, festivos y cambios de día sin esperar */
export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
