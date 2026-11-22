'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { usePublicConfig, type PublicConfig } from '@/lib/public-config';
import { EMPTY_LEAD_FORM, toLeadPayload, validateLeadForm, type LeadFormErrors, type LeadFormValues } from '@/lib/lead-form';
import { site } from '@/lib/site';
import { WhatsAppButton } from './WhatsAppButton';
import { SELECT_MOTIVO_EVENT } from './SelectMotivoLink';

type Status = { kind: 'idle' } | { kind: 'submitting' } | { kind: 'success'; firstName: string } | { kind: 'error'; message: string };

const RATE_LIMITED =
  'Has enviado varios formularios en poco tiempo. Espera un minuto e intenta de nuevo, o escríbenos por WhatsApp.';
const GENERIC_ERROR = 'No pudimos enviar tus datos en este momento. Intenta de nuevo en unos minutos o escríbenos por WhatsApp.';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Formulario unificado (ESP §5): GET /api/public/config para motivos y textos; POST /api/leads con origin "web" */
export function ContactForm() {
  const state = usePublicConfig();
  if (state.status === 'loading') {
    return (
      <div className="flex min-h-[320px] items-center justify-center text-slate-500" aria-busy="true">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" /> Cargando formulario…
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        <p className="font-semibold">No pudimos cargar el formulario.</p>
        <p className="mt-1">Recarga la página en unos minutos o escríbenos directamente por WhatsApp.</p>
        <WhatsAppButton className="mt-4" />
      </div>
    );
  }
  return <LeadForm config={state.config} />;
}

function LeadForm({ config }: { config: PublicConfig }) {
  const [values, setValues] = useState<LeadFormValues>(EMPTY_LEAD_FORM);
  const [errors, setErrors] = useState<LeadFormErrors>({});
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();
  const fieldId = (name: keyof LeadFormValues) => `${id}-${name}`;

  // Tarjeta de servicio -> preselecciona el motivo
  useEffect(() => {
    const onSelect = (e: Event) => {
      const wanted = normalize(String((e as CustomEvent<string>).detail ?? ''));
      const match = config.motivos.find((m) => normalize(m.name) === wanted);
      if (match) setValues((v) => ({ ...v, motivo: match.id }));
    };
    window.addEventListener(SELECT_MOTIVO_EVENT, onSelect);
    return () => window.removeEventListener(SELECT_MOTIVO_EVENT, onSelect);
  }, [config.motivos]);

  const set = <K extends keyof LeadFormValues>(key: K, value: LeadFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const found = validateLeadForm(values);
    setErrors(found);
    if (Object.keys(found).length) {
      setStatus({ kind: 'idle' });
      const first = Object.keys(found)[0] as keyof LeadFormValues;
      document.getElementById(fieldId(first))?.focus();
      return;
    }
    setStatus({ kind: 'submitting' });
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(toLeadPayload(values)),
      });
      if (res.status === 429) return setStatus({ kind: 'error', message: RATE_LIMITED });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string | string[] };
        const message = Array.isArray(data.message) ? data.message.join('. ') : data.message;
        return setStatus({ kind: 'error', message: res.status === 400 && message ? message : GENERIC_ERROR });
      }
      setStatus({ kind: 'success', firstName: values.fullName.trim().split(/\s+/)[0] ?? '' });
      setValues(EMPTY_LEAD_FORM);
    } catch {
      setStatus({ kind: 'error', message: GENERIC_ERROR });
    }
  };

  if (status.kind === 'success') {
    return (
      <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center sm:p-8">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-700" aria-hidden="true" />
        <h3 className="mt-3 font-serif text-2xl font-bold text-navy">¡Gracias{status.firstName ? `, ${status.firstName}` : ''}!</h3>
        <p className="mt-2 text-slate-700">
          Recibimos tus datos. Un asesor de JurisGlobal se comunicará contigo pronto por llamada o correo.
        </p>
        <p className="mt-4 text-sm font-semibold text-gold-700">{site.closing}</p>
        <button type="button" onClick={() => setStatus({ kind: 'idle' })} className="tap mt-4 text-sm font-semibold text-navy underline underline-offset-4">
          Enviar otra solicitud
        </button>
      </div>
    );
  }

  const busy = status.kind === 'submitting';
  const inputClass = (name: keyof LeadFormValues) =>
    `tap w-full rounded-xl border bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 outline-none transition focus:ring-2 ${
      errors[name] ? 'border-red-600 focus:ring-red-200' : 'border-slate-300 focus:border-navy focus:ring-navy/15'
    }`;
  const errorText = (name: keyof LeadFormValues) =>
    errors[name] ? (
      <p id={`${fieldId(name)}-error`} className="mt-1.5 flex items-center gap-1 text-sm text-red-700">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> {errors[name]}
      </p>
    ) : null;
  const a11y = (name: keyof LeadFormValues) => ({
    id: fieldId(name),
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby': errors[name] ? `${fieldId(name)}-error` : undefined,
  });

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="relative space-y-5 [&_input]:scroll-mt-28 [&_select]:scroll-mt-28" aria-label="Formulario de contacto">
      <div>
        <label htmlFor={fieldId('fullName')} className="mb-1.5 block text-sm font-semibold text-slate-800">
          Nombre completo
        </label>
        <input {...a11y('fullName')} name="fullName" autoComplete="name" value={values.fullName} onChange={(e) => set('fullName', e.target.value)} className={inputClass('fullName')} placeholder="Nombre y apellidos" maxLength={120} />
        {errorText('fullName')}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fieldId('phone')} className="mb-1.5 block text-sm font-semibold text-slate-800">
            Teléfono
          </label>
          <div className="flex">
            <span className="inline-flex items-center rounded-l-xl border border-r-0 border-slate-300 bg-slate-50 px-3 text-base font-semibold text-slate-700" aria-hidden="true">
              +57
            </span>
            <input
              {...a11y('phone')}
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              value={values.phone}
              onChange={(e) => set('phone', e.target.value)}
              className={`${inputClass('phone')} rounded-l-none`}
              placeholder="300 123 4567"
              maxLength={20}
            />
          </div>
          {errorText('phone')}
        </div>

        <div>
          <label htmlFor={fieldId('email')} className="mb-1.5 block text-sm font-semibold text-slate-800">
            Correo electrónico
          </label>
          <input {...a11y('email')} name="email" type="email" inputMode="email" autoComplete="email" value={values.email} onChange={(e) => set('email', e.target.value)} className={inputClass('email')} placeholder="nombre@correo.com" maxLength={254} />
          {errorText('email')}
        </div>
      </div>

      <div>
        <label htmlFor={fieldId('motivo')} className="mb-1.5 block text-sm font-semibold text-slate-800">
          Motivo de tu consulta
        </label>
        <select {...a11y('motivo')} name="motivo" value={values.motivo} onChange={(e) => set('motivo', e.target.value)} className={inputClass('motivo')}>
          <option value="">Selecciona una opción</option>
          {config.motivos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {errorText('motivo')}
      </div>

      {/* Honeypot anti-spam: invisible para personas y lectores de pantalla */}
      <div className="absolute -left-[10000px] h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor={fieldId('website')}>No llenes este campo</label>
        <input id={fieldId('website')} name="website" tabIndex={-1} autoComplete="off" value={values.website} onChange={(e) => set('website', e.target.value)} />
      </div>

      <fieldset className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-800">Autorizaciones (obligatorias)</legend>
        {(['privacyAndTerms', 'contactAndDataProcessing'] as const).map((key) => (
          <div key={key}>
            <label htmlFor={fieldId(key)} className="flex cursor-pointer gap-3 text-sm leading-relaxed text-slate-700">
              <input
                {...a11y(key)}
                type="checkbox"
                checked={values[key]}
                onChange={(e) => set(key, e.target.checked)}
                className="mt-0.5 h-6 w-6 shrink-0 cursor-pointer rounded border-slate-400 accent-[var(--brand-navy)]"
              />
              <span>{config.consents[key].text}</span>
            </label>
            {errorText(key)}
          </div>
        ))}
        <p className="flex flex-wrap gap-x-4 gap-y-1 pl-9 text-sm">
          <a href={config.legal.privacy} target="_blank" rel="noopener" className="font-semibold text-navy underline underline-offset-2">
            Aviso de Privacidad
          </a>
          <a href={config.legal.terms} target="_blank" rel="noopener" className="font-semibold text-navy underline underline-offset-2">
            Términos y Condiciones
          </a>
          <a href={config.legal.cookies} target="_blank" rel="noopener" className="font-semibold text-navy underline underline-offset-2">
            Política de Cookies
          </a>
        </p>
      </fieldset>

      {status.kind === 'error' && (
        <div role="alert" className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{status.message}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="tap inline-flex w-full items-center justify-center gap-2 rounded-xl bg-navy px-6 text-base font-bold text-white transition-colors hover:bg-navy-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
      >
        {busy && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
        {busy ? 'Enviando…' : 'Enviar mis datos'}
      </button>
      <p className="text-center text-xs text-slate-500">Un asesor te contactará por llamada o correo en horario laboral.</p>
    </form>
  );
}
