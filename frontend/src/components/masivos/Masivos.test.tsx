import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyOf, callsTo, routeFetch } from '@/test/panel-fixtures';
import type { CampaignDetail as Detail, CampaignPreview, ImportSummary, MassTemplate } from '@/lib/masivos';
import { ContactImporter } from './ContactImporter';
import { CampaignForm } from './CampaignForm';
import { CampaignDetail } from './CampaignDetail';

const realtime = vi.hoisted(() => ({ handler: null as null | ((event: string, payload: unknown) => void) }));
vi.mock('@/context/SudoContext', () => ({
  useSudoMode: () => ({ sudoFetch: (path: string, init?: RequestInit) => fetch(`/api${path}`, init) }),
}));
vi.mock('@/lib/realtime', () => ({
  usePanelEvents: (_events: string[], handler: (event: string, payload: unknown) => void) => {
    realtime.handler = handler;
  },
}));

const TEMPLATE: MassTemplate = {
  id: 't1',
  metaId: null,
  name: 'promo_asesoria',
  language: 'es_CO',
  category: 'MARKETING',
  purpose: 'MARKETING',
  status: 'APPROVED',
  bodyText: 'Hola {{1}}, en JurisGlobal te acompañamos con tu caso.',
  footerText: 'Responde STOP para no recibir más',
  buttons: [{ text: 'No recibir más', role: 'OPT_OUT' }],
  variableCount: 1,
  hasOptOut: true,
  source: 'MANUAL',
  lastSyncedAt: null,
  updatedAt: '2026-11-22T15:00:00.000Z',
  campaigns: 0,
  problems: [],
};

const PREVIEW: CampaignPreview = {
  kind: 'MARKETING',
  total: 2000,
  recipients: 1180,
  excluded: { optedOut: 20, unverified: 800, alreadyVerified: 0, total: 820 },
  frequencyCapped: 35,
  problems: [],
  sample: { body: 'Hola Ana, en JurisGlobal te acompañamos con tu caso.', footer: 'Responde STOP para no recibir más', buttons: ['No recibir más'] },
};

const metrics = (over: Partial<Detail['metrics']> = {}) => ({
  total: 10,
  pending: 4,
  sent: 5,
  delivered: 4,
  read: 2,
  failed: 1,
  skipped: 0,
  optedOut: 1,
  replied: 1,
  ...over,
});

const DETAIL: Detail = {
  id: 'c1',
  name: 'Asesoría inicial · diciembre',
  kind: 'MARKETING',
  status: 'RUNNING',
  dryRun: false,
  scheduledAt: null,
  startedAt: '2026-11-24T15:00:00.000Z',
  completedAt: null,
  pausedReason: null,
  nextRunAt: '2026-11-30T12:00:00.000Z',
  waitReason: 'WINDOW',
  createdAt: '2026-11-24T14:00:00.000Z',
  createdBy: 'Ronaldo Socio',
  metrics: metrics(),
  template: { id: 't1', name: 'promo_asesoria', language: 'es_CO', bodyText: TEMPLATE.bodyText, footerText: null, buttons: [] },
  topErrors: [{ code: 131047, category: 'RECIPIENT', label: 'Fuera de la ventana de 24 h', count: 1 }],
  skipReasons: {},
  deferred: 0,
};

describe('Masivos · importador de contactos', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sube el archivo con la nota de soporte y muestra el resumen con las filas inválidas', async () => {
    const user = userEvent.setup();
    const summary: ImportSummary = {
      importId: 'i1',
      fileName: 'base.csv',
      totalRows: 8,
      imported: 2,
      updated: 1,
      duplicates: 2,
      duplicatesInFile: 1,
      duplicatesExisting: 1,
      optedOutSkipped: 1,
      invalid: 2,
      invalidDetails: ['Fila 5: el Teléfono "123" no es un celular colombiano válido', 'Fila 6: el Origen está vacío'],
      warnings: [],
      verified: 2,
      unverified: 1,
    };
    const fetchMock = routeFetch({ 'POST /api/admin/contacts/import': () => ({ body: summary }) });
    const onImported = vi.fn();
    render(<ContactImporter onImported={onImported} />);

    const importButton = screen.getByRole('button', { name: 'Importar' });
    expect(importButton).toBeDisabled();
    await user.upload(screen.getByLabelText(/Archivo/), new File(['Teléfono,Origen,Autorización'], 'base.csv', { type: 'text/csv' }));
    await user.type(screen.getByLabelText(/Soporte documental/), 'Contrato cláusula 7');
    await user.click(importButton);

    const result = await screen.findByRole('status', { name: 'Resumen de la importación' });
    expect(onImported).toHaveBeenCalled();
    const form = callsTo(fetchMock, 'POST', '/api/admin/contacts/import')[0].init?.body as FormData;
    expect((form.get('file') as File).name).toBe('base.csv');
    expect(form.get('consentNote')).toBe('Contrato cláusula 7');
    const stat = (name: string) => within(result).getByText(name, { selector: 'dt' }).nextElementSibling?.textContent;
    expect(stat('Importados')).toBe('2');
    expect(stat('Actualizados')).toBe('1');
    expect(stat('Duplicados omitidos')).toBe('2');
    expect(stat('Filas inválidas')).toBe('2');
    expect(stat('Verificados')).toBe('2');
    expect(stat('No verificados')).toBe('1');
    expect(within(result).getByText('Fila 5: el Teléfono "123" no es un celular colombiano válido')).toBeInTheDocument();
  });

  it('muestra el error del archivo (columnas faltantes)', async () => {
    const user = userEvent.setup();
    routeFetch({
      'POST /api/admin/contacts/import': () => ({ status: 400, body: { message: 'Faltan columnas obligatorias: Origen, Autorización' } }),
    });
    render(<ContactImporter onImported={vi.fn()} />);
    await user.upload(screen.getByLabelText(/Archivo/), new File(['x'], 'x.csv'));
    await user.click(screen.getByRole('button', { name: 'Importar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Faltan columnas obligatorias: Origen, Autorización');
  });
});

describe('Masivos · nueva campaña con vista previa', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('muestra cuántos reciben y cuántos se excluyen (baja, no verificados, tope) y lanza tras confirmar', async () => {
    const user = userEvent.setup();
    const fetchMock = routeFetch({
      'GET /api/admin/templates': () => ({
        body: { items: [TEMPLATE, { ...TEMPLATE, id: 't2', name: 'sin_baja', hasOptOut: false, problems: ['Sin opción de baja'] }], canSync: false },
      }),
      'GET /api/admin/contacts/sources': () => ({ body: [{ source: 'Consultoría Andina', count: 2000 }] }),
      'POST /api/admin/campaigns/preview': () => ({ body: PREVIEW }),
      'POST /api/admin/campaigns': () => ({ status: 201, body: { ...DETAIL, id: 'c9' } }),
    });
    const onCreated = vi.fn();
    render(<CampaignForm onClose={vi.fn()} onCreated={onCreated} />);

    const select = await screen.findByLabelText('Plantilla aprobada');
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2)); // la que no tiene baja no aparece
    await user.type(screen.getByLabelText('Nombre de la campaña'), 'Asesoría inicial · diciembre');
    await user.selectOptions(select, 't1');
    await user.selectOptions(screen.getByLabelText('Valor de {{1}}'), 'firstName');
    await user.type(screen.getByLabelText('Si no hay nombre ({{1}})'), 'amigo');

    expect(await screen.findByTestId('preview-recipients', {}, { timeout: 4000 })).toHaveTextContent('1180');
    expect(screen.getByTestId('preview-optedout')).toHaveTextContent('20');
    expect(screen.getByTestId('preview-unverified')).toHaveTextContent('800');
    expect(screen.getByTestId('preview-capped')).toHaveTextContent('35 ya alcanzaron su tope');
    expect(screen.getByText('Hola Ana, en JurisGlobal te acompañamos con tu caso.')).toBeInTheDocument();
    expect(bodyOf(callsTo(fetchMock, 'POST', '/api/admin/campaigns/preview').at(-1)?.init)).toEqual({
      templateId: 't1',
      audience: { type: 'all' },
      variableMapping: { '1': { type: 'firstName', value: 'amigo' } },
    });

    await user.click(screen.getByLabelText(/Modo simulación/));
    await user.click(screen.getByRole('button', { name: 'Lanzar campaña' }));
    expect(screen.getByRole('group', { name: 'Confirmar lanzamiento' })).toHaveTextContent('Se enviará a 1180 contactos (simulación');
    await user.click(screen.getByRole('button', { name: 'Confirmar y lanzar' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('c9'));
    expect(bodyOf(callsTo(fetchMock, 'POST', '/api/admin/campaigns')[0].init)).toEqual({
      name: 'Asesoría inicial · diciembre',
      templateId: 't1',
      audience: { type: 'all' },
      variableMapping: { '1': { type: 'firstName', value: 'amigo' } },
      dryRun: true,
    });
  });

  it('audiencia por origen y programación en hora de Colombia', async () => {
    const user = userEvent.setup();
    const fetchMock = routeFetch({
      'GET /api/admin/templates': () => ({ body: { items: [TEMPLATE], canSync: false } }),
      'GET /api/admin/contacts/sources': () => ({ body: [{ source: 'Consultoría Andina', count: 2000 }, { source: 'Feria', count: 40 }] }),
      'POST /api/admin/campaigns/preview': () => ({ body: { ...PREVIEW, total: 40, recipients: 40, excluded: { optedOut: 0, unverified: 0, alreadyVerified: 0, total: 0 }, frequencyCapped: 0 } }),
      'POST /api/admin/campaigns': () => ({ status: 201, body: DETAIL }),
    });
    render(<CampaignForm onClose={vi.fn()} onCreated={vi.fn()} />);
    await user.type(screen.getByLabelText('Nombre de la campaña'), 'Feria');
    await user.selectOptions(await screen.findByLabelText('Plantilla aprobada'), 't1');
    await user.click(screen.getByLabelText('Por origen'));
    expect(screen.getByRole('button', { name: 'Lanzar campaña' })).toBeDisabled(); // sin origen elegido
    await user.click(await screen.findByLabelText('Feria (40)'));
    await user.click(screen.getByLabelText('Programar'));
    await user.type(screen.getByLabelText('Fecha y hora (Colombia)'), '2026-11-30T07:00');
    expect(await screen.findByTestId('preview-recipients', {}, { timeout: 4000 })).toHaveTextContent('40');
    await user.click(screen.getByRole('button', { name: 'Programar campaña' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar y lanzar' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/admin/campaigns')).toHaveLength(1));
    expect(bodyOf(callsTo(fetchMock, 'POST', '/api/admin/campaigns')[0].init)).toMatchObject({
      audience: { type: 'source', sources: ['Feria'] },
      scheduledAt: '2026-11-30T12:00:00.000Z',
      dryRun: false,
    });
  });
});

describe('Masivos · tablero de la campaña', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('muestra métricas y la espera por horario; Pausar, Reanudar y Cancelar (con confirmación)', async () => {
    const user = userEvent.setup();
    let current: Detail = DETAIL;
    const fetchMock = routeFetch({
      'GET /api/admin/campaigns/c1': () => ({ body: current }),
      'GET /api/admin/campaigns/c1/recipients': () => ({
        body: {
          items: [
            { id: 'r1', phone: '+57 300 111 2233', name: 'Ana', status: 'READ', skipReason: null, errorCode: null, errorLabel: null, notBefore: null, sentAt: '2026-11-24T15:00:00.000Z', deliveredAt: null, readAt: '2026-11-24T15:05:00.000Z', failedAt: null, repliedAt: null, optedOutAt: null },
            { id: 'r2', phone: '+57 300 111 2244', name: 'Luis', status: 'FAILED', skipReason: null, errorCode: 131047, errorLabel: 'Fuera de la ventana de 24 h', notBefore: null, sentAt: null, deliveredAt: null, readAt: null, failedAt: '2026-11-24T15:01:00.000Z', repliedAt: null, optedOutAt: null },
          ],
          total: 2,
          page: 1,
          pageSize: 25,
        },
      }),
      'POST /api/admin/campaigns/c1/pause': () => {
        current = { ...current, status: 'PAUSED', pausedReason: 'MANUAL', waitReason: null };
        return { body: current };
      },
      'POST /api/admin/campaigns/c1/resume': () => {
        current = { ...current, status: 'RUNNING', pausedReason: null };
        return { body: current };
      },
      'POST /api/admin/campaigns/c1/cancel': () => {
        current = { ...current, status: 'CANCELLED', metrics: metrics({ pending: 0, skipped: 4 }) };
        return { body: current };
      },
    });
    render(<CampaignDetail id="c1" onBack={vi.fn()} />);

    expect(await screen.findByTestId('campaign-status')).toHaveTextContent('En curso');
    expect(screen.getByTestId('campaign-wait')).toHaveTextContent('Fuera del horario permitido (Ley 2300): reanuda sola');
    for (const [key, value] of Object.entries({ total: 10, pending: 4, sent: 5, delivered: 4, read: 2, failed: 1, optedOut: 1 }))
      expect(screen.getByTestId(`metric-${key}`)).toHaveTextContent(String(value));
    expect(screen.getByRole('region', { name: 'Errores más frecuentes' })).toHaveTextContent('Fuera de la ventana de 24 h (131047)');
    expect(await screen.findByText('Luis')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Pausar' }));
    expect(await screen.findByText('Pausada manualmente')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/admin/campaigns/c1/pause')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Reanudar' }));
    await waitFor(() => expect(screen.getByTestId('campaign-status')).toHaveTextContent('En curso'));

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(callsTo(fetchMock, 'POST', '/api/admin/campaigns/c1/cancel')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Sí, cancelar' }));
    await waitFor(() => expect(screen.getByTestId('campaign-status')).toHaveTextContent('Cancelada'));
    expect(screen.queryByRole('button', { name: 'Pausar' })).not.toBeInTheDocument();
  });

  it('se actualiza en vivo con campaign:progress de su campaña (agrupando eventos)', async () => {
    let current: Detail = DETAIL;
    const fetchMock = routeFetch({
      'GET /api/admin/campaigns/c1': () => ({ body: current }),
      'GET /api/admin/campaigns/c1/recipients': () => ({ body: { items: [], total: 0, page: 1, pageSize: 25 } }),
    });
    render(<CampaignDetail id="c1" onBack={vi.fn()} />);
    expect(await screen.findByTestId('metric-read')).toHaveTextContent('2');
    const before = callsTo(fetchMock, 'GET', '/api/admin/campaigns/c1').length;

    current = { ...DETAIL, metrics: metrics({ read: 3 }) };
    act(() => {
      realtime.handler?.('campaign:progress', { campaignId: 'otra' });
      realtime.handler?.('campaign:progress', { campaignId: 'c1' });
      realtime.handler?.('campaign:progress', { campaignId: 'c1' });
    });
    await waitFor(() => expect(screen.getByTestId('metric-read')).toHaveTextContent('3'), { timeout: 4000 });
    expect(callsTo(fetchMock, 'GET', '/api/admin/campaigns/c1').length).toBe(before + 1);
  });
});
