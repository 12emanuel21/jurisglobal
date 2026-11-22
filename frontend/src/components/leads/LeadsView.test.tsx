import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadsView } from './LeadsView';
import { ASSIGNEES, callsTo, makeDetail, makeLead, routeFetch } from '@/test/panel-fixtures';
import { MOTIVOS } from '@/test/fixtures';

// Tiempo real simulado: se guarda el handler para disparar eventos de Socket.io
const realtime = vi.hoisted(() => ({ handler: null as null | ((event: string, payload: unknown) => void) }));
vi.mock('@/lib/realtime', () => ({
  usePanelEvents: (_events: string[], handler: (event: string, payload: unknown) => void) => {
    realtime.handler = handler;
  },
}));
vi.mock('@/context/SudoContext', () => ({
  useSudoMode: () => ({ sudoFetch: (path: string, init?: RequestInit) => fetch(`/api${path}`, init) }),
}));

const LEADS = [
  makeLead(),
  makeLead({ id: 'l2', fullName: 'Carlos Gómez', phone: '+573109998877', status: 'CONTACTED', origin: 'WHATSAPP', motivo: { id: 'm-insolvencia', name: 'Insolvencia y deudas' }, submissionCount: 2 }),
];

function setup(items = LEADS) {
  return routeFetch({
    'GET /api/admin/leads': () => ({ body: { items, total: items.length, page: 1, pageSize: 25, pages: 1 } }),
    'GET /api/admin/leads/summary': () => ({ body: { byStatus: { NEW: 7, CONTACTED: 3, SCHEDULED: 2, CLOSED: 1 }, total: 13 } }),
    'GET /api/public/config': () => ({ body: { motivos: MOTIVOS } }),
    'GET /api/admin/leads/assignees': () => ({ body: ASSIGNEES }),
    'GET /api/admin/leads/l2': () => ({ body: makeDetail({ id: 'l2', fullName: 'Carlos Gómez' }) }),
  });
}

describe('LeadsView (listado y filtros)', () => {
  beforeEach(() => window.history.replaceState(null, '', '/panel'));
  afterEach(() => vi.unstubAllGlobals());

  it('muestra las tarjetas por estado y el listado con teléfono, motivo, origen y estado', async () => {
    setup();
    render(<LeadsView isAdmin={false} />);

    expect(await screen.findByTestId('summary-NEW')).toHaveTextContent('7');
    expect(screen.getByTestId('summary-CONTACTED')).toHaveTextContent('3');
    expect(screen.getByTestId('summary-SCHEDULED')).toHaveTextContent('2');
    expect(screen.getByTestId('summary-CLOSED')).toHaveTextContent('1');

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3); // encabezado + 2
    expect(within(rows[1]).getByText('Ana María Pérez')).toBeInTheDocument();
    expect(within(rows[1]).getByText('+57 300 123 4567')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Insolvencia y deudas')).toBeInTheDocument();
    expect(within(rows[2]).getByText('WhatsApp')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Contactado')).toBeInTheDocument();
    expect(screen.getByText('2 leads · página 1 de 1')).toBeInTheDocument();
  });

  it('los filtros (estado, motivo, origen, fechas y búsqueda) viajan al servidor y reinician la página', async () => {
    const user = userEvent.setup();
    const fetchMock = setup();
    render(<LeadsView isAdmin={false} />);
    await screen.findByRole('table');

    await user.selectOptions(screen.getByLabelText('Estado'), 'CONTACTED');
    await user.selectOptions(screen.getByLabelText('Motivo'), 'm-insolvencia');
    await user.selectOptions(screen.getByLabelText('Origen'), 'WHATSAPP');
    await user.type(screen.getByLabelText('Desde'), '2026-11-01');
    await user.type(screen.getByLabelText('Buscar'), 'gómez');

    await waitFor(() => {
      const last = callsTo(fetchMock, 'GET', '/api/admin/leads').at(-1)!.url.searchParams;
      expect(Object.fromEntries(last)).toEqual({
        q: 'gómez',
        status: 'CONTACTED',
        motivoId: 'm-insolvencia',
        origin: 'WHATSAPP',
        from: '2026-11-01',
        page: '1',
        pageSize: '25',
      });
    });

    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    await waitFor(() => {
      const last = callsTo(fetchMock, 'GET', '/api/admin/leads').at(-1)!.url.searchParams;
      expect(Object.fromEntries(last)).toEqual({ page: '1', pageSize: '25' });
    });
  });

  it('una tarjeta del resumen filtra por su estado', async () => {
    const user = userEvent.setup();
    const fetchMock = setup();
    render(<LeadsView isAdmin={false} />);
    await user.click(await screen.findByRole('button', { name: /Agendados/ }));
    await waitFor(() => expect(callsTo(fetchMock, 'GET', '/api/admin/leads').at(-1)!.url.searchParams.get('status')).toBe('SCHEDULED'));
    expect(screen.getByRole('button', { name: /Agendados/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('tiempo real: un lead nuevo muestra un aviso discreto y refresca sin recargar', async () => {
    const user = userEvent.setup();
    const fetchMock = setup();
    render(<LeadsView isAdmin={false} />);
    await screen.findByRole('table');
    const before = callsTo(fetchMock, 'GET', '/api/admin/leads').length;

    act(() => realtime.handler?.('lead:new', { leadId: 'l2', isNew: true }));
    expect(await screen.findByRole('status')).toHaveTextContent('Entró un lead nuevo');
    await waitFor(() => expect(callsTo(fetchMock, 'GET', '/api/admin/leads').length).toBeGreaterThan(before));

    act(() => realtime.handler?.('lead:updated', { leadId: 'l2', isNew: false }));
    expect(await screen.findByRole('status')).toHaveTextContent('recontacto');

    // "Ver" abre el detalle del lead
    await user.click(screen.getByRole('button', { name: 'Ver' }));
    expect(await screen.findByRole('dialog', { name: 'Carlos Gómez' })).toBeInTheDocument();
    expect(window.location.search).toBe('?lead=l2');
  });

  it('sin resultados con filtros lo dice claramente', async () => {
    const user = userEvent.setup();
    setup([]);
    render(<LeadsView isAdmin={false} />);
    expect(await screen.findByText('Aún no hay leads.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Origen'), 'WEB');
    expect(await screen.findByText('Ningún lead coincide con los filtros.')).toBeInTheDocument();
  });
});
