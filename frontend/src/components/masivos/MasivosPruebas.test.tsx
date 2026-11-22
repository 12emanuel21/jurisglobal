import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyOf, callsTo, routeFetch } from '@/test/panel-fixtures';
import type { CampaignPreview, ImportPreview, MassTemplate } from '@/lib/masivos';
import { WhatsAppPreview } from './WhatsAppPreview';
import { TestSendTab, isColombianMobileInput } from './TestSendTab';
import { CampaignForm } from './CampaignForm';
import { TemplatesTab } from './TemplatesTab';

vi.mock('@/context/SudoContext', () => ({
  useSudoMode: () => ({ sudoFetch: (path: string, init?: RequestInit) => fetch(`/api${path}`, init) }),
}));
vi.mock('@/lib/realtime', () => ({ usePanelEvents: () => undefined }));

const base: MassTemplate = {
  id: 't1',
  metaId: null,
  name: 'promo_asesoria',
  language: 'es_CO',
  category: 'MARKETING',
  purpose: 'MARKETING',
  status: 'APPROVED',
  headerText: null,
  bodyText: 'Hola {{1}}, tu cita de *{{2}}* es mañana.\n_Te esperamos._',
  footerText: 'Responde STOP para no recibir más',
  buttons: [{ text: 'No recibir más', role: 'OPT_OUT' }],
  variableCount: 2,
  hasOptOut: true,
  source: 'MANUAL',
  lastSyncedAt: null,
  updatedAt: '2026-11-22T15:00:00.000Z',
  campaigns: 0,
  problems: [],
  warnings: [],
};
const SIMPLE: MassTemplate = {
  ...base,
  id: 't0',
  name: 'prueba_envio_masivo',
  bodyText: 'Prueba de envío de JurisGlobal.',
  footerText: null,
  buttons: [],
  variableCount: 0,
  hasOptOut: false,
  warnings: ['Sin botón ni pie de baja: se recomienda agregar «Responde STOP para no recibir más».'],
};

describe('Masivos · teléfono de vista previa (WhatsApp)', () => {
  it('formatea negritas, cursivas y saltos de línea, reemplaza variables y resalta las que faltan', () => {
    render(<WhatsAppPreview header="JurisGlobal" body={base.bodyText} footer={base.footerText} buttons={['No recibir más']} params={['Ana']} />);
    const phone = screen.getByRole('figure', { name: 'Vista previa en WhatsApp' });
    const body = within(phone).getByTestId('wa-body');
    expect(body).toHaveTextContent('Hola Ana, tu cita de {{2}} es mañana.Te esperamos.');
    expect(body.querySelector('strong')).not.toBeNull();
    expect(body.querySelector('em')).toHaveTextContent('Te esperamos.');
    expect(body.querySelectorAll('br')).toHaveLength(1);
    expect(within(phone).getByTestId('wa-missing-var')).toHaveTextContent('{{2}}');
    expect(within(phone).getByTestId('wa-header')).toHaveTextContent('JurisGlobal');
    expect(within(phone).getByRole('list', { name: 'Botones de la plantilla' })).toHaveTextContent('No recibir más');
  });

  it('nunca interpreta HTML del texto', () => {
    render(<WhatsAppPreview body={'<img src=x onerror="alert(1)"> *hola*'} />);
    const body = screen.getByTestId('wa-body');
    expect(body.querySelector('img')).toBeNull();
    expect(body).toHaveTextContent('<img src=x onerror="alert(1)"> hola');
  });
});

describe('Masivos · envío de prueba / unitario', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('valida el celular colombiano', () => {
    expect(isColombianMobileInput('+57 300 123 4567')).toBe(true);
    expect(isColombianMobileInput('3001234567')).toBe(true);
    expect(isColombianMobileInput('601 555 1234')).toBe(false);
    expect(isColombianMobileInput('+57 300')).toBe(false);
  });

  it('plantilla aprobada sin variables: envía con «omitir horario» y muestra el resultado', async () => {
    const user = userEvent.setup();
    const fetchMock = routeFetch({
      'GET /api/admin/templates': () => ({
        body: { items: [SIMPLE, base, { ...base, id: 't9', name: 'pendiente', status: 'PENDING', problems: ['No aprobada'] }], canSync: false },
      }),
      'POST /api/admin/campaigns/test-send': () => ({
        body: { status: 'SENT', waMessageId: 'wamid.1', phone: '+57 300 123 4567', body: SIMPLE.bodyText, insideWindow: false, windowBypassed: true, conversationId: 'c1' },
      }),
    });
    render(<TestSendTab />);
    const select = await screen.findByLabelText('Plantilla aprobada');
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(3)); // la pendiente no aparece
    await user.selectOptions(select, 't0');
    expect(screen.getByText(/Aviso \(no bloquea\)/)).toBeInTheDocument();
    expect(screen.getByTestId('wa-body')).toHaveTextContent('Prueba de envío de JurisGlobal.');

    const send = screen.getByRole('button', { name: 'Enviar prueba' });
    expect(send).toBeDisabled(); // falta el celular
    await user.type(screen.getByLabelText('Celular (Colombia)'), '300 123 4567');
    await user.click(screen.getByLabelText(/Enviar inmediatamente \(omitir horario Ley 2300 por ser prueba\)/));
    await user.click(send);

    expect(await screen.findByRole('status')).toHaveTextContent('Enviado a +57 300 123 4567');
    expect(screen.getByRole('status')).toHaveTextContent('Se omitió el horario de la Ley 2300');
    expect(bodyOf(callsTo(fetchMock, 'POST', '/api/admin/campaigns/test-send')[0].init)).toEqual({
      templateId: 't0',
      phone: '+57 300 123 4567',
      variables: [],
      skipWindow: true,
    });
  });

  it('con variables: el teléfono se actualiza al escribir y no deja enviar hasta llenarlas; muestra el rechazo por horario', async () => {
    const user = userEvent.setup();
    const fetchMock = routeFetch({
      'GET /api/admin/templates': () => ({ body: { items: [base], canSync: false } }),
      'POST /api/admin/campaigns/test-send': () => ({
        status: 409,
        body: { message: 'Fuera del horario permitido por la Ley 2300 (o es festivo). Próxima apertura: lunes 30 de noviembre, 7:00 a. m.' },
      }),
    });
    render(<TestSendTab />);
    await user.selectOptions(await screen.findByLabelText('Plantilla aprobada'), 't1');
    await user.type(screen.getByLabelText('Celular (Colombia)'), '3001234567');
    expect(screen.getAllByTestId('wa-missing-var')).toHaveLength(2);
    await user.type(screen.getByLabelText('Valor de {{1}}'), 'Marta');
    expect(screen.getByRole('button', { name: 'Enviar prueba' })).toBeDisabled();
    await user.type(screen.getByLabelText('Valor de {{2}}'), 'tránsito');
    expect(screen.getByTestId('wa-body')).toHaveTextContent('Hola Marta, tu cita de tránsito es mañana.');
    expect(screen.queryByTestId('wa-missing-var')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enviar prueba' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fuera del horario permitido por la Ley 2300');
    expect(bodyOf(callsTo(fetchMock, 'POST', '/api/admin/campaigns/test-send')[0].init)).toMatchObject({
      variables: ['Marta', 'tránsito'],
      skipWindow: false,
    });
  });
});

describe('Masivos · campaña con audiencia desde un archivo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('la primera fila del archivo alimenta el teléfono y sus orígenes quedan como audiencia', async () => {
    const user = userEvent.setup();
    const filePreview: ImportPreview = {
      fileName: 'feria.xlsx',
      error: null,
      headers: ['Telefono', 'Nombre', 'Origen', 'Autorizacion'],
      columns: { phone: 'Telefono', name: 'Nombre', source: 'Origen', consent: 'Autorizacion' },
      firstRow: { Telefono: '310 555 0000', Nombre: 'Luis Gómez', Origen: 'Feria 2026', Autorizacion: 'Sí' },
      firstContact: { row: 2, phone: '+57 310 555 0000', name: 'Luis Gómez', email: null, source: 'Feria 2026', consent: 'DOCUMENTED', tags: [] },
      totalRows: 3,
      validRows: 3,
      invalidRows: 0,
      duplicateRows: 0,
      verified: 3,
      unverified: 0,
      sources: ['Feria 2026'],
      errors: [],
    };
    const preview: CampaignPreview = {
      kind: 'MARKETING',
      total: 3,
      recipients: 3,
      excluded: { optedOut: 0, unverified: 0, alreadyVerified: 0, total: 0 },
      frequencyCapped: 0,
      problems: [],
      warnings: [],
      sampleContact: { name: 'Luis Gómez' },
      sample: { body: '', footer: null, buttons: [] },
    };
    const fetchMock = routeFetch({
      'GET /api/admin/templates': () => ({ body: { items: [{ ...base, bodyText: 'Hola {{1}}, ¿hablamos de tu caso de {{2}}?' }], canSync: false } }),
      'GET /api/admin/contacts/sources': () => ({ body: [] }),
      'POST /api/admin/contacts/import/preview': () => ({ body: filePreview }),
      'POST /api/admin/contacts/import': () => ({
        body: { importId: 'i1', fileName: 'feria.xlsx', totalRows: 3, imported: 3, updated: 0, duplicates: 0, duplicatesInFile: 0, duplicatesExisting: 0, optedOutSkipped: 0, invalid: 0, invalidDetails: [], warnings: [], verified: 3, unverified: 0 },
      }),
      'POST /api/admin/campaigns/preview': () => ({ body: preview }),
    });
    render(<CampaignForm onClose={vi.fn()} onCreated={vi.fn()} />);
    await user.selectOptions(await screen.findByLabelText('Plantilla aprobada'), 't1');
    await user.selectOptions(screen.getByLabelText('Valor de {{2}}'), 'literal');
    await user.type(screen.getByLabelText('Texto de {{2}}'), 'tránsito');
    const phone = screen.getByRole('figure', { name: 'Vista previa en WhatsApp' });
    expect(within(phone).getByTestId('wa-body')).toHaveTextContent('Hola Ana, ¿hablamos de tu caso de tránsito?'); // ejemplo

    await user.click(screen.getByLabelText('Desde un archivo (Excel/CSV)'));
    expect(screen.getByRole('button', { name: 'Descargar plantilla Excel (.xlsx)' })).toBeInTheDocument();
    await user.upload(screen.getByLabelText(/Archivo/), new File(['x'], 'feria.xlsx'));
    await waitFor(() => expect(within(phone).getByTestId('wa-body')).toHaveTextContent('Hola Luis, ¿hablamos de tu caso de tránsito?'));
    expect(phone).toHaveTextContent('Con la primera fila del archivo (Luis Gómez)');

    await user.click(screen.getByRole('button', { name: 'Confirmar e importar 3 contactos' }));
    expect(await screen.findByTestId('file-audience')).toHaveTextContent('Origen «Feria 2026»');
    await waitFor(() =>
      expect(bodyOf(callsTo(fetchMock, 'POST', '/api/admin/campaigns/preview').at(-1)?.init)).toMatchObject({
        audience: { type: 'source', sources: ['Feria 2026'] },
      }),
    );
  });
});

describe('Masivos · plantilla sin opción de baja', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('muestra un aviso informativo pero la deja lista para campañas', async () => {
    routeFetch({ 'GET /api/admin/templates': () => ({ body: { items: [SIMPLE], canSync: false } }) });
    render(<TemplatesTab />);
    expect(await screen.findByTestId('template-warning')).toHaveTextContent('Aviso (no bloquea)');
    expect(screen.getByText('Lista para campañas y envíos de prueba')).toBeInTheDocument();
  });
});
