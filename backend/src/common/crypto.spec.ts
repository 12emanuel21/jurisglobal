import { decryptField, encryptField, phoneHash } from './crypto';

describe('Cifrado de campos y seudónimo de teléfonos', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  });

  it('cifra y descifra (AES-256-GCM) con IV aleatorio', () => {
    const a = encryptField('JBSWY3DPEHPK3PXP');
    const b = encryptField('JBSWY3DPEHPK3PXP');
    expect(a).toMatch(/^enc:v1:/);
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('detecta manipulación del texto cifrado', () => {
    const value = encryptField('secreto');
    const raw = Buffer.from(value.slice(7), 'base64');
    raw[raw.length - 1] ^= 0xff;
    expect(() => decryptField('enc:v1:' + raw.toString('base64'))).toThrow();
  });

  it('phoneHash es estable, distinto por número y no contiene el número', () => {
    expect(phoneHash('573001234567')).toBe(phoneHash('573001234567'));
    expect(phoneHash('573001234567')).not.toBe(phoneHash('573001234568'));
    expect(phoneHash('573001234567')).toMatch(/^[0-9a-f]{64}$/);
  });
});
