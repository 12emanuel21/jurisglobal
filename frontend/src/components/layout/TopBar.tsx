'use client';

import { usePathname } from 'next/navigation';
import { LogOut, Menu } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ROLE_LABELS } from '@/lib/roles';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { getPageTitle } from './navigation';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase() || '?';
}

export default function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-950 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={onMenuClick} className="tap rounded-lg p-2 text-gray-500 hover:bg-gray-100 md:hidden" aria-label="Abrir menú">
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="truncate text-base font-semibold text-gray-900 dark:text-white">{getPageTitle(pathname)}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <ThemeToggle />
        <div className="hidden text-right sm:block">
          <p className="max-w-[220px] truncate text-sm font-medium text-gray-800 dark:text-slate-200">{user?.name}</p>
          <p className="text-[11px] font-medium text-gray-500 dark:text-slate-500">{user ? ROLE_LABELS[user.role] : ''}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--brand-navy)] text-xs font-bold text-[var(--brand-gold)]">
          {initials(user?.name ?? '')}
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="tap flex items-center gap-2 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-700 transition-colors hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-600 dark:border-slate-700 dark:text-slate-300"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Cerrar sesión</span>
        </button>
      </div>
    </header>
  );
}
