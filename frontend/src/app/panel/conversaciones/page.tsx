'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bot, Headset, Loader2, MessagesSquare, RefreshCw, Send, User } from 'lucide-react';
import { apiJson } from '@/lib/api';
import { formatDateTime, formatListDate, formatPhone } from '@/lib/format';
import { usePanelEvents } from '@/lib/realtime';
import { ChatMediaAttachment, stripMediaLabel, type MediaKind } from '@/components/conversations/ChatMedia';

/** Respaldo del tiempo real: refresco periódico de la bandeja y del chat abierto */
const POLL_INTERVAL_MS = 15_000;
const MAX_MESSAGE_LENGTH = 4096;

const SYSTEM_LABELS: Record<string, string> = {
  '[SYSTEM_BOT_PAUSED]': '👤 Bot pausado: el equipo atiende este chat',
  '[SYSTEM_BOT_RESUMED]': '🤖 Bot reactivado',
  '[SYSTEM_OPT_OUT]': '🚫 Baja registrada: la persona pidió no recibir más mensajes automáticos',
};
const systemLabel = (message: string | null) => SYSTEM_LABELS[message ?? ''] ?? `⚙️ ${message ?? ''}`;

type Author = 'CONTACT' | 'BOT' | 'AGENT' | 'SYSTEM';

interface Conversation {
  id: string;
  waId: string;
  displayName: string | null;
  leadId: string | null;
  lastMessage: string;
  lastAuthor: Author | null;
  lastMessageAt: string;
  messageCount: number;
  botPaused: boolean;
}

interface ConversationStatus {
  botPaused: boolean;
  resumesAt: string | null;
  lastInboundAt: string | null;
  outsideServiceWindow: boolean;
}

interface ChatMessage {
  id: string;
  author: Author;
  body: string | null;
  mediaKind: MediaKind | null;
  mediaFile: string | null;
  mediaName: string | null;
  status: 'RECEIVED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | null;
  errorDetail: string | null;
  createdAt: string;
  sentBy: { name: string } | null;
}

const STATUS_TICKS: Record<string, string> = { SENT: '✓', DELIVERED: '✓✓', READ: '✓✓ leído', FAILED: '⚠ no entregado' };

/**
 * Inbox de WhatsApp (adaptado de dashboard/chats de KovalCloud): bandeja, historial con imágenes,
 * notas de voz (con transcripción) y PDFs, envío manual y pausa del bot (handover humano).
 */
export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ConversationStatus | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [togglingBot, setTogglingBot] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    try {
      setConversations(await apiJson<Conversation[]>('/conversations', {}, 'No se pudieron cargar las conversaciones'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las conversaciones');
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadChat = useCallback(async (id: string) => {
    const [data, chatStatus] = await Promise.all([
      apiJson<ChatMessage[]>(`/conversations/${id}/messages`, {}, 'No se pudo cargar el chat'),
      apiJson<ConversationStatus>(`/conversations/${id}/status`, {}, 'No se pudo cargar el chat'),
    ]);
    if (selectedRef.current !== id) return;
    setMessages(data);
    setStatus(chatStatus);
  }, []);

  // Carga inicial + respaldo periódico (setState solo en los callbacks de la promesa)
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      apiJson<Conversation[]>('/conversations', {}, 'No se pudieron cargar las conversaciones')
        .then((data) => {
          if (cancelled) return;
          setConversations(data);
          setError(null);
        })
        .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : 'No se pudieron cargar las conversaciones'))
        .finally(() => !cancelled && setListLoading(false));
      if (selectedRef.current) loadChat(selectedRef.current).catch(() => undefined);
    };
    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [loadChat]);

  // Tiempo real: un mensaje nuevo o un cambio de estado refresca la bandeja y el chat abierto
  usePanelEvents(['message:new', 'message:status', 'conversation:updated'], (_event, payload) => {
    void loadList();
    const id = (payload as { conversationId?: string } | null)?.conversationId;
    if (id && id === selectedRef.current) void loadChat(id).catch(() => undefined);
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const openConversation = async (id: string) => {
    setSelectedId(id);
    selectedRef.current = id;
    setMessages([]);
    setStatus(null);
    setDraft('');
    setSendError(null);
    setChatLoading(true);
    try {
      await loadChat(id);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el chat');
    } finally {
      setChatLoading(false);
    }
  };

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const id = selectedId;
    const text = draft.trim();
    if (!id || !text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await apiJson(`/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify({ text }) }, 'No se pudo enviar el mensaje');
      setDraft('');
      await Promise.all([loadChat(id), loadList()]);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'No se pudo enviar el mensaje');
    } finally {
      setSending(false);
    }
  };

  const toggleBot = async () => {
    const id = selectedId;
    if (!id || !status) return;
    setTogglingBot(true);
    setSendError(null);
    try {
      await apiJson(`/conversations/${id}/handover`, { method: 'PATCH', body: JSON.stringify({ botPaused: !status.botPaused }) }, 'No se pudo cambiar el estado del bot');
      await Promise.all([loadChat(id), loadList()]);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'No se pudo cambiar el estado del bot');
    } finally {
      setTogglingBot(false);
    }
  };

  const selected = conversations.find((c) => c.id === selectedId);
  const title = (c: Conversation) => c.displayName || formatPhone(c.waId);

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">{error}</div>}

      <div className="flex h-[calc(100vh-11rem)] min-h-[480px] overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/80 shadow-xl">
        <aside className={`w-full shrink-0 flex-col border-r border-slate-800 md:w-80 lg:w-96 ${selectedId ? 'hidden md:flex' : 'flex'}`}>
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3.5">
            <div>
              <h2 className="text-sm font-bold text-white">Conversaciones</h2>
              <p className="text-[11px] text-slate-500">
                {conversations.length} {conversations.length === 1 ? 'chat' : 'chats'} · en tiempo real
              </p>
            </div>
            <button type="button" onClick={() => void loadList()} className="tap rounded-lg p-2.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200" aria-label="Actualizar">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {listLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-2 border-b border-slate-800/60 px-4 py-3.5">
                  <div className="h-3 w-1/2 animate-pulse rounded bg-slate-800" />
                  <div className="h-3 w-4/5 animate-pulse rounded bg-slate-800/70" />
                </div>
              ))
            ) : conversations.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                <MessagesSquare className="h-8 w-8 text-slate-600" />
                <p className="text-sm font-semibold text-slate-300">Aún no hay conversaciones</p>
                <p className="text-xs text-slate-500">Aparecerán aquí cuando alguien escriba al WhatsApp de JurisGlobal.</p>
              </div>
            ) : (
              conversations.map((c) => {
                const active = c.id === selectedId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => void openConversation(c.id)}
                    className={`block w-full border-b border-slate-800/60 px-4 py-3.5 text-left transition ${active ? 'bg-blue-500/10' : 'hover:bg-slate-800/50'}`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold ${active ? 'text-blue-300' : 'text-white'}`}>
                        {title(c)}
                        {c.botPaused && (
                          <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-amber-300">
                            Humano
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[10px] text-slate-500">{formatListDate(c.lastMessageAt)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">
                      {c.lastAuthor === 'BOT' && <span className="text-indigo-400">🤖 </span>}
                      {c.lastAuthor === 'AGENT' && <span className="text-sky-400">👤 Equipo: </span>}
                      {c.lastMessage}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className={`min-w-0 flex-1 flex-col ${selectedId ? 'flex' : 'hidden md:flex'}`}>
          {!selectedId ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl border border-blue-500/20 bg-blue-500/10">
                <MessagesSquare className="h-8 w-8 text-blue-400" />
              </div>
              <h3 className="text-base font-bold text-white">Selecciona un chat para ver el historial</h3>
              <p className="max-w-sm text-xs text-slate-500">Verás la conversación con el bot y el equipo, con imágenes, notas de voz y documentos.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null);
                    selectedRef.current = null;
                  }}
                  className="tap rounded-lg p-2 text-slate-400 hover:bg-slate-800 md:hidden"
                  aria-label="Volver a las conversaciones"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-slate-300">
                  <User className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-white">{selected ? title(selected) : ''}</p>
                  <p className="text-[11px] text-slate-500">
                    {selected ? `${formatPhone(selected.waId)} · ${selected.messageCount} mensajes` : 'Historial del chat'}
                  </p>
                </div>
                {status && (
                  <button
                    type="button"
                    onClick={() => void toggleBot()}
                    disabled={togglingBot}
                    aria-pressed={status.botPaused}
                    title={status.botPaused ? `Clic para reactivar el bot${status.resumesAt ? ` (se reactiva solo ${formatDateTime(status.resumesAt)})` : ''}` : 'Clic para pausar el bot y atender tú este chat'}
                    className={`tap inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition disabled:opacity-60 ${
                      status.botPaused ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20' : 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20'
                    }`}
                  >
                    {togglingBot ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : status.botPaused ? <Headset className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">{status.botPaused ? '👤 Atiende el equipo (bot pausado)' : '🤖 Bot activo'}</span>
                    <span className="sm:hidden">{status.botPaused ? '👤 Humano' : '🤖 Bot'}</span>
                  </button>
                )}
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto bg-slate-950/50 px-4 py-5">
                {chatLoading ? (
                  <p className="text-center text-xs text-slate-500">Cargando historial...</p>
                ) : messages.length === 0 ? (
                  <p className="text-center text-xs text-slate-500">Este chat no tiene mensajes guardados.</p>
                ) : (
                  messages.map((msg) => {
                    if (msg.author === 'SYSTEM') {
                      return (
                        <div key={msg.id} className="flex justify-center">
                          <span className="rounded-full border border-slate-700/60 bg-slate-900 px-3 py-1 text-[10px] font-semibold text-slate-400">
                            {systemLabel(msg.body)} · {formatDateTime(msg.createdAt)}
                          </span>
                        </div>
                      );
                    }
                    const fromAgent = msg.author === 'AGENT';
                    const fromBot = msg.author === 'BOT';
                    const fromFirm = fromAgent || fromBot;
                    const text = stripMediaLabel(msg.body ?? '', msg.mediaFile ? msg.mediaKind : null);
                    const transcript = msg.mediaKind === 'AUDIO' && msg.mediaFile && text && text === msg.body;
                    return (
                      <div key={msg.id} className={`flex ${fromFirm ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[85%] rounded-2xl px-3.5 py-2 shadow-sm md:max-w-[70%] ${
                            fromAgent ? 'rounded-br-md bg-blue-700 text-white' : fromBot ? 'rounded-br-md bg-indigo-600 text-white' : 'rounded-bl-md border border-slate-700/60 bg-slate-800 text-slate-100'
                          }`}
                        >
                          <p className={`mb-0.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${fromFirm ? 'text-white/75' : 'text-slate-400'}`}>
                            {fromAgent ? <Headset className="h-3 w-3" /> : fromBot ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                            {fromAgent ? (msg.sentBy?.name ?? 'Equipo') : fromBot ? 'Bot' : 'Contacto'}
                          </p>
                          {msg.mediaKind && <ChatMediaAttachment kind={msg.mediaKind} file={msg.mediaFile} name={msg.mediaName} tone={fromFirm ? 'color' : 'dark'} />}
                          {text && (
                            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                              {transcript && <span className="mr-1 text-[11px] font-semibold opacity-70">Transcripción:</span>}
                              {text}
                            </p>
                          )}
                          <p className={`mt-1 text-right text-[10px] ${fromFirm ? 'text-white/70' : 'text-slate-500'}`}>
                            {formatDateTime(msg.createdAt)}
                            {fromFirm && msg.status && STATUS_TICKS[msg.status] ? ` · ${STATUS_TICKS[msg.status]}` : ''}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              <form onSubmit={sendMessage} className="space-y-2 border-t border-slate-800 bg-slate-900 px-3 py-3">
                {status?.outsideServiceWindow && (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                    La persona no escribe hace más de 24 h: Meta solo permite plantillas aprobadas y el mensaje puede ser rechazado.
                  </p>
                )}
                {sendError && (
                  <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
                    {sendError}
                  </p>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void sendMessage();
                      }
                    }}
                    rows={1}
                    maxLength={MAX_MESSAGE_LENGTH}
                    placeholder="Escribe un mensaje..."
                    aria-label="Mensaje"
                    disabled={sending}
                    className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition [field-sizing:content] focus:border-blue-500 disabled:opacity-60"
                  />
                  <button type="submit" disabled={sending || !draft.trim()} className="tap inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white transition hover:bg-blue-600 disabled:opacity-50">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    <span className="hidden sm:inline">Enviar</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-500">
                  {status?.botPaused ? 'El bot no responderá en este chat mientras lo atiendas (se reactiva solo tras 12 h sin mensajes del equipo).' : 'Al enviar, el bot se pausa en este chat para no interrumpirte.'}
                </p>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
