/** Marca provisional (texto) hasta recibir el logo en alta resolución (Etapa 3) */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand-navy)] font-serif text-sm font-black text-[var(--brand-gold)] ring-1 ring-[var(--brand-gold)]/40">
        JG
      </span>
      {!compact && (
        <span className="font-serif text-lg font-black tracking-tight text-[var(--brand-navy)] dark:text-white">
          JURIS<span className="text-[var(--brand-gold)]">GLOBAL</span>
        </span>
      )}
    </span>
  );
}
