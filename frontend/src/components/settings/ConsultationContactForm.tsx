'use client';

import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { formatCopValue, settingsApi, type EditableSettings } from '@/lib/admin-settings';
import { btnPrimary, card, errorText, input, label, muted } from '@/components/panel/ui';
import { SaveFeedback, type Feedback } from './SaveFeedback';

/** Correos separados por coma, punto y coma o salto de línea */
export const parseEmailList = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);

/**
 * Asesoría y contacto: interruptor y valor de la asesoría inicial (web y bot lo leen al instante),
 * correos que reciben el aviso de lead nuevo, y correo y teléfono institucionales (los comparte el
 * bot cuando alguien no acepta la autorización).
 */
export function ConsultationContactForm({ settings, onSaved }: { settings: EditableSettings; onSaved: (s: EditableSettings) => void }) {
  const [show, setShow] = useState(settings.showConsultationPrice);
  const [price, setPrice] = useState(settings.consultationPrice?.toString() ?? '');
  const [emails, setEmails] = useState(settings['notify.leadEmails'].join('\n'));
  const [companyEmail, setCompanyEmail] = useState(settings['company.email'] ?? '');
  const [companyPhone, setCompanyPhone] = useState(settings['company.phone'] ?? '');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const numericPrice = price.trim() ? Number(price.replace(/[.\s$]/g, '')) : null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const saved = await settingsApi.update({
        showConsultationPrice: show,
        consultationPrice: numericPrice,
        'notify.leadEmails': parseEmailList(emails),
        'company.email': companyEmail.trim() || null,
        'company.phone': companyPhone.trim() || null,
      });
      onSaved(saved);
      setFeedback({ ok: true, text: 'Cambios guardados. La web y el bot ya usan los nuevos valores.' });
    } catch (err) {
      setFeedback({ ok: false, text: errorText(err, 'No se pudo guardar') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <section className={`${card} space-y-4 p-5`}>
        <h3 className="text-sm font-bold text-navy dark:text-slate-100">Asesoría inicial</h3>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p id="price-switch-label" className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              Mostrar el precio en la web y en el chatbot
            </p>
            <p className={`text-xs ${muted}`}>Apagado: no se muestra ningún valor y un asesor confirma las condiciones (nunca se dice «gratis»).</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={show}
            aria-labelledby="price-switch-label"
            onClick={() => setShow((v) => !v)}
            className={`tap relative inline-flex w-16 shrink-0 items-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
              show ? 'border-navy bg-navy' : 'border-gray-300 bg-gray-200 dark:border-slate-600 dark:bg-slate-700'
            }`}
          >
            <span className={`inline-block h-7 w-7 rounded-full bg-[#fff] shadow transition-transform ${show ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        </div>
        <div className="max-w-xs">
          <label htmlFor="consultation-price" className={label}>
            Valor de la asesoría inicial (COP)
          </label>
          <input
            id="consultation-price"
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder="100000"
            className={input}
          />
          <p className={`mt-1 text-xs ${muted}`}>
            {numericPrice && Number.isFinite(numericPrice) ? `Se mostrará como ${formatCopValue(numericPrice)}` : 'Sin valor'}
            {show ? '' : ' · oculto mientras el interruptor esté apagado'}
          </p>
        </div>
      </section>

      <section className={`${card} grid gap-4 p-5 md:grid-cols-2`}>
        <h3 className="text-sm font-bold text-navy md:col-span-2 dark:text-slate-100">Contacto y avisos</h3>
        <div className="md:col-span-2">
          <label htmlFor="notify-emails" className={label}>
            Correos que reciben el aviso de lead nuevo (uno por línea)
          </label>
          <textarea id="notify-emails" rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} className={`${input} py-2`} placeholder="socios@jurisglobal.co" />
          <p className={`mt-1 text-xs ${muted}`}>Vacío: se usa LEAD_NOTIFICATION_EMAIL del servidor.</p>
        </div>
        <div>
          <label htmlFor="company-email" className={label}>
            Correo institucional de contacto
          </label>
          <input id="company-email" type="email" value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} className={input} placeholder="contacto@jurisglobal.co" />
        </div>
        <div>
          <label htmlFor="company-phone" className={label}>
            Teléfono institucional
          </label>
          <input id="company-phone" type="tel" value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)} className={input} placeholder="300 123 4567" />
        </div>
        <p className={`text-xs md:col-span-2 ${muted}`}>El chatbot comparte estos canales cuando alguien no acepta la autorización de datos.</p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Guardar cambios
        </button>
        <SaveFeedback feedback={feedback} />
      </div>
    </form>
  );
}
