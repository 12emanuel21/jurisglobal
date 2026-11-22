import { QualityGuard, QUALITY_MAX_AGE_MS, ratingFromQualityWebhook, shouldCheckQuality } from './quality-guard';

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    set: jest.fn((k: string, v: string) => (store.set(k, v), Promise.resolve('OK'))),
    del: jest.fn((k: string) => Promise.resolve(store.delete(k) ? 1 : 0)),
    incr: jest.fn((k: string) => {
      const n = Number(store.get(k) ?? 0) + 1;
      store.set(k, String(n));
      return Promise.resolve(n);
    }),
  };
}

function setup({ configured = true, rating = 'GREEN', pauseOnRed = true, active = ['c1', 'c2'] } = {}) {
  const redis = fakeRedis();
  const settingsStore: Record<string, unknown> = {
    'marketing.pauseOnQualityRed': pauseOnRed,
    'whatsapp.quality': null,
  };
  const settings = {
    get: jest.fn((k: string) => Promise.resolve(settingsStore[k])),
    set: jest.fn((k: string, v: unknown) => ((settingsStore[k] = v), Promise.resolve())),
  };
  const prisma = {
    campaign: {
      findMany: jest.fn(() => Promise.resolve(active.map((id) => ({ id })))),
      updateMany: jest.fn(() => Promise.resolve({ count: active.length })),
    },
  };
  const cloudApi = {
    isConfigured: jest.fn(() => configured),
    getQualityRating: jest.fn(() => Promise.resolve(rating)),
  };
  const realtime = { emitToPanel: jest.fn() };
  const guard = new QualityGuard(
    prisma as never,
    settings as never,
    cloudApi as never,
    realtime as never,
    redis as never,
  );
  return { guard, redis, settings, settingsStore, prisma, cloudApi, realtime };
}

describe('Pausa automática por calidad del número (quality_rating)', () => {
  it('cuándo consultar: inicio de lote (sin dato), cada 50 envíos o dato viejo', () => {
    const now = 1_000_000_000;
    expect(shouldCheckQuality(null, 0, now)).toBe(true);
    expect(shouldCheckQuality({ rating: 'GREEN', at: now - 1000 }, 49, now)).toBe(false);
    expect(shouldCheckQuality({ rating: 'GREEN', at: now - 1000 }, 50, now)).toBe(true);
    expect(shouldCheckQuality({ rating: 'GREEN', at: now - QUALITY_MAX_AGE_MS - 1 }, 0, now)).toBe(true);
  });

  it('RED: pausa TODAS las campañas activas con motivo QUALITY_RED, registra la alerta y bloquea el envío', async () => {
    const { guard, prisma, settingsStore, realtime } = setup({ rating: 'RED' });
    expect(await guard.assertSendable()).toBe(false);
    expect(prisma.campaign.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['c1', 'c2'] }, status: { in: ['SCHEDULED', 'RUNNING'] } },
      data: { status: 'PAUSED', pausedReason: 'QUALITY_RED', nextRunAt: null, waitReason: null },
    });
    expect(settingsStore['whatsapp.quality']).toMatchObject({ rating: 'RED', source: 'GRAPH' });
    expect(realtime.emitToPanel).toHaveBeenCalledWith('whatsapp:quality', { rating: 'RED' });
    expect(realtime.emitToPanel).toHaveBeenCalledWith('campaign:progress', { campaignId: 'c1' });
  });

  it('GREEN/YELLOW: deja enviar y no vuelve a consultar Graph hasta 50 envíos', async () => {
    const { guard, cloudApi, prisma } = setup({ rating: 'YELLOW' });
    expect(await guard.assertSendable()).toBe(true);
    for (let i = 0; i < 49; i++) await guard.noteSend();
    expect(await guard.assertSendable()).toBe(true);
    expect(cloudApi.getQualityRating).toHaveBeenCalledTimes(1);
    await guard.noteSend();
    expect(await guard.assertSendable()).toBe(true);
    expect(cloudApi.getQualityRating).toHaveBeenCalledTimes(2);
    expect(prisma.campaign.updateMany).not.toHaveBeenCalled();
  });

  it('sin credenciales de Meta (simulación/desarrollo): no consulta nada y no falla', async () => {
    const { guard, cloudApi } = setup({ configured: false });
    expect(await guard.assertSendable()).toBe(true);
    expect(cloudApi.getQualityRating).not.toHaveBeenCalled();
  });

  it('si Graph falla no frena los envíos; con el interruptor apagado tampoco consulta', async () => {
    const failing = setup();
    failing.cloudApi.getQualityRating.mockRejectedValueOnce(new Error('timeout'));
    expect(await failing.guard.assertSendable()).toBe(true);
    const off = setup({ rating: 'RED', pauseOnRed: false });
    expect(await off.guard.assertSendable()).toBe(true);
    expect(off.cloudApi.getQualityRating).not.toHaveBeenCalled();
  });

  it('webhook phone_number_quality_update: FLAGGED/DOWNGRADE = RED y pausa; UNFLAGGED registra la recuperación', async () => {
    expect(ratingFromQualityWebhook({ event: 'FLAGGED', current_limit: 'TIER_1K' })).toEqual({
      rating: 'RED',
      event: 'FLAGGED',
    });
    expect(ratingFromQualityWebhook({ event: 'DOWNGRADE' })?.rating).toBe('RED');
    expect(ratingFromQualityWebhook({ event: 'UNFLAGGED' })?.rating).toBe('GREEN');
    expect(ratingFromQualityWebhook({ quality_rating: 'red' })?.rating).toBe('RED');
    expect(ratingFromQualityWebhook({ event: 'OTRO' })).toBeNull();

    const { guard, prisma, settingsStore } = setup();
    await guard.onWebhook({ event: 'FLAGGED' });
    expect(prisma.campaign.updateMany).toHaveBeenCalledTimes(1);
    expect(settingsStore['whatsapp.quality']).toMatchObject({ rating: 'RED', source: 'WEBHOOK', event: 'FLAGGED' });
    // Tras un RED cacheado, el worker sigue bloqueado sin volver a consultar
    expect(await guard.assertSendable()).toBe(false);
  });
});
