'use client';

import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Loader2, Pencil, Plus, X } from 'lucide-react';
import { settingsApi, type AdminMotivo } from '@/lib/admin-settings';
import { btnPrimary, btnSecondary, card, errorText, input, label, muted } from '@/components/panel/ui';
import { SaveFeedback, type Feedback } from './SaveFeedback';

/** Límite del título de un botón de WhatsApp (el bot muestra botones si hay 3 o menos activos) */
export const MOTIVO_MAX_LENGTH = 20;

/**
 * Motivos de consulta: crear, renombrar, reordenar y activar/desactivar. Se reflejan de inmediato
 * en el formulario web (/public/config) y en el chatbot. Los motivos con leads no se borran.
 */
export function MotivosEditor() {
  const [motivos, setMotivos] = useState<AdminMotivo[] | null>(null);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    settingsApi
      .motivos()
      .then(setMotivos)
      .catch((err: unknown) => setFeedback({ ok: false, text: errorText(err) }));
  }, []);

  const run = async (action: () => Promise<AdminMotivo[]>, ok: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      setMotivos(await action());
      setFeedback({ ok: true, text: ok });
      return true;
    } catch (err) {
      setFeedback({ ok: false, text: errorText(err, 'No se pudo guardar') });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (await run(() => settingsApi.createMotivo(name), `Motivo «${name}» creado.`)) setNewName('');
  };

  const move = (index: number, delta: number) => {
    if (!motivos) return;
    const ids = motivos.map((m) => m.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved);
    void run(() => settingsApi.reorderMotivos(ids), 'Orden guardado.');
  };

  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const name = editing.name.trim();
    if (await run(() => settingsApi.updateMotivo(editing.id, { name }), 'Nombre guardado.')) setEditing(null);
  };

  const activeCount = motivos?.filter((m) => m.isActive).length ?? 0;

  return (
    <div className="space-y-4">
      <section className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-navy dark:text-slate-100">Motivos de consulta</h3>
        <p className={`mt-1 text-xs ${muted}`}>
          El orden es el del formulario web y del chatbot. Con 3 motivos activos o menos el bot muestra botones; con más, una lista.
        </p>
        {!motivos && !feedback && (
          <p className={`mt-4 flex items-center gap-2 text-sm ${muted}`}>
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </p>
        )}
        {motivos && (
          <ol className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-slate-800 dark:border-slate-800" aria-label="Motivos">
            {motivos.map((m, i) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid={`motivo-${m.name}`}>
                <span className={`w-6 text-center text-xs font-bold ${muted}`}>{i + 1}</span>
                {editing?.id === m.id ? (
                  <form onSubmit={rename} className="flex min-w-0 flex-1 items-center gap-2">
                    <label htmlFor={`rename-${m.id}`} className="sr-only">
                      Nuevo nombre de {m.name}
                    </label>
                    <input
                      id={`rename-${m.id}`}
                      autoFocus
                      maxLength={MOTIVO_MAX_LENGTH}
                      value={editing.name}
                      onChange={(e) => setEditing({ id: m.id, name: e.target.value })}
                      className={input}
                    />
                    <button type="submit" disabled={busy} className={btnPrimary} aria-label="Guardar nombre">
                      <Check className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className={btnSecondary} aria-label="Cancelar">
                      <X className="h-4 w-4" />
                    </button>
                  </form>
                ) : (
                  <>
                    <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${m.isActive ? 'text-gray-900 dark:text-slate-100' : 'text-gray-400 line-through dark:text-slate-500'}`}>
                      {m.name}
                    </span>
                    <span className={`text-xs ${muted}`}>
                      {m.leadCount} lead{m.leadCount === 1 ? '' : 's'}
                    </span>
                    <button type="button" onClick={() => setEditing({ id: m.id, name: m.name })} className="tap inline-flex w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800" aria-label={`Renombrar ${m.name}`}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" disabled={busy || i === 0} onClick={() => move(i, -1)} className="tap inline-flex w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-800" aria-label={`Subir ${m.name}`}>
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button type="button" disabled={busy || i === motivos.length - 1} onClick={() => move(i, 1)} className="tap inline-flex w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-800" aria-label={`Bajar ${m.name}`}>
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <label className="tap inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 text-xs font-semibold text-gray-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={m.isActive}
                        disabled={busy || (m.isActive && activeCount <= 1)}
                        onChange={(e) =>
                          void run(() => settingsApi.updateMotivo(m.id, { isActive: e.target.checked }), e.target.checked ? `«${m.name}» activado.` : `«${m.name}» desactivado.`)
                        }
                        className="h-5 w-5 accent-[#0b1f3a]"
                        aria-label={`${m.name} activo`}
                      />
                      Activo
                    </label>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
        <form onSubmit={create} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="new-motivo" className={label}>
              Nuevo motivo (máx. {MOTIVO_MAX_LENGTH} caracteres)
            </label>
            <input id="new-motivo" maxLength={MOTIVO_MAX_LENGTH} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ej.: Sucesiones" className={input} />
          </div>
          <button type="submit" disabled={busy || !newName.trim()} className={btnPrimary}>
            <Plus className="h-4 w-4" /> Agregar
          </button>
        </form>
      </section>
      <SaveFeedback feedback={feedback} />
    </div>
  );
}
