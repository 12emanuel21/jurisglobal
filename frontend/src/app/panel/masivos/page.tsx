import { Megaphone } from 'lucide-react';
import { card, heading, muted } from '@/components/panel/ui';

/** Masivos (solo ADMIN): se construyen en la Etapa 6 */
export default function MassMessagingPage() {
  return (
    <div className="space-y-4">
      <h2 className={heading}>Masivos</h2>
      <section className={`${card} flex flex-col items-start gap-3 p-6`}>
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-navy text-gold">
          <Megaphone className="h-5 w-5" aria-hidden="true" />
        </span>
        <p className="text-base font-semibold text-navy dark:text-slate-100">Próximamente — Etapa 6</p>
        <p className={`max-w-prose text-sm ${muted}`}>
          Aquí se importarán contactos con su origen y autorización, y se programarán campañas con plantillas aprobadas por Meta,
          respetando los horarios de la Ley 2300, los festivos, los topes de envío y las bajas. Los horarios y topes ya se pueden
          ajustar en Configuración.
        </p>
      </section>
    </div>
  );
}
