'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Info, Loader2, Send } from 'lucide-react';
import { btnPrimary, card, errorText, input, label, muted } from '@/components/panel/ui';
import { useSudoMode } from '@/context/SudoContext';
import { apiErrorMessage } from '@/lib/api';
import { masivosApi, type MassTemplate, type TestSendResult } from '@/lib/masivos';
import { WhatsAppPreview } from './WhatsAppPreview';

/** Celular colombiano: 10 dígitos que empiezan por 3, con o sin +57 (el backend valida igual) */
export function isColombianMobileInput(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  const national = digits.length === 12 && digits.startsWith('57') ? digits.slice(2) : digits;
  return /^3\d{9}$/.test(national);
}

/**
 * Envío de prueba / unitario (solo ADMIN): una plantilla aprobada a un celular, con la vista previa
 * del teléfono en vivo. Respeta la baja siempre y, salvo que se marque la casilla (queda en la
 * bitácora), el horario de la Ley 2300 y los festivos.
 */
export function TestSendTab() {
  const { sudoFetch } = useSudoMode();
  const [templates, setTemplates] = useState<MassTemplate[] | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [phone, setPhone] = useState('+57 ');
  const [values, setValues] = useState<Record<string, string[]>>({});
  const [skipWindow, setSkipWindow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TestSendResult | null>(null);

  useEffect(() => {
    masivosApi
      .templates()
      .then((r) => setTemplates(r.items))
      .catch((err: unknown) => setError(errorText(err, 'No se pudieron cargar las plantillas')));
  }, []);

  const approved = useMemo(() => (templates ?? []).filter((t) => t.status === 'APPROVED'), [templates]);
  const template = approved.find((t) => t.id === templateId) ?? null;
  const variables = useMemo(
    () => Array.from({ length: template?.variableCount ?? 0 }, (_, i) => values[templateId]?.[i] ?? ''),
    [template, templateId, values],
  );
  const phoneOk = isColombianMobileInput(phone);
  const ready = Boolean(template) && phoneOk && variables.every((v) => v.trim()) && !busy;

  const setVar = (i: number, value: string) =>
    setValues((all) => {
      const list = [...(all[templateId] ?? [])];
      list[i] = value;
      return { ...all, [templateId]: list };
    });

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // Envío real a Meta: con 2FA activo el backend pide el código (Sudo Mode) y sudoFetch lo solicita
      const res = await sudoFetch('/admin/campaigns/test-send', {
        method: 'POST',
        body: JSON.stringify({ templateId, phone: phone.trim(), variables: variables.map((v) => v.trim()), skipWindow }),
      });
      if (!res.ok) throw new Error((await apiErrorMessage(res, 'No se pudo enviar la prueba')).message);
      setResult((await res.json()) as TestSendResult);
    } catch (err) {
      setError(errorText(err, 'No se pudo enviar la prueba'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Envío de prueba o unitario" className={`${card} p-5`}>
      <h3 className="text-base font-bold text-navy dark:text-slate-100">Envío de prueba / unitario</h3>
      <p className={`mt-1 max-w-prose text-sm ${muted}`}>
        Envía una plantilla aprobada a un solo celular para probarla antes de una campaña. No crea campaña ni cuenta en los topes. Los números dados de
        baja (STOP) nunca reciben mensajes.
      </p>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_320px]">
        <form onSubmit={send} className="space-y-4">
          <div>
            <label htmlFor="ts-template" className={label}>
              Plantilla aprobada
            </label>
            <select
              id="ts-template"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setResult(null);
              }}
              className={input}
            >
              <option value="">Elige una plantilla…</option>
              {approved.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.language}){t.variableCount ? ` · ${t.variableCount} variable${t.variableCount > 1 ? 's' : ''}` : ' · sin variables'}
                </option>
              ))}
            </select>
            {templates && approved.length === 0 && (
              <p className={`mt-1 text-xs ${muted}`}>No hay plantillas aprobadas: regístralas o sincronízalas en la pestaña Plantillas.</p>
            )}
            {(template?.warnings ?? []).map((w) => (
              <p key={w} className="mt-1 flex items-start gap-2 text-xs text-[#1e3a8a] dark:text-[#bfdbfe]">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> Aviso (no bloquea): {w}
              </p>
            ))}
          </div>

          <div>
            <label htmlFor="ts-phone" className={label}>
              Celular (Colombia)
            </label>
            <input
              id="ts-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+57 300 123 4567"
              aria-invalid={phone.replace(/\D/g, '').length > 2 && !phoneOk}
              className={input}
            />
            {phone.replace(/\D/g, '').length > 2 && !phoneOk && (
              <p className="mt-1 text-xs text-red-700 dark:text-red-300">Escribe un celular colombiano: 10 dígitos que empiezan por 3.</p>
            )}
          </div>

          {template && template.variableCount > 0 && (
            <fieldset className="space-y-2">
              <legend className={label}>Valores de las variables</legend>
              {variables.map((v, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[60px_1fr] sm:items-center">
                  <span className="font-mono text-sm">{`{{${i + 1}}}`}</span>
                  <input
                    aria-label={`Valor de {{${i + 1}}}`}
                    value={v}
                    maxLength={200}
                    onChange={(e) => setVar(i, e.target.value)}
                    placeholder={i === 0 ? 'Ej.: Ana' : 'Texto'}
                    className={input}
                  />
                </div>
              ))}
            </fieldset>
          )}

          <label className="flex items-start gap-2 rounded-xl border border-gold/60 bg-[#fdf8ec] p-3 text-sm text-navy dark:bg-gold/10 dark:text-slate-100">
            <input type="checkbox" className="mt-1" checked={skipWindow} onChange={(e) => setSkipWindow(e.target.checked)} />
            <span>
              <strong>Enviar inmediatamente (omitir horario Ley 2300 por ser prueba)</strong>
              <span className={`block text-xs ${muted}`}>
                Solo para pruebas internas (p. ej. un domingo o fuera de horario). Queda registrado en la bitácora y no cambia el horario de envío
                configurado: las campañas masivas siguen respetando la Ley 2300, domingos y festivos.
              </span>
            </span>
          </label>

          {error && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          )}
          {result && (
            <p role="status" className="flex items-start gap-2 rounded-xl bg-[#dcfce7] p-3 text-sm text-[#166534] dark:bg-[#14532d]/60 dark:text-[#bbf7d0]">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {result.status === 'SIMULATED'
                  ? `Simulado (WhatsApp no está configurado o está en modo simulación): no se llamó a Meta. Destino ${result.phone}.`
                  : `Enviado a ${result.phone}. Queda en el Inbox y en la bitácora.`}
                {result.windowBypassed && ' Se omitió el horario de la Ley 2300 (registrado como prueba).'}
              </span>
            </p>
          )}
          <button type="submit" disabled={!ready} className={btnPrimary}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar prueba
          </button>
        </form>

        <div>
          {template ? (
            <WhatsAppPreview
              header={template.headerText}
              body={template.bodyText}
              footer={template.footerText}
              buttons={template.buttons.map((b) => b.text)}
              params={variables}
              caption="Así le llegará con los valores escritos"
            />
          ) : (
            <p className={`rounded-2xl bg-gray-50 p-4 text-sm dark:bg-slate-800/50 ${muted}`}>Elige una plantilla para ver la vista previa en el teléfono.</p>
          )}
        </div>
      </div>
    </section>
  );
}
