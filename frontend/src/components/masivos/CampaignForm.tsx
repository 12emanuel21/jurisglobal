'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, Loader2, Rocket, Search, X } from 'lucide-react';
import { btnGhost, btnPrimary, btnSecondary, card, errorText, input, label, muted } from '@/components/panel/ui';
import { useSudoMode } from '@/context/SudoContext';
import { apiErrorMessage } from '@/lib/api';
import {
  KIND_LABEL,
  bogotaLocalToIso,
  masivosApi,
  resolveVariables,
  type Audience,
  type CampaignPreview,
  type ImportPreview,
  type MassContact,
  type MassTemplate,
  type Recurrence,
  type SchedulePreview,
  type VariableRule,
} from '@/lib/masivos';
import { DEFAULT_RECURRENCE, RecurrenceFields, recurrencePayload } from './RecurrenceFields';
import { ContactImporter } from './ContactImporter';
import { WhatsAppPreview } from './WhatsAppPreview';

const EXAMPLE_NAME = 'Ana María Pérez';
type AudienceChoice = Audience['type'] | 'file';

interface Props {
  onClose: () => void;
  onCreated: (campaignId: string) => void;
  /** Se creó una campaña recurrente (no hay campaña todavía: la crea el worker en cada ejecución) */
  onScheduled?: (scheduleId: string) => void;
}

/**
 * Nueva campaña: plantilla, audiencia, variables y programación, con vista previa en vivo de
 * cuántos la reciben y cuántos quedan excluidos (baja, no verificado, tope de frecuencia).
 */
export function CampaignForm({ onClose, onCreated, onScheduled }: Props) {
  const { sudoFetch } = useSudoMode();
  const [templates, setTemplates] = useState<MassTemplate[] | null>(null);
  const [sources, setSources] = useState<Array<{ source: string; count: number }>>([]);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [audienceType, setAudienceType] = useState<AudienceChoice>('all');
  /** Archivo cargado desde la campaña: su primera fila alimenta el teléfono y sus orígenes, la audiencia */
  const [filePreview, setFilePreview] = useState<ImportPreview | null>(null);
  const [fileSources, setFileSources] = useState<string[]>([]);
  const [chosenSources, setChosenSources] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [mapping, setMapping] = useState<Record<string, VariableRule>>({});
  const [when, setWhen] = useState<'now' | 'later' | 'repeat'>('now');
  const [recurrence, setRecurrence] = useState<Recurrence>(DEFAULT_RECURRENCE);
  const [schedulePreview, setSchedulePreview] = useState<SchedulePreview | null>(null);
  const [scheduledLocal, setScheduledLocal] = useState('');
  const [dryRun, setDryRun] = useState(false);
  const [preview, setPreview] = useState<{ key: string; data: CampaignPreview | null; error: string | null } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    masivosApi
      .templates()
      .then((r) => setTemplates(r.items))
      .catch((err: unknown) => setError(errorText(err)));
    masivosApi
      .sources()
      .then(setSources)
      .catch(() => undefined);
  }, []);

  const usable = useMemo(() => (templates ?? []).filter((t) => t.problems.length === 0), [templates]);
  const template = usable.find((t) => t.id === templateId) ?? null;
  const audience: Audience = useMemo(
    () =>
      audienceType === 'source'
        ? { type: 'source', sources: chosenSources }
        : audienceType === 'file'
          ? { type: 'source', sources: fileSources }
          : audienceType === 'selection'
            ? { type: 'selection', contactIds: Object.keys(selected) }
            : { type: 'all' },
    [audienceType, chosenSources, fileSources, selected],
  );
  const variableMapping = useMemo(() => {
    const out: Record<string, VariableRule> = {};
    for (let i = 1; i <= (template?.variableCount ?? 0); i++) out[String(i)] = mapping[String(i)] ?? { type: 'firstName' };
    return out;
  }, [mapping, template]);

  const audienceReady =
    audienceType === 'all' ||
    (audienceType === 'source'
      ? chosenSources.length > 0
      : audienceType === 'file'
        ? fileSources.length > 0
        : Object.keys(selected).length > 0);
  const previewKey = JSON.stringify({ templateId, audience, variableMapping });
  const canPreview = Boolean(template) && audienceReady;

  // Vista previa en vivo (con espera corta mientras se escribe)
  useEffect(() => {
    if (!canPreview) return;
    let alive = true;
    const t = setTimeout(() => {
      masivosApi
        .preview({ templateId, audience, variableMapping })
        .then((data) => alive && setPreview({ key: previewKey, data, error: null }))
        .catch((err: unknown) => alive && setPreview({ key: previewKey, data: null, error: errorText(err) }));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [canPreview, previewKey, templateId, audience, variableMapping]);

  const current = canPreview && preview?.key === previewKey ? preview : null;

  // Teléfono de vista previa: primera fila del archivo cargado › primer contacto que la recibiría › ejemplo
  const fileName = audienceType === 'file' ? filePreview?.firstContact : null;
  const sampleName = fileName ? fileName.name : current?.data?.sampleContact ? current.data.sampleContact.name : EXAMPLE_NAME;
  const sampleCaption = fileName
    ? `Con la primera fila del archivo (${fileName.name ?? 'sin nombre'})`
    : current?.data?.sampleContact
      ? `Con el primer contacto que la recibirá (${current.data.sampleContact.name ?? 'sin nombre'})`
      : `Con un nombre de ejemplo (${EXAMPLE_NAME})`;
  const sampleParams = template ? resolveVariables(variableMapping, template.variableCount, sampleName) : [];
  const scheduledIso = when === 'later' && scheduledLocal ? bogotaLocalToIso(scheduledLocal) : undefined;
  const repeat = when === 'repeat';
  // Recurrente: basta con que la audiencia y la regla sean válidas (los destinatarios se recalculan en cada ejecución)
  const ready = Boolean(
    name.trim().length >= 3 &&
      current?.data &&
      (repeat ? schedulePreview && current.data.problems.length === 0 : current.data.recipients > 0 && (when === 'now' || scheduledIso)),
  );

  const launch = async () => {
    setBusy(true);
    setError(null);
    try {
      if (repeat) {
        const res = await sudoFetch('/admin/campaign-schedules', {
          method: 'POST',
          body: JSON.stringify({ name: name.trim(), templateId, audience, variableMapping, dryRun, recurrence: recurrencePayload(recurrence) }),
        });
        if (!res.ok) throw new Error((await apiErrorMessage(res, 'No se pudo crear la campaña recurrente')).message);
        onScheduled?.(((await res.json()) as { id: string }).id);
        return;
      }
      // Lanzar es sensible: con 2FA activo el backend pide el código (Sudo Mode) y sudoFetch lo solicita
      const res = await sudoFetch('/admin/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), templateId, audience, variableMapping, scheduledAt: scheduledIso, dryRun }),
      });
      if (!res.ok) throw new Error((await apiErrorMessage(res, 'No se pudo lanzar la campaña')).message);
      onCreated(((await res.json()) as { id: string }).id);
    } catch (err) {
      setError(errorText(err, 'No se pudo lanzar la campaña'));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const setVar = (n: number, rule: VariableRule) => setMapping((m) => ({ ...m, [String(n)]: rule }));

  return (
    <section aria-label="Nueva campaña" className={`${card} p-5`}>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-navy dark:text-slate-100">Nueva campaña</h3>
        <button type="button" onClick={onClose} aria-label="Cerrar" className={btnGhost}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <div>
            <label htmlFor="cf-name" className={label}>
              Nombre de la campaña
            </label>
            <input id="cf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ej.: Asesoría inicial · diciembre" className={input} />
          </div>
          <div>
            <label htmlFor="cf-template" className={label}>
              Plantilla aprobada
            </label>
            <select id="cf-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={input}>
              <option value="">Elige una plantilla…</option>
              {usable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.language}) · {KIND_LABEL[t.purpose]}
                </option>
              ))}
            </select>
            {templates && usable.length === 0 && (
              <p className={`mt-1 text-xs ${muted}`}>No hay plantillas listas: regístralas en la pestaña Plantillas (aprobadas en Meta).</p>
            )}
            {template?.purpose === 'OPT_IN' && (
              <p className={`mt-1 text-xs ${muted}`}>Confirmación de autorización: solo se envía a contactos no verificados.</p>
            )}
          </div>

          {template && template.variableCount > 0 && (
            <fieldset>
              <legend className={label}>Variables de la plantilla</legend>
              <div className="space-y-2">
                {Array.from({ length: template.variableCount }, (_, i) => i + 1).map((n) => {
                  const rule = variableMapping[String(n)];
                  return (
                    <div key={n} className="grid gap-2 sm:grid-cols-[60px_1fr_1fr] sm:items-center">
                      <span className="font-mono text-sm">{`{{${n}}}`}</span>
                      <select aria-label={`Valor de {{${n}}}`} value={rule.type} onChange={(e) => setVar(n, { ...rule, type: e.target.value as VariableRule['type'] })} className={input}>
                        <option value="firstName">Primer nombre del contacto</option>
                        <option value="fullName">Nombre completo del contacto</option>
                        <option value="literal">Texto fijo</option>
                      </select>
                      <input
                        aria-label={rule.type === 'literal' ? `Texto de {{${n}}}` : `Si no hay nombre ({{${n}}})`}
                        value={rule.value ?? ''}
                        onChange={(e) => setVar(n, { ...rule, value: e.target.value })}
                        placeholder={rule.type === 'literal' ? 'Texto fijo' : 'Si no hay nombre: cliente'}
                        className={input}
                      />
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend className={label}>Audiencia</legend>
            <div className="flex flex-col gap-1 sm:flex-row sm:gap-5">
              {(
                [
                  ['all', template?.purpose === 'OPT_IN' ? 'Todos los no verificados' : 'Todos los verificados'],
                  ['source', 'Por origen'],
                  ['selection', 'Selección'],
                  ['file', 'Desde un archivo (Excel/CSV)'],
                ] as const
              ).map(([value, text]) => (
                <label key={value} className="tap inline-flex items-center gap-2 text-sm">
                  <input type="radio" name="cf-audience" checked={audienceType === value} onChange={() => setAudienceType(value)} /> {text}
                </label>
              ))}
            </div>
            {audienceType === 'source' && (
              <div className="mt-2 flex flex-wrap gap-2">
                {sources.length === 0 && <p className={`text-xs ${muted}`}>No hay orígenes registrados.</p>}
                {sources.map((s) => {
                  const on = chosenSources.includes(s.source);
                  return (
                    <label key={s.source} className={`tap inline-flex items-center gap-2 rounded-xl border px-3 text-sm ${on ? 'border-navy bg-navy/5' : 'border-gray-300 dark:border-slate-700'}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setChosenSources((list) => (on ? list.filter((x) => x !== s.source) : [...list, s.source]))}
                      />
                      {s.source} ({s.count})
                    </label>
                  );
                })}
              </div>
            )}
            {audienceType === 'selection' && <ContactPicker selected={selected} onChange={setSelected} />}
            {audienceType === 'file' && (
              <div className="mt-2 space-y-2">
                <ContactImporter
                  title="Cargar la audiencia desde un archivo"
                  onPreview={setFilePreview}
                  onImported={(_summary, p) => {
                    setFileSources(p?.sources ?? []);
                    masivosApi
                      .sources()
                      .then(setSources)
                      .catch(() => undefined);
                  }}
                />
                {fileSources.length > 0 && (
                  <p className={`text-xs ${muted}`} data-testid="file-audience">
                    Audiencia: contactos con Origen {fileSources.map((x) => `«${x}»`).join(', ')} (se excluyen bajas y, en marketing, los no verificados).
                  </p>
                )}
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend className={label}>¿Cuándo?</legend>
            <div className="flex flex-col gap-1 sm:flex-row sm:gap-5">
              <label className="tap inline-flex items-center gap-2 text-sm">
                <input type="radio" name="cf-when" checked={when === 'now'} onChange={() => setWhen('now')} /> Lo antes posible
              </label>
              <label className="tap inline-flex items-center gap-2 text-sm">
                <input type="radio" name="cf-when" checked={when === 'later'} onChange={() => setWhen('later')} /> Programar
              </label>
              <label className="tap inline-flex items-center gap-2 text-sm">
                <input type="radio" name="cf-when" checked={repeat} onChange={() => setWhen('repeat')} /> Repetir (campaña recurrente)
              </label>
            </div>
            {repeat && <RecurrenceFields value={recurrence} onChange={setRecurrence} onValidity={setSchedulePreview} />}
            {when === 'later' && (
              <div className="mt-2 max-w-xs">
                <label htmlFor="cf-date" className={label}>
                  Fecha y hora (Colombia)
                </label>
                <input id="cf-date" type="datetime-local" value={scheduledLocal} onChange={(e) => setScheduledLocal(e.target.value)} className={input} />
              </div>
            )}
            <p className={`mt-1 text-xs ${muted}`}>
              Igual se respeta el horario de la Ley 2300 (L–V 7:00–19:00, sáb 8:00–15:00, sin domingos ni festivos): fuera de horario la campaña espera
              y se reanuda sola.
            </p>
          </fieldset>

          <label className="tap inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> Modo simulación (recorre horarios y topes sin enviar a
            Meta)
          </label>
        </div>

        <aside aria-label="Vista previa" className="space-y-3 rounded-2xl bg-gray-50 p-4 dark:bg-slate-800/50">
          <h4 className="text-sm font-bold text-navy dark:text-slate-100">Vista previa</h4>
          {!canPreview && <p className={`text-sm ${muted}`}>Elige una plantilla y la audiencia para ver a cuántos les llega.</p>}
          {canPreview && !current && (
            <p className={`flex items-center gap-2 text-sm ${muted}`}>
              <Loader2 className="h-4 w-4 animate-spin" /> Calculando…
            </p>
          )}
          {current?.error && (
            <p role="alert" className="text-sm text-red-700">
              {current.error}
            </p>
          )}
          {current?.data && <PreviewSummary preview={current.data} />}
          {template ? (
            <WhatsAppPreview
              header={template.headerText}
              body={template.bodyText}
              footer={template.footerText}
              buttons={template.buttons.map((b) => b.text)}
              params={sampleParams}
              caption={sampleCaption}
            />
          ) : (
            <p className={`text-xs ${muted}`}>Al elegir la plantilla verás aquí cómo le llega el mensaje al contacto.</p>
          )}
        </aside>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {!confirming ? (
          <button type="button" disabled={!ready} onClick={() => setConfirming(true)} className={btnPrimary}>
            <Rocket className="h-4 w-4" /> {repeat ? 'Crear campaña recurrente' : when === 'later' ? 'Programar campaña' : 'Lanzar campaña'}
          </button>
        ) : (
          <div role="group" aria-label="Confirmar lanzamiento" className="flex flex-wrap items-center gap-2 rounded-xl border border-gold/60 bg-[#fdf8ec] p-3 dark:bg-gold/10">
            {repeat ? (
              <p className="text-sm text-navy dark:text-slate-100">
                <strong>{schedulePreview?.description}</strong>: en cada ejecución se crea una campaña con la audiencia de ese momento (hoy{' '}
                {current?.data?.recipients ?? 0} contactos){dryRun ? ', en simulación' : ''}. ¿Confirmas?
              </p>
            ) : (
              <p className="text-sm text-navy dark:text-slate-100">
                Se enviará a <strong>{current?.data?.recipients ?? 0}</strong> contactos{dryRun ? ' (simulación, sin llamar a Meta)' : ''}. ¿Confirmas?
              </p>
            )}
            <button type="button" onClick={() => void launch()} disabled={busy} className={btnPrimary}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {repeat ? 'Confirmar y programar' : 'Confirmar y lanzar'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={btnGhost}>
              Volver
            </button>
          </div>
        )}
        <button type="button" onClick={onClose} className={btnSecondary}>
          Cancelar
        </button>
      </div>
    </section>
  );
}

export function PreviewSummary({ preview }: { preview: CampaignPreview }) {
  const row = (text: string, value: number, testId: string) => (
    <li className="flex justify-between gap-2">
      <span>{text}</span>
      <strong data-testid={testId}>{value}</strong>
    </li>
  );
  return (
    <div className="space-y-3 text-sm">
      <p>
        <span className="font-serif text-3xl font-bold text-navy dark:text-slate-100" data-testid="preview-recipients">
          {preview.recipients}
        </span>{' '}
        de {preview.total} contactos recibirán el mensaje
      </p>
      <div>
        <p className="font-semibold">Excluidos: {preview.excluded.total}</p>
        <ul className={`mt-1 space-y-1 ${muted}`}>
          {row('Por baja (STOP o supresión)', preview.excluded.optedOut, 'preview-optedout')}
          {preview.kind === 'MARKETING'
            ? row('Por no verificado (sin soporte de autorización)', preview.excluded.unverified, 'preview-unverified')
            : row('Ya verificados (no necesitan confirmar)', preview.excluded.alreadyVerified, 'preview-verified')}
        </ul>
      </div>
      {preview.frequencyCapped > 0 && (
        <p className="flex items-start gap-2 text-amber-800 dark:text-amber-300" data-testid="preview-capped">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {preview.frequencyCapped} ya alcanzaron su tope de frecuencia: se les enviará cuando se libere
          su cupo (día o semana).
        </p>
      )}
      {(preview.warnings ?? []).map((w) => (
        <p key={w} className="flex items-start gap-2 text-xs text-[#1e3a8a] dark:text-[#bfdbfe]" data-testid="preview-warning">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> Aviso (no bloquea): {w}
        </p>
      ))}
    </div>
  );
}

function ContactPicker({ selected, onChange }: { selected: Record<string, string>; onChange: (s: Record<string, string>) => void }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<MassContact[]>([]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      masivosApi
        .contacts({ q: search.trim(), pageSize: 20 })
        .then((r) => alive && setResults(r.items.filter((c) => c.status !== 'opted_out')))
        .catch(() => undefined);
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [search]);

  const toggle = (c: MassContact) => {
    const next = { ...selected };
    if (next[c.id]) delete next[c.id];
    else next[c.id] = c.name ?? c.phone;
    onChange(next);
  };

  return (
    <div className="mt-2 space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
        <input aria-label="Buscar contactos para la selección" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre o celular" className={`${input} pl-9`} />
      </div>
      <p className={`text-xs ${muted}`}>{Object.keys(selected).length} seleccionados</p>
      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {results.map((c) => (
          <li key={c.id}>
            <label className="tap flex items-center gap-2 rounded-lg px-2 text-sm hover:bg-gray-100 dark:hover:bg-slate-800">
              <input type="checkbox" checked={Boolean(selected[c.id])} onChange={() => toggle(c)} />
              <span className="flex-1">{c.name ?? 'Sin nombre'}</span>
              <span className={`text-xs ${muted}`}>{c.phone}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
