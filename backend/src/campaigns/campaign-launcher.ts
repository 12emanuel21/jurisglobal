import { Inject, Injectable } from '@nestjs/common';
import { CampaignMsgStatus, Prisma, type MessageTemplate } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CampaignQueue } from './campaign-queue';
import { QualityGuard } from './quality-guard';
import { CLOCK, type Clock } from './clock';
import { resolveAudience, type Audience } from './audience';
import { normalizeMapping, templateLaunchProblems, type TemplateButton } from './template-rules';

/** Motivo de negocio por el que no se crea la campaña (la API lo devuelve como 400) */
export class LaunchRejected extends Error {}

export interface LaunchInput {
  template: MessageTemplate;
  audience: Audience;
  variableMapping: unknown;
  name: string;
  scheduledAt: Date | null;
  dryRun: boolean;
  /** null = la creó una campaña recurrente (sin usuario) */
  actorId: string | null;
  scheduleId?: string | null;
}

export function mappingOrReject(raw: unknown, variableCount: number) {
  try {
    return normalizeMapping(raw, variableCount);
  } catch (error) {
    throw new LaunchRejected((error as Error).message);
  }
}

/**
 * Crea una campaña y la pone en la cola (la usan el panel y las campañas recurrentes del worker):
 * los aptos quedan PENDING y los excluidos SKIPPED con su motivo. El envío lo hace el worker, que
 * revalida baja, horario Ley 2300, festivos y topes antes de cada mensaje.
 */
@Injectable()
export class CampaignLauncher {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly queue: CampaignQueue,
    private readonly quality: QualityGuard,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async launch(input: LaunchInput): Promise<{ id: string; recipients: number; excluded: number }> {
    const { template } = input;
    const buttons = (Array.isArray(template.buttons) ? template.buttons : []) as unknown as TemplateButton[];
    const problems = templateLaunchProblems({ status: template.status, purpose: template.purpose, buttons });
    if (problems.length) throw new LaunchRejected(problems.join('. '));
    const mapping = mappingOrReject(input.variableMapping, template.variableCount);

    const now = this.clock.now();
    const scheduledAt = input.scheduledAt && input.scheduledAt.getTime() > now.getTime() ? input.scheduledAt : null;
    const members = await resolveAudience(this.prisma, input.audience, template.purpose);
    const recipients = members.filter((m) => !m.exclusion).length;
    if (!recipients)
      throw new LaunchRejected(
        template.purpose === 'MARKETING'
          ? 'Ningún contacto de esa audiencia puede recibir marketing (solo los verificados y sin baja)'
          : 'Ningún contacto de esa audiencia necesita confirmar su autorización',
      );

    const campaign = await this.prisma.$transaction(
      async (tx) => {
        const created = await tx.campaign.create({
          data: {
            name: input.name,
            kind: template.purpose,
            templateId: template.id,
            variableMapping: mapping as unknown as Prisma.InputJsonValue,
            audienceFilter: input.audience as unknown as Prisma.InputJsonValue,
            status: scheduledAt ? 'SCHEDULED' : 'RUNNING',
            scheduledAt,
            startedAt: scheduledAt ? null : now,
            dryRun: input.dryRun,
            createdById: input.actorId,
            scheduleId: input.scheduleId ?? null,
          },
        });
        // createdAt escalonado (1 ms): el worker envía en el orden de la audiencia, sin empates
        const rows: Prisma.CampaignMessageCreateManyInput[] = members.map((m, i) => ({
          createdAt: new Date(now.getTime() + i),
          campaignId: created.id,
          contactId: m.id,
          phone: m.phone,
          variables: [],
          status: m.exclusion ? CampaignMsgStatus.SKIPPED : CampaignMsgStatus.PENDING,
          skipReason: m.exclusion,
        }));
        for (let i = 0; i < rows.length; i += 1000)
          await tx.campaignMessage.createMany({ data: rows.slice(i, i + 1000) });
        return created;
      },
      { timeout: 60_000 },
    );

    await this.quality.forceRecheck();
    await this.queue.schedule(campaign.id, scheduledAt ? scheduledAt.getTime() - now.getTime() : 0);
    await this.audit.record({
      userId: input.actorId,
      action: 'campaign.launch',
      entity: 'Campaign',
      entityId: campaign.id,
      data: {
        name: campaign.name,
        template: template.name,
        kind: template.purpose,
        recipients,
        excluded: members.length - recipients,
        scheduledAt: scheduledAt?.toISOString() ?? null,
        dryRun: campaign.dryRun,
        scheduleId: input.scheduleId ?? null,
      },
    });
    this.realtime.emitToPanel('campaign:progress', { campaignId: campaign.id });
    return { id: campaign.id, recipients, excluded: members.length - recipients };
  }
}
