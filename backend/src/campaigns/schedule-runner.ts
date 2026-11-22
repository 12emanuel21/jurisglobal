import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CampaignSchedule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CampaignLauncher, LaunchRejected } from './campaign-launcher';
import { CLOCK, type Clock } from './clock';
import { nextRunAfter, runLabel, type RecurrenceRule } from './recurrence';
import type { Audience } from './audience';

export const ruleOf = (s: CampaignSchedule): RecurrenceRule => ({
  frequency: s.frequency,
  daysOfWeek: s.daysOfWeek,
  dayOfMonth: s.dayOfMonth,
  timeOfDay: s.timeOfDay,
  startDate: s.startDate,
  endDate: s.endDate,
});

export const PREVIOUS_STILL_ACTIVE =
  'La ejecución anterior sigue activa (en curso, programada o pausada): se omitió esta para no duplicar envíos';

/**
 * Campañas recurrentes (lo ejecuta el worker en su revisión de cada minuto): toda programación activa
 * cuya hora llegó crea su campaña con CampaignLauncher. La ejecución se «reclama» de forma atómica
 * (nextRunAt) para que nunca se cree dos veces. Si la anterior sigue activa, la plantilla ya no está
 * aprobada o nadie de la audiencia puede recibir, se omite esa vez y queda el motivo en el panel.
 */
@Injectable()
export class CampaignScheduleRunner {
  private readonly logger = new Logger(CampaignScheduleRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly launcher: CampaignLauncher,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async runDue(): Promise<number> {
    const now = this.clock.now();
    const due = await this.prisma.campaignSchedule.findMany({
      where: { isActive: true, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: 'asc' },
      take: 20,
    });
    let launched = 0;
    for (const s of due) if (await this.runOne(s, now)) launched++;
    return launched;
  }

  private async runOne(s: CampaignSchedule, now: Date): Promise<boolean> {
    const next = nextRunAfter(ruleOf(s), now);
    const claimed = await this.prisma.campaignSchedule.updateMany({
      where: { id: s.id, isActive: true, nextRunAt: s.nextRunAt },
      data: { nextRunAt: next, lastRunAt: now, ...(next ? {} : { isActive: false }) },
    });
    if (!claimed.count) return false; // otra instancia ya la tomó

    let campaignId: string | null = null;
    let skip: string | null = null;
    try {
      const previous = await this.prisma.campaign.findFirst({
        where: { scheduleId: s.id, status: { in: ['SCHEDULED', 'RUNNING', 'PAUSED'] } },
        select: { id: true },
      });
      if (previous) skip = PREVIOUS_STILL_ACTIVE;
      else {
        const template = await this.prisma.messageTemplate.findUnique({ where: { id: s.templateId } });
        if (!template) throw new LaunchRejected('La plantilla ya no existe');
        ({ id: campaignId } = await this.launcher.launch({
          template,
          audience: s.audienceFilter as unknown as Audience,
          variableMapping: s.variableMapping,
          name: `${s.name} · ${runLabel(now)}`,
          scheduledAt: null,
          dryRun: s.dryRun,
          actorId: null,
          scheduleId: s.id,
        }));
      }
    } catch (error) {
      skip =
        error instanceof LaunchRejected
          ? error.message
          : 'Error inesperado al crear la campaña: se intentará en la próxima ejecución';
      if (!(error instanceof LaunchRejected))
        this.logger.error(`Campaña recurrente ${s.id}: ${(error as Error).message}`);
    }

    await this.prisma.campaignSchedule.update({
      where: { id: s.id },
      data: { lastSkipReason: skip, ...(campaignId ? { lastCampaignId: campaignId, runs: { increment: 1 } } : {}) },
    });
    await this.audit.record({
      userId: null,
      action: campaignId ? 'schedule.run' : 'schedule.skip',
      entity: 'CampaignSchedule',
      entityId: s.id,
      data: { name: s.name, campaignId, reason: skip, nextRunAt: next?.toISOString() ?? null },
    });
    this.logger.log(
      campaignId
        ? `🔁 Campaña recurrente «${s.name}»: creada ${campaignId}`
        : `🔁 Campaña recurrente «${s.name}» omitida: ${skip}`,
    );
    this.realtime.emitToPanel('schedule:changed', { scheduleId: s.id });
    return Boolean(campaignId);
  }
}
