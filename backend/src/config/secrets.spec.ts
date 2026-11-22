import { createHmac } from 'crypto';
import { isValidMetaSignature, safeEqual } from './secrets';

describe('Firma de webhooks de Meta (x-hub-signature-256)', () => {
  const secret = 'app-secret-de-prueba';
  const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
  const sign = (b: Buffer, s = secret) => 'sha256=' + createHmac('sha256', s).update(b).digest('hex');

  it('acepta la firma correcta calculada sobre el cuerpo crudo', () => {
    expect(isValidMetaSignature(body, sign(body), secret)).toBe(true);
  });

  it('rechaza cuerpo alterado, otro secreto, cabecera ausente o sin prefijo', () => {
    expect(isValidMetaSignature(Buffer.from(body.toString() + ' '), sign(body), secret)).toBe(false);
    expect(isValidMetaSignature(body, sign(body, 'otro'), secret)).toBe(false);
    expect(isValidMetaSignature(body, undefined, secret)).toBe(false);
    expect(isValidMetaSignature(body, sign(body).replace('sha256=', ''), secret)).toBe(false);
  });

  it('sin App Secret configurado rechaza siempre (fail-closed)', () => {
    expect(isValidMetaSignature(body, sign(body), undefined)).toBe(false);
    expect(isValidMetaSignature(undefined, sign(body), secret)).toBe(false);
  });

  it('safeEqual: longitudes distintas o valores no string son falsos', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual(undefined, 'abc')).toBe(false);
  });
});
