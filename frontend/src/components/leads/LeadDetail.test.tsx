import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeadDetail } from './LeadDetail';
import { ASSIGNEES, bodyOf, callsTo, makeDetail, routeFetch } from '@/test/panel-fixtures';

vi.mock('@/context/SudoContext', () => ({
  useSudoMode: () => ({ sudoFetch: (path: string, init?: RequestInit) => fetch(`/api${path}`, init) }),
}));

function setup(detail = makeDetail()) {
  let current = detail;
  const fetchMock = routeFetch({
    'GET /api/admin/leads/l1': () => ({ body: current }),
    'PATCH /api/admin/leads/l1': (init) => {
      const patch = bodyOf(init);
      const assignedTo = 'assignedToId' in patch ? (ASSIGNEES.find((a) => a.id === patch.assignedToId) ?? null) : current.assignedTo;
      current = { ...current, ...(patch.status ? { status: patch.status as typeof current.status } : {}), assignedTo };
      return { body: current };
    },
    'POST /api/admin/leads/l1/notes': (init) => ({
      status: 201,
      body: { id: 'n2', body: bodyOf(init).body, createdAt: '2026-11-22T17:00:00.000Z', author: { id: 'u-asesor', name: 'Laura Asesora' } },
    }),
    'POST /api/admin/leads/l1/anonymize': () => {
      current = { ...current, fullName: 'Titular anonimizado', phone: null, email: null, anonymizedAt: '2026-11-22T18:00:00.000Z' };
      return { body: current };
    },
  });
  const onChanged = vi.fn();
  return { fetchMock, onChanged };
}

const renderDetail = (isAdmin: boolean, onChanged = vi.fn()) =>
  render(<LeadDetail leadId="l1" isAdmin={isAdmin} assignees={ASSIGNEES} onClose={vi.fn()} onChanged={onChanged} />);

describe('LeadDetail (detalle del lead)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('muestra datos, envíos, autorizaciones y el acceso al chat del Inbox', async () => {
    setup(makeDetail({ conversationId: 'conv-1', submissionCount: 3 }));
    renderDetail(false);
    expect(await screen.findByRole('heading', { name: 'Ana María Pérez' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /\+57 300 123 4567/ })).toHaveAttribute('href', 'tel:+573001234567');
    expect(screen.getByText('3 envíos (2 recontactos)')).toBeInTheDocument();
    expect(screen.getByText(/Contacto y tratamiento de datos · Aceptó/)).toBeInTheDocument();
    expect(screen.getByText(/versión consent\.web\.contact@1/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir chat en el Inbox' })).toHaveAttribute('href', '/panel/conversaciones?c=conv-1');
  });

  it('cambia el estado, asigna responsable y agrega una nota interna', async () => {
    const user = userEvent.setup();
    const { fetchMock, onChanged } = setup();
    renderDetail(false, onChanged);
    await screen.findByRole('heading', { name: 'Ana María Pérez' });

    await user.selectOptions(screen.getByLabelText('Estado'), 'CONTACTED');
    await waitFor(() => expect(bodyOf(callsTo(fetchMock, 'PATCH', '/api/admin/leads/l1')[0].init)).toEqual({ status: 'CONTACTED' }));
    expect(screen.getByLabelText('Estado')).toHaveValue('CONTACTED');

    await user.selectOptions(screen.getByLabelText('Responsable'), 'u-asesor');
    await waitFor(() => expect(bodyOf(callsTo(fetchMock, 'PATCH', '/api/admin/leads/l1')[1].init)).toEqual({ assignedToId: 'u-asesor' }));
    await user.selectOptions(screen.getByLabelText('Responsable'), '');
    await waitFor(() => expect(bodyOf(callsTo(fetchMock, 'PATCH', '/api/admin/leads/l1')[2].init)).toEqual({ assignedToId: null }));

    const add = screen.getByRole('button', { name: 'Agregar nota' });
    expect(add).toBeDisabled();
    await user.type(screen.getByLabelText('Nueva nota'), 'Llamé, envía el comparendo mañana.');
    await user.click(add);
    expect(await screen.findByText('Llamé, envía el comparendo mañana.')).toBeInTheDocument();
    expect(screen.getByText('Llamé, envía el comparendo mañana.').closest('li')).toHaveTextContent('Laura Asesora');
    expect(bodyOf(callsTo(fetchMock, 'POST', '/api/admin/leads/l1/notes')[0].init)).toEqual({ body: 'Llamé, envía el comparendo mañana.' });
    expect(onChanged).toHaveBeenCalledTimes(4);
  });

  it('el ASESOR no ve la opción de anonimizar', async () => {
    setup();
    renderDetail(false);
    await screen.findByRole('heading', { name: 'Ana María Pérez' });
    expect(screen.queryByRole('button', { name: 'Anonimizar datos personales' })).not.toBeInTheDocument();
  });

  it('ADMIN: la anonimización exige confirmar escribiendo ANONIMIZAR y luego muestra el lead anonimizado', async () => {
    const user = userEvent.setup();
    const { fetchMock } = setup();
    renderDetail(true);
    await screen.findByRole('heading', { name: 'Ana María Pérez' });

    await user.click(screen.getByRole('button', { name: 'Anonimizar datos personales' }));
    const dialog = screen.getByRole('alertdialog', { name: /Anonimizar datos personales/ });
    expect(dialog).toHaveTextContent('No se puede deshacer');
    const confirm = screen.getByRole('button', { name: 'Anonimizar definitivamente' });
    expect(confirm).toBeDisabled();

    // Cancelar no envía nada
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/admin/leads/l1/anonymize')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Anonimizar datos personales' }));
    await user.type(screen.getByLabelText(/Para confirmar escribe/), 'anonimiza');
    expect(screen.getByRole('button', { name: 'Anonimizar definitivamente' })).toBeDisabled();
    await user.type(screen.getByLabelText(/Para confirmar escribe/), 'r');
    await user.click(screen.getByRole('button', { name: 'Anonimizar definitivamente' }));

    expect(await screen.findByRole('heading', { name: 'Titular anonimizado' })).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/admin/leads/l1/anonymize')).toHaveLength(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText(/Anonimizado el/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anonimizar datos personales' })).not.toBeInTheDocument();
  });

  it('si el servidor rechaza la anonimización, el error se muestra en el diálogo', async () => {
    const user = userEvent.setup();
    routeFetch({
      'GET /api/admin/leads/l1': () => ({ body: makeDetail() }),
      'POST /api/admin/leads/l1/anonymize': () => ({ status: 403, body: { message: 'Tu rol no tiene acceso a esta sección' } }),
    });
    renderDetail(true);
    await user.click(await screen.findByRole('button', { name: 'Anonimizar datos personales' }));
    await user.type(screen.getByLabelText(/Para confirmar escribe/), 'ANONIMIZAR');
    await user.click(screen.getByRole('button', { name: 'Anonimizar definitivamente' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tu rol no tiene acceso a esta sección');
  });
});
