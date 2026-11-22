'use client';

import { ArrowRight } from 'lucide-react';

/** Evento para preseleccionar el motivo del formulario desde una tarjeta de servicio */
export const SELECT_MOTIVO_EVENT = 'jg:select-motivo';

export function SelectMotivoLink({ motivo, className = '', children }: { motivo: string; className?: string; children: React.ReactNode }) {
  return (
    <a
      href="#contacto"
      onClick={() => window.dispatchEvent(new CustomEvent<string>(SELECT_MOTIVO_EVENT, { detail: motivo }))}
      className={`tap inline-flex items-center gap-2 self-start rounded-lg text-sm font-semibold text-navy underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${className}`}
    >
      {children}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </a>
  );
}
