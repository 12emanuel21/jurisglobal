import { buildLeadEmail, type LeadEmailData } from './lead-email';

const base: LeadEmailData = {
  leadId: 'lead-1',
  isNew: true,
  fullName: 'Ana <b>Pérez</b>',
  phone: '573001234567',
  email: 'ana@correo.co',
  motivo: 'Tránsito',
  origin: 'WEB',
  submissionCount: 1,
  receivedAt: new Date('2026-11-22T15:30:00Z'),
  differences: [],
  panelBaseUrl: 'https://pruebas.jurisglobal.test/',
};

describe('Correo de aviso de lead', () => {
  it('lead nuevo: asunto, wa.me, mailto, panel y fecha de Colombia', () => {
    const { subject, html, text } = buildLeadEmail(base);
    expect(subject).toBe('Nuevo lead · Ana <b>Pérez</b> · Tránsito (Formulario web)');
    expect(html).toContain('href="https://wa.me/573001234567"');
    expect(html).toContain('href="mailto:ana@correo.co"');
    expect(html).toContain('href="https://pruebas.jurisglobal.test/panel/leads/lead-1"');
    expect(html).toContain('+57 300 123 4567');
    expect(text).toContain('Teléfono: +57 300 123 4567 (https://wa.me/573001234567)');
    expect(text).toContain('10:30');
  });

  it('escapa HTML de los datos del formulario', () => {
    const { html } = buildLeadEmail(base);
    expect(html).toContain('Ana &lt;b&gt;Pérez&lt;/b&gt;');
    expect(html).not.toContain('<b>Pérez</b>');
  });

  it('recontacto: indica el envío y las diferencias', () => {
    const { subject, html, text } = buildLeadEmail({
      ...base,
      isNew: false,
      submissionCount: 3,
      origin: 'WHATSAPP',
      differences: ['Correo: «nuevo@correo.co»'],
    });
    expect(subject).toMatch(/^Recontacto \(envío #3\) · .* \(WhatsApp\)$/);
    expect(html).toContain('Correo: «nuevo@correo.co»');
    expect(text).toContain('- Correo: «nuevo@correo.co»');
  });
});
