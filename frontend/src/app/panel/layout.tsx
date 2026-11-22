'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { SudoProvider } from '@/context/SudoContext';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import { canAccessPanelPath, PANEL_HOME } from '@/lib/roles';

/** Panel de administración (ruta protegida, ESP §4/§8). .jg-panel delimita el modo claro de globals.css */
export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <div className="jg-panel">
        <PanelShell>{children}</PanelShell>
      </div>
    </ThemeProvider>
  );
}

function PanelShell({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const allowed = !user || canAccessPanelPath(user.role, pathname);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (!allowed) router.replace(PANEL_HOME);
  }, [isAuthenticated, isLoading, allowed, router, pathname]);

  if (isLoading || !isAuthenticated || !allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-slate-950">
        <p className="flex items-center gap-2 text-xs font-semibold text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Verificando sesión...
        </p>
      </div>
    );
  }

  return (
    <SudoProvider>
      <div className="flex h-screen bg-gray-50 text-gray-900 antialiased dark:bg-[#0b1626] dark:text-slate-100">
        <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar onMenuClick={() => setMobileOpen(true)} />
          <main className="relative flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="mx-auto w-full max-w-7xl">{children}</div>
          </main>
        </div>
      </div>
    </SudoProvider>
  );
}
