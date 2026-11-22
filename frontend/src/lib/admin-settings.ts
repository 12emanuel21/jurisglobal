import { apiJson } from '@/lib/api';

/** Parámetros editables (GET/PATCH /admin/settings) */
export interface EditableSettings {
  showConsultationPrice: boolean;
  consultationPrice: number | null;
  'notify.leadEmails': string[];
  'company.email': string | null;
  'company.phone': string | null;
  'bot.greeting': string;
  'bot.declined': string;
  'bot.closing': string;
  'bot.optOutConfirmation': string;
  'marketing.maxPerContactPerDay': number;
  'marketing.maxPerContactPerWeek': number;
  'marketing.dailyGlobalLimit': number;
  /** Retraso aleatorio entre envíos de masivos, en ms */
  'marketing.jitterMs': { min: number; max: number };
}

export interface AdminMotivo {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  leadCount: number;
}

export interface SendWindow {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
  enabled: boolean;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  source: 'SEED' | 'MANUAL';
  enabled: boolean;
}

export const DAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** Límites de la Ley 2300 de 2023 (el backend también los exige). null = sin envíos */
export const LEY_2300_LIMITS: Array<{ opensAt: string; closesAt: string } | null> = [
  null,
  { opensAt: '07:00', closesAt: '19:00' },
  { opensAt: '07:00', closesAt: '19:00' },
  { opensAt: '07:00', closesAt: '19:00' },
  { opensAt: '07:00', closesAt: '19:00' },
  { opensAt: '07:00', closesAt: '19:00' },
  { opensAt: '08:00', closesAt: '15:00' },
];

const json = (body: unknown) => JSON.stringify(body);

export const settingsApi = {
  get: () => apiJson<EditableSettings>('/admin/settings', {}, 'No se pudo cargar la configuración'),
  update: (values: Partial<EditableSettings>) =>
    apiJson<EditableSettings>('/admin/settings', { method: 'PATCH', body: json({ values }) }, 'No se pudo guardar'),

  motivos: () => apiJson<AdminMotivo[]>('/admin/motivos', {}, 'No se pudieron cargar los motivos'),
  createMotivo: (name: string) =>
    apiJson<AdminMotivo[]>('/admin/motivos', { method: 'POST', body: json({ name }) }, 'No se pudo crear el motivo'),
  updateMotivo: (id: string, patch: { name?: string; isActive?: boolean }) =>
    apiJson<AdminMotivo[]>(`/admin/motivos/${id}`, { method: 'PATCH', body: json(patch) }, 'No se pudo guardar el motivo'),
  reorderMotivos: (ids: string[]) =>
    apiJson<AdminMotivo[]>('/admin/motivos/order', { method: 'PUT', body: json({ ids }) }, 'No se pudo guardar el orden'),

  windows: () => apiJson<SendWindow[]>('/admin/send-windows', {}, 'No se pudieron cargar los horarios'),
  updateWindows: (windows: SendWindow[]) =>
    apiJson<SendWindow[]>('/admin/send-windows', { method: 'PUT', body: json({ windows }) }, 'No se pudieron guardar los horarios'),

  holidays: (year: number) => apiJson<Holiday[]>(`/admin/holidays?year=${year}`, {}, 'No se pudieron cargar los festivos'),
  createHoliday: (date: string, name: string) =>
    apiJson<Holiday>('/admin/holidays', { method: 'POST', body: json({ date, name }) }, 'No se pudo agregar el festivo'),
  setHolidayEnabled: (id: string, enabled: boolean) =>
    apiJson<Holiday>(`/admin/holidays/${id}`, { method: 'PATCH', body: json({ enabled }) }, 'No se pudo guardar el festivo'),
  removeHoliday: (id: string) =>
    apiJson<{ removed: 'deleted' | 'disabled' }>(`/admin/holidays/${id}`, { method: 'DELETE' }, 'No se pudo quitar el festivo'),
};

/** 100000 -> "$100.000 COP" */
export function formatCopValue(value: number): string {
  return `$${String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} COP`;
}
