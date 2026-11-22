import { formatPhone, isColombianMobile, toE164 } from './phone';

describe('toE164 (teléfonos de Colombia y E.164)', () => {
  it.each([
    ['300 123 4567', '573001234567'],
    ['300-123-4567', '573001234567'],
    ['(300) 123.4567', '573001234567'],
    ['+57 300 123 4567', '573001234567'],
    ['57 3001234567', '573001234567'],
    ['0057 300 123 4567', '573001234567'],
    ['03001234567', '573001234567'],
    ['573001234567', '573001234567'],
  ])('%s -> %s', (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });

  it('números extranjeros se conservan si cumplen E.164', () => {
    expect(toE164('+1 (305) 555-0100')).toBe('13055550100');
    expect(toE164('+34 612 345 678')).toBe('34612345678');
  });

  it('rechaza vacíos, letras y longitudes imposibles', () => {
    expect(toE164('')).toBeNull();
    expect(toE164('abc')).toBeNull();
    expect(toE164('12345')).toBeNull();
    expect(toE164('57300123')).toBeNull();
    expect(toE164(undefined)).toBeNull();
  });

  it('isColombianMobile y formatPhone', () => {
    expect(isColombianMobile('573001234567')).toBe(true);
    expect(isColombianMobile('5716012345')).toBe(false);
    expect(formatPhone('573001234567')).toBe('+57 300 123 4567');
    expect(formatPhone('13055550100')).toBe('+13055550100');
  });
});
