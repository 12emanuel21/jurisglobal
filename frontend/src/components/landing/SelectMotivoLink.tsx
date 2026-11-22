'use client';

import { ArrowRight } from 'lucide-react';

/** Evento para preseleccionar el motivo del formulario desde una tarjeta de servicio */
export const SELECT_MOTIVO_EVENT = 'jg:select-motivo';

const LINK_CLASS =
  'tap inline-flex items-center gap-2 self-start rounded-lg text-sm font-semibold text-navy underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold';

/** `classes` reemplaza el estilo de enlace (p. ej. para mostrarlo como botón); `className` lo complementa */
export function SelectMotivoLink({
  motivo,
  className = '',
  classes = LINK_CLASS,
  children,
}: {
  motivo: string;
  className?: string;
  classes?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href="#contacto"
      onClick={() => window.dispatchEvent(new CustomEvent<string>(SELECT_MOTIVO_EVENT, { detail: motivo }))}
      className={`${classes} ${className}`}
    >
      {children}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </a>
  );
}
