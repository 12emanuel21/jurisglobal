import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SettingsService } from '../settings/settings.service';
import { REDIS } from '../redis/redis.module';
import { loadEnv } from '../config/env';
import { WhatsAppCloudApi } from '../whatsapp/cloud-api.client';

/** Se vuelve a consultar Graph cada 50 envíos reales o si el último dato tiene más de 10 minutos */
export const QUALITY_CHECK_EVERY_SENDS = 50;
export const QUALITY_MAX_AGE_MS = 10 * 60 * 1000;
export const QUALITY_PAUSE_REASON = 'QUALITY_RED';

export interface CachedQuality {
  rating: string;
  at: number;
}

/** ¿Hay que consultar la calidad antes de este envío? (inicio de un lote o cada ~50 envíos) */
export function shouldCheckQuality(cached: CachedQuality | null, sendsSinceCheck: number, nowMs: number): boolean {
  return !cached || sendsSinceCheck >= QUALITY_CHECK_EVERY_SENDS || nowMs - cached.at > QUALITY_MAX_AGE_MS;
}

/**
 * Calidad que informa el webhook phone_number_quality_update. Meta envía un evento
 * (FLAGGED / UNFLAGGED / DOWNGRADE / UPGRADE) y, según la versión, el rating: FLAGGED y DOWNGRADE
 * se tratan como RED (calidad baja), UNFLAGGED y UPGRADE como recuperación.
 */
export function ratingFromQualityWebhook(value: unknown): { rating: string; event: string | null } | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const explicit = [v.quality_rating, v.current_quality_rating, v.quality].find((x) => typeof x === 'string');
  const event = typeof v.event === 'string' ? v.event.toUpperCase() : null;
  if (explicit) return { rating: explicit.toUpperCase(), event };
  if (event === 'FLAGGED' || event === 'DOWNGRADE') return { rating: 'RED', event };
  if (event === 'UNFLAGGED' || event === 'UPGRADE') return { rating: 'GREEN', event };
  return null;
}

/**
 * Pausa automática por calidad del número (ESP §7.2; corrige que en Django solo se mostraba).
 * El worker la consulta antes de un lote y cada ~50 envíos; el webhook la informa al instante.
 * Si es RED, todas las campañas activas quedan PAUSED con motivo QUALITY_RED y el panel muestra
 * la alerta. Sin credenciales de Meta (simulación/desarrollo) no consulta nada.
 */
@Injectable()
export class QualityGuard {
  private readonly logger = new Logger(QualityGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly cloudApi: WhatsAppCloudApi,
    private readonly realtime: RealtimeGateway,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private key(name: string) {
    return `${loadEnv().REDIS_KEY_PREFIX}wa:quality:${name}`;
  }

  /** ¿Se puede enviar? false = la calidad es RED y ya se pausaron las campañas */
  async assertSendable(now = Date.now()): Promise<boolean> {
    if (!this.cloudApi.isConfigured() || loadEnv().CAMPAIGNS_FORCE_DRY_RUN) return true;
    if (!(await this.settings.get('marketing.pauseOnQualityRed'))) return true;

    const [rawCached, rawSends] = await Promise.all([
      this.redis.get(this.key('last')),
      this.redis.get(this.key('sends')),
    ]);
    const cached = rawCached ? (JSON.parse(rawCached) as CachedQuality) : null;
    if (!shouldCheckQuality(cached, Number(rawSends ?? 0), now)) {
      if (cached?.rating !== 'RED') return true;
      await this.pauseAll('GRAPH');
      return false;
    }

    let rating: string | null;
    try {
      rating = await this.cloudApi.getQualityRating();
    } catch (error) {
      // Graph caído no frena los envíos (los errores de cuenta en el envío sí pausan)
      this.logger.warn(`No se pudo consultar la calidad del número: ${(error as Error).message}`);
      rating = 'UNKNOWN';
    }
    if (!rating) return true;
    await this.redis.set(
      this.key('last'),
      JSON.stringify({ rating, at: now } satisfies CachedQuality),
      'PX',
      QUALITY_MAX_AGE_MS * 3,
    );
    await this.redis.set(this.key('sends'), '0');
    if (rating !== 'UNKNOWN') await this.record(rating, 'GRAPH');
    if (rating !== 'RED') return true;
    await this.pauseAll('GRAPH');
    return false;
  }

  /** Cuenta un envío real (cada 50 se vuelve a consultar) */
  async noteSend(): Promise<void> {
    await this.redis.incr(this.key('sends'));
  }

  /** Al reanudar o lanzar: el próximo envío vuelve a consultar Graph (inicio de lote) */
  async forceRecheck(): Promise<void> {
    await this.redis.del(this.key('last'));
  }

  /** Evento phone_number_quality_update del webhook de Meta */
  async onWebhook(value: unknown): Promise<void> {
    const parsed = ratingFromQualityWebhook(value);
    if (!parsed) return;
    await this.redis.set(
      this.key('last'),
      JSON.stringify({ rating: parsed.rating, at: Date.now() } satisfies CachedQuality),
      'PX',
      QUALITY_MAX_AGE_MS * 3,
    );
    await this.record(parsed.rating, 'WEBHOOK', parsed.event ?? undefined);
    if (parsed.rating === 'RED' && (await this.settings.get('marketing.pauseOnQualityRed')))
      await this.pauseAll('WEBHOOK');
  }

  private async record(rating: string, source: 'GRAPH' | 'WEBHOOK', event?: string) {
    const previous = await this.settings.get('whatsapp.quality');
    await this.settings.set(
      'whatsapp.quality',
      { rating, source, at: new Date().toISOString(), ...(event ? { event } : {}) },
      null,
    );
    if (previous?.rating !== rating) {
      this.logger.log(`Calidad del número de WhatsApp: ${rating} (${source})`);
      this.realtime.emitToPanel('whatsapp:quality', { rating });
    }
  }

  /** Pausa TODAS las campañas activas (programadas o en curso) con motivo QUALITY_RED */
  async pauseAll(source: 'GRAPH' | 'WEBHOOK'): Promise<number> {
    const active = await this.prisma.campaign.findMany({
      where: { status: { in: ['SCHEDULED', 'RUNNING'] } },
      select: { id: true },
    });
    if (!active.length) return 0;
    await this.prisma.campaign.updateMany({
      where: { id: { in: active.map((c) => c.id) }, status: { in: ['SCHEDULED', 'RUNNING'] } },
      data: { status: 'PAUSED', pausedReason: QUALITY_PAUSE_REASON, nextRunAt: null, waitReason: null },
    });
    this.logger.warn(`⏸️ Calidad RED (${source}): ${active.length} campaña(s) pausada(s)`);
    for (const c of active) this.realtime.emitToPanel('campaign:progress', { campaignId: c.id });
    return active.length;
  }
}
