import { Logo, LogoMark } from '@/components/brand/Logo';

/** Marca del panel: logotipo oficial; sigue el tema claro/oscuro del panel */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return compact ? <LogoMark size={32} tone="auto" /> : <Logo tone="auto" priority />;
}
