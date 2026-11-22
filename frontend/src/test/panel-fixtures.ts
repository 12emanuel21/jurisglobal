import { vi } from 'vitest';
import type { LeadDetail, LeadListItem } from '@/lib/leads';

type Handler = (init: RequestInit | undefined, url: URL) => { status?: number; body?: unknown } | undefined;

/**
 * fetch simulado por rutas: { 'GET /api/admin/leads': handler, 'PATCH /api/admin/leads/l1': … }.
 * Se compara la ruta sin la query; el handler recibe la URL completa para revisar los filtros.
 */
export function routeFetch(routes: Record<string, Handler>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const handler = routes[`${method} ${url.pathname}`];
    const result = handler?.(init, url) ?? { status: 404, body: { message: `Sin ruta simulada: ${method} ${url.pathname}` } };
    return Promise.resolve(
      new Response(JSON.stringify(result.body ?? {}), { status: result.status ?? 200, headers: { 'Content-Type': 'application/json' } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Llamadas a una ruta (método + ruta sin query) */
export const callsTo = (fetchMock: ReturnType<typeof routeFetch>, method: string, path: string) =>
  fetchMock.mock.calls
    .map(([input, init]) => ({ url: new URL(String(input), 'http://localhost'), init }))
    .filter(({ url, init }) => (init?.method ?? 'GET').toUpperCase() === method && url.pathname === path);

export const bodyOf = (init: RequestInit | undefined) => JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;

export function makeLead(patch: Partial<LeadListItem> = {}): LeadListItem {
  return {
    id: 'l1',
    fullName: 'Ana María Pérez',
    phone: '+573001234567',
    email: 'ana@correo.co',
    motivo: { id: 'm-transito', name: 'Tránsito' },
    origin: 'WEB',
    lastOrigin: 'WEB',
    status: 'NEW',
    assignedTo: null,
    submissionCount: 1,
    createdAt: '2026-11-22T15:00:00.000Z',
    lastSubmittedAt: '2026-11-22T15:00:00.000Z',
    anonymizedAt: null,
    optedOut: false,
    conversationId: null,
    ...patch,
  };
}

export function makeDetail(patch: Partial<LeadDetail> = {}): LeadDetail {
  return {
    ...makeLead(),
    optedOutAt: null,
    notes: [{ id: 'n1', body: 'Recontacto automático por WhatsApp (envío #2).', createdAt: '2026-11-22T16:00:00.000Z', author: null }],
    consents: [
      {
        id: 'c1',
        purpose: 'CONTACT_AND_DATA_PROCESSING',
        granted: true,
        channel: 'WEB',
        textVersion: 'consent.web.contact@1',
        textSnapshot: 'Acepto ser contactado por medio de una cuenta institucional y verificada de JurisGlobal.',
        createdAt: '2026-11-22T15:00:00.000Z',
      },
    ],
    ...patch,
  };
}

export const ASSIGNEES = [
  { id: 'u-admin', name: 'Ronaldo Jiménez', role: 'ADMIN' as const },
  { id: 'u-asesor', name: 'Laura Asesora', role: 'ASESOR' as const },
];
