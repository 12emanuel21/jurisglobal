'use client';

import { AlertTriangle, CalendarClock, Pause, Play, Repeat, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { btnDanger, btnGhost, btnSecondary, card, errorText, muted } from '@/components/panel/ui';
import { formatDateTime } from '@/lib/format';
import { CAMPAIGN_STATUS_LABEL, masivosApi, type CampaignScheduleSummary } from '@/lib/masivos';

interface Props {
  items: CampaignScheduleSummary[];
  onChanged: () => void;
  onOpenCampaign: (campaignId: string) => void;
}

/** Terminada = ya pasó su fecha de fin (hora de Colombia) */
const finished = (s: CampaignScheduleSummary) =>
  !s.isActive && Boolean(s.recurrence.endDate) && s.recurrence.endDate! < new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);

/** Campañas recurrentes: regla, próxima y última ejecución, motivo de una omisión y acciones */
export function SchedulesPanel({ items, onChanged, onOpenCampaign }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!items.length) return null;

  const act = async (id: string, action: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await action();
      setConfirmDelete(null);
      onChanged();
    } catch (err) {
      setError(errorText(err, 'No se pudo actualizar la campaña recurrente'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="schedules-title" className="space-y-3">
      <h3 id="schedules-title" className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-navy dark:text-slate-100">
        <Repeat className="h-4 w-4" aria-hidden="true" /> Campañas recurrentes
      </h3>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      <ul className="grid gap-3 lg:grid-cols-2" aria-label="Campañas recurrentes">
        {items.map((s) => (
          <li key={s.id} className={`${card} p-4`} data-testid={`schedule-${s.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-navy dark:text-slate-100">{s.name}</p>
                <p className={`text-xs ${muted}`}>
                  {s.template.name}
                  {s.dryRun ? ' · Simulación' : ''} · {s.runs} {s.runs === 1 ? 'campaña creada' : 'campañas creadas'}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  s.isActive ? 'bg-[#dcfce7] text-[#166534] dark:bg-[#14532d]/60 dark:text-[#bbf7d0]' : 'bg-[#f1f5f9] text-[#334155] dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {s.isActive ? 'Activa' : finished(s) ? 'Terminada' : 'Pausada'}
              </span>
            </div>
            <p className="mt-2 flex items-center gap-2 text-sm text-navy dark:text-slate-100">
              <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" /> {s.description}
            </p>
            <dl className={`mt-2 grid gap-1 text-xs ${muted} sm:grid-cols-2`}>
              <div>
                <dt className="inline font-semibold">Próxima: </dt>
                <dd className="inline" data-testid="schedule-next">
                  {s.isActive && s.nextRunAt ? formatDateTime(s.nextRunAt) : '—'}
                </dd>
              </div>
              <div>
                <dt className="inline font-semibold">Última: </dt>
                <dd className="inline">
                  {s.lastCampaign ? (
                    <button type="button" onClick={() => onOpenCampaign(s.lastCampaign!.id)} className="underline underline-offset-2 hover:text-navy">
                      {s.lastCampaign.name} ({CAMPAIGN_STATUS_LABEL[s.lastCampaign.status]})
                    </button>
                  ) : s.lastRunAt ? (
                    formatDateTime(s.lastRunAt)
                  ) : (
                    'aún no se ha ejecutado'
                  )}
                </dd>
              </div>
            </dl>
            {s.lastSkipReason && (
              <p className="mt-2 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300" data-testid="schedule-skip">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Última ejecución omitida: {s.lastSkipReason}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {finished(s) ? null : s.isActive ? (
                <button type="button" disabled={busy === s.id} onClick={() => void act(s.id, () => masivosApi.pauseSchedule(s.id))} className={btnSecondary}>
                  <Pause className="h-4 w-4" /> Pausar
                </button>
              ) : (
                <button type="button" disabled={busy === s.id} onClick={() => void act(s.id, () => masivosApi.resumeSchedule(s.id))} className={btnSecondary}>
                  <Play className="h-4 w-4" /> Reanudar
                </button>
              )}
              {confirmDelete === s.id ? (
                <span role="group" aria-label={`Confirmar eliminar ${s.name}`} className="inline-flex flex-wrap items-center gap-2">
                  <span className="text-xs">Las campañas ya creadas se conservan.</span>
                  <button type="button" disabled={busy === s.id} onClick={() => void act(s.id, () => masivosApi.deleteSchedule(s.id))} className={btnDanger}>
                    Sí, eliminar
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(null)} className={btnGhost}>
                    No
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(s.id)} className={btnGhost} aria-label={`Eliminar ${s.name}`}>
                  <Trash2 className="h-4 w-4" /> Eliminar
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
