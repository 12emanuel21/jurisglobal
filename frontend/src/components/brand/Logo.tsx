import Image from 'next/image';

/**
 * Logotipo OFICIAL de JurisGlobal (public/logo-oficial.png procesado con scripts/brand-assets.mjs):
 * fondo transparente, colores planos de la marca y una versión "-dark" (azul marino → blanco) para
 * fondos oscuros. Archivos en public/brand/.
 *
 * - "full": isotipo + palabra JURISGLOBAL en una fila (barras horizontales: encabezado, panel).
 * - "vertical": logotipo completo apilado con el lema (pie de página, login).
 * - "mark": solo el isotipo (globo).
 *
 * tone: "light" sobre fondo claro · "dark" sobre azul marino · "auto" sigue el tema del panel (clase dark).
 */
type Tone = 'light' | 'dark' | 'auto';

interface LogoProps {
  variant?: 'full' | 'vertical' | 'mark';
  tone?: Tone;
  className?: string;
  showTagline?: boolean;
  /** Carga prioritaria (logo visible al cargar, p. ej. el encabezado) */
  priority?: boolean;
}

// Proporciones de los archivos (ancho / alto)
const RATIO = { isotipo: 512 / 514, wordmark: 1024 / 117, tagline: 1024 / 71, 'logo-vertical': 1024 / 942 } as const;
type Asset = keyof typeof RATIO;

function BrandImage({ asset, tone, height, className = '', priority, alt = '' }: { asset: Asset; tone: Tone; height: number; className?: string; priority?: boolean; alt?: string }) {
  const width = Math.round(height * RATIO[asset]);
  const common = { width, height, priority, draggable: false } as const;
  const cls = `select-none object-contain ${className}`;
  if (tone === 'auto')
    return (
      <>
        <Image src={`/brand/${asset}.png`} alt={alt} {...common} className={`${cls} dark:hidden`} />
        <Image src={`/brand/${asset}-dark.png`} alt="" {...common} aria-hidden className={`${cls} hidden dark:block`} />
      </>
    );
  return <Image src={`/brand/${asset}${tone === 'dark' ? '-dark' : ''}.png`} alt={alt} {...common} className={cls} />;
}

export function LogoMark({ size = 40, tone = 'light', className = '' }: { size?: number; tone?: Tone; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 ${className}`} style={{ width: size }}>
      <BrandImage asset="isotipo" tone={tone} height={size} className="h-auto w-full" />
    </span>
  );
}

export function Logo({ variant = 'full', tone = 'light', className = '', showTagline = false, priority = false }: LogoProps) {
  if (variant === 'mark')
    return (
      <span className={`inline-flex ${className}`} role="img" aria-label="JurisGlobal">
        <BrandImage asset="isotipo" tone={tone} height={40} className="h-10 w-10" priority={priority} />
      </span>
    );

  if (variant === 'vertical')
    return (
      <span className={`inline-flex ${className || 'w-48'}`} role="img" aria-label="JurisGlobal, Soluciones Jurídicas y Financieras">
        <BrandImage asset="logo-vertical" tone={tone} height={240} className="h-auto w-full" priority={priority} />
      </span>
    );

  // Horizontal: alturas fijas en px y ancho automático → nítido y sin deformarse en cualquier pantalla
  return (
    <span className={`inline-flex items-center gap-2 sm:gap-2.5 ${className}`} role="img" aria-label="JurisGlobal, Soluciones Jurídicas y Financieras">
      <span className="flex shrink-0">
        <BrandImage asset="isotipo" tone={tone} height={44} className="h-9 w-auto sm:h-11" priority={priority} />
      </span>
      <span className="flex shrink-0 flex-col gap-1">
        <span className="flex">
          <BrandImage asset="wordmark" tone={tone} height={20} className="h-4 w-auto sm:h-5" priority={priority} />
        </span>
        {showTagline && (
          <span className="flex">
            <BrandImage asset="tagline" tone={tone} height={12} className="h-[9px] w-auto sm:h-3" priority={priority} />
          </span>
        )}
      </span>
    </span>
  );
}
