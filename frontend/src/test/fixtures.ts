import { vi } from 'vitest';
import type { PublicConfig } from '@/lib/public-config';

/** Igual que la semilla del backend: las 6 áreas de servicio (nombres cortos) + Otro */
export const MOTIVOS = [
  { id: 'm-centrales', name: 'Centrales de riesgo' },
  { id: 'm-insolvencia', name: 'Insolvencia y deudas' },
  { id: 'm-reestructuracion', name: 'Reestructuración' },
  { id: 'm-procesos', name: 'Procesos y embargos' },
  { id: 'm-laboral', name: 'Derecho laboral' },
  { id: 'm-familia', name: 'Familia y tránsito' },
  { id: 'm-otro', name: 'Otro' },
];

export function makeConfig(patch: Partial<PublicConfig> = {}): PublicConfig {
  return {
    motivos: MOTIVOS,
    showConsultationPrice: false,
    consultationPrice: null,
    currency: 'COP',
    legal: { privacy: '/legal/privacidad', terms: '/legal/terminos', cookies: '/legal/cookies' },
    consents: {
      privacyAndTerms: { version: 1, text: 'Acepto el Aviso de Privacidad, los Términos y Condiciones y la Política de Cookies de JurisGlobal.' },
      contactAndDataProcessing: {
        version: 1,
        text: 'Acepto ser contactado por medio de una cuenta institucional y verificada de JurisGlobal y autorizo el tratamiento de mis datos personales.',
      },
    },
    company: { name: 'JURISGLOBAL', slogan: 'Tu tranquilidad, nuestra misión.' },
    ...patch,
  };
}

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

/**
 * fetch simulado: GET /api/public/config devuelve `config`; POST /api/leads responde `leadResponse`.
 * Devuelve el mock para inspeccionar las llamadas.
 */
export function mockApi(config: PublicConfig | null, leadResponse: { status: number; body: unknown } = { status: 201, body: { ok: true } }) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/public/config') return config ? json(200, config) : json(503, { message: 'down' });
    if (url === '/api/leads' && init?.method === 'POST') return json(leadResponse.status, leadResponse.body);
    return json(404, {});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const leadPosts = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(([url, init]) => String(url) === '/api/leads' && init?.method === 'POST');
