import {
  countVariables,
  footerHasOptOut,
  guessButtonRole,
  normalizeMapping,
  parseGraphTemplate,
  renderBody,
  resolveVariables,
  headerTextOf,
  templateLaunchProblems,
  templateWarnings,
} from './template-rules';

describe('Reglas de plantillas de Meta', () => {
  it('variables posicionales consecutivas desde {{1}}', () => {
    expect(countVariables('Hola {{1}}, tu cita es el {{2}}. {{1}}')).toBe(2);
    expect(countVariables('Sin variables')).toBe(0);
    expect(() => countVariables('Hola {{2}}')).toThrow(/consecutivas/);
  });

  it('roles de botón sugeridos por el texto', () => {
    expect(guessButtonRole('No recibir más')).toBe('OPT_OUT');
    expect(guessButtonRole('Darme de baja')).toBe('OPT_OUT');
    expect(guessButtonRole('STOP')).toBe('OPT_OUT');
    expect(guessButtonRole('No acepto')).toBe('OPT_OUT');
    expect(guessButtonRole('Sí, acepto')).toBe('OPT_IN_ACCEPT');
    expect(guessButtonRole('Acepto')).toBe('OPT_IN_ACCEPT');
    expect(guessButtonRole('Quiero asesoría')).toBe('OTHER');
  });

  it('opción de baja en el pie', () => {
    expect(footerHasOptOut('Responde STOP para no recibir más mensajes')).toBe(true);
    expect(footerHasOptOut('Escribe BAJA para salir')).toBe(true);
    expect(footerHasOptOut('JurisGlobal · Tu tranquilidad, nuestra misión')).toBe(false);
    expect(footerHasOptOut(null)).toBe(false);
  });

  it('no se lanza sin aprobación o (opt-in) sin botón de aceptar; la falta de baja solo es un aviso', () => {
    const ok = { status: 'APPROVED', purpose: 'MARKETING' as const, buttons: [] };
    expect(templateLaunchProblems(ok)).toEqual([]);
    expect(templateLaunchProblems({ ...ok, status: 'PAUSED' })).toHaveLength(1);
    // Sin pie ni botón de baja: aprobada en Meta = apta; queda un aviso informativo
    expect(templateLaunchProblems({ ...ok, status: 'APPROVED' })).toEqual([]);
    expect(templateWarnings({ hasOptOut: false })[0]).toMatch(/STOP/);
    expect(templateWarnings({ hasOptOut: true })).toEqual([]);
    expect(templateLaunchProblems({ ...ok, purpose: 'OPT_IN' })[0]).toMatch(/botón para aceptar/);
    expect(
      templateLaunchProblems({ ...ok, purpose: 'OPT_IN', buttons: [{ text: 'Sí, acepto', role: 'OPT_IN_ACCEPT' }] }),
    ).toEqual([]);
  });

  it('variables: primer nombre por defecto, respaldo si no hay nombre y limpieza para Meta', () => {
    const mapping = normalizeMapping({ '2': { type: 'literal', value: 'tu  caso\n de tránsito' } }, 2);
    expect(mapping).toEqual({ '1': { type: 'firstName' }, '2': { type: 'literal', value: 'tu  caso\n de tránsito' } });
    expect(resolveVariables(mapping, 2, { name: 'Ana María Pérez' })).toEqual(['Ana', 'tu caso de tránsito']);
    expect(resolveVariables(mapping, 2, { name: null })).toEqual(['cliente', 'tu caso de tránsito']);
    expect(resolveVariables({ '1': { type: 'fullName', value: 'amigo' } }, 1, { name: '' })).toEqual(['amigo']);
    expect(() => normalizeMapping({ '1': { type: 'literal' } }, 1)).toThrow(/\{\{1\}\}/);
  });

  it('renderBody', () => {
    expect(renderBody('Hola {{1}}, ¿hablamos de {{2}}?', ['Ana', 'tu caso'])).toBe('Hola Ana, ¿hablamos de tu caso?');
  });

  it('lee una plantilla de Graph: cuerpo, pie, botones de respuesta rápida y opción de baja', () => {
    const t = parseGraphTemplate({
      id: '123',
      name: 'promo',
      language: 'es_CO',
      category: 'MARKETING',
      status: 'APPROVED',
      components: [
        { type: 'HEADER', text: 'JurisGlobal' },
        { type: 'BODY', text: 'Hola {{1}}' },
        { type: 'FOOTER', text: 'JurisGlobal' },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'QUICK_REPLY', text: 'Me interesa' },
            { type: 'QUICK_REPLY', text: 'No recibir más' },
            { type: 'URL', text: 'Web' },
          ],
        },
      ],
    });
    expect(t).toMatchObject({
      metaId: '123',
      bodyText: 'Hola {{1}}',
      variableCount: 1,
      footerText: 'JurisGlobal',
      buttons: [
        { text: 'Me interesa', role: 'OTHER' },
        { text: 'No recibir más', role: 'OPT_OUT' },
      ],
      hasOptOut: true,
    });
  });

  it('encabezado de texto desde los componentes de Meta', () => {
    expect(
      headerTextOf([
        { type: 'HEADER', format: 'TEXT', text: 'JurisGlobal' },
        { type: 'BODY', text: 'x' },
      ]),
    ).toBe('JurisGlobal');
    expect(headerTextOf([{ type: 'HEADER', format: 'IMAGE' }])).toBeNull();
    expect(headerTextOf([{ type: 'BODY', text: 'x' }])).toBeNull();
    expect(headerTextOf(null)).toBeNull();
  });
});
