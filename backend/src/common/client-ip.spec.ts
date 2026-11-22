import { isInternalIp, normalizeIp, resolveClientIp } from './client-ip';

describe('IP real detrás de Cloudflare → cloudflared → nginx', () => {
  it('usa CF-Connecting-IP cuando la conexión viene de la red interna (nginx en jurisglobal_net)', () => {
    expect(
      resolveClientIp('172.20.0.5', {
        'cf-connecting-ip': '181.49.10.20',
        'x-real-ip': '172.20.0.9',
        'x-forwarded-for': '1.2.3.4, 172.20.0.9',
      }),
    ).toBe('181.49.10.20');
  });

  it('sin Cloudflare: X-Real-IP y luego la última entrada de X-Forwarded-For (la que escribe nginx)', () => {
    expect(resolveClientIp('::ffff:172.20.0.5', { 'x-real-ip': '190.85.1.1' })).toBe('190.85.1.1');
    expect(resolveClientIp('172.20.0.5', { 'x-forwarded-for': '6.6.6.6, 190.85.1.2' })).toBe('190.85.1.2');
    expect(resolveClientIp('127.0.0.1', {})).toBe('127.0.0.1');
  });

  it('una conexión directa desde Internet ignora las cabeceras (no se puede falsificar la IP)', () => {
    expect(resolveClientIp('203.0.113.7', { 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '8.8.8.8' })).toBe(
      '203.0.113.7',
    );
  });

  it('descarta valores que no son IP e IPv6', () => {
    expect(resolveClientIp('10.0.0.2', { 'cf-connecting-ip': 'no-es-ip', 'x-forwarded-for': '2800:e2:1::5' })).toBe(
      '2800:e2:1::5',
    );
    expect(normalizeIp('::ffff:10.1.2.3')).toBe('10.1.2.3');
    expect(normalizeIp('[::1]')).toBe('::1');
    expect(normalizeIp('hola')).toBeNull();
  });

  it('redes internas', () => {
    for (const ip of ['10.1.1.1', '172.16.0.1', '172.31.255.1', '192.168.1.1', '127.0.0.1', '::1', 'fd00::1'])
      expect(isInternalIp(ip)).toBe(true);
    for (const ip of ['172.32.0.1', '8.8.8.8', '181.49.10.20', '2800:e2:1::5']) expect(isInternalIp(ip)).toBe(false);
  });
});
