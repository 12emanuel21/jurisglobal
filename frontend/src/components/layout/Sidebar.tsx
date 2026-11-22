'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getNavItems, isNavItemActive } from './navigation';
import { BrandMark } from './BrandMark';

export default function Sidebar({ mobileOpen = false, onClose }: { mobileOpen?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const navItems = getNavItems(user?.role);

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-gray-900/40 backdrop-blur-sm md:hidden" onClick={onClose} aria-hidden="true" />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-gray-200 bg-white transition-transform duration-200 dark:border-slate-800 dark:bg-slate-950 md:static md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-gray-200 px-5 dark:border-slate-800">
          <Link href="/panel" onClick={onClose}>
            <BrandMark />
          </Link>
          <button type="button" onClick={onClose} className="tap rounded-lg p-2 text-gray-500 hover:bg-gray-100 md:hidden" aria-label="Cerrar menú">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navItems.map(({ label, href, icon: Icon }) => {
            const active = isNavItemActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                aria-current={active ? 'page' : undefined}
                className={`tap flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[var(--brand-navy)]/10 text-[var(--brand-navy)] dark:bg-white/10 dark:text-white'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
                <span className="flex-1">{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-gray-200 p-4 text-[11px] text-gray-400 dark:border-slate-800 dark:text-slate-500">
          Tu tranquilidad, nuestra misión.
        </div>
      </aside>
    </>
  );
}
