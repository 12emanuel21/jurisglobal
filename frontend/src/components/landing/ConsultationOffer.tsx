'use client';

import { CalendarCheck, Loader2 } from 'lucide-react';
import { formatCop, usePublicConfig } from '@/lib/public-config';

/**
 * Bloque de la consulta inicial (ESP §10.2), leído en vivo de GET /api/public/config:
 * - showConsultationPrice = true y hay valor: muestra el precio en pesos.
 * - Interruptor apagado (o configuración no disponible): oferta de valoración jurídica gratis con
 *   el socio fundador (texto aprobado por JurisGlobal), sin mostrar un valor que la configuración no autoriza.
 */
export function ConsultationOffer() {
  const state = usePublicConfig();

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-[220px] items-center justify-center rounded-2xl bg-navy p-6 text-white/80" aria-busy="true">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        <span className="sr-only">Cargando información de la asesoría</span>
      </div>
    );
  }

  const price = state.status === 'ready' && state.config.showConsultationPrice ? state.config.consultationPrice : null;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-navy p-6 text-white shadow-xl shadow-navy/20 sm:p-8" data-testid="consultation-offer">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-gold via-gold-400 to-gold" aria-hidden="true" />
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold-400">
        <CalendarCheck className="h-4 w-4" aria-hidden="true" />
        {price !== null ? 'Asesoría inicial' : 'Valoración inicial'}
      </p>

      {price !== null ? (
        <>
          <p className="mt-4 font-serif text-4xl font-bold tracking-tight sm:text-5xl">{formatCop(price)}</p>
          <p className="mt-3 text-sm leading-relaxed text-white/80">
            Sesión con un asesor de JurisGlobal para revisar tu situación y explicarte las opciones y el siguiente paso.
          </p>
        </>
      ) : (
        <>
          <h2 className="mt-4 font-serif text-2xl font-bold leading-snug text-[#ca9e3d] sm:text-3xl">¡VALORACIÓN JURÍDICA GRATIS!</h2>
          <p className="mt-3 text-base font-semibold leading-snug text-white sm:text-lg">
            Tu problema merece ser escuchado. Tu tranquilidad merece una solución.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-white/80">
            Escríbenos y recibe atención virtual y personalizada de nuestro abogado socio fundador, Ronaldo Jiménez.
          </p>
          <p className="mt-4">
            <span className="inline-flex items-center rounded-full bg-[#14532d]/60 px-3 py-1 text-xs font-semibold text-[#86efac] ring-1 ring-inset ring-[#22c55e]/30">
              Primer paso sin costo
            </span>
          </p>
          <p className="mt-4 text-sm font-medium tracking-wide text-[#ca9e3d]">JURISGLOBAL · Tu tranquilidad, nuestra misión.</p>
        </>
      )}

      <a
        href="#contacto"
        className="tap mt-6 inline-flex w-full items-center justify-center rounded-xl bg-gold px-5 text-sm font-bold text-navy transition-colors hover:bg-gold-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        {price !== null ? 'Agendar mi asesoría' : 'Solicitar valoración'}
      </a>
      <p className="mt-3 text-center text-xs text-white/60">Atención virtual en todo el país · presencial en Barranquilla</p>
    </div>
  );
}
