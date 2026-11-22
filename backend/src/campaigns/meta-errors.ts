/**
 * Glosario de errores de WhatsApp Cloud API para masivos (idea de meta_errors.py del módulo Django,
 * corregida): decide qué hace el worker con cada rechazo.
 *
 * - RECIPIENT: problema de ese destinatario (número sin WhatsApp, fuera de ventana de 24 h, Meta no
 *   lo entregó). Se marca FAILED en ese CampaignMessage y la campaña SIGUE (el módulo Django
 *   abortaba o lo confundía con "saldo").
 * - OPT_OUT (131050): la persona bloqueó el marketing de la empresa. FAILED + baja automática.
 * - TEMPLATE / ACCOUNT: afecta a todos los envíos (plantilla pausada, token vencido, cuenta
 *   bloqueada): se pausa la campaña y el mensaje vuelve a la cola.
 * - RATE_LIMIT / INFRA: transitorio; se reintenta con espera creciente.
 * - UNKNOWN: se trata como error del destinatario (no se aborta); si se repite muchas veces
 *   seguidas, el worker pausa la campaña por precaución.
 *
 * Códigos según la documentación de errores de Cloud API (revisar si Meta agrega nuevos).
 */
export type MetaErrorCategory = 'RECIPIENT' | 'OPT_OUT' | 'TEMPLATE' | 'ACCOUNT' | 'RATE_LIMIT' | 'INFRA' | 'UNKNOWN';
export type MetaErrorAction = 'FAIL' | 'OPT_OUT' | 'PAUSE' | 'RETRY';

export interface MetaErrorClass {
  category: MetaErrorCategory;
  action: MetaErrorAction;
}

const RECIPIENT = new Set([
  100, // parámetro inválido (p. ej. número con formato no aceptado)
  131008, // falta un parámetro obligatorio
  131009, // valor de parámetro no válido (número inválido)
  131021, // destinatario = remitente
  131026, // mensaje no entregable (sin WhatsApp, versión antigua, no aceptó términos)
  131047, // reenganche: pasaron más de 24 h (no aplica a plantillas, pero puede llegar)
  131049, // Meta decidió no entregarlo (salud del ecosistema)
  131051, // tipo de mensaje no soportado
  131053, // error de adjunto
  130472, // número en experimento de Meta
]);
const TEMPLATE = new Set([132000, 132001, 132005, 132007, 132012, 132015, 132016, 132068, 132069]);
const ACCOUNT = new Set([0, 3, 10, 190, 368, 131031, 131042, 131045, 131048, 131057, 133010]);
const RATE_LIMIT = new Set([4, 80007, 130429, 131056]);
const INFRA = new Set([1, 2, 131000, 131016, 133004]);

export function classifyMetaError(code: number | null | undefined, httpStatus?: number | null): MetaErrorClass {
  if (code === 131050) return { category: 'OPT_OUT', action: 'OPT_OUT' };
  if (typeof code === 'number') {
    if (RECIPIENT.has(code)) return { category: 'RECIPIENT', action: 'FAIL' };
    if (TEMPLATE.has(code)) return { category: 'TEMPLATE', action: 'PAUSE' };
    if (ACCOUNT.has(code) || (code >= 200 && code <= 299)) return { category: 'ACCOUNT', action: 'PAUSE' };
    if (RATE_LIMIT.has(code)) return { category: 'RATE_LIMIT', action: 'RETRY' };
    if (INFRA.has(code)) return { category: 'INFRA', action: 'RETRY' };
  }
  if (httpStatus === 429) return { category: 'RATE_LIMIT', action: 'RETRY' };
  // Sin respuesta (red caída) o 5xx sin código conocido: transitorio
  if (!httpStatus || httpStatus >= 500) return { category: 'INFRA', action: 'RETRY' };
  return { category: 'UNKNOWN', action: 'FAIL' };
}

/** Descripción para el panel (errores más frecuentes por campaña) */
export const META_ERROR_LABELS: Record<number, string> = {
  100: 'Parámetro o número no válido',
  131009: 'Número no válido',
  131026: 'No entregable (sin WhatsApp o no aceptó los términos)',
  131047: 'Fuera de la ventana de 24 h',
  131049: 'Meta no lo entregó (límite de marketing por usuario)',
  131050: 'La persona bloqueó el marketing de la empresa',
  131051: 'Tipo de mensaje no soportado',
  131056: 'Demasiados mensajes al mismo número',
  130429: 'Límite de velocidad de Meta',
  131048: 'Límite por reportes de spam',
  131031: 'Cuenta de WhatsApp bloqueada',
  131042: 'Problema de pago de la cuenta',
  132000: 'Cantidad de variables distinta a la plantilla',
  132001: 'La plantilla no existe en ese idioma',
  132015: 'Plantilla pausada por Meta',
  132016: 'Plantilla deshabilitada por Meta',
  190: 'Token de acceso vencido',
};

export const CATEGORY_LABELS: Record<MetaErrorCategory, string> = {
  RECIPIENT: 'Destinatario',
  OPT_OUT: 'Baja',
  TEMPLATE: 'Plantilla',
  ACCOUNT: 'Cuenta de WhatsApp',
  RATE_LIMIT: 'Límite de velocidad',
  INFRA: 'Conexión',
  UNKNOWN: 'Desconocido',
};

/** Motivo de pausa automática según la categoría */
export const PAUSE_REASON: Partial<Record<MetaErrorCategory, string>> = {
  TEMPLATE: 'TEMPLATE_ERROR',
  ACCOUNT: 'ACCOUNT_ERROR',
};
