/**
 * Logotipo PROVISIONAL de JurisGlobal (ESP §2: globo con apretón de manos y flecha dorada; texto
 * "JURISGLOBAL" en azul marino y dorado). Vectorial y sin dependencias.
 * Para usar el archivo definitivo: poner el SVG/PNG en public/brand/ y reemplazar <LogoMark/> por
 * <img src="/brand/logo.svg" …/> en este componente (el resto del sitio no cambia).
 */
interface LogoProps {
  /** "full": símbolo + texto; "mark": solo el símbolo */
  variant?: 'full' | 'mark';
  /** "light": sobre fondo blanco · "dark": sobre azul marino */
  tone?: 'light' | 'dark';
  className?: string;
  showTagline?: boolean;
}

export function LogoMark({ size = 40, tone = 'light' }: { size?: number; tone?: 'light' | 'dark' }) {
  const ring = tone === 'dark' ? '#ffffff' : 'var(--brand-navy)';
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-hidden="true" focusable="false">
      {/* Globo */}
      <circle cx="24" cy="24" r="19" fill="var(--brand-navy)" stroke={ring} strokeWidth={tone === 'dark' ? 1.5 : 0} />
      <g fill="none" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1.1">
        <ellipse cx="24" cy="24" rx="8" ry="19" />
        <path d="M5.5 18h37M5.5 30h37" />
      </g>
      {/* Apretón de manos (estilizado) */}
      <g fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 26.5l5-4.5c1.2-1 2.8-1 4 0l2.2 1.8" />
        <path d="M33.5 26.5l-5.2 4.6c-1.2 1-2.8 1-4 0l-5.3-4.3" />
        <path d="M21.5 27.5l2.4 2M24.4 25.6l2.4 2" />
      </g>
      {/* Flecha dorada ascendente */}
      <path d="M8 36c8.5-1.2 17-5.8 26.5-16.2" fill="none" stroke="var(--brand-gold)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M29.6 18.3l6.2-0.9-1.1 6.1" fill="none" stroke="var(--brand-gold)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ variant = 'full', tone = 'light', className = '', showTagline = false }: LogoProps) {
  const juris = tone === 'dark' ? 'text-white' : 'text-navy';
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark tone={tone} />
      {variant === 'full' && (
        <span className="flex flex-col leading-none">
          <span className="font-serif text-xl font-black tracking-tight" aria-label="JurisGlobal">
            <span className={juris}>JURIS</span>
            <span className="text-gold">GLOBAL</span>
          </span>
          {showTagline && (
            <span className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${tone === 'dark' ? 'text-white/70' : 'text-navy-700'}`}>
              Soluciones Jurídicas y Financieras
            </span>
          )}
        </span>
      )}
    </span>
  );
}
