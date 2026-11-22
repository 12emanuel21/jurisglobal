import { SiteHeader } from '@/components/landing/SiteHeader';
import { SiteFooter } from '@/components/landing/SiteFooter';

/** Textos legales provisionales (ESP §11, §13.1–2): mismo encabezado y pie que la landing */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6">
        <div role="note" className="mb-8 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Borrador provisional.</strong> Texto base pendiente de revisión y aprobación por el equipo jurídico de JurisGlobal. La razón
          social, el NIT y los datos de contacto definitivos se completarán antes de la publicación oficial.
        </div>
        <article className="legal-text space-y-5 leading-relaxed text-slate-700 [&_h1]:font-serif [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:text-navy [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-navy [&_li]:ml-5 [&_li]:list-disc">
          {children}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
