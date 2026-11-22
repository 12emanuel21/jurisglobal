import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CampaignStatus,
  Prisma,
  type Campaign,
  type CampaignMessage,
  type Contact,
  type MessageTemplate,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SettingsService } from '../settings/settings.service';
import { loadEnv } from '../config/env';
import { maskPhone } from '../common/redact';
import {
  isWithinSendWindow,
  nextOpening,
  startOfLocalDay,
  startOfNextLocalDay,
  type SendWindowRule,
} from '../compliance/send-window';
import { applyOptOut } from '../compliance/opt-out-core';
import { FLOW_RESET_MS } from '../chatbot/flow';
import { WhatsAppApiError, WhatsAppCloudApi, WhatsAppNotConfiguredError } from '../whatsapp/cloud-api.client';
import { CampaignQueue } from './campaign-queue';
import { QUALITY_PAUSE_REASON, QualityGuard } from './quality-guard';
import { CLOCK, type Clock } from './clock';
import { PAUSE_REASON, classifyMetaError } from './meta-errors';
import { renderBody, resolveVariables, type VariableMapping } from './template-rules';

export type WaitReason = 'SCHEDULED' | 'WINDOW' | 'DAILY_LIMIT' | 'FREQUENCY_CAP' | 'JITTER' | 'RETRY' | 'YIELD';
export type StepResult = { kind: 'done'; reason: string } | { kind: 'wait'; ms: number; reason: WaitReason };

/** Estados en los que el worker trabaja la campaña */
export const ACTIVE_STATUSES: CampaignStatus[] = ['SCHEDULED', 'RUNNING'];
/** Contactos aptos para marketing (soporte documental o confirmación por WhatsApp) */
export const VERIFIED_STATUSES = ['DOCUMENTED', 'CONFIRMED'] as const;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
/** Decisiones sin envío (omitidos/diferidos) por ejecución antes de ceder el turno a otras campañas */
const MAX_DECISIONS_PER_STEP = 200;
/** Mensajes QUEUED más viejos que esto: el worker se cayó en pleno envío */
const STALE_QUEUED_MS = 10 * 60 * 1000;
/** Errores desconocidos seguidos que pausan la campaña por precaución */
const UNKNOWN_ERROR_BREAKER = 10;

interface Rules {
  windows: SendWindowRule[];
  holidays: Set<string>;
  maxPerDay: number;
  maxPerWeek: number;
  dailyLimit: number;
  jitter: { min: number; max: number };
}

type LoadedCampaign = Campaign & { template: MessageTemplate };
type LoadedMessage = CampaignMessage & { contact: Contact };

const wait = (ms: number, reason: WaitReason): StepResult => ({
  kind: 'wait',
  ms: Math.max(0, Math.round(ms)),
  reason,
});
const done = (reason: string): StepResult => ({ kind: 'done', reason });

/**
 * Motor de masivos (lo ejecuta el worker; ver campaign-worker.ts). Cada `step` envía como máximo un
 * mensaje y devuelve cuánto esperar. Antes de CADA envío revalida:
 *  1. baja/supresión del contacto en ese instante (STOP durante la campaña) y consentimiento;
 *  2. ventana horaria (SendWindow) y festivos en America/Bogota: fuera de horario devuelve la
 *     espera exacta hasta la siguiente apertura y la campaña se reanuda sola;
 *  3. topes: límite diario global y por contacto (día y semana móvil): difiere al siguiente día hábil;
 *  4. jitter aleatorio entre envíos.
 * Corrige los 3 fallos del módulo Django: guarda siempre el wamid, un error de un destinatario no
 * aborta la campaña (131050 = baja automática) y no hay que reanudar a mano tras la ventana.
 */
@Injectable()
export class CampaignEngine {
  private readonly logger = new Logger(CampaignEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly cloudApi: WhatsAppCloudApi,
    private readonly realtime: RealtimeGateway,
    private readonly queue: CampaignQueue,
    private readonly quality: QualityGuard,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async step(campaignId: string): Promise<StepResult> {
    let result: StepResult | 'continue' = 'continue';
    for (let i = 0; i < MAX_DECISIONS_PER_STEP && result === 'continue'; i++) {
      result = await this.decide(campaignId);
    }
    const final = result === 'continue' ? wait(0, 'YIELD') : result;
    await this.recordWait(campaignId, final);
    return final;
  }

  /** Una decisión: 'continue' = omitió o difirió un mensaje sin enviar (sigue con el próximo) */
  private async decide(campaignId: string): Promise<StepResult | 'continue'> {
    const now = this.clock.now();
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId }, include: { template: true } });
    if (!campaign || !ACTIVE_STATUSES.includes(campaign.status)) return done('INACTIVE');
    if (campaign.scheduledAt && campaign.scheduledAt > now)
      return wait(campaign.scheduledAt.getTime() - now.getTime(), 'SCHEDULED');

    const rules = await this.loadRules(now);
    // 2) Ventana Ley 2300 + festivos: espera exacta hasta la próxima apertura (reanudación automática)
    if (!isWithinSendWindow(rules.windows, rules.holidays, now)) {
      const opening = nextOpening(rules.windows, rules.holidays, now);
      if (!opening) return this.pause(campaign, 'NO_WINDOW');
      return wait(opening.getTime() - now.getTime(), 'WINDOW');
    }
    if (campaign.status === 'SCHEDULED') {
      await this.prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'RUNNING', startedAt: campaign.startedAt ?? now },
      });
      this.emit(campaign.id);
    }

    const message = await this.prisma.campaignMessage.findFirst({
      where: { campaignId: campaign.id, status: 'PENDING', OR: [{ notBefore: null }, { notBefore: { lte: now } }] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { contact: true },
    });
    if (!message) {
      const deferred = await this.prisma.campaignMessage.findFirst({
        where: { campaignId: campaign.id, status: 'PENDING' },
        orderBy: { notBefore: 'asc' },
        select: { notBefore: true },
      });
      if (deferred?.notBefore) return wait(deferred.notBefore.getTime() - now.getTime(), 'FREQUENCY_CAP');
      const inFlight = await this.prisma.campaignMessage.count({
        where: { campaignId: campaign.id, status: 'QUEUED' },
      });
      if (inFlight) return wait(60_000, 'RETRY');
      return this.complete(campaign);
    }

    // 1) Baja y consentimiento en este instante
    const contact = message.contact;
    const suppressed =
      contact.consentStatus === 'OPTED_OUT' ||
      Boolean(contact.optedOutAt) ||
      Boolean(await this.prisma.suppression.findUnique({ where: { phoneHash: contact.phoneHash } }));
    if (suppressed) return this.skip(message, 'OPTED_OUT');
    if (!contact.phone || contact.anonymizedAt) return this.skip(message, 'NO_PHONE');
    if (campaign.kind === 'MARKETING' && !(VERIFIED_STATUSES as readonly string[]).includes(contact.consentStatus))
      return this.skip(message, 'NO_CONSENT');

    // 3a) Límite diario global (y el de la campaña, si tiene uno menor): sigue el próximo día hábil
    const limit = Math.min(rules.dailyLimit, campaign.dailyCap ?? Number.POSITIVE_INFINITY);
    const sentToday = await this.prisma.campaignMessage.count({
      where: { sentAt: { gte: startOfLocalDay(now) }, ...this.countScope(campaign) },
    });
    if (sentToday >= limit) return this.waitNextDay(campaign, rules, now, 'DAILY_LIMIT');

    // 3b) Topes por contacto: se difiere (no se descarta) hasta que se libere su cupo
    const freeAt = await this.contactFreeAt(campaign, contact.id, rules, now);
    if (freeAt) {
      await this.prisma.campaignMessage.update({ where: { id: message.id }, data: { notBefore: freeAt } });
      return 'continue';
    }

    // Calidad del número en Meta (antes de un lote y cada ~50 envíos): RED pausa todas las campañas
    if (!(campaign.dryRun || loadEnv().CAMPAIGNS_FORCE_DRY_RUN) && !(await this.quality.assertSendable()))
      return done(`PAUSED:${QUALITY_PAUSE_REASON}`);

    return this.send(campaign, message, rules, now);
  }

  private async send(campaign: LoadedCampaign, message: LoadedMessage, rules: Rules, now: Date): Promise<StepResult> {
    const template = campaign.template;
    const params = resolveVariables(
      (campaign.variableMapping ?? {}) as unknown as VariableMapping,
      template.variableCount,
      message.contact,
    );
    const attempts = message.attempts + 1;
    await this.prisma.campaignMessage.update({
      where: { id: message.id },
      data: { status: 'QUEUED', queuedAt: now, attempts, variables: params },
    });
    const dryRun = campaign.dryRun || loadEnv().CAMPAIGNS_FORCE_DRY_RUN;

    let waMessageId: string;
    try {
      if (dryRun) waMessageId = `dryrun.${message.id}`;
      else
        ({ waMessageId } = await this.cloudApi.sendTemplate(message.phone, template.name, template.language, params));
    } catch (error) {
      return this.onSendError(campaign, { ...message, attempts }, error, rules);
    }

    // Fallo 1 del módulo Django: el wamid se guarda SIEMPRE para correlacionar los estados de Meta
    await this.prisma.$transaction(async (tx) => {
      await tx.campaignMessage.update({
        where: { id: message.id },
        data: { status: 'SENT', waMessageId, sentAt: now, notBefore: null, errorCode: null, errorDetail: null },
      });
      if (dryRun) return;
      await tx.contact.update({ where: { id: message.contactId }, data: { lastMarketingAt: now } });
      await this.logInInbox(tx, message, waMessageId, renderBody(template.bodyText, params), campaign, now);
    });
    if (!dryRun) await this.quality.noteSend();
    this.emit(campaign.id);
    return wait(this.jitter(rules), 'JITTER');
  }

  /**
   * La plantilla enviada queda en el historial del Inbox. Si la conversación llevaba más de 24 h
   * quieta, el flujo del bot vuelve al inicio: la respuesta a la campaña entra limpia al flujo guiado.
   */
  private async logInInbox(
    tx: Prisma.TransactionClient,
    message: LoadedMessage,
    waMessageId: string,
    body: string,
    campaign: LoadedCampaign,
    now: Date,
  ) {
    const existing = await tx.conversation.findUnique({ where: { waId: message.phone } });
    const stale =
      existing &&
      existing.flowState !== 'OPTED_OUT' &&
      now.getTime() - existing.lastMessageAt.getTime() > FLOW_RESET_MS;
    const conversation = existing
      ? await tx.conversation.update({
          where: { id: existing.id },
          data: {
            lastMessageAt: now,
            ...(existing.contactId ? {} : { contactId: message.contactId }),
            ...(stale ? { flowState: 'IDLE', flowData: {} } : {}),
          },
        })
      : await tx.conversation.create({
          data: { waId: message.phone, contactId: message.contactId, lastMessageAt: now },
        });
    await tx.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        author: 'BOT',
        type: 'template',
        body,
        payload: { campaignId: campaign.id, template: campaign.template.name },
        waMessageId,
        status: 'SENT',
        campaignMessageId: message.id,
      },
    });
  }

  /** Clasifica el rechazo de Meta: nunca aborta la campaña por un destinatario (fallo 2 de Django) */
  private async onSendError(
    campaign: LoadedCampaign,
    message: LoadedMessage,
    error: unknown,
    rules: Rules,
  ): Promise<StepResult> {
    if (error instanceof WhatsAppNotConfiguredError) {
      await this.backToPending(message, null, null, null);
      return this.pause(campaign, 'NOT_CONFIGURED');
    }
    const apiError = error instanceof WhatsAppApiError ? error : null;
    const code = apiError?.code ?? null;
    const { category, action } = classifyMetaError(code, apiError?.httpStatus ?? null);
    const detail = [(error as Error)?.message, apiError?.details].filter(Boolean).join(' — ').slice(0, 500);
    this.logger.warn(
      `Campaña ${campaign.id}: envío a ${maskPhone(message.phone)} rechazado (${code ?? '—'}, ${category})`,
    );

    if (action === 'PAUSE') {
      await this.backToPending(message, code, category, detail);
      return this.pause(campaign, `${PAUSE_REASON[category] ?? 'ACCOUNT_ERROR'}${code ? `:${code}` : ''}`);
    }
    if (action === 'RETRY') {
      if (message.attempts < MAX_ATTEMPTS) {
        await this.backToPending(message, code, category, detail);
        return wait(Math.min(15 * 60_000, 30_000 * 2 ** (message.attempts - 1)), 'RETRY');
      }
      await this.fail(message, code, category, detail);
      this.emit(campaign.id);
      return wait(this.jitter(rules), 'JITTER');
    }

    await this.fail(message, code, category, detail);
    if (action === 'OPT_OUT') await this.optOutFromMeta(message, campaign.id);
    this.emit(campaign.id);
    if (category === 'UNKNOWN' && (await this.unknownErrorStreak(campaign.id)))
      return this.pause(campaign, `REPEATED_ERRORS${code ? `:${code}` : ''}`);
    return wait(this.jitter(rules), 'JITTER');
  }

  /** 131050: la persona bloqueó el marketing de la empresa → baja automática (supresión) */
  async optOutFromMeta(message: { id: string; phone: string }, campaignId: string): Promise<void> {
    const result = await this.prisma.$transaction(async (tx) => {
      const core = await applyOptOut(tx, {
        phone: message.phone,
        channel: 'META_131050',
        detail: 'error 131050',
        evidence: { campaignId, campaignMessageId: message.id, metaCode: 131050 },
      });
      await tx.campaignMessage.updateMany({
        where: { id: message.id, optedOutAt: null },
        data: { optedOutAt: new Date() },
      });
      return core;
    });
    this.realtime.emitToPanel('contact:changed', { contactId: result.contactId });
    if (result.leadId) this.realtime.emitToPanel('lead:changed', { leadId: result.leadId });
  }

  private async unknownErrorStreak(campaignId: string): Promise<boolean> {
    const last = await this.prisma.campaignMessage.findMany({
      where: { campaignId, queuedAt: { not: null } },
      orderBy: { queuedAt: 'desc' },
      take: UNKNOWN_ERROR_BREAKER,
      select: { status: true, errorCategory: true },
    });
    return (
      last.length === UNKNOWN_ERROR_BREAKER && last.every((m) => m.status === 'FAILED' && m.errorCategory === 'UNKNOWN')
    );
  }

  private backToPending(message: { id: string }, code: number | null, category: string | null, detail: string | null) {
    return this.prisma.campaignMessage.update({
      where: { id: message.id },
      data: { status: 'PENDING', queuedAt: null, errorCode: code, errorCategory: category, errorDetail: detail },
    });
  }

  private fail(message: { id: string }, code: number | null, category: string, detail: string) {
    return this.prisma.campaignMessage.update({
      where: { id: message.id },
      data: {
        status: 'FAILED',
        failedAt: this.clock.now(),
        errorCode: code,
        errorCategory: category,
        errorDetail: detail,
      },
    });
  }

  private async skip(message: { id: string; campaignId: string }, reason: string): Promise<'continue'> {
    await this.prisma.campaignMessage.update({
      where: { id: message.id },
      data: { status: 'SKIPPED', skipReason: reason },
    });
    this.emit(message.campaignId);
    return 'continue';
  }

  /** Envíos que cuentan para los topes: los reales, más los de esta campaña si es una simulación */
  private countScope(campaign: Campaign): Prisma.CampaignMessageWhereInput {
    return { OR: [{ campaign: { dryRun: false } }, { campaignId: campaign.id }] };
  }

  /** null = el contacto tiene cupo ahora; si no, el instante (en ventana) en que se libera */
  private async contactFreeAt(campaign: Campaign, contactId: string, rules: Rules, now: Date): Promise<Date | null> {
    const scope = this.countScope(campaign);
    const today = await this.prisma.campaignMessage.count({
      where: { contactId, sentAt: { gte: startOfLocalDay(now) }, ...scope },
    });
    if (today >= rules.maxPerDay) return nextOpening(rules.windows, rules.holidays, startOfNextLocalDay(now)) ?? null;
    const week = await this.prisma.campaignMessage.findMany({
      where: { contactId, sentAt: { gt: new Date(now.getTime() - WEEK_MS) }, ...scope },
      orderBy: { sentAt: 'asc' },
      select: { sentAt: true },
    });
    if (week.length < rules.maxPerWeek) return null;
    // Se libera cuando el más antiguo de los últimos `maxPerWeek` envíos sale de la semana móvil
    const oldest = week[week.length - rules.maxPerWeek].sentAt!;
    const freeAt = new Date(oldest.getTime() + WEEK_MS + 1000);
    return nextOpening(rules.windows, rules.holidays, freeAt) ?? null;
  }

  private waitNextDay(
    campaign: LoadedCampaign,
    rules: Rules,
    now: Date,
    reason: WaitReason,
  ): Promise<StepResult> | StepResult {
    const opening = nextOpening(rules.windows, rules.holidays, startOfNextLocalDay(now));
    if (!opening) return this.pause(campaign, 'NO_WINDOW');
    return wait(opening.getTime() - now.getTime(), reason);
  }

  private async loadRules(now: Date): Promise<Rules> {
    const [windows, holidays, s] = await Promise.all([
      this.prisma.sendWindow.findMany(),
      this.prisma.holiday.findMany({
        where: { enabled: true, date: { gte: new Date(now.getTime() - 2 * 86_400_000) } },
        select: { date: true },
      }),
      this.settings.getMany([
        'marketing.maxPerContactPerDay',
        'marketing.maxPerContactPerWeek',
        'marketing.dailyGlobalLimit',
        'marketing.jitterMs',
      ] as const),
    ]);
    const jitter = s['marketing.jitterMs'];
    return {
      windows,
      holidays: new Set(holidays.map((h) => h.date.toISOString().slice(0, 10))),
      maxPerDay: Number(s['marketing.maxPerContactPerDay']),
      maxPerWeek: Number(s['marketing.maxPerContactPerWeek']),
      dailyLimit: Number(s['marketing.dailyGlobalLimit']),
      jitter: { min: Math.max(0, Number(jitter?.min ?? 0)), max: Math.max(0, Number(jitter?.max ?? 0)) },
    };
  }

  private jitter(rules: Rules): number {
    const { min, max } = rules.jitter;
    return max > min ? min + Math.floor(Math.random() * (max - min + 1)) : min;
  }

  private async pause(campaign: Campaign, reason: string): Promise<StepResult> {
    const { count } = await this.prisma.campaign.updateMany({
      where: { id: campaign.id, status: { in: ACTIVE_STATUSES } },
      data: { status: 'PAUSED', pausedReason: reason, nextRunAt: null, waitReason: null },
    });
    if (count) {
      this.logger.warn(`⏸️ Campaña ${campaign.id} pausada automáticamente (${reason})`);
      this.emit(campaign.id);
    }
    return done(`PAUSED:${reason}`);
  }

  private async complete(campaign: Campaign): Promise<StepResult> {
    const { count } = await this.prisma.campaign.updateMany({
      where: { id: campaign.id, status: { in: ACTIVE_STATUSES } },
      data: { status: 'COMPLETED', completedAt: this.clock.now(), nextRunAt: null, waitReason: null },
    });
    if (count) {
      this.logger.log(`✅ Campaña ${campaign.id} terminada`);
      this.emit(campaign.id);
    }
    return done('COMPLETED');
  }

  private async recordWait(campaignId: string, result: StepResult) {
    if (result.kind !== 'wait') return;
    const prev = await this.prisma.campaign.findUnique({ where: { id: campaignId }, select: { waitReason: true } });
    await this.prisma.campaign.updateMany({
      where: { id: campaignId, status: { in: ACTIVE_STATUSES } },
      data: { nextRunAt: new Date(this.clock.now().getTime() + result.ms), waitReason: result.reason },
    });
    // El panel muestra "esperando ventana / cupo"; el jitter no necesita aviso aparte (ya avisó el envío)
    if (result.reason !== 'JITTER' && result.reason !== 'YIELD' && prev?.waitReason !== result.reason)
      this.emit(campaignId);
  }

  /**
   * Revisión periódica: toda campaña activa tiene su trabajo en la cola (si Redis lo perdió o el
   * worker se cayó, se recupera sola) y los envíos interrumpidos a mitad no quedan colgados.
   */
  async reconcile(): Promise<void> {
    const stale = new Date(this.clock.now().getTime() - STALE_QUEUED_MS);
    await this.prisma.campaignMessage.updateMany({
      where: { status: 'QUEUED', queuedAt: { lt: stale }, waMessageId: null },
      data: {
        status: 'FAILED',
        failedAt: this.clock.now(),
        errorCategory: 'INFRA',
        errorDetail: 'Envío interrumpido (el worker se reinició): no se reintenta para no duplicar el mensaje',
      },
    });
    const active = await this.prisma.campaign.findMany({
      where: { status: { in: ACTIVE_STATUSES } },
      select: { id: true },
    });
    for (const c of active) await this.queue.schedule(c.id);
  }

  private emit(campaignId: string) {
    this.realtime.emitToPanel('campaign:progress', { campaignId });
  }
}
