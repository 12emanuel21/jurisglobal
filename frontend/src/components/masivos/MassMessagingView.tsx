'use client';

import { useState } from 'react';
import { FileText, Megaphone, Send, Users } from 'lucide-react';
import { heading, muted } from '@/components/panel/ui';
import { CampaignsTab } from './CampaignsTab';
import { ContactsTab } from './ContactsTab';
import { TemplatesTab } from './TemplatesTab';
import { TestSendTab } from './TestSendTab';

const TABS = [
  { id: 'campanas', label: 'Campañas', icon: Megaphone },
  { id: 'contactos', label: 'Contactos', icon: Users },
  { id: 'plantillas', label: 'Plantillas', icon: FileText },
  { id: 'prueba', label: 'Envío de prueba', icon: Send },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** Masivos (solo ADMIN): campañas con plantillas de Meta, base de contactos e importador */
export function MassMessagingView() {
  const [tab, setTab] = useState<TabId>('campanas');

  return (
    <div className="space-y-5">
      <div>
        <h2 className={heading}>Masivos</h2>
        <p className={`text-sm ${muted}`}>
          Campañas por WhatsApp con plantillas aprobadas por Meta. Respetan el horario de la Ley 2300, los festivos, los topes y las bajas.
        </p>
      </div>
      <div role="tablist" aria-label="Secciones de masivos" className="flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              id={`tab-${id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`panel-${id}`}
              onClick={() => setTab(id)}
              className={`tap inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-sm font-semibold transition sm:gap-2 sm:px-4 ${
                active ? 'bg-navy text-[#fff] [&_svg]:text-gold' : 'text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" /> {label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'campanas' && <CampaignsTab />}
        {tab === 'contactos' && <ContactsTab />}
        {tab === 'plantillas' && <TemplatesTab />}
        {tab === 'prueba' && <TestSendTab />}
      </div>
    </div>
  );
}
