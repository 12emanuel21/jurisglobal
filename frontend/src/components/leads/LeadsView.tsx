'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, ChevronLeft, ChevronRight, Download, Loader2, MessagesSquare, RefreshCw, Search, X } from 'lucide-react';
import { apiJson } from '@/lib/api';
import { formatListDate } from '@/lib/format';
import { usePanelEvents } from '@/lib/realtime';
import {
  EMPTY_FILTERS,
  LEAD_STATUSES,
  ORIGIN_LABEL,
  STATUS_BADGE,
  STATUS_LABEL,
  STATUS_PLURAL,
  leadsApi,
  type LeadFilters,
  type LeadPage,
  type LeadStatus,
  type LeadSummary,
  type Person,
} from '@/lib/leads';
import { btnPrimary, btnSecondary, card, errorText, heading, input, label, muted } from '@/components/panel/ui';
import { LeadDetail, displayLeadPhone } from './LeadDetail';

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 350;
const NOTICE_MS = 8000;

/** Acento de cada tarjeta del resumen */
const CARD_ACCENT: Record<LeadStatus, string> = {
  NEW: 'border-t-sky-600',
  CONTACTED: 'border-t-gold',
  SCHEDULED: 'border-t-violet-600',
  CLOSED: 'border-t-gray-400',
};

interface Notice {
  leadId: string;
  text: string;
}

/** Lee ?lead=<id> al abrir (enlace directo a un lead) sin useSearchParams: la página sigue estática */
function initialLeadFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('lead');
}

function syncLeadInUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('lead', id);
  else url.searchParams.delete('lead');
  window.history.replaceState(null, '', `${url.pathname}${url.search}`);
}

/**
 * Leads (vista principal del panel): resumen por estado, filtros, listado paginado en el servidor,
 * exportación CSV con los filtros activos y aviso en tiempo real (Socket.io) de leads nuevos y
 * recontactos sin recargar.
 */
export function LeadsView({ isAdmin }: { isAdmin: boolean }) {
  const [filters, setFilters] = useState<LeadFilters>(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LeadPage | null>(null);
  const [summary, setSummary] = useState<LeadSummary | null>(null);
  const [motivos, setMotivos] = useState<Array<{ id: string; name: string }>>([]);
  const [assignees, setAssignees] = useState<Person[]>([]);
  /** Consulta ya respondida (filtros + página): mientras no coincida con la actual, se muestra "cargando" */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const requestRef = useRef(0);
  const selectedRef = useRef<string | null>(null);

  const queryKey = JSON.stringify([filters, page]);
  const loading = loadedKey !== queryKey || refreshing;

  /** Lista + resumen. El estado solo cambia al responder (y solo con la respuesta más reciente) */
  const load = useCallback((f: LeadFilters, p: number) => {
    const request = ++requestRef.current;
    const key = JSON.stringify([f, p]);
    return Promise.all([leadsApi.list(f, p, PAGE_SIZE), leadsApi.summary()])
      .then(([list, counts]) => {
        if (request !== requestRef.current) return;
        setData(list);
        setSummary(counts);
        setError(null);
      })
      .catch((err: unknown) => {
        if (request === requestRef.current) setError(errorText(err, 'No se pudieron cargar los leads'));
      })
      .finally(() => {
        if (request === requestRef.current) setLoadedKey(key);
      });
  }, []);

  useEffect(() => {
    void load(filters, page);
  }, [load, filters, page]);

  const refresh = () => {
    setRefreshing(true);
    void load(filters, page).finally(() => setRefreshing(false));
  };

  // Catálogos para los filtros y el responsable
  useEffect(() => {
    apiJson<{ motivos: Array<{ id: string; name: string }> }>('/public/config')
      .then((c) => setMotivos(c.motivos))
      .catch(() => undefined);
    leadsApi
      .assignees()
      .catch(() => [] as Person[])
      .then((list) => {
        setAssignees(list);
        // Enlace directo ?lead=<id>: se abre cuando ya están los responsables del detalle
        const fromUrl = initialLeadFromUrl();
        if (fromUrl) {
          selectedRef.current = fromUrl;
          setSelectedId(fromUrl);
        }
      });
  }, []);

  // Búsqueda con espera corta (no una petición por tecla)
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.q === search ? f : { ...f, q: search }));
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  // Tiempo real: lead nuevo o recontacto (formulario o bot) -> aviso; cambios del equipo -> refresco silencioso
  usePanelEvents(['lead:new', 'lead:updated', 'lead:changed'], (event, payload) => {
    const leadId = (payload as { leadId?: string } | null)?.leadId;
    void load(filters, page);
    if (leadId && leadId === selectedRef.current) setDetailKey((k) => k + 1);
    if (leadId && event === 'lead:new') setNotice({ leadId, text: 'Entró un lead nuevo' });
    if (leadId && event === 'lead:updated') setNotice({ leadId, text: 'Un lead volvió a escribir (recontacto)' });
  });

  const setFilter = <K extends keyof LeadFilters>(key: K, value: LeadFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const clearFilters = () => {
    setSearch('');
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const openLead = (id: string | null) => {
    selectedRef.current = id;
    setSelectedId(id);
    syncLeadInUrl(id);
  };

  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await leadsApi.exportCsv({ ...filters, q: search });
    } catch (err) {
      setExportError(errorText(err, 'No se pudo exportar'));
    } finally {
      setExporting(false);
    }
  };

  const hasFilters = Boolean(search || filters.status || filters.motivoId || filters.origin || filters.from || filters.to);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className={heading}>Leads</h2>
          <p className={`text-sm ${muted}`}>Personas que dejaron sus datos por la web o por WhatsApp.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={refresh} className={btnSecondary} aria-label="Actualizar">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button type="button" onClick={() => void exportCsv()} disabled={exporting} className={btnPrimary}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Exportar CSV
          </button>
        </div>
      </div>

      {notice && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-gold/60 bg-[#fdf8ec] px-4 py-2 text-sm text-navy dark:bg-gold/10 dark:text-slate-100">
          <span className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-gold-700 dark:text-gold-400" aria-hidden="true" /> {notice.text}
          </span>
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => openLead(notice.leadId)} className="tap rounded-lg px-3 font-semibold underline-offset-2 hover:underline">
              Ver
            </button>
            <button type="button" onClick={() => setNotice(null)} aria-label="Cerrar aviso" className="tap inline-flex w-11 items-center justify-center rounded-lg">
              <X className="h-4 w-4" />
            </button>
          </span>
        </div>
      )}
      {exportError && (
        <p role="alert" className="text-sm text-red-700">
          {exportError}
        </p>
      )}

      <section aria-label="Resumen por estado" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {LEAD_STATUSES.map((s) => {
          const active = filters.status === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter('status', active ? '' : s)}
              aria-pressed={active}
              className={`${card} border-t-4 ${CARD_ACCENT[s]} p-4 text-left transition hover:shadow-md ${active ? 'ring-2 ring-gold' : ''}`}
            >
              <p className={`text-xs font-semibold uppercase tracking-wide ${muted}`}>{STATUS_PLURAL[s]}</p>
              <p className="mt-1 font-serif text-3xl font-bold text-navy dark:text-slate-100" data-testid={`summary-${s}`}>
                {summary ? summary.byStatus[s] : '—'}
              </p>
            </button>
          );
        })}
      </section>

      <section aria-label="Filtros" className={`${card} grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5 xl:grid-cols-7`}>
        <div className="sm:col-span-2 lg:col-span-5 xl:col-span-2">
          <label htmlFor="f-q" className={label}>
            Buscar
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input id="f-q" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre, teléfono o correo" className={`${input} pl-9`} />
          </div>
        </div>
        <div>
          <label htmlFor="f-status" className={label}>
            Estado
          </label>
          <select id="f-status" value={filters.status} onChange={(e) => setFilter('status', e.target.value as LeadStatus | '')} className={input}>
            <option value="">Todos</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-motivo" className={label}>
            Motivo
          </label>
          <select id="f-motivo" value={filters.motivoId} onChange={(e) => setFilter('motivoId', e.target.value)} className={input}>
            <option value="">Todos</option>
            {motivos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-origin" className={label}>
            Origen
          </label>
          <select id="f-origin" value={filters.origin} onChange={(e) => setFilter('origin', e.target.value as LeadFilters['origin'])} className={input}>
            <option value="">Todos</option>
            <option value="WEB">Web</option>
            <option value="WHATSAPP">WhatsApp</option>
          </select>
        </div>
        {/* Celular y tableta: Desde/Hasta lado a lado; escritorio: cada fecha es una columna más de la fila */}
        <div className="grid grid-cols-2 gap-3 sm:col-span-2 lg:contents">
          <div>
            <label htmlFor="f-from" className={label}>
              Desde
            </label>
            <input id="f-from" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor="f-to" className={label}>
              Hasta
            </label>
            <input id="f-to" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} className={input} />
          </div>
        </div>
        {hasFilters && (
          <div className="sm:col-span-2 lg:col-span-5 xl:col-span-7">
            <button type="button" onClick={clearFilters} className="tap text-sm font-semibold text-navy underline-offset-2 hover:underline dark:text-slate-200">
              Limpiar filtros
            </button>
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <section aria-label="Listado de leads" aria-busy={loading} className={`${card} overflow-hidden`}>
        {data && data.items.length === 0 && !loading && (
          <p className={`p-6 text-center text-sm ${muted}`}>{hasFilters ? 'Ningún lead coincide con los filtros.' : 'Aún no hay leads.'}</p>
        )}
        {data && data.items.length > 0 && (
          <>
            {/* Escritorio: tabla */}
            <table className="hidden w-full text-left text-sm md:table">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-semibold">Nombre</th>
                  <th className="px-4 py-3 font-semibold">Motivo</th>
                  <th className="px-4 py-3 font-semibold">Origen</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3 font-semibold">Responsable</th>
                  <th className="px-4 py-3 font-semibold">Último envío</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {data.items.map((l) => (
                  <tr key={l.id} className="cursor-pointer hover:bg-[#fdf8ec] dark:hover:bg-slate-800/60" onClick={() => openLead(l.id)}>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => openLead(l.id)} className="text-left font-semibold text-navy hover:underline dark:text-slate-100">
                        {l.fullName}
                      </button>
                      <p className={`text-xs ${muted}`}>
                        {displayLeadPhone(l.phone)}
                        {l.submissionCount > 1 && ` · ${l.submissionCount} envíos`}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-gray-800 dark:text-slate-200">{l.motivo.name}</td>
                    <td className="px-4 py-3 text-gray-800 dark:text-slate-200">
                      <span className="inline-flex items-center gap-1">
                        {ORIGIN_LABEL[l.origin]}
                        {l.conversationId && <MessagesSquare className="h-3.5 w-3.5 text-gray-500" aria-label="Tiene chat en el Inbox" />}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${STATUS_BADGE[l.status]}`}>{STATUS_LABEL[l.status]}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-800 dark:text-slate-200">{l.assignedTo?.name ?? <span className={muted}>—</span>}</td>
                    <td className={`px-4 py-3 ${muted}`}>{formatListDate(l.lastSubmittedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Celular: tarjetas */}
            <ul className="divide-y divide-gray-100 md:hidden dark:divide-slate-800">
              {data.items.map((l) => (
                <li key={l.id}>
                  <button type="button" onClick={() => openLead(l.id)} className="tap flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-[#fdf8ec] dark:hover:bg-slate-800/60">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-navy dark:text-slate-100">{l.fullName}</span>
                      <span className={`block text-xs ${muted}`}>
                        {l.motivo.name} · {ORIGIN_LABEL[l.origin]} · {formatListDate(l.lastSubmittedAt)}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${STATUS_BADGE[l.status]}`}>{STATUS_LABEL[l.status]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {!data && loading && (
          <p className={`flex items-center justify-center gap-2 p-6 text-sm ${muted}`}>
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando leads…
          </p>
        )}
      </section>

      {data && data.total > 0 && (
        <nav aria-label="Paginación" className="flex items-center justify-between gap-3 text-sm">
          <p className={muted}>
            {data.total} lead{data.total === 1 ? '' : 's'} · página {data.page} de {data.pages}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPage((p) => p - 1)} disabled={data.page <= 1 || loading} className={btnSecondary} aria-label="Página anterior">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={data.page >= data.pages || loading} className={btnSecondary} aria-label="Página siguiente">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </nav>
      )}

      {selectedId && (
        <LeadDetail
          leadId={selectedId}
          isAdmin={isAdmin}
          assignees={assignees}
          refreshKey={detailKey}
          onClose={() => openLead(null)}
          onChanged={() => void load(filters, page)}
        />
      )}
    </div>
  );
}
