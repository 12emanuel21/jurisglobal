import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyOf, callsTo, routeFetch } from '@/test/panel-fixtures';
import type { CampaignPreview, CampaignScheduleSummary, MassTemplate, SchedulePreview } from '@/lib/masivos';
import { CampaignForm } from './CampaignForm';
import { CampaignsTab } from './CampaignsTab';

vi.mock('@/context/SudoContext', () => ({
  useSudoMode: () => ({ sudoFetch: (path: string, init?: RequestInit) => fetch(`/api${path}`, init) }),
}));
vi.mock('@/lib/realtime', () => ({ usePanelEvents: () => undefined }));

const TEMPLATE: MassTemplate = {
  id: 't1',
  metaId: null,
  name: 'boletin',
  language: 'es_CO',
  category: 'MARKETING',
  purpose: 'MARKETING',
  status: 'APPROVED',
  bodyText: 'Hola {{1}}, estas son las novedades de la semana.',
  footerText: null,
  buttons: [],
  variableCount: 1,
  hasOptOut: false,
  source: 'MANUAL',
  lastSyncedAt: null,
  updatedAt: '2026-11-22T15:00:00.000Z',
  campaigns: 0,
  problems: [],
  warnings: [],
};
const PREVIEW: CampaignPreview = {
  kind: 'MARKETING',
  total: 50,
  recipients: 40,
  excluded: { optedOut: 2, unverified: 8, alreadyVerified: 0, total: 10 },
  frequencyCapped: 0,
  problems: [],
  warnings: [],
  sampleContact: { name: 'Ana María Pérez' },
  sample: { body: '', footer: null, buttons: [] },
};
const SCHEDULE_PREVIEW: SchedulePreview = {
  description: 'Cada semana: lunes y jueves a las 08:00',
  runs: [
    { at: '2026-11-26T13:00:00.000Z', insideWindow: true, startsAt: '2026-11-26T13:00:00.000Z' },
    { at: '2026-11-30T13:00:00.000Z', insideWindow: true, startsAt: '2026-11-30T13:00:00.000Z' },
  ],
};

describe('Masivos · campaña recurrente', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('«Repetir»: elige días y hora, ve las próximas ejecuciones y crea la programación', async () => {
    const user = userEvent.setup();
    const fetchMock = routeFetch({
      'GET /api/admin/templates': () => ({ body: { items: [TEMPLATE], canSync: false } }),
      'GET /api/admin/contacts/sources': () => ({ body: [] }),
      'POST /api/admin/campaigns/preview': () => ({ body: PREVIEW }),
      'POST /api/admin/campaign-schedules/preview': () => ({ body: SCHEDULE_PREVIEW }),
      'POST /api/admin/campaign-schedules': () => ({ status: 201, body: { id: 's1' } }),
    });
    const onScheduled = vi.fn();
    const onCreated = vi.fn();
    render(<CampaignForm onClose={vi.fn()} onCreated={onCreated} onScheduled={onScheduled} />);
    await user.type(screen.getByLabelText('Nombre de la campaña'), 'Boletín semanal');
    await user.selectOptions(await screen.findByLabelText('Plantilla aprobada'), 't1');
    await user.click(screen.getByLabelText('Repetir (campaña recurrente)'));

    const fields = screen.getByTestId('recurrence-fields');
    expect(within(fields).getByLabelText('lunes')).toBeChecked(); // por defecto: lunes 08:00
    await user.click(within(fields).getByLabelText('jueves'));
    await user.clear(within(fields).getByLabelText('Hora (Colombia)'));
    await user.type(within(fields).getByLabelText('Hora (Colombia)'), '08:00');
    expect(await screen.findByTestId('recurrence-preview', {}, { timeout: 4000 })).toHaveTextContent('Cada semana: lunes y jueves a las 08:00');
    expect(within(screen.getByRole('list', { name: 'Próximas ejecuciones' })).getAllByRole('listitem')).toHaveLength(2);
    await waitFor(() =>
      expect(bodyOf(callsTo(fetchMock, 'POST', '/api/admin/campaign-schedules/preview').at(-1)?.init)).toEqual({
        frequency: 'WEEKLY',
        timeOfDay: '08:00',
        daysOfWeek: [1, 4],
      }),
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Crear campaña recurrente' })).toBeEnabled(), { timeout: 4000 });
    await user.click(screen.getByRole('button', { name: 'Crear campaña recurrente' }));
    expect(screen.getByRole('group', { name: 'Confirmar lanzamiento' })).toHaveTextContent('Cada semana: lunes y jueves a las 08:00');
    await user.click(screen.getByRole('button', { name: 'Confirmar y programar' }));
    await waitFor(() => expect(onScheduled).toHaveBeenCalledWith('s1'));
    expect(onCreated).not.toHaveBeenCalled();
    expect(callsTo(fetchMock, 'POST', '/api/admin/campaigns')).toHaveLength(0);
    expect(bodyOf(callsTo(fetchMock, 'POST', '/api/admin/campaign-schedules')[0].init)).toEqual({
      name: 'Boletín semanal',
      templateId: 't1',
      audience: { type: 'all' },
      variableMapping: { '1': { type: 'firstName' } },
      dryRun: false,
      recurrence: { frequency: 'WEEKLY', timeOfDay: '08:00', daysOfWeek: [1, 4] },
    });
  });

  it('muestra un aviso si una ejecución cae fuera del horario Ley 2300', async () => {
    const user = userEvent.setup();
    routeFetch({
      'GET /api/admin/templates': () => ({ body: { items: [TEMPLATE], canSync: false } }),
      'GET /api/admin/contacts/sources': () => ({ body: [] }),
      'POST /api/admin/campaigns/preview': () => ({ body: PREVIEW }),
      'POST /api/admin/campaign-schedules/preview': () => ({
        body: {
          description: 'Cada semana: domingo a las 10:00',
          runs: [{ at: '2026-11-29T15:00:00.000Z', insideWindow: false, startsAt: '2026-11-30T12:00:00.000Z' }],
        },
      }),
    });
    render(<CampaignForm onClose={vi.fn()} onCreated={vi.fn()} />);
    await user.selectOptions(await screen.findByLabelText('Plantilla aprobada'), 't1');
    await user.click(screen.getByLabelText('Repetir (campaña recurrente)'));
    const runs = await screen.findByRole('list', { name: 'Próximas ejecuciones' }, { timeout: 4000 });
    expect(runs).toHaveTextContent('fuera del horario Ley 2300: empieza a enviar el');
  });

  it('lista las programaciones con su próxima ejecución, el motivo de una omisión y las acciones', async () => {
    const user = userEvent.setup();
    let schedule: CampaignScheduleSummary = {
      id: 's1',
      name: 'Boletín semanal',
      template: { id: 't1', name: 'boletin' },
      dryRun: false,
      description: 'Cada semana: lunes y jueves a las 08:00',
      recurrence: { frequency: 'WEEKLY', daysOfWeek: [1, 4], dayOfMonth: null, timeOfDay: '08:00', startDate: null, endDate: null },
      isActive: true,
      nextRunAt: '2026-11-30T13:00:00.000Z',
      lastRunAt: '2026-11-26T13:00:00.000Z',
      lastSkipReason: 'La ejecución anterior sigue activa (en curso, programada o pausada): se omitió esta para no duplicar envíos',
      lastCampaign: { id: 'c1', name: 'Boletín semanal · 23/11/2026', status: 'PAUSED' },
      runs: 3,
      createdBy: 'Ronaldo',
      createdAt: '2026-11-22T15:00:00.000Z',
    };
    const fetchMock = routeFetch({
      'GET /api/admin/campaigns': () => ({ body: { items: [], quality: null } }),
      'GET /api/admin/campaign-schedules': () => ({ body: [schedule] }),
      'POST /api/admin/campaign-schedules/s1/pause': () => {
        schedule = { ...schedule, isActive: false, nextRunAt: null };
        return { body: schedule };
      },
      'DELETE /api/admin/campaign-schedules/s1': () => ({ body: { ok: true } }),
    });
    render(<CampaignsTab />);
    const card = await screen.findByTestId('schedule-s1');
    expect(card).toHaveTextContent('Cada semana: lunes y jueves a las 08:00');
    expect(card).toHaveTextContent('3 campañas creadas');
    expect(card).toHaveTextContent('Activa');
    expect(within(card).getByTestId('schedule-skip')).toHaveTextContent('sigue activa');
    expect(within(card).getByRole('button', { name: 'Boletín semanal · 23/11/2026 (Pausada)' })).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Pausar' }));
    expect(await within(screen.getByTestId('schedule-s1')).findByRole('button', { name: 'Reanudar' })).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/admin/campaign-schedules/s1/pause')).toHaveLength(1);
    expect(within(screen.getByTestId('schedule-s1')).getByTestId('schedule-next')).toHaveTextContent('—');

    await user.click(screen.getByRole('button', { name: 'Eliminar Boletín semanal' }));
    expect(callsTo(fetchMock, 'DELETE', '/api/admin/campaign-schedules/s1')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Sí, eliminar' }));
    await waitFor(() => expect(callsTo(fetchMock, 'DELETE', '/api/admin/campaign-schedules/s1')).toHaveLength(1));
  });
});
