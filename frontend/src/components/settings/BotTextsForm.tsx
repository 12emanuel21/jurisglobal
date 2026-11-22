'use client';

import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { settingsApi, type EditableSettings } from '@/lib/admin-settings';
import { btnPrimary, card, errorText, input, label, muted } from '@/components/panel/ui';
import { SaveFeedback, type Feedback } from './SaveFeedback';

type BotKey = 'bot.greeting' | 'bot.declined' | 'bot.closing' | 'bot.optOutConfirmation';

const FIELDS: Array<{ key: BotKey; title: string; help: string; max: number }> = [
  { key: 'bot.greeting', title: 'Saludo', help: 'Primer mensaje; va junto con la autorización de datos y sus botones.', max: 500 },
  {
    key: 'bot.declined',
    title: 'Rechazo de la autorización',
    help: 'Cuando la persona toca «No acepto». Después se agregan la web, el correo y el teléfono institucionales.',
    max: 600,
  },
  { key: 'bot.closing', title: 'Cierre', help: 'Va después del resumen de los datos registrados.', max: 600 },
  { key: 'bot.optOutConfirmation', title: 'Confirmación de baja (STOP)', help: 'Respuesta a STOP / BAJA / NO QUIERO MÁS MENSAJES.', max: 500 },
];

/**
 * Textos configurables del chatbot. Formato de WhatsApp: *negrita*, _cursiva_. El servidor rechaza
 * «gratis» y las promesas de resultado, igual que en las respuestas de la IA.
 */
export function BotTextsForm({ settings, onSaved }: { settings: EditableSettings; onSaved: (s: EditableSettings) => void }) {
  const [values, setValues] = useState<Record<BotKey, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, settings[f.key]])) as Record<BotKey, string>);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      onSaved(await settingsApi.update(values));
      setFeedback({ ok: true, text: 'Textos guardados. El bot los usa desde el próximo mensaje.' });
    } catch (err) {
      setFeedback({ ok: false, text: errorText(err, 'No se pudieron guardar los textos') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <p className={`text-sm ${muted}`}>
        Escribe en español claro, sin prometer resultados ni decir «gratis». Formato de WhatsApp: <code>*negrita*</code>.
      </p>
      {FIELDS.map((f) => (
        <section key={f.key} className={`${card} p-5`}>
          <label htmlFor={f.key} className={label}>
            {f.title}
          </label>
          <textarea
            id={f.key}
            rows={4}
            maxLength={f.max}
            value={values[f.key]}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            className={`${input} py-2`}
          />
          <p className={`mt-1 flex justify-between gap-3 text-xs ${muted}`}>
            <span>{f.help}</span>
            <span className="shrink-0 tabular-nums">
              {values[f.key].length}/{f.max}
            </span>
          </p>
        </section>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Guardar textos
        </button>
        <SaveFeedback feedback={feedback} />
      </div>
    </form>
  );
}
