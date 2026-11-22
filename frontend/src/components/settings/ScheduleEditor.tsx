'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { DAY_LABELS, LEY_2300_LIMITS, settingsApi, type EditableSettings, type Holiday, type SendWindow } from '@/lib/admin-settings';
import { btnPrimary, btnSecondary, card, errorText, input, label, muted } from '@/components/panel/ui';
import { SaveFeedback, type Feedback } from './SaveFeedback';

/** Orden de la semana colombiana: lunes primero */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * Horarios de envío (Ley 2300, hora de Colombia), festivos y topes de envío. Lo usarán los masivos
 * de la Etapa 6; el servidor no acepta franjas por fuera de la ley.
 */
export function ScheduleEditor({ settings, onSaved }: { settings: EditableSettings; onSaved: (s: EditableSettings) => void }) {
  return (
    <div className="space-y-6">
      <WindowsSection />
      <CapsSection settings={settings} onSaved={onSaved} />
      <HolidaysSection />
    </div>
  );
}

function WindowsSection() {
  const [windows, setWindows] = useState<SendWindow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    settingsApi
      .windows()
      .then(setWindows)
      .catch((err: unknown) => setFeedback({ ok: false, text: errorText(err) }));
  }, []);

  const update = (day: number, patch: Partial<SendWindow>) =>
    setWindows((list) => list?.map((w) => (w.dayOfWeek === day ? { ...w, ...patch } : w)) ?? list);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!windows) return;
    setBusy(true);
    setFeedback(null);
    try {
      setWindows(await settingsApi.updateWindows(windows));
      setFeedback({ ok: true, text: 'Horarios guardados.' });
    } catch (err) {
      setFeedback({ ok: false, text: errorText(err, 'No se pudieron guardar los horarios') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className={`${card} p-5`}>
      <h3 className="text-sm font-bold text-navy dark:text-slate-100">Horarios de envío (Ley 2300, hora de Colombia)</h3>
      <p className={`mt-1 text-xs ${muted}`}>Máximo permitido: lunes a viernes 7:00–19:00 y sábados 8:00–15:00. Domingos y festivos, sin envíos.</p>
      {!windows ? (
        <p className={`mt-4 flex items-center gap-2 text-sm ${muted}`}>
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {WEEK_ORDER.map((day) => {
            const w = windows.find((x) => x.dayOfWeek === day);
            if (!w) return null;
            const limit = LEY_2300_LIMITS[day];
            return (
              <fieldset key={day} className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 sm:grid-cols-[8rem_1fr_1fr_auto] dark:border-slate-800">
                <legend className="sr-only">{DAY_LABELS[day]}</legend>
                <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{DAY_LABELS[day]}</span>
                <label className="tap inline-flex items-center justify-end gap-2 text-xs font-semibold text-gray-700 sm:order-last dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={w.enabled}
                    disabled={!limit}
                    onChange={(e) => update(day, { enabled: e.target.checked })}
                    className="h-5 w-5 accent-[#0b1f3a]"
                    aria-label={`${DAY_LABELS[day]} habilitado`}
                  />
                  {limit ? 'Habilitado' : 'Sin envíos (ley)'}
                </label>
                <label className="text-xs text-gray-600 dark:text-slate-400">
                  Abre
                  <input type="time" value={w.opensAt} min={limit?.opensAt} max={limit?.closesAt} disabled={!limit || !w.enabled} onChange={(e) => update(day, { opensAt: e.target.value })} className={input} aria-label={`${DAY_LABELS[day]} abre`} />
                </label>
                <label className="text-xs text-gray-600 dark:text-slate-400">
                  Cierra
                  <input type="time" value={w.closesAt} min={limit?.opensAt} max={limit?.closesAt} disabled={!limit || !w.enabled} onChange={(e) => update(day, { closesAt: e.target.value })} className={input} aria-label={`${DAY_LABELS[day]} cierra`} />
                </label>
              </fieldset>
            );
          })}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || !windows} className={btnPrimary}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Guardar horarios
        </button>
        <SaveFeedback feedback={feedback} />
      </div>
    </form>
  );
}

function CapsSection({ settings, onSaved }: { settings: EditableSettings; onSaved: (s: EditableSettings) => void }) {
  const [perDay, setPerDay] = useState(String(settings['marketing.maxPerContactPerDay']));
  const [perWeek, setPerWeek] = useState(String(settings['marketing.maxPerContactPerWeek']));
  const [global, setGlobal] = useState(String(settings['marketing.dailyGlobalLimit']));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      onSaved(
        await settingsApi.update({
          'marketing.maxPerContactPerDay': Number(perDay),
          'marketing.maxPerContactPerWeek': Number(perWeek),
          'marketing.dailyGlobalLimit': Number(global),
        }),
      );
      setFeedback({ ok: true, text: 'Topes guardados.' });
    } catch (err) {
      setFeedback({ ok: false, text: errorText(err, 'No se pudieron guardar los topes') });
    } finally {
      setBusy(false);
    }
  };

  const field = (id: string, text: string, value: string, set: (v: string) => void, max: number) => (
    <div>
      <label htmlFor={id} className={label}>
        {text}
      </label>
      <input id={id} type="number" min={1} max={max} step={1} value={value} onChange={(e) => set(e.target.value)} className={input} />
    </div>
  );

  return (
    <form onSubmit={save} className={`${card} p-5`}>
      <h3 className="text-sm font-bold text-navy dark:text-slate-100">Topes de envío de masivos</h3>
      <p className={`mt-1 text-xs ${muted}`}>Se aplican a las campañas de la Etapa 6.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {field('cap-day', 'Máximo por contacto al día', perDay, setPerDay, 5)}
        {field('cap-week', 'Máximo por contacto a la semana', perWeek, setPerWeek, 14)}
        {field('cap-global', 'Límite diario global', global, setGlobal, 10000)}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Guardar topes
        </button>
        <SaveFeedback feedback={feedback} />
      </div>
    </form>
  );
}

function HolidaysSection() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [holidays, setHolidays] = useState<Holiday[] | null>(null);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const load = useCallback(
    (y: number) =>
      settingsApi
        .holidays(y)
        .then(setHolidays)
        .catch((err: unknown) => setFeedback({ ok: false, text: errorText(err) })),
    [],
  );

  useEffect(() => {
    void load(year);
  }, [load, year]);

  const run = async (action: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      await load(year);
      setFeedback({ ok: true, text: ok });
      return true;
    } catch (err) {
      setFeedback({ ok: false, text: errorText(err, 'No se pudo guardar') });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => settingsApi.createHoliday(date, name.trim()), 'Festivo agregado.')) {
      setDate('');
      setName('');
    }
  };

  const fmt = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });

  return (
    <section className={`${card} p-5`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-navy dark:text-slate-100">Festivos de Colombia</h3>
          <p className={`mt-1 text-xs ${muted}`}>Los oficiales se cargan solos; al quitarlos quedan desactivados. Los agregados a mano se borran.</p>
        </div>
        <div className="flex gap-2" role="group" aria-label="Año">
          {[thisYear, thisYear + 1].map((y) => (
            <button key={y} type="button" onClick={() => setYear(y)} aria-pressed={year === y} className={year === y ? btnPrimary : btnSecondary}>
              {y}
            </button>
          ))}
        </div>
      </div>
      {!holidays ? (
        <p className={`mt-4 flex items-center gap-2 text-sm ${muted}`}>
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-slate-800 dark:border-slate-800">
          {holidays.length === 0 && <li className={`px-3 py-3 text-sm ${muted}`}>Sin festivos cargados para {year}.</li>}
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-3 py-1.5">
              <span className={`w-28 shrink-0 text-sm tabular-nums ${h.enabled ? 'text-gray-900 dark:text-slate-100' : 'text-gray-400 line-through'}`}>{fmt(h.date)}</span>
              <span className={`min-w-0 flex-1 truncate text-sm ${h.enabled ? 'text-gray-800 dark:text-slate-200' : 'text-gray-400 line-through'}`}>
                {h.name}
                {h.source === 'MANUAL' && <span className="ml-2 rounded bg-[#fdf8ec] px-1.5 py-0.5 text-[10px] font-bold text-gold-700">MANUAL</span>}
              </span>
              {h.enabled ? (
                <button type="button" disabled={busy} onClick={() => void run(() => settingsApi.removeHoliday(h.id), `«${h.name}» quitado.`)} className="tap inline-flex w-11 items-center justify-center rounded-lg text-red-700 hover:bg-red-50" aria-label={`Quitar ${h.name}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => void run(() => settingsApi.setHolidayEnabled(h.id, true), `«${h.name}» restaurado.`)} className="tap inline-flex w-11 items-center justify-center rounded-lg text-navy hover:bg-gray-100 dark:text-slate-200" aria-label={`Restaurar ${h.name}`}>
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="mt-4 grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
        <div>
          <label htmlFor="holiday-date" className={label}>
            Fecha
          </label>
          <input id="holiday-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor="holiday-name" className={label}>
            Nombre
          </label>
          <input id="holiday-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Cierre de fin de año" className={input} />
        </div>
        <button type="submit" disabled={busy || !date || !name.trim()} className={btnPrimary}>
          <Plus className="h-4 w-4" /> Agregar festivo
        </button>
      </form>
      <div className="mt-3">
        <SaveFeedback feedback={feedback} />
      </div>
    </section>
  );
}
