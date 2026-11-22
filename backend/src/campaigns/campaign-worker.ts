import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DelayedError, Worker, type Job } from 'bullmq';
import { promises as fs } from 'fs';
import { CampaignEngine } from './campaign-engine';
import {
  CAMPAIGN_QUEUE,
  CampaignQueue,
  RECONCILE_JOB,
  RUN_JOB,
  bullConnection,
  bullPrefix,
  type RunJobData,
} from './campaign-queue';

/** Archivo de señal de vida: el healthcheck del contenedor worker verifica que se actualice */
export const WORKER_HEARTBEAT_FILE = '/tmp/jurisglobal-worker.alive';
const HEARTBEAT_MS = 30_000;

/**
 * Procesa la cola de masivos (solo en el proceso worker). Concurrencia 1: los envíos de todas las
 * campañas pasan de a uno, así el conteo del límite diario y de los topes no tiene carreras.
 * Un trabajo que debe esperar (jitter, ventana, cupo) se reprograma a sí mismo con moveToDelayed.
 */
@Injectable()
export class CampaignWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CampaignWorkerService.name);
  private worker: Worker<RunJobData> | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private readonly engine: CampaignEngine,
    private readonly queue: CampaignQueue,
  ) {}

  async onApplicationBootstrap() {
    await this.start();
  }

  async start(): Promise<void> {
    if (this.worker) return;
    this.worker = new Worker<RunJobData>(CAMPAIGN_QUEUE, (job, token) => this.process(job, token), {
      connection: bullConnection(),
      prefix: bullPrefix(),
      concurrency: 1,
    });
    this.worker.on('failed', (job, err) =>
      this.logger.error(`Trabajo ${job?.name ?? '?'} (${job?.id ?? '?'}) falló: ${err.message}`),
    );
    this.worker.on('error', (err) => this.logger.error(`Worker de masivos: ${err.message}`));
    await this.queue.ensureReconciler();
    await this.engine.reconcile().catch((err: Error) => this.logger.error(`Revisión inicial: ${err.message}`));
    const beat = () => void fs.writeFile(WORKER_HEARTBEAT_FILE, String(Date.now())).catch(() => undefined);
    beat();
    this.heartbeat = setInterval(beat, HEARTBEAT_MS);
    this.logger.log('📨 Worker de masivos escuchando la cola');
  }

  async process(job: Job<RunJobData>, token?: string): Promise<string> {
    if (job.name === RECONCILE_JOB) {
      await this.engine.reconcile();
      return 'reconciled';
    }
    if (job.name !== RUN_JOB) return 'ignored';
    let result;
    try {
      result = await this.engine.step(job.data.campaignId);
    } catch (error) {
      // Error inesperado (BD caída, bug): no se pierde la campaña, se reintenta en 1 minuto
      this.logger.error(`Campaña ${job.data.campaignId}: ${(error as Error).message}`);
      result = { kind: 'wait' as const, ms: 60_000, reason: 'RETRY' as const };
    }
    if (result.kind === 'done') return result.reason;
    await job.moveToDelayed(Date.now() + result.ms, token);
    throw new DelayedError();
  }

  async onModuleDestroy() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    await this.worker?.close().catch(() => undefined);
    this.worker = null;
  }
}
