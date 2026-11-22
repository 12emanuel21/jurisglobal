import type { Channel, LeadStatus } from '@prisma/client';

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'SCHEDULED', 'CLOSED'] as const satisfies readonly LeadStatus[];
export const LEAD_ORIGINS = ['WEB', 'WHATSAPP', 'IMPORT', 'PANEL'] as const satisfies readonly Channel[];

export const STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: 'Nuevo',
  CONTACTED: 'Contactado',
  SCHEDULED: 'Agendado',
  CLOSED: 'Cerrado',
};

export const ORIGIN_LABEL: Record<Channel, string> = {
  WEB: 'Web',
  WHATSAPP: 'WhatsApp',
  IMPORT: 'Importación',
  PANEL: 'Panel',
};

/** La API acepta el valor del enum o su nombre en español: "contactado" -> CONTACTED */
const STATUS_ALIASES: Record<string, LeadStatus> = {
  nuevo: 'NEW',
  contactado: 'CONTACTED',
  agendado: 'SCHEDULED',
  cerrado: 'CLOSED',
};

export function toLeadStatus(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const v = value.trim();
  return STATUS_ALIASES[v.toLowerCase()] ?? v.toUpperCase();
}

/** "web" | "whatsapp" (o el enum) -> Channel */
export function toChannel(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

/** Nombre que reemplaza al titular anonimizado (Ley 1581) */
export const ANONYMIZED_NAME = 'Titular anonimizado';
export const ANONYMIZED_NOTE = '[Contenido eliminado por anonimización de datos personales (Ley 1581)]';
