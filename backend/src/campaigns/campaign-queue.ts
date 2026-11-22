import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, type ConnectionOptions } from 'bullmq';
import { loadEnv } from '../config/env';

export const CAMPAIGN_QUEUE = 'campaigns';
/** Un trabajo por campaña (jobId = id de la campaña): envía, espera (jitter/ventana/topes) y sigue */
export const RUN_JOB = 'run';
/** Cada 60 s: revisa que toda campaña activa tenga su trabajo (red de seguridad ante caídas) */
export const RECONCILE_JOB = 'reconcile';
export const RECONCILE_EVERY_MS = 60_000;

/** Conexión para BullMQ (necesita maxRetriesPerRequest: null en los workers) */
export function bullConnection(): ConnectionOptions {
  return { url: loadEnv().REDIS_URL, maxRetriesPerRequest: null };
}

/** Prefijo de las claves de BullMQ (las pruebas usan uno propio y no chocan con el worker de desarrollo) */
export const bullPrefix = () => `${loadEnv().REDIS_KEY_PREFIX}bull`;

export interface RunJobData {
  campaignId: string;
}

/**
 * Cola de masivos sobre Redis (BullMQ). La API solo encola; el proceso worker (src/worker.ts)
 * procesa. Cada campaña tiene UN trabajo que se reprograma a sí mismo (moveToDelayed): no hay
 * miles de trabajos con ETA larga (el problema del módulo Django) y pausar/cancelar es inmediato.
 */
@Injectable()
export class CampaignQueue implements OnModuleDestroy {
  private readonly logger = new Logger(CampaignQueue.name);
  private queue: Queue<RunJobData> | null = null;

  get instance(): Queue<RunJobData> {
    this.queue ??= new Queue<RunJobData>(CAMPAIGN_QUEUE, { connection: bullConnection(), prefix: bullPrefix() });
    return this.queue;
  }

  /**
   * Encola la ejecución de una campaña. Si ya tiene un trabajo esperando (jitter, ventana o cupo),
   * lo deja como está: al despertar revalida todo, así que nunca hay dos cadenas por campaña.
   */
  async schedule(campaignId: string, delayMs = 0): Promise<void> {
    const existing = await this.instance.getJob(campaignId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') await existing.remove().catch(() => undefined);
      else return;
    }
    await this.instance.add(
      RUN_JOB,
      { campaignId },
      { jobId: campaignId, delay: Math.max(0, delayMs), removeOnComplete: true, removeOnFail: true },
    );
  }

  /** Quita el trabajo pendiente de una campaña cancelada (si está en curso, terminará solo) */
  async unschedule(campaignId: string): Promise<void> {
    const job = await this.instance.getJob(campaignId);
    if (!job) return;
    const state = await job.getState();
    if (state === 'delayed' || state === 'waiting' || state === 'prioritized')
      await job.remove().catch(() => undefined);
  }

  /** Programa la revisión periódica (la registra el worker al arrancar; idempotente) */
  async ensureReconciler(): Promise<void> {
    await this.instance.upsertJobScheduler(
      RECONCILE_JOB,
      { every: RECONCILE_EVERY_MS },
      { name: RECONCILE_JOB, opts: { removeOnComplete: true, removeOnFail: true } },
    );
  }

  async onModuleDestroy() {
    await this.queue?.close().catch((err: Error) => this.logger.warn(`Cerrando la cola: ${err.message}`));
  }
}
