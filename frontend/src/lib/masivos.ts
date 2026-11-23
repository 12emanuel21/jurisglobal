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

/** Vista previa del archivo antes de importar (POST /admin/contacts/import/preview; no guarda nada) */
export interface ImportPreview {
  fileName: string;
  /** Problema que impide importar (columnas faltantes, formato…); null = importable */
  error: string | null;
  headers: string[];
  columns: Partial<Record<'name' | 'phone' | 'email' | 'tags' | 'source' | 'consent', string>>;
  firstRow: Record<string, string> | null;
  firstContact: {
    row: number;
    phone: string;
    name: string | null;
    email: string | null;
    source: string;
    consent: 'DOCUMENTED' | 'UNVERIFIED';
    tags: string[];
  } | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  verified: number;
  unverified: number;
  sources: string[];
  errors: string[];
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
  /** Encabezado de texto (plantillas sincronizadas desde Meta con HEADER de texto) */
  headerText?: string | null;
  bodyText: string;
  footerText: string | null;
  buttons: TemplateButton[];
  variableCount: number;
  hasOptOut: boolean;
  source: 'MANUAL' | 'META' | string;
  lastSyncedAt: string | null;
  updatedAt: string;
  campaigns: number;
  /** Impiden usarla (no aprobada; opt-in sin botón de aceptar) */
  problems: string[];
  /** Avisos informativos que NO bloquean (p. ej. sin pie/botón de baja) */
  warnings?: string[];
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

/** Reemplaza {{n}} por los valores (los que falten quedan como {{n}}) */
export function renderTemplate(body: string, params: Array<string | null | undefined>): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, n: string) => params[Number(n) - 1]?.trim() || match);
}

/** Igual que el backend (template-rules.ts): valores de las variables para un contacto */
export function resolveVariables(mapping: Record<string, VariableRule>, count: number, name: string | null | undefined): string[] {
  const fullName = name?.trim() ?? '';
  const firstName = fullName.split(/\s+/)[0] ?? '';
  return Array.from({ length: count }, (_, i) => {
    const rule = mapping[String(i + 1)] ?? { type: 'firstName' };
    if (rule.type === 'literal') return rule.value?.trim() ?? '';
    const value = rule.type === 'fullName' ? fullName : firstName;
    return value || rule.value?.trim() || 'cliente';
  });
}

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
  /** Creada por una campaña recurrente */
  scheduleId?: string | null;
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
  warnings?: string[];
  /** Primer contacto que la recibiría (para armar la vista previa con datos reales) */
  sampleContact?: { name: string | null };
  sample: { header?: string | null; body: string; footer: string | null; buttons: string[] };
}

export interface TestSendInput {
  templateId: string;
  phone: string;
  variables: string[];
  skipWindow: boolean;
}

export interface TestSendResult {
  status: 'SENT' | 'SIMULATED';
  waMessageId: string;
  phone: string;
  body: string;
  insideWindow: boolean;
  windowBypassed: boolean;
  conversationId: string | null;
}

export interface CampaignInput {
  name: string;
  templateId: string;
  audience: Audience;
  variableMapping: Record<string, VariableRule>;
  scheduledAt?: string;
  dryRun?: boolean;
}

// ───────── Campañas recurrentes ─────────
export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export interface Recurrence {
  frequency: Frequency;
  daysOfWeek: number[];
  dayOfMonth: number | null;
  timeOfDay: string;
  startDate: string | null;
  endDate: string | null;
}
export interface SchedulePreview {
  description: string;
  /** startsAt: cuándo empezaría a enviar (si cae fuera del horario Ley 2300, la siguiente apertura) */
  runs: Array<{ at: string; insideWindow: boolean; startsAt: string | null }>;
}
export interface CampaignScheduleSummary {
  id: string;
  name: string;
  template: { id: string; name: string };
  dryRun: boolean;
  description: string;
  recurrence: Recurrence;
  isActive: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSkipReason: string | null;
  lastCampaign: { id: string; name: string; status: CampaignStatus } | null;
  runs: number;
  createdBy: string | null;
  createdAt: string;
}
/** 0 = domingo … 6 = sábado; la semana se muestra de lunes a domingo */
export const WEEK_DAYS: Array<{ value: number; short: string; long: string }> = [
  { value: 1, short: 'L', long: 'lunes' },
  { value: 2, short: 'M', long: 'martes' },
  { value: 3, short: 'X', long: 'miércoles' },
  { value: 4, short: 'J', long: 'jueves' },
  { value: 5, short: 'V', long: 'viernes' },
  { value: 6, short: 'S', long: 'sábado' },
  { value: 0, short: 'D', long: 'domingo' },
];

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

  async previewImport(file: File): Promise<ImportPreview> {
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch('/admin/contacts/import/preview', { method: 'POST', body: form });
    if (!res.ok) {
      const { message, data } = await apiErrorMessage(res, 'No se pudo leer el archivo');
      throw new ApiError(message, res.status, data);
    }
    return (await res.json()) as ImportPreview;
  },
  /** Descarga la plantilla Excel (.xlsx) con las columnas exactas del importador */
  async downloadImportTemplate(): Promise<void> {
    const res = await apiFetch('/admin/contacts/import-template');
    if (!res.ok) throw new ApiError((await apiErrorMessage(res, 'No se pudo descargar la plantilla')).message, res.status);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = IMPORT_TEMPLATE_FILENAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  templates: () => apiJson<{ items: MassTemplate[]; canSync: boolean }>('/admin/templates'),
  createTemplate: (body: TemplateInput) => apiJson<MassTemplate>('/admin/templates', json(body)),
  updateTemplate: (id: string, body: TemplateInput) => apiJson<MassTemplate>(`/admin/templates/${id}`, json(body, 'PATCH')),
  deleteTemplate: (id: string) => apiJson<{ ok: true }>(`/admin/templates/${id}`, { method: 'DELETE' }),
  syncTemplates: () => apiJson<{ created: number; updated: number; removed?: number; total: number }>('/admin/templates/sync', { method: 'POST' }),

  campaigns: () => apiJson<{ items: CampaignSummary[]; quality: WhatsAppQuality | null }>('/admin/campaigns'),
  campaign: (id: string) => apiJson<CampaignDetail>(`/admin/campaigns/${id}`),
  recipients: (id: string, params: { status?: RecipientStatus | ''; page?: number }) =>
    apiJson<{ items: Recipient[]; total: number; page: number; pageSize: number }>(`/admin/campaigns/${id}/recipients${qs(params)}`),
  preview: (body: Pick<CampaignInput, 'templateId' | 'audience' | 'variableMapping'>) =>
    apiJson<CampaignPreview>('/admin/campaigns/preview', json(body)),
  pause: (id: string) => apiJson<CampaignDetail>(`/admin/campaigns/${id}/pause`, { method: 'POST' }),
  resume: (id: string) => apiJson<CampaignDetail>(`/admin/campaigns/${id}/resume`, { method: 'POST' }),
  cancel: (id: string) => apiJson<CampaignDetail>(`/admin/campaigns/${id}/cancel`, { method: 'POST' }),

  schedules: () => apiJson<CampaignScheduleSummary[]>('/admin/campaign-schedules'),
  schedulePreview: (body: Partial<Recurrence>) => apiJson<SchedulePreview>('/admin/campaign-schedules/preview', json(body)),
  pauseSchedule: (id: string) => apiJson<CampaignScheduleSummary>(`/admin/campaign-schedules/${id}/pause`, { method: 'POST' }),
  resumeSchedule: (id: string) => apiJson<CampaignScheduleSummary>(`/admin/campaign-schedules/${id}/resume`, { method: 'POST' }),
  deleteSchedule: (id: string) => apiJson<{ ok: true }>(`/admin/campaign-schedules/${id}`, { method: 'DELETE' }),
};

export const IMPORT_TEMPLATE_FILENAME = 'plantilla-contactos-jurisglobal.xlsx';

/** "2026-11-30T07:00" (hora de Colombia) -> ISO UTC. Colombia es UTC-5 todo el año (sin horario de verano) */
export const bogotaLocalToIso = (local: string) => new Date(`${local}:00-05:00`).toISOString();
