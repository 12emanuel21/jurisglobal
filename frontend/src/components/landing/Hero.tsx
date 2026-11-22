import { MapPin, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { site } from '@/lib/site';
import { ConsultationOffer } from './ConsultationOffer';
import { WhatsAppButton } from './WhatsAppButton';

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white to-slate-50" aria-labelledby="hero-title">
      {/* Globo decorativo (marca de agua) */}
      <svg className="pointer-events-none absolute -right-40 -top-24 hidden h-[560px] w-[560px] text-navy/[0.04] lg:block" viewBox="0 0 100 100" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="0.6">
          <circle cx="50" cy="50" r="48" />
          <ellipse cx="50" cy="50" rx="20" ry="48" />
          <ellipse cx="50" cy="50" rx="36" ry="48" />
          <path d="M2 50h96M8 26h84M8 74h84" />
        </g>
      </svg>

      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[1.25fr_1fr] lg:items-center lg:py-24">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-gold/60 bg-white px-3 py-1 text-xs font-semibold text-gold-700">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {site.slogan}
          </p>
          <h1 id="hero-title" className="mt-5 font-serif text-4xl font-bold leading-tight tracking-tight text-navy sm:text-5xl">
            Estamos de tu lado construyendo soluciones continuas.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-700">
            <strong className="font-semibold text-navy">Te brindamos orientación y acompañamiento jurídico y financiero,</strong> con profesionalismo, compromiso y calidad humana, para ayudarte a resolver tus dificultades, proteger tus intereses, recuperar el control de tus obligaciones y encontrar nuevas oportunidades para avanzar con tranquilidad
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href="#contacto"
              className="tap inline-flex items-center justify-center rounded-xl bg-navy px-6 text-sm font-bold text-white shadow-sm transition-colors hover:bg-navy-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2"
            >
              Quiero que me contacten
            </a>
            <WhatsAppButton variant="outline" />
          </div>

          <ul className="mt-8 flex flex-col gap-2 text-sm text-slate-600 sm:flex-row sm:gap-6">
            <li className="flex items-center gap-2">
              <MonitorSmartphone className="h-4 w-4 text-navy" aria-hidden="true" /> Atención virtual en toda Colombia
            </li>
            <li className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-navy" aria-hidden="true" /> Presencial en {site.city}
            </li>
          </ul>
        </div>

        <ConsultationOffer />
      </div>
    </section>
  );
}
