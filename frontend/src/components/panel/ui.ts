/**
 * Estilos compartidos del panel con la identidad de JurisGlobal: fondo claro, azul marino (acciones
 * principales) y dorado (foco y acentos). Se usan gray-* y text-[#fff] a propósito: la capa de modo
 * claro de globals.css reasigna slate-*, text-white y los acentos 100–400 de las páginas heredadas.
 * Botones y campos con mínimo 44 px (.tap).
 */
export const card = 'rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900';

export const input =
  'tap w-full rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-navy focus:ring-2 focus:ring-gold/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';

export const label = 'mb-1 block text-xs font-semibold text-gray-700 dark:text-slate-300';

const btnBase =
  'tap inline-flex items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export const btnPrimary = `${btnBase} bg-navy text-[#fff] hover:bg-navy-700 dark:bg-gold dark:text-navy dark:hover:bg-gold-400`;
export const btnSecondary = `${btnBase} border border-gray-300 bg-white text-navy hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800`;
export const btnDanger = `${btnBase} bg-red-700 text-[#fff] hover:bg-red-800`;
export const btnGhost = `${btnBase} text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800`;

export const muted = 'text-gray-600 dark:text-slate-400';
export const heading = 'font-serif text-xl font-bold text-navy dark:text-slate-100';

/** Mensaje de error legible */
export const errorText = (err: unknown, fallback = 'Ocurrió un error') => (err instanceof Error ? err.message : fallback);
