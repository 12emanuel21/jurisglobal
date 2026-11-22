'use client';

import { useEffect, useState } from 'react';

/** Respuesta de GET /api/public/config (backend/src/leads/public-config.controller.ts) */
export interface PublicConfig {
  motivos: Array<{ id: string; name: string }>;
  showConsultationPrice: boolean;
  consultationPrice: number | null;
  currency: string;
  legal: { privacy: string; terms: string; cookies: string };
  consents: {
    privacyAndTerms: { version: number; text: string };
    contactAndDataProcessing: { version: number; text: string };
  };
  company: { name: string; slogan: string };
}

let pending: Promise<PublicConfig> | null = null;

/** Una sola petición compartida por todos los bloques de la página (hero y formulario) */
export function fetchPublicConfig(): Promise<PublicConfig> {
  pending ??= fetch('/api/public/config', { headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? (res.json() as Promise<PublicConfig>) : Promise.reject(new Error(`HTTP ${res.status}`))))
    .catch((error: unknown) => {
      pending = null; // permite reintentar en la siguiente visita
      throw error;
    });
  return pending;
}

/** Solo pruebas */
export function resetPublicConfigCache() {
  pending = null;
}

export type PublicConfigState =
  | { status: 'loading'; config: null }
  | { status: 'ready'; config: PublicConfig }
  | { status: 'error'; config: null };

export function usePublicConfig(): PublicConfigState {
  const [state, setState] = useState<PublicConfigState>({ status: 'loading', config: null });
  useEffect(() => {
    let cancelled = false;
    fetchPublicConfig()
      .then((config) => !cancelled && setState({ status: 'ready', config }))
      .catch(() => !cancelled && setState({ status: 'error', config: null }));
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/** 100000 -> "$100.000 COP" */
export function formatCop(value: number): string {
  return `$${Math.round(value).toLocaleString('es-CO')} COP`;
}
