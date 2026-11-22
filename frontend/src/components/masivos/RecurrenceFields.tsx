'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, Loader2 } from 'lucide-react';
import { errorText, input, label, muted } from '@/components/panel/ui';
import { formatDateTime } from '@/lib/format';
import { WEEK_DAYS, masivosApi, type Frequency, type Recurrence, type SchedulePreview } from '@/lib/masivos';

export const DEFAULT_RECURRENCE: Recurrence = {
  frequency: 'WEEKLY',
  daysOfWeek: [1],
  dayOfMonth: 1,
  timeOfDay: '08:00',
  startDate: null,
  endDate: null,
};

/** Regla lista para el backend (solo los campos de la frecuencia elegida) */
export function recurrencePayload(r: Recurrence) {
  return {
    frequency: r.frequency,
    timeOfDay: r.timeOfDay,
    ...(r.frequency === 'WEEKLY' ? { daysOfWeek: r.daysOfWeek } : {}),
    ...(r.frequency === 'MONTHLY' ? { dayOfMonth: r.dayOfMonth ?? 1 } : {}),
    ...(r.startDate ? { startDate: r.startDate } : {}),
    ...(r.endDate ? { endDate: r.endDate } : {}),
  };
}

interface Props {
  value: Recurrence;
  onChange: (value: Recurrence) => void;
  /** Avisa si la regla es válida (el backend la calculó) */
  onValidity: (preview: SchedulePreview | null) => void;
}

/**
 * Campos de una campaña recurrente (diaria, semanal o mensual a una hora de Colombia) con la vista
 * previa de las próximas ejecuciones calculada por el backend y el aviso de Ley 2300.
 */
export function RecurrenceFields({ value, onChange, onValidity }: Props) {
  const [preview, setPreview] = useState<{ key: string; data: SchedulePreview | null; error: string | null } | null>(null);
  const set = <K extends keyof Recurrence>(key: K, v: Recurrence[K]) => onChange({ ...value, [key]: v });
  const payload = recurrencePayload(value);
  const key = JSON.stringify(payload);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      masivosApi
        .schedulePreview(JSON.parse(key) as Partial<Recurrence>)
        .then((data) => {
          if (!alive) return;
          setPreview({ key, data, error: null });
          onValidity(data.runs.length ? data : null);
        })
        .catch((err: unknown) => {
          if (!alive) return;
          setPreview({ key, data: null, error: errorText(err) });
          onValidity(null);
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // onValidity es estable en el formulario; solo se recalcula cuando cambia la regla
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = preview?.key === key ? preview : null;

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-gray-200 p-3 dark:border-slate-700" data-testid="recurrence-fields">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="rf-frequency" className={label}>
            Frecuencia
          </label>
          <select id="rf-frequency" value={value.frequency} onChange={(e) => set('frequency', e.target.value as Frequency)} className={input}>
            <option value="DAILY">Todos los días</option>
            <option value="WEEKLY">Cada semana</option>
            <option value="MONTHLY">Cada mes</option>
          </select>
        </div>
        <div>
          <label htmlFor="rf-time" className={label}>
            Hora (Colombia)
          </label>
          <input id="rf-time" type="time" value={value.timeOfDay} onChange={(e) => set('timeOfDay', e.target.value)} className={input} />
        </div>
      </div>

      {value.frequency === 'WEEKLY' && (
        <fieldset>
          <legend className={label}>Días de la semana</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEK_DAYS.map((d) => {
              const on = value.daysOfWeek.includes(d.value);
              return (
                <label
                  key={d.value}
                  className={`tap inline-flex min-w-11 cursor-pointer items-center justify-center rounded-lg border px-2 text-sm font-semibold ${
                    on ? 'border-navy bg-navy text-[#fff] dark:border-gold dark:bg-gold dark:text-navy' : 'border-gray-300 dark:border-slate-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    aria-label={d.long}
                    checked={on}
                    onChange={() =>
                      set('daysOfWeek', on ? value.daysOfWeek.filter((x) => x !== d.value) : [...value.daysOfWeek, d.value].sort())
                    }
                  />
                  {d.short}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {value.frequency === 'MONTHLY' && (
        <div className="max-w-[12rem]">
          <label htmlFor="rf-dom" className={label}>
            Día del mes (1 a 28)
          </label>
          <input
            id="rf-dom"
            type="number"
            min={1}
            max={28}
            value={value.dayOfMonth ?? 1}
            onChange={(e) => set('dayOfMonth', Number(e.target.value))}
            className={input}
          />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="rf-start" className={label}>
            Desde (opcional)
          </label>
          <input id="rf-start" type="date" value={value.startDate ?? ''} onChange={(e) => set('startDate', e.target.value || null)} className={input} />
        </div>
        <div>
          <label htmlFor="rf-end" className={label}>
            Hasta (opcional)
          </label>
          <input id="rf-end" type="date" value={value.endDate ?? ''} onChange={(e) => set('endDate', e.target.value || null)} className={input} />
        </div>
      </div>

      <div aria-live="polite">
        {!current && (
          <p className={`flex items-center gap-2 text-xs ${muted}`}>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculando las próximas ejecuciones…
          </p>
        )}
        {current?.error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {current.error}
          </p>
        )}
        {current?.data && (
          <div className="text-sm" data-testid="recurrence-preview">
            <p className="flex items-center gap-2 font-semibold text-navy dark:text-slate-100">
              <CalendarClock className="h-4 w-4" aria-hidden="true" /> {current.data.description}
            </p>
            {current.data.runs.length === 0 ? (
              <p className="mt-1 text-red-700 dark:text-red-300">Con esas fechas no queda ninguna ejecución futura.</p>
            ) : (
              <ul className={`mt-1 space-y-0.5 text-xs ${muted}`} aria-label="Próximas ejecuciones">
                {current.data.runs.map((r) => (
                  <li key={r.at}>
                    {formatDateTime(r.at)}
                    {!r.insideWindow && (
                      <span className="ml-1 inline-flex items-center gap-1 text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" /> fuera del horario Ley 2300: empieza a enviar
                        {r.startsAt ? ` el ${formatDateTime(r.startsAt)}` : ' en la siguiente apertura'}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <p className={`text-xs ${muted}`}>
        En cada ejecución se crea una campaña nueva con la audiencia de ese momento (entran los contactos nuevos del origen elegido). Si la anterior
        sigue en curso o pausada, esa ejecución se omite para no duplicar envíos.
      </p>
    </div>
  );
}
