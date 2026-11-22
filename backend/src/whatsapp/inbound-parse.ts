/**
 * Lectura de un mensaje entrante de Cloud API (adaptado de extractPlainText de KovalCloud).
 * No confía en el payload más allá de su forma: los campos ausentes quedan en null.
 */
export const MEDIA_MESSAGE_TYPES = ['image', 'document', 'audio', 'video', 'sticker'] as const;
export type MediaMessageType = (typeof MEDIA_MESSAGE_TYPES)[number];

export interface ParsedInbound {
  waMessageId: string;
  from: string;
  timestamp: Date | null;
  type: string;
  /** Texto, caption, título del botón/opción o ubicación legible */
  text: string;
  /** id del botón o de la fila elegida (el flujo del bot usa el id, no el título) */
  interactiveId: string | null;
  /** wamid del mensaje citado (botones de plantilla: el envío de la campaña) */
  contextId: string | null;
  media: { type: MediaMessageType; id: string | null; mime: string | null; filename: string | null } | null;
}

export function parseInboundMessage(msg: any): ParsedInbound | null {
  if (!msg || typeof msg.id !== 'string' || typeof msg.from !== 'string') return null;
  const seconds = Number(msg.timestamp);
  const mediaType = MEDIA_MESSAGE_TYPES.find((t) => msg[t]);
  const media = mediaType
    ? {
        type: mediaType,
        id: typeof msg[mediaType]?.id === 'string' ? msg[mediaType].id : null,
        mime: typeof msg[mediaType]?.mime_type === 'string' ? msg[mediaType].mime_type : null,
        filename: typeof msg[mediaType]?.filename === 'string' ? msg[mediaType].filename : null,
      }
    : null;

  const lat = Number(msg?.location?.latitude);
  const lng = Number(msg?.location?.longitude);
  const location = msg?.location && Number.isFinite(lat) && Number.isFinite(lng) ? `📍 Ubicación: ${lat}, ${lng}` : '';

  const text = (
    location ||
    msg?.text?.body ||
    msg?.image?.caption ||
    msg?.video?.caption ||
    msg?.document?.caption ||
    msg?.interactive?.button_reply?.title ||
    msg?.interactive?.list_reply?.title ||
    msg?.button?.text ||
    ''
  )
    .toString()
    .trim();

  const interactiveId =
    msg?.interactive?.button_reply?.id ?? msg?.interactive?.list_reply?.id ?? msg?.button?.payload ?? null;

  return {
    waMessageId: msg.id,
    from: msg.from,
    timestamp: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null,
    type: typeof msg.type === 'string' ? msg.type : (mediaType ?? 'unknown'),
    text,
    interactiveId: typeof interactiveId === 'string' ? interactiveId : null,
    contextId: typeof msg?.context?.id === 'string' ? msg.context.id : null,
    media,
  };
}

/** Todos los cambios de todas las entradas (KovalCloud solo procesaba entry[0].changes[0]) */
export function webhookValues(payload: any): any[] {
  const entries: any[] = Array.isArray(payload?.entry) ? payload.entry : [];
  return entries
    .flatMap((entry) => (Array.isArray(entry?.changes) ? entry.changes : []))
    .map((c) => c?.value)
    .filter(Boolean);
}

/** Cambios con su campo (messages, phone_number_quality_update…) */
export function webhookChanges(payload: any): Array<{ field: string; value: any }> {
  const entries: any[] = Array.isArray(payload?.entry) ? payload.entry : [];
  return entries
    .flatMap((entry) => (Array.isArray(entry?.changes) ? entry.changes : []))
    .filter((c) => c?.value)
    .map((c) => ({ field: typeof c.field === 'string' ? c.field : 'messages', value: c.value }));
}
