import { SiteHeader } from '@/components/landing/SiteHeader';
import { Hero } from '@/components/landing/Hero';
import { Services } from '@/components/landing/Services';
import { WhyUs } from '@/components/landing/WhyUs';
import { ContactSection } from '@/components/landing/ContactSection';
import { ClosingBand, SiteFooter } from '@/components/landing/SiteFooter';
import { WhatsAppFloat } from '@/components/landing/WhatsAppFloat';

/**
 * Landing de JurisGlobal (ESP §3.1). Página estática (carga rápida); el bloque de la asesoría y el
 * formulario leen la configuración viva de GET /api/public/config en el navegador.
 */
export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <a href="#contacto" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-navy focus:px-4 focus:py-2 focus:text-white">
        Ir al formulario de contacto
      </a>
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <Services />
        <WhyUs />
        <ContactSection />
        <ClosingBand />
      </main>
      <SiteFooter />
      <WhatsAppFloat />
    </div>
  );
}
