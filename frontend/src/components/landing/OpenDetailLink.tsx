'use client';

import { ChevronDown } from 'lucide-react';

/**
 * Enlace a un desglose dentro del acordeón de servicios: abre el <details> (si estaba cerrado) y
 * lleva al área. Sin JavaScript sigue funcionando como ancla normal.
 */
const LINK_CLASS =
  'tap inline-flex items-center gap-1.5 self-start rounded-lg text-sm font-medium text-gold-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ca9e3d]';

export function OpenDetailLink({
  detailsId,
  targetId,
  classes = LINK_CLASS,
  children,
}: {
  detailsId: string;
  targetId: string;
  /** Reemplaza el estilo de enlace (p. ej. botón sobre fondo oscuro) */
  classes?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={`#${targetId}`}
      onClick={(e) => {
        const details = document.getElementById(detailsId);
        if (!(details instanceof HTMLDetailsElement)) return;
        e.preventDefault();
        details.open = true;
        document.getElementById(targetId)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        history.replaceState(null, '', `#${targetId}`);
      }}
      className={classes}
    >
      {children}
      <ChevronDown className="h-4 w-4" aria-hidden="true" />
    </a>
  );
}
