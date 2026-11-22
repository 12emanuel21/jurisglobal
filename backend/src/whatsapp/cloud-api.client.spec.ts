import { buildButtonsPayload, buildListPayload, buildTemplatePayload } from './cloud-api.client';

describe('Payloads de WhatsApp Cloud API', () => {
  it('botones de respuesta (Acepto / No acepto)', () => {
    const p = buildButtonsPayload('573001234567', '¿Autorizas el tratamiento de tus datos?', [
      { id: 'consent_yes', title: 'Acepto' },
      { id: 'consent_no', title: 'No acepto' },
    ]);
    expect(p.interactive.type).toBe('button');
    expect(p.interactive.action.buttons).toEqual([
      { type: 'reply', reply: { id: 'consent_yes', title: 'Acepto' } },
      { type: 'reply', reply: { id: 'consent_no', title: 'No acepto' } },
    ]);
  });

  it('rechaza más de 3 botones o títulos largos', () => {
    const b = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, title: `Op ${i}` }));
    expect(() => buildButtonsPayload('57', 'x', b(4))).toThrow();
    expect(() => buildButtonsPayload('57', 'x', [{ id: 'a', title: 'x'.repeat(21) }])).toThrow();
  });

  it('lista de motivos', () => {
    const p = buildListPayload('573001234567', 'Elige el motivo', 'Ver motivos', [
      { id: 'm1', title: 'Tránsito' },
      { id: 'm2', title: 'Deudas', description: 'Negociación y reestructuración' },
    ]);
    expect(p.interactive.action.sections[0].rows).toHaveLength(2);
    expect(p.interactive.action.sections[0].rows[1]).toHaveProperty('description');
    expect(() => buildListPayload('57', 'x', 'y', [])).toThrow();
  });

  it('plantilla con variables posicionales y sin variables', () => {
    expect(buildTemplatePayload('57', 'bienvenida', 'es_CO', ['Ana']).template).toEqual({
      name: 'bienvenida',
      language: { code: 'es_CO' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }],
    });
    expect(buildTemplatePayload('57', 'hola', 'es').template).not.toHaveProperty('components');
  });
});
