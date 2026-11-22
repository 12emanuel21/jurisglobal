import { formatPhone } from '../common/phone';

export interface LeadEmailData {
  leadId: string;
  isNew: boolean;
  fullName: string;
  phone: string;
  email: string;
  motivo: string;
  origin: 'WEB' | 'WHATSAPP';
  submissionCount: number;
  receivedAt: Date;
  /** Datos del nuevo envío que difieren del registro (recontacto) */
  differences: string[];
  panelBaseUrl: string;
}

const ORIGIN_LABEL = { WEB: 'Formulario web', WHATSAPP: 'WhatsApp' } as const;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fmtDate = (d: Date) =>
  d.toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long', timeStyle: 'short' });

/** Correo en español para el equipo: lead nuevo o recontacto, con enlaces directos (ESP §8) */
export function buildLeadEmail(d: LeadEmailData) {
  const kind = d.isNew ? 'Nuevo lead' : `Recontacto (envío #${d.submissionCount})`;
  const subject = `${kind} · ${d.fullName} · ${d.motivo} (${ORIGIN_LABEL[d.origin]})`;
  const waLink = `https://wa.me/${d.phone}`;
  const panelLink = `${d.panelBaseUrl.replace(/\/$/, '')}/panel/leads/${d.leadId}`;
  const rows: Array<[string, string, string?]> = [
    ['Nombre', d.fullName],
    ['Teléfono', formatPhone(d.phone), waLink],
    ['Correo', d.email, `mailto:${d.email}`],
    ['Motivo', d.motivo],
    ['Origen', ORIGIN_LABEL[d.origin]],
    ['Recibido', fmtDate(d.receivedAt)],
  ];

  const htmlRows = rows
    .map(
      ([label, value, href]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap">${label}</td>` +
        `<td style="padding:6px 0;color:#0f172a;font-weight:600">${
          href ? `<a href="${escapeHtml(href)}" style="color:#0f2a4a">${escapeHtml(value)}</a>` : escapeHtml(value)
        }</td></tr>`,
    )
    .join('');
  const diffHtml = d.differences.length
    ? `<p style="margin:16px 0 4px;color:#92400e;font-weight:600">Datos nuevos que difieren del registro (no se sobrescribieron):</p><ul style="margin:0;color:#92400e">${d.differences
        .map((x) => `<li>${escapeHtml(x)}</li>`)
        .join('')}</ul>`
    : '';

  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#0f2a4a;color:#ffffff;padding:16px 20px;border-radius:12px 12px 0 0">
    <span style="font-weight:900;letter-spacing:.5px">JURIS<span style="color:#c9a227">GLOBAL</span></span>
    <div style="font-size:14px;margin-top:4px">${escapeHtml(kind)}</div>
  </div>
  <div style="background:#ffffff;padding:20px;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px">
    <table style="border-collapse:collapse;font-size:14px">${htmlRows}</table>
    ${diffHtml}
    <p style="margin:20px 0 0"><a href="${escapeHtml(panelLink)}" style="display:inline-block;background:#0f2a4a;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Ver en el panel</a>
    &nbsp; <a href="${escapeHtml(waLink)}" style="color:#0f2a4a">Escribir por WhatsApp</a></p>
    <p style="margin:20px 0 0;font-size:11px;color:#94a3b8">Contiene datos personales protegidos (Ley 1581 de 2012). No reenviar fuera del equipo de JurisGlobal.</p>
  </div>
</div></body></html>`;

  const text = [
    `${kind} — JurisGlobal`,
    '',
    ...rows.map(
      ([label, value, href]) => `${label}: ${value}${href && !href.startsWith('mailto:') ? ` (${href})` : ''}`,
    ),
    ...(d.differences.length
      ? ['', 'Datos nuevos que difieren del registro (no se sobrescribieron):', ...d.differences.map((x) => `- ${x}`)]
      : []),
    '',
    `Ver en el panel: ${panelLink}`,
    '',
    'Contiene datos personales protegidos (Ley 1581 de 2012). No reenviar fuera del equipo de JurisGlobal.',
  ].join('\n');

  return { subject, html, text };
}
