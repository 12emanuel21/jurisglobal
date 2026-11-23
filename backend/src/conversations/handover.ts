/**
 * Handover humano (adaptado de chats/handover.ts de KovalCloud, ahora con columnas en Conversation
 * en lugar de marcadores): el bot no responde mientras la conversación esté pausada. Sin actividad
 * del equipo durante HANDOVER_TTL_MS, el bot se reactiva solo (evita un número "mudo" olvidado).
 */
export const HANDOVER_TTL_MS = 12 * 60 * 60 * 1000;
/** Meta solo permite mensajes libres hasta 24 h después del último mensaje del cliente */
export const META_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Marcadores visibles en el historial (author SYSTEM) */
export const BOT_PAUSED_MARKER = '[SYSTEM_BOT_PAUSED]';
export const BOT_RESUMED_MARKER = '[SYSTEM_BOT_RESUMED]';
/** El equipo reinició el flujo del bot desde el Inbox (el próximo mensaje recibe el saludo) */
export const BOT_RESET_MARKER = '[SYSTEM_BOT_RESET]';

export interface HandoverState {
  botPaused: boolean;
  /** Cuándo se reactivará solo el bot (null si está activo) */
  resumesAt: Date | null;
}

export function resolveHandover(
  botPausedAt: Date | null,
  lastAgentAt: Date | null,
  now: Date = new Date(),
): HandoverState {
  if (!botPausedAt) return { botPaused: false, resumesAt: null };
  const lastActivity = Math.max(botPausedAt.getTime(), lastAgentAt?.getTime() ?? 0);
  const resumesAt = new Date(lastActivity + HANDOVER_TTL_MS);
  return resumesAt > now ? { botPaused: true, resumesAt } : { botPaused: false, resumesAt: null };
}

export function isOutsideServiceWindow(lastInboundAt: Date | null, now: Date = new Date()): boolean {
  return !lastInboundAt || now.getTime() - lastInboundAt.getTime() > META_SERVICE_WINDOW_MS;
}
