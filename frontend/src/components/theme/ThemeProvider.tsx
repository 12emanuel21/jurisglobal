'use client';

import React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

/** Clave propia: el tema es preferencia del panel, no de la web pública */
export const DASHBOARD_THEME_STORAGE_KEY = 'jg-panel-theme';

/** Sin una elección guardada, el panel y el login abren en claro */
export const DEFAULT_DASHBOARD_THEME = 'light';

/**
 * Tema claro/oscuro del panel y el login: next-themes pone la clase "dark" en <html>
 * (variante dark: de Tailwind) y recuerda la elección con el botón Sol/Luna. Sin elección guardada
 * abre en claro; no sigue el tema del sistema operativo (enableSystem={false}).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={DEFAULT_DASHBOARD_THEME}
      enableSystem={false}
      storageKey={DASHBOARD_THEME_STORAGE_KEY}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
