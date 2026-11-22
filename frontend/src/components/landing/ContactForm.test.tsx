import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPublicConfigCache } from '@/lib/public-config';
import { leadPosts, makeConfig, mockApi } from '@/test/fixtures';
import { ContactForm } from './ContactForm';
import { SELECT_MOTIVO_EVENT } from './SelectMotivoLink';

const PRIVACY = /Acepto el Aviso de Privacidad/;
const CONTACT = /Acepto ser contactado por medio de una cuenta institucional/;

async function fillValid(user: ReturnType<typeof userEvent.setup>, phone = '300 123 4567') {
  await user.type(screen.getByLabelText('Nombre completo'), '  Ana   María Pérez ');
  await user.type(screen.getByLabelText('Teléfono'), phone);
  await user.type(screen.getByLabelText('Correo electrónico'), 'Ana@Correo.co');
  await user.selectOptions(screen.getByLabelText('Motivo de tu consulta'), 'Tránsito');
}

describe('ContactForm (formulario unificado)', () => {
  beforeEach(() => resetPublicConfigCache());
  afterEach(() => vi.unstubAllGlobals());

  it('carga los motivos activos en orden y los textos y enlaces de autorización desde la configuración', async () => {
    const fetchMock = mockApi(makeConfig());
    render(<ContactForm />);
    const select = await screen.findByLabelText('Motivo de tu consulta');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Selecciona una opción', 'Tránsito', 'Cartera', 'Deudas', 'Otro']);
    expect(screen.getByRole('checkbox', { name: PRIVACY })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: CONTACT })).not.toBeChecked();
    expect(screen.getByRole('link', { name: 'Aviso de Privacidad' })).toHaveAttribute('href', '/legal/privacidad');
    expect(screen.getByRole('link', { name: 'Términos y Condiciones' })).toHaveAttribute('href', '/legal/terminos');
    expect(screen.getByRole('link', { name: 'Política de Cookies' })).toHaveAttribute('href', '/legal/cookies');
    expect(fetchMock).toHaveBeenCalledWith('/api/public/config', expect.anything());
  });

  it('un motivo inactivo (ausente en la configuración) no aparece', async () => {
    mockApi(makeConfig({ motivos: [{ id: 'm-transito', name: 'Tránsito' }, { id: 'm-otro', name: 'Otro' }] }));
    render(<ContactForm />);
    const select = await screen.findByLabelText('Motivo de tu consulta');
    expect(within(select).queryByRole('option', { name: 'Cartera' })).toBeNull();
  });

  it('rechaza el envío si faltan las autorizaciones (no llama a POST /api/leads)', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi(makeConfig());
    render(<ContactForm />);
    await screen.findByLabelText('Motivo de tu consulta');
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Enviar mis datos' }));

    expect(screen.getByText('Debes aceptar para continuar.')).toBeInTheDocument();
    expect(screen.getByText('Debes autorizar para continuar.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: PRIVACY })).toHaveAttribute('aria-invalid', 'true');
    expect(leadPosts(fetchMock)).toHaveLength(0);
  });

  it.each(['12345', '+1 305 555 0100', '200 123 4567'])('rechaza el teléfono inválido %s', async (phone) => {
    const user = userEvent.setup();
    const fetchMock = mockApi(makeConfig());
    render(<ContactForm />);
    await screen.findByLabelText('Motivo de tu consulta');
    await fillValid(user, phone);
    await user.click(screen.getByRole('checkbox', { name: PRIVACY }));
    await user.click(screen.getByRole('checkbox', { name: CONTACT }));
    await user.click(screen.getByRole('button', { name: 'Enviar mis datos' }));

    expect(screen.getByText(/Ingresa un celular \(3xx\) o fijo \(60x\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Teléfono')).toHaveFocus();
    expect(leadPosts(fetchMock)).toHaveLength(0);
  });

  it('envío válido: POST /api/leads con origin "web", +57, el id del motivo y el honeypot vacío; muestra la confirmación', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi(makeConfig(), { status: 201, body: { ok: true, message: 'Recibimos tus datos.' } });
    render(<ContactForm />);
    await screen.findByLabelText('Motivo de tu consulta');
    await fillValid(user);
    await user.click(screen.getByRole('checkbox', { name: PRIVACY }));
    await user.click(screen.getByRole('checkbox', { name: CONTACT }));
    await user.click(screen.getByRole('button', { name: 'Enviar mis datos' }));

    expect(await screen.findByRole('status')).toHaveTextContent('¡Gracias, Ana!');
    expect(screen.getByRole('status')).toHaveTextContent('Un asesor de JurisGlobal se comunicará contigo pronto por llamada o correo');

    const posts = leadPosts(fetchMock);
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1]?.body))).toEqual({
      fullName: 'Ana María Pérez',
      phone: '+573001234567',
      email: 'ana@correo.co',
      motivo: 'm-transito',
      origin: 'web',
      privacyAndTerms: true,
      contactAndDataProcessing: true,
      website: '',
    });
  });

  it('429: avisa del límite de envíos sin perder lo escrito', async () => {
    const user = userEvent.setup();
    mockApi(makeConfig(), { status: 429, body: { message: 'ThrottlerException' } });
    render(<ContactForm />);
    await screen.findByLabelText('Motivo de tu consulta');
    await fillValid(user);
    await user.click(screen.getByRole('checkbox', { name: PRIVACY }));
    await user.click(screen.getByRole('checkbox', { name: CONTACT }));
    await user.click(screen.getByRole('button', { name: 'Enviar mis datos' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Has enviado varios formularios en poco tiempo');
    expect(screen.getByLabelText('Nombre completo')).toHaveValue('  Ana   María Pérez ');
  });

  it('400 del servidor: muestra su mensaje', async () => {
    const user = userEvent.setup();
    mockApi(makeConfig(), { status: 400, body: { message: 'El motivo no es válido' } });
    render(<ContactForm />);
    await screen.findByLabelText('Motivo de tu consulta');
    await fillValid(user);
    await user.click(screen.getByRole('checkbox', { name: PRIVACY }));
    await user.click(screen.getByRole('checkbox', { name: CONTACT }));
    await user.click(screen.getByRole('button', { name: 'Enviar mis datos' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El motivo no es válido');
  });

  it('la tarjeta de un servicio preselecciona el motivo', async () => {
    mockApi(makeConfig());
    render(<ContactForm />);
    const select = await screen.findByLabelText('Motivo de tu consulta');
    act(() => {
      window.dispatchEvent(new CustomEvent(SELECT_MOTIVO_EVENT, { detail: 'Deudas' }));
    });
    expect(select).toHaveValue('m-deudas');
  });

  it('si la configuración no carga, ofrece WhatsApp en lugar del formulario', async () => {
    mockApi(null);
    render(<ContactForm />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar el formulario');
  });
});
