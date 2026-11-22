import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { displayPhone, site, whatsappUrl } from '@/lib/site';
import { WhatsAppButton } from './WhatsAppButton';

const LEGAL = [
  { href: '/legal/privacidad', label: 'Aviso de Privacidad' },
  { href: '/legal/terminos', label: 'Términos y Condiciones' },
  { href: '/legal/cookies', label: 'Política de Cookies' },
];

/** Banda de cierre con la frase de marca (ESP §2) */
export function ClosingBand() {
  return (
    <section className="bg-navy py-14 text-white" aria-label="Cierre">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 text-center sm:px-6">
        <p className="font-serif text-2xl font-bold sm:text-3xl">
          Tu mejor decisión hoy, <span className="text-gold-400">tu tranquilidad mañana.</span>
        </p>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <a href="#contacto" className="tap inline-flex items-center justify-center rounded-xl bg-gold px-6 text-sm font-bold text-navy hover:bg-gold-400">
            Dejar mis datos
          </a>
          <WhatsAppButton variant="onDark" />
        </div>
      </div>
    </section>
  );
}

export function SiteFooter() {
  const wa = whatsappUrl();
  const year = new Date().getFullYear();
  return (
    <footer className="border-t-4 border-gold bg-[#081729] pb-24 pt-12 text-sm text-white/75 md:pb-12">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 md:grid-cols-3">
        <div>
          <Logo variant="vertical" tone="dark" className="w-52" />
          <p className="mt-4">{site.slogan}</p>
          <p className="mt-2">Barranquilla · atención virtual en todo el país y presencial en Barranquilla.</p>
        </div>

        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-400">Contacto</h2>
          <ul className="mt-4 space-y-2">
            {wa && (
              <li>
                <a href={wa} target="_blank" rel="noopener noreferrer" className="hover:text-white">
                  WhatsApp {displayPhone(site.whatsappNumber)}
                </a>
              </li>
            )}
            {site.contactPhone && (
              <li>
                <a href={`tel:${site.contactPhone.replace(/[^\d+]/g, '')}`} className="hover:text-white">
                  Teléfono {site.contactPhone}
                </a>
              </li>
            )}
            {site.contactEmail && (
              <li>
                <a href={`mailto:${site.contactEmail}`} className="break-all hover:text-white">
                  {site.contactEmail}
                </a>
              </li>
            )}
          </ul>
        </div>

        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-400">Legal</h2>
          <ul className="mt-4 space-y-2">
            {LEGAL.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="hover:text-white">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mx-auto mt-10 flex max-w-6xl flex-col gap-2 border-t border-white/10 px-4 pt-6 text-xs text-white/55 sm:flex-row sm:justify-between sm:px-6">
        <p>
          © {year} JURISGLOBAL, Soluciones Jurídicas y Financieras{site.nitInfo ? ` · ${site.nitInfo}` : ''}
        </p>
        <Link href="/login" className="hover:text-white">
          Acceso del equipo
        </Link>
      </div>
    </footer>
  );
}
