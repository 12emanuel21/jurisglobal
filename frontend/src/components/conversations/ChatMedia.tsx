'use client';

import React, { useEffect, useState } from 'react';
import { FileText, ImageOff, Mic, X } from 'lucide-react';

export type MediaKind = 'IMAGE' | 'AUDIO' | 'DOCUMENT' | 'UNSUPPORTED';

/**
 * Adjuntos del Inbox (adaptado de components/chats/ChatMedia.tsx de KovalCloud). Con la sesión en
 * cookie httpOnly, el navegador la envía solo: no hace falta descargar como blob con un token.
 */
export const mediaUrl = (file: string) => `/api/conversations/media/${encodeURIComponent(file)}`;

export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}>
      <button type="button" onClick={onClose} aria-label="Cerrar" className="tap absolute right-4 top-4 rounded-full bg-white/10 p-3 text-white hover:bg-white/20">
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- adjunto privado servido con sesión */}
      <img src={src} alt={alt} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

export function ChatMediaAttachment({
  kind,
  file,
  name,
  tone = 'dark',
}: {
  kind: MediaKind;
  file: string | null;
  name?: string | null;
  tone?: 'dark' | 'color';
}) {
  const [zoom, setZoom] = useState(false);
  const [failed, setFailed] = useState(false);
  const muted = tone === 'color' ? 'text-white/80' : 'text-slate-400';

  if (kind === 'UNSUPPORTED' || !file || failed) {
    return (
      <span className={`mb-1 flex items-center gap-1.5 text-xs ${muted}`}>
        <ImageOff className="h-3.5 w-3.5" /> {kind === 'UNSUPPORTED' ? 'Formato no soportado (video o sticker)' : 'Adjunto no disponible'}
      </span>
    );
  }
  const url = mediaUrl(file);

  if (kind === 'IMAGE') {
    return (
      <>
        <button type="button" onClick={() => setZoom(true)} className="mb-1 block overflow-hidden rounded-xl border border-black/20" title="Ver en grande">
          {/* eslint-disable-next-line @next/next/no-img-element -- adjunto privado servido con sesión */}
          <img src={url} alt={name || 'Imagen del chat'} onError={() => setFailed(true)} className="max-h-60 w-auto max-w-full object-cover" />
        </button>
        {zoom && <ImageLightbox src={url} alt={name || 'Imagen del chat'} onClose={() => setZoom(false)} />}
      </>
    );
  }

  if (kind === 'AUDIO') {
    return (
      <div className="mb-1 space-y-1">
        <span className={`flex items-center gap-1 text-[11px] font-semibold ${muted}`}>
          <Mic className="h-3.5 w-3.5" /> Nota de voz
        </span>
        <audio controls preload="metadata" src={url} onError={() => setFailed(true)} className="h-9 w-64 max-w-full" />
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`tap mb-1 flex items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition ${
        tone === 'color' ? 'border-white/25 bg-white/10 hover:bg-white/20' : 'border-slate-600 bg-slate-900/60 hover:border-slate-500'
      }`}
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="truncate">{name || 'Documento PDF'}</span>
      <span className={`ml-auto shrink-0 ${muted}`}>Abrir ↗</span>
    </a>
  );
}

/** El texto guardado empieza con la etiqueta del adjunto ("📷 Imagen"): con el adjunto a la vista sobra */
export function stripMediaLabel(message: string, kind: MediaKind | null | undefined): string {
  if (!kind) return message;
  const [first, ...rest] = message.split('\n');
  return /^(📷 Imagen|🎙️ Nota de voz|📄 Documento|📎 Archivo adjunto)/.test(first) ? rest.join('\n').trim() : message;
}
