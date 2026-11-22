import { BadRequestException } from '@nestjs/common';
import { SETTING_DEFAULTS } from '../settings/defaults';
import { buildLeadWhere } from './leads/admin-leads.service';
import { CSV_BOM, csvCell, csvDate, phoneCell, toCsv } from './leads/leads-csv';
import { toLeadStatus } from './leads/lead-labels';
import { EDITABLE_SETTING_KEYS, validateSettingsPatch, type EditableSettingKey } from './settings/setting-rules';

const current = Object.fromEntries(EDITABLE_SETTING_KEYS.map((k) => [k, SETTING_DEFAULTS[k]])) as Record<
  EditableSettingKey,
  unknown
>;

describe('CSV de leads (Excel en Colombia)', () => {
  it('BOM UTF-8, separador ";", CRLF y tildes/eñes intactas', () => {
    const csv = toCsv(['Nombre', 'Motivo'], [['José Ñúñez', 'Tránsito']]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toBe(`${CSV_BOM}Nombre;Motivo\r\nJosé Ñúñez;Tránsito\r\n`);
  });

  it('el teléfono va como texto ="+57…" para que Excel no pierda el "+" ni lo vuelva número', () => {
    expect(csvCell(phoneCell('573001234567'))).toBe('"=""+573001234567"""');
    expect(csvCell(phoneCell(null))).toBe('');
  });

  it('comillas, ";" y saltos de línea se escapan; las fórmulas inyectadas se neutralizan', () => {
    expect(csvCell('Pérez; "el Mono"')).toBe('"Pérez; ""el Mono"""');
    expect(csvCell('línea 1\nlínea 2')).toBe('"línea 1\nlínea 2"');
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('+573001234567')).toBe("'+573001234567");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(3)).toBe('3');
    expect(csvCell(null)).toBe('');
  });

  it('fecha en hora de Colombia', () => {
    expect(csvDate(new Date('2026-11-22T03:05:00Z'))).toBe('2026-11-21 22:05');
  });
});

describe('Filtros del listado de leads', () => {
  it('estado en español u original, origen, motivo y búsqueda por nombre, correo o teléfono', () => {
    expect(toLeadStatus('contactado')).toBe('CONTACTED');
    expect(toLeadStatus('Agendado')).toBe('SCHEDULED');
    expect(toLeadStatus('NEW')).toBe('NEW');

    const where = buildLeadWhere({ status: 'NEW', origin: 'WHATSAPP', q: '300 123' });
    expect(where).toEqual({
      AND: [
        { status: 'NEW' },
        { origin: 'WHATSAPP' },
        {
          OR: [
            { fullName: { contains: '300 123', mode: 'insensitive' } },
            { email: { contains: '300 123', mode: 'insensitive' } },
            { phone: { contains: '300123' } },
          ],
        },
      ],
    });
    expect(buildLeadWhere({})).toEqual({});
  });

  it('rango de fechas en hora de Colombia (día completo) y rango invertido -> 400', () => {
    const where = buildLeadWhere({ from: '2026-11-01', to: '2026-11-30' }) as { AND: Array<Record<string, any>> };
    expect(where.AND[0].createdAt.gte.toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(where.AND[0].createdAt.lte.toISOString()).toBe('2026-12-01T04:59:59.999Z');
    expect(() => buildLeadWhere({ from: '2026-12-01', to: '2026-11-01' })).toThrow(BadRequestException);
  });
});

describe('Validación de Configuración', () => {
  it('precio: encender exige valor; el valor es un entero en COP', () => {
    expect(validateSettingsPatch({ showConsultationPrice: true }, current)).toEqual({
      ok: false,
      errors: ['Para mostrar el precio, escribe el valor de la asesoría inicial'],
    });
    expect(validateSettingsPatch({ showConsultationPrice: true, consultationPrice: 100000 }, current)).toEqual({
      ok: true,
      values: { showConsultationPrice: true, consultationPrice: 100000 },
    });
    expect(validateSettingsPatch({ consultationPrice: 99.5 }, current).ok).toBe(false);
    expect(validateSettingsPatch({ consultationPrice: '' }, current)).toEqual({
      ok: true,
      values: { consultationPrice: null },
    });
  });

  it('correos de aviso y de contacto: válidos, en minúsculas y sin repetir', () => {
    expect(
      validateSettingsPatch({ 'notify.leadEmails': ['Socio@JurisGlobal.co', 'socio@jurisglobal.co'] }, current),
    ).toEqual({
      ok: true,
      values: { 'notify.leadEmails': ['socio@jurisglobal.co'] },
    });
    expect(validateSettingsPatch({ 'notify.leadEmails': ['no-es-correo'] }, current).ok).toBe(false);
    expect(validateSettingsPatch({ 'company.email': '  ' }, current)).toEqual({
      ok: true,
      values: { 'company.email': null },
    });
    expect(validateSettingsPatch({ 'company.phone': '+57 300 123 4567' }, current).ok).toBe(true);
    expect(validateSettingsPatch({ 'company.phone': 'llámenos' }, current).ok).toBe(false);
  });

  it('textos del bot: nunca "gratis" ni promesas', () => {
    const result = validateSettingsPatch(
      { 'bot.closing': 'Gracias. La consulta es GRATIS y te garantizamos el resultado.' },
      current,
    );
    expect(result).toEqual({ ok: false, errors: ['El texto no puede decir «gratis» ni prometer resultados'] });
    expect(validateSettingsPatch({ 'bot.greeting': '¡Hola! Bienvenido a JurisGlobal.' }, current).ok).toBe(true);
  });

  it('topes de envío: enteros en rango y semanal >= diario', () => {
    expect(
      validateSettingsPatch({ 'marketing.maxPerContactPerDay': 3, 'marketing.maxPerContactPerWeek': 2 }, current),
    ).toEqual({
      ok: false,
      errors: ['El máximo semanal por contacto no puede ser menor que el diario'],
    });
    expect(validateSettingsPatch({ 'marketing.dailyGlobalLimit': 0 }, current).ok).toBe(false);
    expect(validateSettingsPatch({ 'marketing.dailyGlobalLimit': 500 }, current).ok).toBe(true);
  });

  it('claves no editables desde el panel -> error', () => {
    expect(validateSettingsPatch({ 'consent.web.contact': 'x' }, current)).toEqual({
      ok: false,
      errors: ['El parámetro «consent.web.contact» no se puede editar desde el panel'],
    });
  });
});
