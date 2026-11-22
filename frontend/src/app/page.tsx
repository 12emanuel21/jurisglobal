import Link from 'next/link';

/**
 * Página pública provisional (Etapa 1). La landing con servicios, formulario y botón de WhatsApp
 * se construye en la Etapa 3.
 */
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-6 text-center">
      <p className="font-serif text-4xl font-black tracking-tight text-[var(--brand-navy)] sm:text-5xl">
        JURIS<span className="text-[var(--brand-gold)]">GLOBAL</span>
      </p>
      <p className="mt-2 text-sm font-semibold uppercase tracking-[0.25em] text-[var(--brand-navy-700)]">Soluciones Jurídicas y Financieras</p>
      <p className="mt-8 max-w-md text-lg text-slate-700">Tu tranquilidad, nuestra misión.</p>
      <p className="mt-2 max-w-md text-sm text-slate-500">Estamos preparando nuestro sitio. Muy pronto podrás dejar tus datos para que un asesor te contacte.</p>
      <Link
        href="/login"
        className="tap mt-10 inline-flex items-center rounded-xl border border-[var(--brand-navy)]/20 px-5 text-sm font-semibold text-[var(--brand-navy)] transition hover:bg-[var(--brand-navy)]/5"
      >
        Acceso del equipo
      </Link>
    </main>
  );
}
