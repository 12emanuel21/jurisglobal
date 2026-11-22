import { isStatusUpgrade, parseMetaStatus } from './message-status';

describe('Estados de entrega (orden monótono)', () => {
  it('avanza sent -> delivered -> read', () => {
    expect(isStatusUpgrade(null, 'SENT')).toBe(true);
    expect(isStatusUpgrade('SENT', 'DELIVERED')).toBe(true);
    expect(isStatusUpgrade('DELIVERED', 'READ')).toBe(true);
    expect(isStatusUpgrade('SENT', 'READ')).toBe(true);
  });

  it('un delivered tardío no pisa un read; read y failed son terminales', () => {
    expect(isStatusUpgrade('READ', 'DELIVERED')).toBe(false);
    expect(isStatusUpgrade('READ', 'FAILED')).toBe(false);
    expect(isStatusUpgrade('FAILED', 'DELIVERED')).toBe(false);
    expect(isStatusUpgrade('DELIVERED', 'SENT')).toBe(false);
  });

  it('failed aplica sobre sent/delivered', () => {
    expect(isStatusUpgrade('SENT', 'FAILED')).toBe(true);
    expect(isStatusUpgrade('DELIVERED', 'FAILED')).toBe(true);
  });

  it('parseMetaStatus', () => {
    expect(parseMetaStatus('read')).toBe('READ');
    expect(parseMetaStatus('deleted')).toBeNull();
  });
});
