'use client';

import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { whatsappUrl } from '@/lib/site';

/**
 * Botón flotante de WhatsApp. Se oculta mientras el formulario (#contacto) está a la vista para no
 * tapar sus campos ni el botón de envío en el celular.
 */
export function WhatsAppFloat() {
  const href = whatsappUrl();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const target = document.getElementById('contacto');
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setHidden(entry.isIntersecting), { threshold: 0.05 });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Escríbenos por WhatsApp"
      data-testid="whatsapp-float"
      className={`fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#177a41] text-white shadow-lg shadow-black/20 transition-all hover:bg-[#12663a] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold/60 ${
        hidden ? 'pointer-events-none translate-y-4 opacity-0' : 'opacity-100'
      }`}
      tabIndex={hidden ? -1 : 0}
    >
      <MessageCircle className="h-7 w-7" aria-hidden="true" />
    </a>
  );
}
