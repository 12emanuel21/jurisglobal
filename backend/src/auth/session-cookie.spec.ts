import { durationToMs, extractSessionToken, readCookie, SESSION_COOKIE } from './session-cookie';

describe('Cookie de sesión', () => {
  it('durationToMs', () => {
    expect(durationToMs('12h')).toBe(43_200_000);
    expect(durationToMs('7d')).toBe(604_800_000);
    expect(durationToMs('90')).toBe(90_000);
    expect(() => durationToMs('doce horas')).toThrow();
  });

  it('extrae el token de la cookie y, si no hay, del Bearer', () => {
    expect(extractSessionToken({ headers: {}, cookies: { [SESSION_COOKIE]: 'abc' } })).toBe('abc');
    expect(extractSessionToken({ headers: { authorization: 'Bearer xyz' } })).toBe('xyz');
    expect(extractSessionToken({ headers: {} })).toBeNull();
  });

  it('readCookie lee la cookie del handshake', () => {
    expect(readCookie(`a=1; ${SESSION_COOKIE}=tok%3D; b=2`, SESSION_COOKIE)).toBe('tok=');
    expect(readCookie(undefined, SESSION_COOKIE)).toBeNull();
  });
});
