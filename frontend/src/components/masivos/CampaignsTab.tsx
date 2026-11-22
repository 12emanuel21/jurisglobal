'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { btnPrimary, card, errorText, muted } from '@/components/panel/ui';
import { formatDateTime } from '@/lib/format';
import { usePanelEvents } from '@/lib/realtime';
import { CAMPAIGN_STATUS_LABEL, KIND_LABEL, masivosApi, type CampaignSummary } from '@/lib/masivos';
import { CampaignDetail, ProgressBar, STATUS_BADGE } from './CampaignDetail';
import { CampaignForm } from './CampaignForm';

/** Lista de campañas con su avance en vivo; abre el tablero de cada una o el formulario de una nueva */
export function CampaignsTab() {
  const [items, setItems] = useState<CampaignSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (openId) return;
    let alive = true;
    masivosApi
      .campaigns()
      .then((r) => alive && (setItems(r.items), setError(null)))
      .catch((err: unknown) => alive && setError(errorText(err, 'No se pudieron cargar las campañas')));
    return () => {
      alive = false;
    };
  }, [reload, openId]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  usePanelEvents(['campaign:progress'], () => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setReload((n) => n + 1);
    }, 1000);
  });

  if (openId) return <CampaignDetail id={openId} onBack={() => setOpenId(null)} />;

  return (
    <div className="space-y-4">
      {creating ? (
        <CampaignForm
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setOpenId(id);
          }}
        />
      ) : (
        <div className="flex justify-end">
          <button type="button" onClick={() => setCreating(true)} className={btnPrimary}>
            <Plus className="h-4 w-4" /> Nueva campaña
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {items && items.length === 0 && !creating && (
        <p className={`${card} p-5 text-sm ${muted}`}>Aún no hay campañas. Importa contactos, registra una plantilla y crea la primera.</p>
      )}
      <ul className="space-y-3" aria-label="Campañas">
        {items?.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => setOpenId(c.id)} className={`${card} block w-full p-4 text-left transition hover:shadow-md`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-navy dark:text-slate-100">{c.name}</p>
                  <p className={`text-xs ${muted}`}>
                    {c.template.name} · {KIND_LABEL[c.kind]}
                    {c.dryRun ? ' · Simulación' : ''} · {formatDateTime(c.createdAt)}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[c.status]}`}>{CAMPAIGN_STATUS_LABEL[c.status]}</span>
              </div>
              <div className="mt-3">
                <ProgressBar metrics={c.metrics} />
              </div>
              <p className={`mt-2 text-xs ${muted}`}>
                {c.metrics.sent} enviados · {c.metrics.delivered} entregados · {c.metrics.read} leídos · {c.metrics.failed} fallidos · {c.metrics.pending}{' '}
                pendientes · {c.metrics.optedOut} bajas
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
