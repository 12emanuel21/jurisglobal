import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Adjuntos de WhatsApp (imágenes, notas de voz, PDFs) — adaptado de chats/chat-media.ts de
 * KovalCloud, sin tenant: uploads/chat/<uuid>.<ext>. NO los publica nginx (pueden ser documentos
 * personales): se sirven con sesión por GET /conversations/media/:file.
 */
export const CHAT_MEDIA_ROOT = path.join(process.cwd(), 'uploads', 'chat');
export const MAX_CHAT_MEDIA_BYTES = 16 * 1024 * 1024;

export type StoredMediaKind = 'IMAGE' | 'AUDIO' | 'DOCUMENT';

export interface StoredChatMedia {
  kind: StoredMediaKind;
  file: string;
  mime: string;
  name: string | null;
}

const AUDIO_TYPES: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/webm': 'webm',
};
const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  amr: 'audio/amr',
  webm: 'audio/webm',
};
const FILE_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|webp|pdf|ogg|mp3|m4a|aac|amr|webm)$/;

const baseMime = (mime: string | null | undefined) => (mime ?? '').split(';')[0].trim().toLowerCase();

/** Tipo real de la imagen según sus primeros bytes (no se confía en el mimetype) */
export function detectImageType(buffer: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Imágenes y PDF por "magic numbers"; audio por su mimetype. null = no soportado */
export function classifyChatMedia(
  buffer: Buffer,
  mime: string | null | undefined,
): { kind: StoredMediaKind; ext: string } | null {
  const image = detectImageType(buffer);
  if (image) return { kind: 'IMAGE', ext: image };
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'DOCUMENT', ext: 'pdf' };
  const audio = AUDIO_TYPES[baseMime(mime)];
  return audio ? { kind: 'AUDIO', ext: audio } : null;
}

/** Guarda el adjunto; null si está vacío, es muy grande o no es de un tipo soportado */
export async function storeChatMedia(
  buffer: Buffer,
  mime: string | null | undefined,
  name?: string | null,
  root = CHAT_MEDIA_ROOT,
): Promise<StoredChatMedia | null> {
  if (!buffer.length || buffer.length > MAX_CHAT_MEDIA_BYTES) return null;
  const type = classifyChatMedia(buffer, mime);
  if (!type) return null;
  const file = `${randomUUID()}.${type.ext}`;
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, file), buffer);
  return { kind: type.kind, file, mime: EXTENSION_MIME[type.ext], name: name?.trim().slice(0, 200) || null };
}

/** Ruta física de un adjunto o null si el nombre no es uno generado por nosotros (evita path traversal) */
export function chatMediaPath(file: string, root = CHAT_MEDIA_ROOT): string | null {
  return FILE_PATTERN.test(file) ? path.join(root, file) : null;
}

export function chatMediaMime(file: string): string {
  return EXTENSION_MIME[file.split('.').pop() ?? ''] ?? 'application/octet-stream';
}

/** Texto del mensaje en el historial cuando trae adjunto (la bandeja lo muestra; el adjunto va aparte) */
export function describeChatMedia(
  kind: StoredMediaKind | 'UNSUPPORTED',
  caption?: string | null,
  name?: string | null,
): string {
  const label =
    kind === 'IMAGE'
      ? '📷 Imagen'
      : kind === 'AUDIO'
        ? '🎙️ Nota de voz'
        : kind === 'DOCUMENT'
          ? `📄 Documento${name ? `: ${name}` : ''}`
          : '📎 Archivo adjunto (formato no soportado)';
  return caption?.trim() ? `${label}\n${caption.trim()}` : label;
}
