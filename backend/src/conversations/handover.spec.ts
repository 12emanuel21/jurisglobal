import { HANDOVER_TTL_MS, isOutsideServiceWindow, resolveHandover } from './handover';

describe('Handover humano y ventana de 24 h', () => {
  const now = new Date('2026-11-22T15:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it('sin pausa: bot activo', () => {
    expect(resolveHandover(null, null, now)).toEqual({ botPaused: false, resumesAt: null });
  });

  it('pausado hace 1 h: sigue pausado y se reactiva 12 h después de la última actividad', () => {
    const state = resolveHandover(ago(3_600_000), null, now);
    expect(state.botPaused).toBe(true);
    expect(state.resumesAt?.getTime()).toBe(ago(3_600_000).getTime() + HANDOVER_TTL_MS);
  });

  it('un mensaje reciente del equipo extiende la pausa', () => {
    expect(resolveHandover(ago(13 * 3_600_000), ago(60_000), now).botPaused).toBe(true);
    expect(resolveHandover(ago(13 * 3_600_000), ago(12.5 * 3_600_000), now).botPaused).toBe(false);
  });

  it('ventana de servicio de Meta', () => {
    expect(isOutsideServiceWindow(null, now)).toBe(true);
    expect(isOutsideServiceWindow(ago(23 * 3_600_000), now)).toBe(false);
    expect(isOutsideServiceWindow(ago(25 * 3_600_000), now)).toBe(true);
  });
});
