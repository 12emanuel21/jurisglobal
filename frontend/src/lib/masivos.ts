import { apiFetch, apiJson, ApiError, apiErrorMessage } from '@/lib/api';

// ───────── Contactos ─────────
export type ContactStatus = 'verified' | 'unverified' | 'opted_out';

export interface MassContact {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  source: string;
  sourceDetail: string | null;
  tags: string[];
  status: ContactStatus;
  consentStatus: 'UNVERIFIED' | 'DOCUMENTED' | 'CONFIRMED' | 'OPTED_OUT';
  optedOutAt: string | null;
  optOutChannel: string | null;
  lastMarketingAt: string | null;
  importFile: string | null;
  createdAt: string;
}

export interface ContactPage {
  items: MassContact[];
  total: number;
  page: number;
  pageSize: number;
  counts: { verified: number; unverified: number; optedOut: number };
}

export interface ImportSummary {
  importId: string;
  fileName: string;
  totalRows: number;
  imported: number;
  updated: number;
  duplicates: number;
  duplicatesInFile: number;
  duplicatesExisting: number;
  optedOutSkipped: number;
  invalid: number;
  invalidDetails: string[];
  warnings: string[];
  verified: number;
  unverified: number;
}

export const CONTACT_STATUS_LABEL: Record<ContactStatus, string> = {
  verified: 'Verificado',
  unverified: 'No verificado',
  opted_out: 'Baja',
};

export const OPT_OUT_CHANNEL_LABEL: Record<string, string> = {
  KEYWORD: 'escribió STOP',
  TEMPLATE_BUTTON: 'botón de la plantilla',
  META_131050: 'bloqueó el marketing (Meta 131050)',
  PANEL: 'manual desde el panel',
};

// ───────── Plantillas ─────────
export type ButtonRole = 'OPT_OUT' | 'OPT_IN_ACCEPT' | 'OTHER';
export type CampaignKind = 'MARKETING' | 'OPT_IN';

export interface TemplateButton {
  text: string;
  role: ButtonRole;
}

export interface MassTemplate {
  id: string;
  metaId: string | null;
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | string;
  purpose: CampaignKind;
  status: string;
  bodyText: string;
  footerText: string | null;
  buttons: TemplateButton[];
  variableCount: number;
  hasOptOut: boolean;
  source: 'MANUAL' | 'META' | string;
  lastSyncedAt: string | null;
  updatedAt: string;
  campaigns: number;
  problems: string[];
}

export interface TemplateInput {
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY';
  purpose: CampaignKind;
  status: string;
  bodyText: string;
  footerText?: string;
  buttons: TemplateButton[];
}

export const BUTTON_ROLE_LABEL: Record<ButtonRole, string> = {
  OPT_OUT: 'Baja (no recibir más)',
  OPT_IN_ACCEPT: 'Acepta la autorización',
  OTHER: 'Otro (entra al chatbot)',
};

export const KIND_LABEL: Record<CampaignKind, string> = {
  MARKETING: 'Marketing (solo verificados)',
  OPT_IN: 'Confirmación de autorización (opt-in)',
};

/** {{1}}, {{2}}… usados en el cuerpo */
export function templateVariables(body: string): number[] {
  const found = new Set<number>();
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) found.add(Number(m[1]));
  return [...found].sort((a, b) => a - b);
}

// ───────── Campañas ─────────
export type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
export type RecipientStatus = 'PENDING' | 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'SKIPPED';

export interface CampaignMetrics {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
  optedOut: number;
  replied: number;
}

export interface CampaignSummary {
  id: string;
  name: string;
  kind: CampaignKind;
  status: CampaignStatus;
  dryRun: boolean;
  template: { id: string; name: string; language: string };
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  pausedReason: string | null;
  nextRunAt: string | null;
  waitReason: string | null;
  createdAt: string;
  metrics: CampaignMetrics;
}

export interface CampaignDetail extends Omit<CampaignSummary, 'template'> {
  createdBy: string | null;
  template: { id: string; name: string; language: string; bodyText: string; footerText: string | null; buttons: TemplateButton[] };
  topErrors: Array<{ code: number | null; category: string | null; label: string; count: number }>;
  skipReasons: Record<string, number>;
  deferred: number;
}

export interface Recipient {
  id: string;
  phone: string;
  name: string | null;
  status: RecipientStatus;
  skipReason: string | null;
  errorCode: number | null;
  errorLabel: string | null;
  notBefore: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  repliedAt: string | null;
  optedOutAt: string | null;
}

export type VariableRule = { type: 'firstName' | 'fullName' | 'literal'; value?: string };
export interface Audience {
  type: 'all' | 'source' | 'selection';
  sources?: string[];
  contactIds?: string[];
}

export interface CampaignPreview {
  kind: CampaignKind;
  total: number;
  recipients: number;
  excluded: { optedOut: number; unverified: number; alreadyVerified: number; total: number };
  frequencyCapped: number;
  problems: string[];
  sample: { body: string; footer: string | null; buttons: string[] };
}

export interface CampaignInput {
  name: string;
  templateId: string;
  audience: Audience;
  variableMapping: Record<string, VariableRule>;
  scheduledAt?: string;
  dryRun?: boolean;
}

/** Última calidad del número reportada por Meta (Graph o webhook) */
export interface WhatsAppQuality {
  rating: string;
  source: 'GRAPH' | 'WEBHOOK';
  at: string;
  event?: string;
}

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  DRAFT: 'Borrador',
  SCHEDULED: 'Programada',
  RUNNING: 'En curso',
  PAUSED: 'Pausada',
  COMPLETED: 'Terminada',
  CANCELLED: 'Cancelada',
  FAILED: 'Fallida',
};

export const RECIPIENT_STATUS_LABEL: Record<RecipientStatus, string> = {
  PENDING: 'Pendiente',
  QUEUED: 'Enviando',
  SENT: 'Enviado',
  DELIVERED: 'Entregado',
  READ: 'Leído',
  FAILED: 'Fallido',
  SKIPPED: 'Omitido',
};

export const SKIP_REASON_LABEL: Record<string, string> = {
  OPTED_OUT: 'Baja (STOP)',
  NO_CONSENT: 'No verificado',
  ALREADY_VERIFIED: 'Ya verificado',
  NO_PHONE: 'Sin teléfono (anonimizado)',
  CANCELLED: 'Campaña cancelada',
};

export const WAIT_REASON_LABEL: Record<string, string> = {
  WINDOW: 'Fuera del horario permitido (Ley 2300): reanuda sola',
  DAILY_LIMIT: 'Se alcanzó el límite diario: sigue el próximo día hábil',
  FREQUENCY_CAP: 'Contactos en su tope de frecuencia: siguen cuando se libere el cupo',
  SCHEDULED: 'Programada',
  RETRY: 'Reintentando tras un error temporal',
};

export function pausedReasonLabel(reason: string | null): string {
  if (!reason) return '';
  const [kind, code] = reason.split(':');
  const base: Record<string, string> = {
    MANUAL: 'Pausada manualmente',
    TEMPLATE_ERROR: 'Pausada automáticamente: Meta rechazó la plantilla',
    ACCOUNT_ERROR: 'Pausada automáticamente: problema con la cuenta de WhatsApp',
    NOT_CONFIGURED: 'Pausada: falta configurar WhatsApp Cloud API (o usa el modo simulación)',
    NO_WINDOW: 'Pausada: no hay ningún horario de envío habilitado',
    REPEATED_ERRORS: 'Pausada por precaución: muchos errores seguidos',
    QUALITY_RED: 'Pausada automáticamente: Meta marcó la calidad del número en ROJO',
  };
  return `${base[kind] ?? 'Pausada'}${code ? ` (código ${code})` : ''}`;
}

const json = (body: unknown, method = 'POST'): RequestInit => ({ method, body: JSON.stringify(body) });
const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') search.set(k, String(v));
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const masivosApi = {
  contacts: (params: { q?: string; status?: ContactStatus | ''; source?: string; page?: number; pageSize?: number }) =>
    apiJson<ContactPage>(`/admin/contacts${qs(params)}`),
  sources: () => apiJson<Array<{ source: string; count: number }>>('/admin/contacts/sources'),
  createContact: (body: { phone: string; name?: string; email?: string; source: string; consent: 'DOCUMENTED' | 'UNVERIFIED'; consentNote?: string }) =>
    apiJson<{ id: string }>('/admin/contacts', json(body)),
  optOutContact: (id: string, note?: string) => apiJson<{ ok: true }>(`/admin/contacts/${id}/opt-out`, json({ note })),
  async importContacts(file: File, consentNote?: string): Promise<ImportSummary> {
    const form = new FormData();
    form.append('file', file);
    if (consentNote?.trim()) form.append('consentNote', consentNote.trim());
    const res = await apiFetch('/admin/contacts/import', { method: 'POST', body: form });
    if (!res.ok) {
      const { message, data } = await apiErrorMessage(res, 'No se pudo importar el archivo');
      throw new ApiError(message, res.status, data);
    }
    return (await res.json()) as ImportSummary;
  },

  templates: () => apiJson<{ items: MassTemplate[]; canSync: boolean }>('/admin/templates'),
  createTemplate: (body: TemplateInput) => apiJson<MassTemplate>('/admin/templates', json(body)),
  updateTemplate: (id: string, body: TemplateInput) => apiJson<MassTemplate>(`/admin/templates/${id}`, json(body, 'PATCH')),
  deleteTemplate: (id: string) => apiJson<{ ok: true }>(`/admin/templates/${id}`, { method: 'DELETE' }),
  syncTemplates: () => apiJson<{ created: number; updated: number; total: number }>('/admin/templates/sync', { method: 'POST' }),

  campaigns: () => apiJson<{ items: CampaignSummary[]; quality: WhatsAppQuality | null }>('/admin/campaigns'),
  campaign: (id: string) => apiJson<CampaignDetail>(`/admin/campaigns/${id}`),
  recipients: (id: string, params: { status?: RecipientStatus | ''; page?: number }) =>
    apiJson<{ items: Recipient[]; total: number; page: number; pageSize: number }>(`/admin/campaigns/${id}/recipients${qs(params)}`),
  preview: (body: Pick<CampaignInput, 'templateId' | 'audience' | 'variableMapping'>) =>
    apiJson<CampaignPreview>('/admin/campaigns/preview', json(body)),
  pause: (id: string) => apiJson<CampaignDetail>(`/admin/campaigns/${id}/pause`, { method: 'POST' }),
  resume: (id: string) => apiJson<CampaignDetail>(`/admin/campaigns/${id}/resume`, { method: 'POST' }),
  cancel: (id: string) => apiJson<CampaignDetail>(`/admin/campaigns/${id}/cancel`, { method: 'POST' }),
};

/** Plantilla CSV descargable para el importador (BOM para Excel en Colombia, separador ;) */
export const IMPORT_TEMPLATE_CSV =
  '﻿Nombre;Teléfono;Correo;Etiquetas;Origen;Autorización\n' +
  'Ana María Pérez;300 123 4567;ana@correo.co;tránsito;Consultoría (nombre);Sí\n' +
  'Luis Gómez;+57 310 555 0000;;;Feria (nombre);No\n';

/** "2026-11-30T07:00" (hora de Colombia) -> ISO UTC. Colombia es UTC-5 todo el año (sin horario de verano) */
export const bogotaLocalToIso = (local: string) => new Date(`${local}:00-05:00`).toISOString();
