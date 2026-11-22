import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsultationContactForm, parseEmailList } from './ConsultationContactForm';
import { MotivosEditor } from './MotivosEditor';
import { bodyOf, callsTo, routeFetch } from '@/test/panel-fixtures';
import type { AdminMotivo, EditableSettings } from '@/lib/admin-settings';

const SETTINGS: EditableSettings = {
  showConsultationPrice: false,
  consultationPrice: null,
  'notify.leadEmails': [],
  'company.email': null,
  'company.phone': null,
  'bot.greeting': '¡Hola! Bienvenido a JurisGlobal.',
  'bot.declined': 'Entendido.',
  'bot.closing': 'Gracias, hemos registrado tus datos.',
  'bot.optOutConfirmation': 'Listo.',
  'marketing.maxPerContactPerDay': 1,
  'marketing.maxPerContactPerWeek': 2,
  'marketing.dailyGlobalLimit': 250,
};

describe('Configuración · Asesoría y contacto', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('enciende el interruptor del precio, muestra la vista previa en COP y guarda', async () => {
    const user = userEvent.setup();
    const fetchMock = routeFetch({
      'PATCH /api/admin/settings': (init) => ({ body: { ...SETTINGS, ...(bodyOf(init).values as object) } }),
    });
    const onSaved = vi.fn();
    render(<ConsultationContactForm settings={SETTINGS} onSaved={onSaved} />);

    const toggle = screen.getByRole('switch', { name: 'Mostrar el precio en la web y en el chatbot' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.type(screen.getByLabelText('Valor de la asesoría inicial (COP)'), '100.000');
    expect(screen.getByText('Se mostrará como $100.000 COP')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Correos que reciben el aviso/), 'socios@jurisglobal.co{enter}equipo@jurisglobal.co');
    await user.type(screen.getByLabelText('Correo institucional de contacto'), 'contacto@jurisglobal.co');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(bodyOf(callsTo(fetchMock, 'PATCH', '/api/admin/settings')[0].init)).toEqual({
      values: {
        showConsultationPrice: true,
        consultationPrice: 100000,
        'notify.leadEmails': ['socios@jurisglobal.co', 'equipo@jurisglobal.co'],
        'company.email': 'contacto@jurisglobal.co',
        'company.phone': null,
      },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Cambios guardados');
  });

  it('muestra el error del servidor (p. ej. precio visible sin valor)', async () => {
    const user = userEvent.setup();
    routeFetch({
      'PATCH /api/admin/settings': () => ({ status: 400, body: { message: ['Para mostrar el precio, escribe el valor de la asesoría inicial'] } }),
    });
    render(<ConsultationContactForm settings={SETTINGS} onSaved={vi.fn()} />);
    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Para mostrar el precio, escribe el valor de la asesoría inicial');
  });

  it('separa la lista de correos por línea, coma o punto y coma', () => {
    expect(parseEmailList('a@x.co, b@x.co;\nc@x.co  ')).toEqual(['a@x.co', 'b@x.co', 'c@x.co']);
  });
});

describe('Configuración · Motivos', () => {
  afterEach(() => vi.unstubAllGlobals());

  const base: AdminMotivo[] = [
    { id: 'm1', name: 'Tránsito', isActive: true, sortOrder: 0, leadCount: 5 },
    { id: 'm2', name: 'Cartera', isActive: true, sortOrder: 1, leadCount: 1 },
    { id: 'm3', name: 'Otro', isActive: true, sortOrder: 2, leadCount: 0 },
  ];

  function setup() {
    let list = [...base];
    const fetchMock = routeFetch({
      'GET /api/admin/motivos': () => ({ body: list }),
      'POST /api/admin/motivos': (init) => {
        list = [...list, { id: 'm4', name: String(bodyOf(init).name), isActive: true, sortOrder: 3, leadCount: 0 }];
        return { status: 201, body: list };
      },
      'PATCH /api/admin/motivos/m3': (init) => {
        list = list.map((m) => (m.id === 'm3' ? { ...m, ...bodyOf(init) } : m));
        return { body: list };
      },
      'PUT /api/admin/motivos/order': (init) => {
        const ids = bodyOf(init).ids as string[];
        list = ids.map((id, i) => ({ ...list.find((m) => m.id === id)!, sortOrder: i }));
        return { body: list };
      },
    });
    return fetchMock;
  }

  it('lista en orden, crea, desactiva y reordena', async () => {
    const user = userEvent.setup();
    const fetchMock = setup();
    render(<MotivosEditor />);
    const list = await screen.findByRole('list', { name: 'Motivos' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Tránsito'),
      expect.stringContaining('Cartera'),
      expect.stringContaining('Otro'),
    ]);
    expect(screen.getByText('5 leads')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Nuevo motivo/), 'Sucesiones');
    await user.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(await screen.findByTestId('motivo-Sucesiones')).toBeInTheDocument();
    expect(bodyOf(callsTo(fetchMock, 'POST', '/api/admin/motivos')[0].init)).toEqual({ name: 'Sucesiones' });

    await user.click(screen.getByRole('checkbox', { name: 'Otro activo' }));
    await waitFor(() => expect(bodyOf(callsTo(fetchMock, 'PATCH', '/api/admin/motivos/m3')[0].init)).toEqual({ isActive: false }));
    expect(await screen.findByRole('status')).toHaveTextContent('«Otro» desactivado.');

    await user.click(screen.getByRole('button', { name: 'Subir Cartera' }));
    await waitFor(() => expect(bodyOf(callsTo(fetchMock, 'PUT', '/api/admin/motivos/order')[0].init)).toEqual({ ids: ['m2', 'm1', 'm3', 'm4'] }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Cartera'));
    expect(screen.getByRole('button', { name: 'Subir Cartera' })).toBeDisabled();
  });

  it('no deja desactivar el último motivo activo', async () => {
    routeFetch({
      'GET /api/admin/motivos': () => ({ body: [{ id: 'm1', name: 'Tránsito', isActive: true, sortOrder: 0, leadCount: 0 }, { id: 'm2', name: 'Cartera', isActive: false, sortOrder: 1, leadCount: 0 }] }),
    });
    render(<MotivosEditor />);
    expect(await screen.findByRole('checkbox', { name: 'Tránsito activo' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Cartera activo' })).toBeEnabled();
  });
});
