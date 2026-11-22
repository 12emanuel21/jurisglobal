import { apiFetch, apiJson, ApiError } from '@/lib/api';

export type LeadStatus = 'NEW' | 'CONTACTED' | 'SCHEDULED' | 'CLOSED';
export type LeadOrigin = 'WEB' | 'WHATSAPP' | 'IMPORT' | 'PANEL';

export const LEAD_STATUSES: LeadStatus[] = ['NEW', 'CONTACTED', 'SCHEDULED', 'CLOSED'];

export const STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: 'Nuevo',
  CONTACTED: 'Contactado',
  SCHEDULED: 'Agendado',
  CLOSED: 'Cerrado',
};
/** Plural para las tarjetas del resumen */
export const STATUS_PLURAL: Record<LeadStatus, string> = {
  NEW: 'Nuevos',
  CONTACTED: 'Contactados',
  SCHEDULED: 'Agendados',
  CLOSED: 'Cerrados',
};
export const ORIGIN_LABEL: Record<LeadOrigin, string> = { WEB: 'Web', WHATSAPP: 'WhatsApp', IMPORT: 'Importación', PANEL: 'Panel' };

/** Insignia por estado (claro y oscuro) */
export const STATUS_BADGE: Record<LeadStatus, string> = {
  NEW: 'bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-500/30',
  CONTACTED: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30',
  SCHEDULED: 'bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-200 dark:ring-violet-500/30',
  CLOSED: 'bg-gray-100 text-gray-700 ring-gray-200 dark:bg-slate-700/40 dark:text-slate-200 dark:ring-slate-600',
};

export interface Person {
  id: string;
  name: string;
  role?: 'ADMIN' | 'ASESOR';
}

export interface LeadListItem {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  motivo: { id: string; name: string };
  origin: LeadOrigin;
  lastOrigin: LeadOrigin;
  status: LeadStatus;
  assignedTo: Person | null;
  submissionCount: number;
  createdAt: string;
  lastSubmittedAt: string;
  anonymizedAt: string | null;
  optedOut: boolean;
  conversationId: string | null;
}

export interface LeadNote {
  id: string;
  body: string;
  createdAt: string;
  author: Person | null;
}

export interface LeadConsent {
  id: string;
  purpose: 'PRIVACY_TERMS_COOKIES' | 'CONTACT_AND_DATA_PROCESSING' | 'MARKETING_WHATSAPP';
  granted: boolean;
  channel: LeadOrigin;
  textVersion: string;
  textSnapshot: string;
  createdAt: string;
}

export interface LeadDetail extends LeadListItem {
  optedOutAt: string | null;
  notes: LeadNote[];
  consents: LeadConsent[];
}

export const CONSENT_PURPOSE_LABEL: Record<LeadConsent['purpose'], string> = {
  PRIVACY_TERMS_COOKIES: 'Aviso de Privacidad, Términos y Cookies',
  CONTACT_AND_DATA_PROCESSING: 'Contacto y tratamiento de datos',
  MARKETING_WHATSAPP: 'Mensajes informativos por WhatsApp',
};

export interface LeadPage {
  items: LeadListItem[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export interface LeadSummary {
  byStatus: Record<LeadStatus, number>;
  total: number;
}

export interface LeadFilters {
  q: string;
  status: LeadStatus | '';
  motivoId: string;
  origin: 'WEB' | 'WHATSAPP' | '';
  from: string;
  to: string;
}

export const EMPTY_FILTERS: LeadFilters = { q: '', status: '', motivoId: '', origin: '', from: '', to: '' };

/** Filtros -> query string (solo los que tienen valor) */
export function filtersToQuery(filters: LeadFilters, extra: Record<string, string | number> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, String(value).trim());
  for (const [key, value] of Object.entries(extra)) params.set(key, String(value));
  return params.toString();
}

export const leadsApi = {
  list: (filters: LeadFilters, page: number, pageSize = 25) =>
    apiJson<LeadPage>(`/admin/leads?${filtersToQuery(filters, { page, pageSize })}`, {}, 'No se pudieron cargar los leads'),
  summary: () => apiJson<LeadSummary>('/admin/leads/summary', {}, 'No se pudo cargar el resumen'),
  assignees: () => apiJson<Person[]>('/admin/leads/assignees', {}, 'No se pudieron cargar los responsables'),
  detail: (id: string) => apiJson<LeadDetail>(`/admin/leads/${id}`, {}, 'No se pudo cargar el lead'),
  update: (id: string, patch: { status?: LeadStatus; assignedToId?: string | null }) =>
    apiJson<LeadDetail>(`/admin/leads/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }, 'No se pudo guardar el cambio'),
  addNote: (id: string, body: string) =>
    apiJson<LeadNote>(`/admin/leads/${id}/notes`, { method: 'POST', body: JSON.stringify({ body }) }, 'No se pudo guardar la nota'),
  /** Descarga el CSV con los filtros activos */
  async exportCsv(filters: LeadFilters): Promise<void> {
    const res = await apiFetch(`/admin/leads/export?${filtersToQuery(filters)}`);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { message?: string | string[] };
      const message = Array.isArray(data.message) ? data.message.join('. ') : (data.message ?? 'No se pudo exportar');
      throw new ApiError(message, res.status);
    }
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'leads-jurisglobal.csv';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
