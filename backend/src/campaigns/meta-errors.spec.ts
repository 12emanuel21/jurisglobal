import { classifyMetaError } from './meta-errors';

describe('Glosario de errores de Meta (masivos)', () => {
  it('131047 y otros errores del destinatario: FAILED en ese mensaje, la campaña sigue', () => {
    for (const code of [131047, 131026, 131049, 131009, 100])
      expect(classifyMetaError(code, 400)).toEqual({ category: 'RECIPIENT', action: 'FAIL' });
  });

  it('131050: baja automática del contacto', () => {
    expect(classifyMetaError(131050, 400)).toEqual({ category: 'OPT_OUT', action: 'OPT_OUT' });
  });

  it('131047 no se confunde con un problema de saldo/cuenta (bug del módulo Django); 131042 sí es de cuenta', () => {
    expect(classifyMetaError(131047, 400).category).not.toBe('ACCOUNT');
    expect(classifyMetaError(131042, 400)).toEqual({ category: 'ACCOUNT', action: 'PAUSE' });
  });

  it('plantilla pausada/deshabilitada o variables mal: pausa la campaña', () => {
    for (const code of [132000, 132001, 132015, 132016])
      expect(classifyMetaError(code, 400)).toEqual({ category: 'TEMPLATE', action: 'PAUSE' });
  });

  it('token vencido, permisos y bloqueos de cuenta: pausa', () => {
    for (const code of [190, 10, 200, 131031, 131048, 368]) expect(classifyMetaError(code, 400).action).toBe('PAUSE');
  });

  it('límites de velocidad e infraestructura: reintento', () => {
    expect(classifyMetaError(130429, 400)).toEqual({ category: 'RATE_LIMIT', action: 'RETRY' });
    expect(classifyMetaError(131056, 400).action).toBe('RETRY');
    expect(classifyMetaError(null, 429)).toEqual({ category: 'RATE_LIMIT', action: 'RETRY' });
    expect(classifyMetaError(131000, 500)).toEqual({ category: 'INFRA', action: 'RETRY' });
    expect(classifyMetaError(undefined, undefined)).toEqual({ category: 'INFRA', action: 'RETRY' });
    expect(classifyMetaError(null, 503).category).toBe('INFRA');
  });

  it('código desconocido con 4xx: falla solo ese destinatario (no aborta)', () => {
    expect(classifyMetaError(999_999, 400)).toEqual({ category: 'UNKNOWN', action: 'FAIL' });
  });
});
