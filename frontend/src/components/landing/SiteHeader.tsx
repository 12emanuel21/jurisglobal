'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { WhatsAppButton } from './WhatsAppButton';

const LINKS = [
  { href: '/#servicios', label: 'Servicios' },
  { href: '/#nosotros', label: 'Nosotros' },
  { href: '/#contacto', label: 'Contacto' },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="tap flex items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold" aria-label="JurisGlobal, inicio">
          <Logo />
        </Link>

        <nav aria-label="Principal" className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="tap inline-flex items-center rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-navy">
              {l.label}
            </a>
          ))}
          <WhatsAppButton label="WhatsApp" className="ml-2" />
        </nav>

        <div className="flex items-center gap-2 md:hidden">
          <WhatsAppButton label="Escríbenos por WhatsApp" compact />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="menu-movil"
            aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
            className="tap inline-flex w-11 items-center justify-center rounded-xl border border-slate-200 text-navy"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <nav id="menu-movil" aria-label="Menú móvil" className="border-t border-slate-200 bg-white px-4 pb-4 md:hidden">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="tap flex items-center border-b border-slate-100 text-base font-medium text-slate-800">
              {l.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
