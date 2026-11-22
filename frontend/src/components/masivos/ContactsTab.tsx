'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search, UserMinus, UserPlus, X } from 'lucide-react';
import { btnDanger, btnGhost, btnPrimary, btnSecondary, card, errorText, input, label, muted } from '@/components/panel/ui';
import { formatListDate } from '@/lib/format';
import { usePanelEvents } from '@/lib/realtime';
import {
  CONTACT_STATUS_LABEL,
  OPT_OUT_CHANNEL_LABEL,
  masivosApi,
  type ContactPage,
  type ContactStatus,
  type MassContact,
} from '@/lib/masivos';
import { ContactImporter } from './ContactImporter';

const STATUS_STYLE: Record<ContactStatus, string> = {
  verified: 'bg-[#e6f4ea] text-[#14532d] dark:bg-[#14532d]/50 dark:text-[#bbf7d0]',
  unverified: 'bg-[#fdf3d7] text-[#78350f] dark:bg-[#78350f]/50 dark:text-[#fde68a]',
  opted_out: 'bg-gray-200 text-gray-800 dark:bg-slate-700 dark:text-slate-200',
};

export function StatusPill({ status }: { status: ContactStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>{CONTACT_STATUS_LABEL[status]}</span>;
}

/** Base de contactos de masivos: resumen, filtros, alta y baja manual e importador */
export function ContactsTab() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ContactStatus | ''>('');
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<ContactPage | null>(null);
  const [sources, setSources] = useState<Array<{ source: string; count: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [optingOut, setOptingOut] = useState<MassContact | null>(null);

  // Búsqueda con espera corta para no consultar en cada tecla
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let alive = true;
    masivosApi
      .contacts({ q, status, source, page, pageSize: 25 })
      .then((d) => alive && (setData(d), setError(null)))
      .catch((err: unknown) => alive && setError(errorText(err, 'No se pudieron cargar los contactos')));
    masivosApi
      .sources()
      .then((s) => alive && setSources(s))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [q, status, source, page, reload]);

  usePanelEvents(['contact:changed'], () => setReload((n) => n + 1));
  const refresh = () => setReload((n) => n + 1);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const summaryCard = (key: ContactStatus, value: number | undefined, hint: string) => {
    const active = status === key;
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => {
          setStatus(active ? '' : key);
          setPage(1);
        }}
        className={`${card} p-4 text-left transition hover:shadow-md ${active ? 'ring-2 ring-gold' : ''}`}
      >
        <p className={`text-xs font-semibold uppercase tracking-wide ${muted}`}>{CONTACT_STATUS_LABEL[key]}s</p>
        <p className="mt-1 font-serif text-3xl font-bold text-navy dark:text-slate-100" data-testid={`contacts-${key}`}>
          {value ?? '—'}
        </p>
        <p className={`mt-1 text-xs ${muted}`}>{hint}</p>
      </button>
    );
  };

  return (
    <div className="space-y-5">
      <section aria-label="Resumen de contactos" className="grid gap-3 sm:grid-cols-3">
        {summaryCard('verified', data?.counts.verified, 'Aptos para marketing')}
        {summaryCard('unverified', data?.counts.unverified, 'Solo campaña de confirmación')}
        {summaryCard('opted_out', data?.counts.optedOut, 'No reciben nada')}
      </section>

      <ContactImporter onImported={refresh} />

      <section aria-label="Contactos" className={`${card} p-4`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label htmlFor="c-q" className={label}>
              Buscar
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
              <input id="c-q" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre, celular o correo" className={`${input} pl-9`} />
            </div>
          </div>
          <div>
            <label htmlFor="c-status" className={label}>
              Estado
            </label>
            <select
              id="c-status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as ContactStatus | '');
                setPage(1);
              }}
              className={input}
            >
              <option value="">Todos</option>
              <option value="verified">Verificados</option>
              <option value="unverified">No verificados</option>
              <option value="opted_out">Bajas</option>
            </select>
          </div>
          <div>
            <label htmlFor="c-source" className={label}>
              Origen
            </label>
            <select
              id="c-source"
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setPage(1);
              }}
              className={input}
            >
              <option value="">Todos</option>
              {sources.map((s) => (
                <option key={s.source} value={s.source}>
                  {s.source} ({s.count})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className={`text-sm ${muted}`}>{data ? `${data.total} contacto${data.total === 1 ? '' : 's'}` : 'Cargando…'}</p>
          <button type="button" onClick={() => setAdding((v) => !v)} className={btnSecondary}>
            <UserPlus className="h-4 w-4" /> Agregar contacto
          </button>
        </div>
        {adding && (
          <AddContactForm
            onClose={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              refresh();
            }}
          />
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}

        {/* Escritorio: tabla · Celular: tarjetas */}
        <div className="mt-4 hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm" aria-label="Lista de contactos">
            <thead className={`text-xs uppercase ${muted}`}>
              <tr>
                <th className="py-2 pr-3">Contacto</th>
                <th className="py-2 pr-3">Celular</th>
                <th className="py-2 pr-3">Origen</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3">Último masivo</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {data?.items.map((c) => (
                <tr key={c.id}>
                  <td className="py-2 pr-3">
                    <p className="font-semibold text-navy dark:text-slate-100">{c.name ?? 'Sin nombre'}</p>
                    {c.email && <p className={`text-xs ${muted}`}>{c.email}</p>}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">{c.phone}</td>
                  <td className="py-2 pr-3">{c.sourceDetail ?? '—'}</td>
                  <td className="py-2 pr-3">
                    <StatusPill status={c.status} />
                    {c.optOutChannel && <p className={`mt-0.5 text-xs ${muted}`}>{OPT_OUT_CHANNEL_LABEL[c.optOutChannel] ?? c.optOutChannel}</p>}
                  </td>
                  <td className="py-2 pr-3">{c.lastMarketingAt ? formatListDate(c.lastMarketingAt) : '—'}</td>
                  <td className="py-2 text-right">
                    {c.status !== 'opted_out' && (
                      <button type="button" onClick={() => setOptingOut(c)} className={btnGhost} aria-label={`Dar de baja a ${c.name ?? c.phone}`}>
                        <UserMinus className="h-4 w-4" /> Baja
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-4 space-y-2 md:hidden" aria-label="Lista de contactos (móvil)">
          {data?.items.map((c) => (
            <li key={c.id} className="rounded-xl border border-gray-200 p-3 dark:border-slate-800">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-navy dark:text-slate-100">{c.name ?? 'Sin nombre'}</p>
                  <p className={`text-sm ${muted}`}>{c.phone}</p>
                  <p className={`text-xs ${muted}`}>{c.sourceDetail ?? '—'}</p>
                </div>
                <StatusPill status={c.status} />
              </div>
              {c.status !== 'opted_out' && (
                <button type="button" onClick={() => setOptingOut(c)} className={`${btnGhost} mt-2 w-full`}>
                  <UserMinus className="h-4 w-4" /> Dar de baja
                </button>
              )}
            </li>
          ))}
        </ul>
        {data && data.items.length === 0 && <p className={`mt-4 text-sm ${muted}`}>No hay contactos con esos filtros.</p>}

        {pages > 1 && (
          <nav aria-label="Paginación de contactos" className="mt-4 flex items-center justify-end gap-2">
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

      {optingOut && (
        <OptOutDialog
          contact={optingOut}
          onClose={() => setOptingOut(null)}
          onDone={() => {
            setOptingOut(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function AddContactForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState('');
  const [consent, setConsent] = useState<'DOCUMENTED' | 'UNVERIFIED'>('UNVERIFIED');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await masivosApi.createContact({
        phone,
        name: name || undefined,
        email: email || undefined,
        source,
        consent,
        consentNote: consent === 'DOCUMENTED' ? note || undefined : undefined,
      });
      onSaved();
    } catch (err) {
      setError(errorText(err, 'No se pudo agregar el contacto'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} aria-label="Agregar contacto" className="mt-3 grid gap-3 rounded-xl border border-gray-200 p-4 sm:grid-cols-2 dark:border-slate-800">
      <div>
        <label htmlFor="nc-phone" className={label}>
          Celular
        </label>
        <input id="nc-phone" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="300 123 4567" inputMode="tel" className={input} />
      </div>
      <div>
        <label htmlFor="nc-name" className={label}>
          Nombre (opcional)
        </label>
        <input id="nc-name" value={name} onChange={(e) => setName(e.target.value)} className={input} />
      </div>
      <div>
        <label htmlFor="nc-email" className={label}>
          Correo (opcional)
        </label>
        <input id="nc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
      </div>
      <div>
        <label htmlFor="nc-source" className={label}>
          Origen
        </label>
        <input id="nc-source" required minLength={2} value={source} onChange={(e) => setSource(e.target.value)} placeholder="Ej.: referido, feria, consultoría" className={input} />
      </div>
      <fieldset className="sm:col-span-2">
        <legend className={label}>Autorización para marketing</legend>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
          <label className="tap inline-flex items-center gap-2 text-sm">
            <input type="radio" name="nc-consent" checked={consent === 'UNVERIFIED'} onChange={() => setConsent('UNVERIFIED')} /> Sin soporte (no verificado)
          </label>
          <label className="tap inline-flex items-center gap-2 text-sm">
            <input type="radio" name="nc-consent" checked={consent === 'DOCUMENTED'} onChange={() => setConsent('DOCUMENTED')} /> Hay soporte documental (verificado)
          </label>
        </div>
      </fieldset>
      {consent === 'DOCUMENTED' && (
        <div className="sm:col-span-2">
          <label htmlFor="nc-note" className={label}>
            ¿Dónde está el soporte?
          </label>
          <input id="nc-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={input} />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Guardar contacto
        </button>
        <button type="button" onClick={onClose} className={btnGhost}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function OptOutDialog({ contact, onClose, onDone }: { contact: MassContact; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await masivosApi.optOutContact(contact.id, note || undefined);
      onDone();
    } catch (err) {
      setError(errorText(err, 'No se pudo registrar la baja'));
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="optout-title" className={`${card} w-full max-w-md p-5`}>
        <div className="flex items-start justify-between gap-3">
          <h3 id="optout-title" className="font-semibold text-navy dark:text-slate-100">
            Dar de baja a {contact.name ?? contact.phone}
          </h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className={btnGhost}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className={`mt-2 text-sm ${muted}`}>
          No volverá a recibir campañas ni mensajes automáticos. La baja es permanente: solo la persona puede volver a autorizar escribiendo al WhatsApp.
        </p>
        <label htmlFor="optout-note" className={`${label} mt-3`}>
          Nota (opcional)
        </label>
        <input id="optout-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Ej.: pidió la baja por teléfono" className={input} />
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>
            Cancelar
          </button>
          <button type="button" onClick={() => void confirm()} disabled={busy} className={btnDanger}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar baja
          </button>
        </div>
      </div>
    </div>
  );
}
