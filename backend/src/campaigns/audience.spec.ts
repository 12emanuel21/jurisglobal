import { exclusionFor } from './audience';

describe('Audiencia: regla de cumplimiento (Ley 1581)', () => {
  it('marketing solo a verificados (soporte documental o confirmación por WhatsApp)', () => {
    expect(exclusionFor('MARKETING', 'DOCUMENTED', false)).toBeNull();
    expect(exclusionFor('MARKETING', 'CONFIRMED', false)).toBeNull();
    expect(exclusionFor('MARKETING', 'UNVERIFIED', false)).toBe('NO_CONSENT');
  });

  it('los no verificados solo reciben la confirmación (OPT_IN), que no va a quien ya está verificado', () => {
    expect(exclusionFor('OPT_IN', 'UNVERIFIED', false)).toBeNull();
    expect(exclusionFor('OPT_IN', 'DOCUMENTED', false)).toBe('ALREADY_VERIFIED');
  });

  it('una baja o un número en la lista de supresión nunca reciben nada', () => {
    expect(exclusionFor('MARKETING', 'OPTED_OUT', false)).toBe('OPTED_OUT');
    expect(exclusionFor('OPT_IN', 'UNVERIFIED', true)).toBe('OPTED_OUT');
    expect(exclusionFor('MARKETING', 'DOCUMENTED', true)).toBe('OPTED_OUT');
  });
});
