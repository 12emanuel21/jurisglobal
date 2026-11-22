'use client';

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { settingsApi, type EditableSettings } from '@/lib/admin-settings';
import { errorText, heading, muted } from '@/components/panel/ui';
import { ConsultationContactForm } from '@/components/settings/ConsultationContactForm';
import { MotivosEditor } from '@/components/settings/MotivosEditor';
import { BotTextsForm } from '@/components/settings/BotTextsForm';
import { ScheduleEditor } from '@/components/settings/ScheduleEditor';

const TABS = [
  { id: 'asesoria', label: 'Asesoría y contacto' },
  { id: 'motivos', label: 'Motivos' },
  { id: 'bot', label: 'Textos del chatbot' },
  { id: 'horarios', label: 'Horarios y topes' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** Configuración dinámica (solo ADMIN): los cambios aplican al instante en la web y el bot */
export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>('asesoria');
  const [settings, setSettings] = useState<EditableSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    settingsApi
      .get()
      .then(setSettings)
      .catch((err: unknown) => setError(errorText(err, 'No se pudo cargar la configuración')));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h2 className={heading}>Configuración</h2>
        <p className={`text-sm ${muted}`}>Parámetros de la web, el chatbot y los envíos.</p>
      </div>
      <div role="tablist" aria-label="Secciones de configuración" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`tap shrink-0 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
              tab === t.id
                ? 'bg-navy text-[#fff] dark:bg-gold dark:text-navy'
                : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {!settings && !error && (
        <p className={`flex items-center gap-2 text-sm ${muted}`}>
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </p>
      )}
      {settings && (
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'asesoria' && <ConsultationContactForm settings={settings} onSaved={setSettings} />}
          {tab === 'motivos' && <MotivosEditor />}
          {tab === 'bot' && <BotTextsForm settings={settings} onSaved={setSettings} />}
          {tab === 'horarios' && <ScheduleEditor settings={settings} onSaved={setSettings} />}
        </div>
      )}
    </div>
  );
}
