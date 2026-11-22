import { Logo, LogoMark } from '@/components/brand/Logo';

/** Marca del panel: mismo logotipo de la web (provisional hasta recibir el archivo final) */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return compact ? <LogoMark size={32} /> : <Logo />;
}
