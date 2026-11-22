'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Ban, Loader2, Mail, MessagesSquare, Phone, ShieldOff, X } from 'lucide-react';
import { useSudoMode } from '@/context/SudoContext';
import { apiErrorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import {
  CONSENT_PURPOSE_LABEL,
  LEAD_STATUSES,
  ORIGIN_LABEL,
  STATUS_BADGE,
  STATUS_LABEL,
  leadsApi,
  type LeadDetail as Detail,
  type LeadStatus,
  type Person,
} from '@/lib/leads';
import { btnPrimary, btnSecondary, card, errorText, input, label, muted } from '@/components/panel/ui';
import { AnonymizeDialog } from './AnonymizeDialog';

/** "+573001234567" -> "+57 300 123 4567" */
export function displayLeadPhone(phone: string | null): string {
  if (!phone) return '—';
  const m = /^\+57(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return m ? `+57 ${m[1]} ${m[2]} ${m[3]}` : phone;
}

/**
 * Detalle del lead (panel lateral): datos, envíos, estado, responsable, notas internas,
 * autorizaciones (Consent) y acceso al chat del Inbox. Anonimizar: solo ADMIN.
 */
export function LeadDetail({
  leadId,
  isAdmin,
  assignees,
  onClose,
  onChanged,
  refreshKey = 0,
}: {
  leadId: string;
  isAdmin: boolean;
  assignees: Person[];
  onClose: () => void;
  /** Avisa al listado que algo cambió (estado, responsable, notas, anonimización) */
  onChanged: () => void;
  /** Cambia cuando llega un evento en tiempo real de este lead */
  refreshKey?: number;
}) {
  const { sudoFetch } = useSudoMode();
  const [lead, setLead] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(() => {
    leadsApi
      .detail(leadId)
      .then((data) => {
        setLead(data);
        setError(null);
      })
      .catch((err: unknown) => setError(errorText(err, 'No se pudo cargar el lead')));
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !confirming && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, confirming]);

  const save = async (patch: { status?: LeadStatus; assignedToId?: string | null }) => {
    setSaving(true);
    setSaveError(null);
    try {
      setLead(await leadsApi.update(leadId, patch));
      onChanged();
    } catch (err) {
      setSaveError(errorText(err, 'No se pudo guardar el cambio'));
    } finally {
      setSaving(false);
    }
  };

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    setNoteBusy(true);
    setSaveError(null);
    try {
      const created = await leadsApi.addNote(leadId, note.trim());
      setLead((current) => (current ? { ...current, notes: [created, ...current.notes] } : current));
      setNote('');
      onChanged();
    } catch (err) {
      setSaveError(errorText(err, 'No se pudo guardar la nota'));
    } finally {
      setNoteBusy(false);
    }
  };

  const anonymize = async () => {
    const res = await sudoFetch(`/admin/leads/${leadId}/anonymize`, { method: 'POST' });
    if (!res.ok) throw new Error((await apiErrorMessage(res, 'No se pudo anonimizar')).message);
    setLead((await res.json()) as Detail);
    setConfirming(false);
    onChanged();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-gray-900/40" role="presentation" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-detail-title"
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-xl flex-col overflow-hidden bg-gray-50 shadow-2xl dark:bg-[#0b1626]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-gray-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gold-700 dark:text-gold-400">Detalle del lead</p>
            <h2 id="lead-detail-title" className="truncate font-serif text-xl font-bold text-navy dark:text-slate-100">
              {lead?.fullName ?? 'Cargando…'}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar detalle" className="tap inline-flex w-11 items-center justify-center rounded-xl text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {error && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          )}
          {!lead && !error && (
            <p className={`flex items-center gap-2 text-sm ${muted}`}>
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </p>
          )}

          {lead && (
            <>
              <section className={`${card} space-y-3 p-4`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${STATUS_BADGE[lead.status]}`}>{STATUS_LABEL[lead.status]}</span>
                  {lead.optedOut && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-800 ring-1 ring-red-200">
                      <Ban className="h-3 w-3" /> Baja de mensajes
                    </span>
                  )}
                  {lead.anonymizedAt && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-800">
                      <ShieldOff className="h-3 w-3" /> Anonimizado el {formatDateTime(lead.anonymizedAt)}
                    </span>
                  )}
                </div>
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <Field label="Teléfono">
                    {lead.phone ? (
                      <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1 font-medium text-navy underline-offset-2 hover:underline dark:text-slate-100">
                        <Phone className="h-3.5 w-3.5" /> {displayLeadPhone(lead.phone)}
                      </a>
                    ) : (
                      '—'
                    )}
                  </Field>
                  <Field label="Correo">
                    {lead.email ? (
                      <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1 break-all font-medium text-navy underline-offset-2 hover:underline dark:text-slate-100">
                        <Mail className="h-3.5 w-3.5 shrink-0" /> {lead.email}
                      </a>
                    ) : (
                      '—'
                    )}
                  </Field>
                  <Field label="Motivo">{lead.motivo.name}</Field>
                  <Field label="Origen">
                    {ORIGIN_LABEL[lead.origin]}
                    {lead.lastOrigin !== lead.origin && ` · último: ${ORIGIN_LABEL[lead.lastOrigin]}`}
                  </Field>
                  <Field label="Envíos">
                    {lead.submissionCount} {lead.submissionCount === 1 ? 'envío' : `envíos (${lead.submissionCount - 1} recontacto${lead.submissionCount > 2 ? 's' : ''})`}
                  </Field>
                  <Field label="Registro / último envío">
                    {formatDateTime(lead.createdAt)} · {formatDateTime(lead.lastSubmittedAt)}
                  </Field>
                </dl>
                {lead.conversationId && (
                  <Link href={`/panel/conversaciones?c=${lead.conversationId}`} className={`${btnSecondary} w-full sm:w-auto`}>
                    <MessagesSquare className="h-4 w-4" /> Abrir chat en el Inbox
                  </Link>
                )}
              </section>

              <section className={`${card} grid gap-3 p-4 sm:grid-cols-2`} aria-label="Gestión">
                <div>
                  <label htmlFor="lead-status" className={label}>
                    Estado
                  </label>
                  <select id="lead-status" value={lead.status} disabled={saving} onChange={(e) => void save({ status: e.target.value as LeadStatus })} className={input}>
                    {LEAD_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="lead-assignee" className={label}>
                    Responsable
                  </label>
                  <select id="lead-assignee" value={lead.assignedTo?.id ?? ''} disabled={saving} onChange={(e) => void save({ assignedToId: e.target.value || null })} className={input}>
                    <option value="">Sin responsable</option>
                    {assignees.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                        {u.role === 'ADMIN' ? ' (Administrador)' : ''}
                      </option>
                    ))}
                    {lead.assignedTo && !assignees.some((u) => u.id === lead.assignedTo?.id) && <option value={lead.assignedTo.id}>{lead.assignedTo.name}</option>}
                  </select>
                </div>
                {saveError && (
                  <p role="alert" className="text-sm text-red-700 sm:col-span-2">
                    {saveError}
                  </p>
                )}
              </section>

              <section className={`${card} space-y-3 p-4`}>
                <h3 className="text-sm font-bold text-navy dark:text-slate-100">Notas internas</h3>
                <form onSubmit={addNote} className="space-y-2">
                  <label htmlFor="lead-note" className="sr-only">
                    Nueva nota
                  </label>
                  <textarea
                    id="lead-note"
                    rows={3}
                    maxLength={2000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Ej.: Llamé, quedó de enviar el comparendo."
                    className={`${input} py-2`}
                  />
                  <button type="submit" disabled={noteBusy || !note.trim()} className={btnPrimary}>
                    {noteBusy && <Loader2 className="h-4 w-4 animate-spin" />} Agregar nota
                  </button>
                </form>
                {lead.notes.length === 0 ? (
                  <p className={`text-sm ${muted}`}>Aún no hay notas.</p>
                ) : (
                  <ol className="space-y-2">
                    {lead.notes.map((n) => (
                      <li key={n.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950">
                        <p className="whitespace-pre-wrap text-gray-800 dark:text-slate-200">{n.body}</p>
                        <p className={`mt-1 text-xs ${muted}`}>
                          {n.author?.name ?? 'Sistema'} · {formatDateTime(n.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section className={`${card} space-y-3 p-4`}>
                <h3 className="text-sm font-bold text-navy dark:text-slate-100">Autorizaciones (Ley 1581)</h3>
                {lead.consents.length === 0 ? (
                  <p className={`text-sm ${muted}`}>Sin registros.</p>
                ) : (
                  <ol className="relative space-y-3 border-l-2 border-gold/50 pl-4">
                    {lead.consents.map((c) => (
                      <li key={c.id} className="text-sm">
                        <p className="font-semibold text-gray-900 dark:text-slate-100">
                          {c.granted ? '✅' : '⛔'} {CONSENT_PURPOSE_LABEL[c.purpose]} · {c.granted ? 'Aceptó' : 'Revocó / no aceptó'}
                        </p>
                        <p className={`text-xs ${muted}`}>
                          {ORIGIN_LABEL[c.channel]} · {formatDateTime(c.createdAt)} · versión {c.textVersion}
                        </p>
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs font-medium text-navy dark:text-slate-300">Ver texto aceptado</summary>
                          <p className="mt-1 whitespace-pre-wrap rounded-lg bg-gray-50 p-2 text-xs text-gray-700 dark:bg-slate-950 dark:text-slate-300">{c.textSnapshot}</p>
                        </details>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              {isAdmin && !lead.anonymizedAt && (
                <section className="rounded-2xl border border-red-200 bg-red-50/60 p-4 dark:border-red-900 dark:bg-red-950/30">
                  <h3 className="text-sm font-bold text-red-800 dark:text-red-300">Zona de datos personales</h3>
                  <p className="mt-1 text-xs text-red-900/80 dark:text-red-200/80">Úsala solo cuando el titular pida la supresión de sus datos.</p>
                  <button type="button" onClick={() => setConfirming(true)} className="tap mt-3 inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-4 text-sm font-semibold text-red-800 hover:bg-red-50 dark:border-red-800 dark:bg-transparent dark:text-red-300">
                    <ShieldOff className="h-4 w-4" /> Anonimizar datos personales
                  </button>
                </section>
              )}
            </>
          )}
        </div>
        {/* Dentro del panel: los clics del diálogo no llegan al fondo (que cierra el detalle) */}
        {confirming && lead && <AnonymizeDialog leadName={lead.fullName} onConfirm={anonymize} onCancel={() => setConfirming(false)} />}
      </aside>
    </div>
  );
}

function Field({ label: text, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-500">{text}</dt>
      <dd className="mt-0.5 text-gray-900 dark:text-slate-100">{children}</dd>
    </div>
  );
}
