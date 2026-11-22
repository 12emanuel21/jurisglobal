import { MessageCircle } from 'lucide-react';
import { whatsappUrl } from '@/lib/site';

interface Props {
  label?: string;
  variant?: 'solid' | 'outline' | 'onDark';
  className?: string;
  message?: string;
  /** Solo ícono (44×44) con la etiqueta para lectores de pantalla */
  compact?: boolean;
}

const STYLES = {
  // Verde WhatsApp oscurecido: texto blanco con contraste AA (5.4:1)
  solid: 'bg-[#177a41] text-white hover:bg-[#12663a] shadow-sm',
  outline: 'border border-navy/20 bg-white text-navy hover:border-navy/40 hover:bg-slate-50',
  onDark: 'border border-white/30 bg-white/10 text-white hover:bg-white/20',
} as const;

/** Enlace directo a WhatsApp (wa.me). Sin número configurado no se muestra. */
export function WhatsAppButton({ label = 'Escríbenos por WhatsApp', variant = 'solid', className = '', message, compact = false }: Props) {
  const href = whatsappUrl(message);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={compact ? label : undefined}
      className={`tap inline-flex items-center justify-center gap-2 rounded-xl ${compact ? 'w-11 px-0' : 'px-5'} text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 ${STYLES[variant]} ${className}`}
    >
      <MessageCircle className="h-5 w-5" aria-hidden="true" />
      {!compact && <span>{label}</span>}
    </a>
  );
}
