'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Ban, ChevronLeft, ChevronRight, Clock, Loader2, Pause, Play } from 'lucide-react';
import { btnDanger, btnGhost, btnPrimary, btnSecondary, card, errorText, input, label, muted } from '@/components/panel/ui';
import { formatDateTime } from '@/lib/format';
import { usePanelEvents } from '@/lib/realtime';
import {
  CAMPAIGN_STATUS_LABEL,
  KIND_LABEL,
  RECIPIENT_STATUS_LABEL,
  SKIP_REASON_LABEL,
  WAIT_REASON_LABEL,
  masivosApi,
  pausedReasonLabel,
  type CampaignDetail as Detail,
  type CampaignMetrics,
  type Recipient,
  type RecipientStatus,
} from '@/lib/masivos';

export const STATUS_BADGE: Record<string, string> = {
  SCHEDULED: 'bg-[#e0effa] text-[#0c4a6e] dark:bg-[#0c4a6e]/50 dark:text-[#bae6fd]',
  RUNNING: 'bg-[#e6f4ea] text-[#14532d] dark:bg-[#14532d]/50 dark:text-[#bbf7d0]',
  PAUSED: 'bg-[#fdf3d7] text-[#78350f] dark:bg-[#78350f]/50 dark:text-[#fde68a]',
  COMPLETED: 'bg-gray-200 text-gray-800 dark:bg-slate-700 dark:text-slate-200',
  CANCELLED: 'bg-[#fde8e8] text-[#7f1d1d] dark:bg-[#7f1d1d]/50 dark:text-[#fecaca]',
  FAILED: 'bg-[#fde8e8] text-[#7f1d1d] dark:bg-[#7f1d1d]/50 dark:text-[#fecaca]',
  DRAFT: 'bg-gray-200 text-gray-800 dark:bg-slate-700 dark:text-slate-200',
};

const METRICS: Array<[keyof CampaignMetrics, string]> = [
  ['total', 'Total'],
  ['pending', 'Pendientes'],
  ['sent', 'Enviados'],
  ['delivered', 'Entregados'],
  ['read', 'Leídos'],
  ['failed', 'Fallidos'],
  ['optedOut', 'Bajas'],
  ['replied', 'Respuestas'],
  ['skipped', 'Omitidos'],
];

/** Barra del embudo: enviados, entregados y leídos sobre el total a enviar */
export function ProgressBar({ metrics }: { metrics: CampaignMetrics }) {
  const base = Math.max(1, metrics.total - metrics.skipped);
  const pct = (n: number) => `${Math.min(100, (n / base) * 100)}%`;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-slate-800" aria-hidden="true">
      <div className="h-full bg-navy dark:bg-sky-400" style={{ width: pct(metrics.read) }} />
      <div className="h-full bg-gold" style={{ width: pct(metrics.sent - metrics.read) }} />
      <div className="h-full bg-red-600" style={{ width: pct(metrics.failed) }} />
    </div>
  );
}

/** Tablero de una campaña: métricas en vivo (Socket.io), controles, errores y destinatarios */
export function CampaignDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [recipients, setRecipients] = useState<{ items: Recipient[]; total: number; pageSize: number } | null>(null);
  const [filter, setFilter] = useState<RecipientStatus | ''>('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<'pause' | 'resume' | 'cancel' | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    masivosApi
      .campaign(id)
      .then((d) => alive && setDetail(d))
      .catch((err: unknown) => alive && setError(errorText(err, 'No se pudo cargar la campaña')));
    masivosApi
      .recipients(id, { status: filter, page })
      .then((r) => alive && setRecipients(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id, filter, page, reload]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Muchos estados de Meta llegan juntos: se agrupan en una sola recarga
  usePanelEvents(['campaign:progress'], (_event, payload) => {
    if ((payload as { campaignId?: string } | null)?.campaignId !== id || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setReload((n) => n + 1);
    }, 600);
  });

  const act = async (action: 'pause' | 'resume' | 'cancel') => {
    setBusy(action);
    setError(null);
    try {
      setDetail(await masivosApi[action](id));
      setConfirmCancel(false);
      setReload((n) => n + 1);
    } catch (err) {
      setError(errorText(err, 'No se pudo completar la acción'));
    } finally {
      setBusy(null);
    }
  };

  if (!detail)
    return (
      <div className="space-y-3">
        <button type="button" onClick={onBack} className={btnGhost}>
          <ArrowLeft className="h-4 w-4" /> Campañas
        </button>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : (
          <p className={`flex items-center gap-2 text-sm ${muted}`}>
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </p>
        )}
      </div>
    );

  const active = detail.status === 'RUNNING' || detail.status === 'SCHEDULED';
  const pages = recipients ? Math.max(1, Math.ceil(recipients.total / recipients.pageSize)) : 1;
  const waiting = active && detail.waitReason && WAIT_REASON_LABEL[detail.waitReason];

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className={btnGhost}>
        <ArrowLeft className="h-4 w-4" /> Campañas
      </button>

      <section className={`${card} p-5`} aria-label="Resumen de la campaña">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-serif text-xl font-bold text-navy dark:text-slate-100">{detail.name}</h3>
            <p className={`text-sm ${muted}`}>
              {detail.template.name} ({detail.template.language}) · {KIND_LABEL[detail.kind]}
              {detail.dryRun ? ' · Simulación' : ''}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[detail.status]}`} data-testid="campaign-status">
                {CAMPAIGN_STATUS_LABEL[detail.status]}
              </span>
              {detail.status === 'PAUSED' && <span className="text-amber-800 dark:text-amber-300">{pausedReasonLabel(detail.pausedReason)}</span>}
              {waiting && (
                <span className={`inline-flex items-center gap-1 ${muted}`} data-testid="campaign-wait">
                  <Clock className="h-4 w-4" /> {waiting}
                  {detail.nextRunAt && detail.waitReason !== 'RETRY' ? ` · próximo envío ${formatDateTime(detail.nextRunAt)}` : ''}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {active && (
              <button type="button" onClick={() => void act('pause')} disabled={busy !== null} className={btnSecondary}>
                {busy === 'pause' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />} Pausar
              </button>
            )}
            {detail.status === 'PAUSED' && (
              <button type="button" onClick={() => void act('resume')} disabled={busy !== null} className={btnPrimary}>
                {busy === 'resume' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Reanudar
              </button>
            )}
            {(active || detail.status === 'PAUSED') &&
              (confirmCancel ? (
                <span role="group" aria-label="Confirmar cancelación" className="flex items-center gap-2">
                  <button type="button" onClick={() => void act('cancel')} disabled={busy !== null} className={btnDanger}>
                    {busy === 'cancel' && <Loader2 className="h-4 w-4 animate-spin" />} Sí, cancelar
                  </button>
                  <button type="button" onClick={() => setConfirmCancel(false)} className={btnGhost}>
                    No
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmCancel(true)} className={btnGhost}>
                  <Ban className="h-4 w-4" /> Cancelar
                </button>
              ))}
          </div>
        </div>
        {confirmCancel && <p className={`mt-2 text-sm ${muted}`}>Los envíos pendientes no saldrán. Lo ya enviado sigue registrando entregas y lecturas.</p>}
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="mt-4">
          <ProgressBar metrics={detail.metrics} />
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9" aria-label="Métricas">
          {METRICS.map(([key, text]) => (
            <div key={key} className="rounded-xl bg-gray-50 p-3 dark:bg-slate-800/60">
              <dt className={`text-xs font-semibold ${muted}`}>{text}</dt>
              <dd className="font-serif text-2xl font-bold text-navy dark:text-slate-100" data-testid={`metric-${key}`}>
                {detail.metrics[key]}
              </dd>
            </div>
          ))}
        </dl>
        {detail.deferred > 0 && <p className={`mt-2 text-xs ${muted}`}>{detail.deferred} diferidos por tope de frecuencia (salen cuando se libere su cupo).</p>}
        <p className={`mt-2 text-xs ${muted}`}>
          {detail.scheduledAt && `Programada para ${formatDateTime(detail.scheduledAt)} · `}
          {detail.startedAt && `Inició ${formatDateTime(detail.startedAt)} · `}
          {detail.completedAt && `Terminó ${formatDateTime(detail.completedAt)} · `}
          Creada {formatDateTime(detail.createdAt)}
          {detail.createdBy ? ` por ${detail.createdBy}` : ''}
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`${card} p-5`} aria-label="Errores más frecuentes">
          <h4 className="text-sm font-bold text-navy dark:text-slate-100">Errores más frecuentes</h4>
          {detail.topErrors.length === 0 ? (
            <p className={`mt-2 text-sm ${muted}`}>Sin errores.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {detail.topErrors.map((e) => (
                <li key={`${e.code}-${e.category}`} className="flex justify-between gap-2">
                  <span>
                    {e.label}
                    {e.code ? <span className={muted}> ({e.code})</span> : null}
                  </span>
                  <strong>{e.count}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={`${card} p-5`} aria-label="Omitidos">
          <h4 className="text-sm font-bold text-navy dark:text-slate-100">Omitidos y por qué</h4>
          {Object.keys(detail.skipReasons).length === 0 ? (
            <p className={`mt-2 text-sm ${muted}`}>Ninguno.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {Object.entries(detail.skipReasons).map(([reason, count]) => (
                <li key={reason} className="flex justify-between gap-2">
                  <span>{SKIP_REASON_LABEL[reason] ?? reason}</span>
                  <strong>{count}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className={`${card} p-5`} aria-label="Destinatarios">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h4 className="text-sm font-bold text-navy dark:text-slate-100">Destinatarios</h4>
          <div className="w-48">
            <label htmlFor="r-status" className={label}>
              Estado
            </label>
            <select
              id="r-status"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value as RecipientStatus | '');
                setPage(1);
              }}
              className={input}
            >
              <option value="">Todos</option>
              {(Object.keys(RECIPIENT_STATUS_LABEL) as RecipientStatus[]).map((s) => (
                <option key={s} value={s}>
                  {RECIPIENT_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <ul className="mt-3 divide-y divide-gray-100 text-sm dark:divide-slate-800">
          {recipients?.items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <p className="font-semibold text-navy dark:text-slate-100">{r.name ?? 'Sin nombre'}</p>
                <p className={`text-xs ${muted}`}>{r.phone}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold">{RECIPIENT_STATUS_LABEL[r.status]}</p>
                <p className={`text-xs ${muted}`}>
                  {r.skipReason
                    ? (SKIP_REASON_LABEL[r.skipReason] ?? r.skipReason)
                    : r.errorLabel
                      ? `${r.errorLabel}${r.errorCode ? ` (${r.errorCode})` : ''}`
                      : r.status === 'PENDING' && r.notBefore
                        ? `Diferido hasta ${formatDateTime(r.notBefore)}`
                        : (r.readAt ?? r.deliveredAt ?? r.sentAt)
                          ? formatDateTime((r.readAt ?? r.deliveredAt ?? r.sentAt)!)
                          : ''}
                  {r.optedOutAt ? ' · se dio de baja' : r.repliedAt ? ' · respondió' : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
        {recipients && recipients.items.length === 0 && <p className={`mt-2 text-sm ${muted}`}>Sin destinatarios con ese estado.</p>}
        {pages > 1 && (
          <nav aria-label="Paginación de destinatarios" className="mt-3 flex items-center justify-end gap-2">
            <button type="button" className={btnSecondary} disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm">
              {page} / {pages}
            </span>
            <button type="button" className={btnSecondary} disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Página siguiente">
              <ChevronRight className="h-4 w-4" />
            </button>
          </nav>
        )}
      </section>
    </div>
  );
}
