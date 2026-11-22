'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { btnGhost, btnPrimary, btnSecondary, card, errorText, input, label, muted } from '@/components/panel/ui';
import { SaveFeedback, type Feedback } from '@/components/settings/SaveFeedback';
import {
  BUTTON_ROLE_LABEL,
  KIND_LABEL,
  masivosApi,
  templateVariables,
  type ButtonRole,
  type MassTemplate,
  type TemplateInput,
} from '@/lib/masivos';

const EMPTY: TemplateInput = {
  name: '',
  language: 'es_CO',
  category: 'MARKETING',
  purpose: 'MARKETING',
  status: 'APPROVED',
  bodyText: '',
  footerText: '',
  buttons: [],
};

const toInput = (t: MassTemplate): TemplateInput => ({
  name: t.name,
  language: t.language,
  category: t.category === 'UTILITY' ? 'UTILITY' : 'MARKETING',
  purpose: t.purpose,
  status: t.status,
  bodyText: t.bodyText,
  footerText: t.footerText ?? '',
  buttons: t.buttons,
});

/** Plantillas aprobadas en Meta: metadatos que usa el worker para enviar y reconocer los botones */
export function TemplatesTab() {
  const [items, setItems] = useState<MassTemplate[] | null>(null);
  const [canSync, setCanSync] = useState(false);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<MassTemplate | 'new' | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let alive = true;
    masivosApi
      .templates()
      .then((r) => {
        if (!alive) return;
        setItems(r.items);
        setCanSync(r.canSync);
      })
      .catch((err: unknown) => alive && setFeedback({ ok: false, text: errorText(err, 'No se pudieron cargar las plantillas') }));
    return () => {
      alive = false;
    };
  }, [reload]);

  const sync = async () => {
    setSyncing(true);
    setFeedback(null);
    try {
      const r = await masivosApi.syncTemplates();
      setFeedback({ ok: true, text: `Sincronizadas desde Meta: ${r.created} nuevas, ${r.updated} actualizadas.` });
      setReload((n) => n + 1);
    } catch (err) {
      setFeedback({ ok: false, text: errorText(err, 'No se pudo sincronizar con Meta') });
    } finally {
      setSyncing(false);
    }
  };

  const remove = async (t: MassTemplate) => {
    if (!window.confirm(`¿Eliminar la plantilla «${t.name}»?`)) return;
    try {
      await masivosApi.deleteTemplate(t.id);
      setReload((n) => n + 1);
    } catch (err) {
      setFeedback({ ok: false, text: errorText(err) });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`max-w-prose text-sm ${muted}`}>
          Las plantillas se crean y aprueban en el administrador de WhatsApp de Meta. Aquí se registran sus datos (o se sincronizan) para usarlas en
          campañas. Toda plantilla necesita una opción de baja: un botón con rol «Baja» o un pie que diga cómo darse de baja (STOP).
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void sync()}
            disabled={!canSync || syncing}
            className={btnSecondary}
            title={canSync ? 'Traer las plantillas de la cuenta de WhatsApp' : 'Requiere WHATSAPP_WABA_ID y WHATSAPP_ACCESS_TOKEN'}
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sincronizar con Meta
          </button>
          <button type="button" onClick={() => setEditing('new')} className={btnPrimary}>
            <Plus className="h-4 w-4" /> Nueva plantilla
          </button>
        </div>
      </div>
      <SaveFeedback feedback={feedback} />
      {editing && (
        <TemplateForm
          template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReload((n) => n + 1);
          }}
        />
      )}
      {items && items.length === 0 && !editing && (
        <p className={`${card} p-5 text-sm ${muted}`}>Aún no hay plantillas. Registra la primera con «Nueva plantilla».</p>
      )}
      <ul className="grid gap-3 lg:grid-cols-2">
        {items?.map((t) => (
          <li key={t.id} className={`${card} p-4`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-mono text-sm font-semibold text-navy dark:text-slate-100">{t.name}</p>
                <p className={`text-xs ${muted}`}>
                  {t.language} · {t.category} · {KIND_LABEL[t.purpose]} · {t.status} · {t.source === 'META' ? 'Sincronizada' : 'Manual'}
                </p>
              </div>
              <div className="flex">
                <button type="button" onClick={() => setEditing(t)} className={btnGhost} aria-label={`Editar ${t.name}`}>
                  <Pencil className="h-4 w-4" />
                </button>
                {t.campaigns === 0 && (
                  <button type="button" onClick={() => void remove(t)} className={btnGhost} aria-label={`Eliminar ${t.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <p className="mt-3 whitespace-pre-wrap rounded-xl bg-[#e7f6e0] p-3 text-sm text-gray-900 dark:bg-slate-800 dark:text-slate-100">{t.bodyText}</p>
            {t.footerText && <p className={`mt-1 text-xs ${muted}`}>{t.footerText}</p>}
            {t.buttons.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {t.buttons.map((b) => (
                  <li key={b.text} className="rounded-lg border border-gray-300 px-2 py-1 text-xs dark:border-slate-700">
                    {b.text} <span className={muted}>· {BUTTON_ROLE_LABEL[b.role]}</span>
                  </li>
                ))}
              </ul>
            )}
            {t.problems.length ? (
              <p className="mt-3 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {t.problems.join('. ')}
              </p>
            ) : (
              <p className="mt-3 flex items-center gap-2 text-xs text-green-800 dark:text-green-300">
                <CheckCircle2 className="h-4 w-4" /> Lista para campañas
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TemplateForm({ template, onClose, onSaved }: { template: MassTemplate | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<TemplateInput>(template ? toInput(template) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof TemplateInput>(key: K, value: TemplateInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const vars = templateVariables(form.bodyText);

  const setButton = (i: number, patch: Partial<{ text: string; role: ButtonRole }>) =>
    set(
      'buttons',
      form.buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)),
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { ...form, footerText: form.footerText?.trim() || undefined, buttons: form.buttons.filter((b) => b.text.trim()) };
    try {
      if (template) await masivosApi.updateTemplate(template.id, body);
      else await masivosApi.createTemplate(body);
      onSaved();
    } catch (err) {
      setError(errorText(err, 'No se pudo guardar la plantilla'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} aria-label={template ? 'Editar plantilla' : 'Nueva plantilla'} className={`${card} grid gap-3 p-5 md:grid-cols-2`}>
      <div className="flex items-center justify-between md:col-span-2">
        <h3 className="text-sm font-bold text-navy dark:text-slate-100">{template ? `Editar ${template.name}` : 'Nueva plantilla'}</h3>
        <button type="button" onClick={onClose} aria-label="Cerrar" className={btnGhost}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <div>
        <label htmlFor="t-name" className={label}>
          Nombre técnico en Meta
        </label>
        <input id="t-name" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="promo_asesoria_inicial" className={`${input} font-mono`} />
      </div>
      <div>
        <label htmlFor="t-lang" className={label}>
          Idioma
        </label>
        <input id="t-lang" required value={form.language} onChange={(e) => set('language', e.target.value)} placeholder="es_CO" className={input} />
      </div>
      <div>
        <label htmlFor="t-category" className={label}>
          Categoría en Meta
        </label>
        <select id="t-category" value={form.category} onChange={(e) => set('category', e.target.value as TemplateInput['category'])} className={input}>
          <option value="MARKETING">MARKETING</option>
          <option value="UTILITY">UTILITY</option>
        </select>
      </div>
      <div>
        <label htmlFor="t-purpose" className={label}>
          Tipo de campaña
        </label>
        <select id="t-purpose" value={form.purpose} onChange={(e) => set('purpose', e.target.value as TemplateInput['purpose'])} className={input}>
          <option value="MARKETING">{KIND_LABEL.MARKETING}</option>
          <option value="OPT_IN">{KIND_LABEL.OPT_IN}</option>
        </select>
      </div>
      <div>
        <label htmlFor="t-status" className={label}>
          Estado en Meta
        </label>
        <select id="t-status" value={form.status} onChange={(e) => set('status', e.target.value)} className={input}>
          <option value="APPROVED">Aprobada</option>
          <option value="PENDING">Pendiente</option>
          <option value="PAUSED">Pausada</option>
          <option value="REJECTED">Rechazada</option>
        </select>
      </div>
      <div className="md:col-span-2">
        <label htmlFor="t-body" className={label}>
          Cuerpo (igual al aprobado en Meta; variables como {'{{1}}'})
        </label>
        <textarea id="t-body" required rows={4} maxLength={1024} value={form.bodyText} onChange={(e) => set('bodyText', e.target.value)} className={`${input} py-2`} />
        <p className={`mt-1 text-xs ${muted}`}>{vars.length ? `Variables: ${vars.map((n) => `{{${n}}}`).join(', ')}` : 'Sin variables'}</p>
      </div>
      <div className="md:col-span-2">
        <label htmlFor="t-footer" className={label}>
          Pie (opcional)
        </label>
        <input id="t-footer" maxLength={60} value={form.footerText ?? ''} onChange={(e) => set('footerText', e.target.value)} placeholder="Responde STOP para no recibir más" className={input} />
      </div>
      <fieldset className="md:col-span-2">
        <legend className={label}>Botones de respuesta rápida</legend>
        <div className="space-y-2">
          {form.buttons.map((b, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input aria-label={`Texto del botón ${i + 1}`} maxLength={25} value={b.text} onChange={(e) => setButton(i, { text: e.target.value })} className={input} />
              <select aria-label={`Rol del botón ${i + 1}`} value={b.role} onChange={(e) => setButton(i, { role: e.target.value as ButtonRole })} className={input}>
                {(Object.keys(BUTTON_ROLE_LABEL) as ButtonRole[]).map((r) => (
                  <option key={r} value={r}>
                    {BUTTON_ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => set('buttons', form.buttons.filter((_, j) => j !== i))} className={btnGhost} aria-label={`Quitar botón ${i + 1}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {form.buttons.length < 10 && (
            <button type="button" onClick={() => set('buttons', [...form.buttons, { text: '', role: 'OTHER' }])} className={btnSecondary}>
              <Plus className="h-4 w-4" /> Agregar botón
            </button>
          )}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-red-700 md:col-span-2 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="flex gap-2 md:col-span-2">
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Guardar plantilla
        </button>
        <button type="button" onClick={onClose} className={btnGhost}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
