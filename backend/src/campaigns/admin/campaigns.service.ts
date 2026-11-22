import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CampaignMsgStatus, Prisma, type Campaign } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { SettingsService } from '../../settings/settings.service';
import { formatPhone } from '../../common/phone';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ACTIVE_STATUSES } from '../campaign-engine';
import { CampaignQueue } from '../campaign-queue';
import { CLOCK, type Clock } from '../clock';
import { TwoFactorAuthService } from '../../auth/two-factor-auth.service';
import { CATEGORY_LABELS, META_ERROR_LABELS, type MetaErrorCategory } from '../meta-errors';
import { resolveAudience, summarizeAudience, type Audience } from '../audience';
import { normalizeMapping, renderBody, resolveVariables, templateLaunchProblems } from '../template-rules';
import { toTemplateButtons } from './templates.service';
import type { CampaignPreviewDto, CreateCampaignDto, RecipientsQueryDto } from './dto';

const MAX_SCHEDULE_AHEAD_MS = 90 * 24 * 60 * 60 * 1000;

export interface CampaignMetrics {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
  optedOut: number;
  replied: number;
}

/** Embudo acumulado: un leído también cuenta como entregado y enviado */
export function metricsFrom(
  counts: Partial<Record<CampaignMsgStatus, number>>,
  optedOut: number,
  replied: number,
): CampaignMetrics {
  const n = (s: CampaignMsgStatus) => counts[s] ?? 0;
  return {
    total: Object.values(counts).reduce((a, b) => a + (b ?? 0), 0),
    pending: n('PENDING') + n('QUEUED'),
    sent: n('SENT') + n('DELIVERED') + n('READ'),
    delivered: n('DELIVERED') + n('READ'),
    read: n('READ'),
    failed: n('FAILED'),
    skipped: n('SKIPPED'),
    optedOut,
    replied,
  };
}

/**
 * Campañas de masivos (solo ADMIN). Al crear se arma la audiencia: los aptos quedan PENDING y los
 * excluidos (baja, sin verificar, ya verificados en un opt-in) quedan SKIPPED con su motivo, para
 * que la exclusión sea auditable. El envío lo hace el worker, que revalida todo antes de cada mensaje.
 */
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly settings: SettingsService,
    private readonly queue: CampaignQueue,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly twoFactorAuth: TwoFactorAuthService,
  ) {}

  private async metricsFor(ids: string[]): Promise<Map<string, CampaignMetrics>> {
    if (!ids.length) return new Map();
    const [groups, optedOut, replied] = await Promise.all([
      this.prisma.campaignMessage.groupBy({
        by: ['campaignId', 'status'],
        where: { campaignId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.campaignMessage.groupBy({
        by: ['campaignId'],
        where: { campaignId: { in: ids }, optedOutAt: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.campaignMessage.groupBy({
        by: ['campaignId'],
        where: { campaignId: { in: ids }, repliedAt: { not: null } },
        _count: { _all: true },
      }),
    ]);
    return new Map(
      ids.map((id) => {
        const counts: Partial<Record<CampaignMsgStatus, number>> = {};
        for (const g of groups.filter((x) => x.campaignId === id)) counts[g.status] = g._count._all;
        return [
          id,
          metricsFrom(
            counts,
            optedOut.find((g) => g.campaignId === id)?._count._all ?? 0,
            replied.find((g) => g.campaignId === id)?._count._all ?? 0,
          ),
        ];
      }),
    );
  }

  private serialize(c: Campaign & { template: { name: string; language: string } }, metrics: CampaignMetrics) {
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      status: c.status,
      dryRun: c.dryRun,
      template: { id: c.templateId, name: c.template.name, language: c.template.language },
      scheduledAt: c.scheduledAt,
      startedAt: c.startedAt,
      completedAt: c.completedAt,
      pausedReason: c.pausedReason,
      nextRunAt: c.nextRunAt,
      waitReason: c.waitReason,
      createdAt: c.createdAt,
      metrics,
    };
  }

  async list() {
    const rows = await this.prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { template: { select: { name: true, language: true } } },
    });
    const metrics = await this.metricsFor(rows.map((r) => r.id));
    return { items: rows.map((c) => this.serialize(c, metrics.get(c.id)!)) };
  }

  async detail(id: string) {
    const c = await this.prisma.campaign.findUnique({
      where: { id },
      include: { template: true, createdBy: { select: { name: true } } },
    });
    if (!c) throw new NotFoundException('Campaña no encontrada');
    const now = this.clock.now();
    const [metrics, errors, skips, deferred] = await Promise.all([
      this.metricsFor([id]),
      this.prisma.campaignMessage.groupBy({
        by: ['errorCode', 'errorCategory'],
        where: { campaignId: id, status: 'FAILED' },
        _count: { _all: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
      }),
      this.prisma.campaignMessage.groupBy({
        by: ['skipReason'],
        where: { campaignId: id, status: 'SKIPPED' },
        _count: { _all: true },
      }),
      this.prisma.campaignMessage.count({ where: { campaignId: id, status: 'PENDING', notBefore: { gt: now } } }),
    ]);
    const buttons = toTemplateButtons(c.template.buttons);
    return {
      ...this.serialize(c, metrics.get(id)!),
      createdBy: c.createdBy?.name ?? null,
      template: {
        id: c.template.id,
        name: c.template.name,
        language: c.template.language,
        bodyText: c.template.bodyText,
        footerText: c.template.footerText,
        buttons,
      },
      topErrors: errors.map((e) => ({
        code: e.errorCode,
        category: e.errorCategory,
        label:
          (e.errorCode && META_ERROR_LABELS[e.errorCode]) ||
          (e.errorCategory ? CATEGORY_LABELS[e.errorCategory as MetaErrorCategory] : null) ||
          'Error de Meta',
        count: e._count._all,
      })),
      skipReasons: Object.fromEntries(skips.map((s) => [s.skipReason ?? 'OTHER', s._count._all])),
      deferred,
    };
  }

  async recipients(id: string, q: RecipientsQueryDto) {
    if (!(await this.prisma.campaign.findUnique({ where: { id }, select: { id: true } })))
      throw new NotFoundException('Campaña no encontrada');
    const where: Prisma.CampaignMessageWhereInput = {
      campaignId: id,
      ...(q.status ? { status: q.status as CampaignMsgStatus } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.campaignMessage.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { contact: { select: { name: true } } },
      }),
      this.prisma.campaignMessage.count({ where }),
    ]);
    return {
      items: rows.map((m) => ({
        id: m.id,
        phone: formatPhone(m.phone),
        name: m.contact.name,
        status: m.status,
        skipReason: m.skipReason,
        errorCode: m.errorCode,
        errorLabel: m.errorCode ? (META_ERROR_LABELS[m.errorCode] ?? m.errorDetail) : m.errorDetail,
        notBefore: m.notBefore,
        sentAt: m.sentAt,
        deliveredAt: m.deliveredAt,
        readAt: m.readAt,
        failedAt: m.failedAt,
        repliedAt: m.repliedAt,
        optedOutAt: m.optedOutAt,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  private async loadTemplate(templateId: string) {
    const template = await this.prisma.messageTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new NotFoundException('Plantilla no encontrada');
    return template;
  }

  private audienceOf(dto: CampaignPreviewDto): Audience {
    const a = dto.audience;
    if (a.type === 'source' && !a.sources?.length) throw new BadRequestException('Elige al menos un origen');
    if (a.type === 'selection' && !a.contactIds?.length)
      throw new BadRequestException('Selecciona al menos un contacto');
    return { type: a.type, sources: a.sources, contactIds: a.contactIds };
  }

  private mappingOf(raw: unknown, variableCount: number) {
    try {
      return normalizeMapping(raw, variableCount);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  /** Vista previa: cuántos reciben, cuántos se excluyen y por qué, y el mensaje de ejemplo */
  async preview(dto: CampaignPreviewDto) {
    const template = await this.loadTemplate(dto.templateId);
    const audience = this.audienceOf(dto);
    const mapping = this.mappingOf(dto.variableMapping, template.variableCount);
    const members = await resolveAudience(this.prisma, audience, template.purpose);
    const caps = await this.settings.getMany([
      'marketing.maxPerContactPerDay',
      'marketing.maxPerContactPerWeek',
    ] as const);
    const summary = await summarizeAudience(
      this.prisma,
      members,
      {
        maxPerDay: Number(caps['marketing.maxPerContactPerDay']),
        maxPerWeek: Number(caps['marketing.maxPerContactPerWeek']),
      },
      this.clock.now(),
    );
    const sampleContact = members.find((m) => !m.exclusion) ?? { name: 'Ana María Pérez' };
    const buttons = toTemplateButtons(template.buttons);
    return {
      kind: template.purpose,
      ...summary,
      problems: templateLaunchProblems({
        status: template.status,
        hasOptOut: template.hasOptOut,
        purpose: template.purpose,
        buttons,
      }),
      sample: {
        body: renderBody(template.bodyText, resolveVariables(mapping, template.variableCount, sampleContact)),
        footer: template.footerText,
        buttons: buttons.map((b) => b.text),
      },
    };
  }

  async create(actor: AuthenticatedUser, dto: CreateCampaignDto, sudoToken?: string) {
    if (actor.isTwoFactorEnabled) await this.twoFactorAuth.assertSudo({ user: actor, sudoToken });
    const template = await this.loadTemplate(dto.templateId);
    const buttons = toTemplateButtons(template.buttons);
    const problems = templateLaunchProblems({
      status: template.status,
      hasOptOut: template.hasOptOut,
      purpose: template.purpose,
      buttons,
    });
    if (problems.length) throw new BadRequestException(problems.join('. '));
    const audience = this.audienceOf(dto);
    const mapping = this.mappingOf(dto.variableMapping, template.variableCount);

    const now = this.clock.now();
    let scheduledAt: Date | null = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    if (scheduledAt && scheduledAt.getTime() <= now.getTime()) scheduledAt = null;
    if (scheduledAt && scheduledAt.getTime() - now.getTime() > MAX_SCHEDULE_AHEAD_MS)
      throw new BadRequestException('Solo se puede programar hasta 90 días hacia adelante');

    const members = await resolveAudience(this.prisma, audience, template.purpose);
    const recipients = members.filter((m) => !m.exclusion).length;
    if (!recipients)
      throw new BadRequestException(
        template.purpose === 'MARKETING'
          ? 'Ningún contacto de esa audiencia puede recibir marketing (solo los verificados y sin baja)'
          : 'Ningún contacto de esa audiencia necesita confirmar su autorización',
      );

    const campaign = await this.prisma.$transaction(
      async (tx) => {
        const created = await tx.campaign.create({
          data: {
            name: dto.name,
            kind: template.purpose,
            templateId: template.id,
            variableMapping: mapping as unknown as Prisma.InputJsonValue,
            audienceFilter: audience as unknown as Prisma.InputJsonValue,
            status: scheduledAt ? 'SCHEDULED' : 'RUNNING',
            scheduledAt,
            startedAt: scheduledAt ? null : now,
            dryRun: dto.dryRun ?? false,
            createdById: actor.id,
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

    await this.queue.schedule(campaign.id, scheduledAt ? scheduledAt.getTime() - now.getTime() : 0);
    await this.audit.record({
      userId: actor.id,
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
      },
    });
    this.emit(campaign.id);
    return this.detail(campaign.id);
  }

  private async load(id: string) {
    const c = await this.prisma.campaign.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Campaña no encontrada');
    return c;
  }

  async pause(actor: AuthenticatedUser, id: string) {
    const c = await this.load(id);
    if (!ACTIVE_STATUSES.includes(c.status))
      throw new ConflictException('Solo se puede pausar una campaña programada o en curso');
    await this.prisma.campaign.update({
      where: { id },
      data: { status: 'PAUSED', pausedReason: 'MANUAL', nextRunAt: null, waitReason: null },
    });
    await this.audit.record({ userId: actor.id, action: 'campaign.pause', entity: 'Campaign', entityId: id });
    this.emit(id);
    return this.detail(id);
  }

  async resume(actor: AuthenticatedUser, id: string) {
    const c = await this.load(id);
    if (c.status !== 'PAUSED') throw new ConflictException('Solo se puede reanudar una campaña pausada');
    const now = this.clock.now();
    const future = c.scheduledAt && c.scheduledAt > now;
    await this.prisma.campaign.update({
      where: { id },
      data: {
        status: future ? 'SCHEDULED' : 'RUNNING',
        pausedReason: null,
        startedAt: c.startedAt ?? (future ? null : now),
      },
    });
    await this.queue.schedule(id, future ? c.scheduledAt!.getTime() - now.getTime() : 0);
    await this.audit.record({
      userId: actor.id,
      action: 'campaign.resume',
      entity: 'Campaign',
      entityId: id,
      data: { previousReason: c.pausedReason },
    });
    this.emit(id);
    return this.detail(id);
  }

  async cancel(actor: AuthenticatedUser, id: string) {
    const c = await this.load(id);
    if (![...ACTIVE_STATUSES, 'PAUSED'].includes(c.status)) throw new ConflictException('La campaña ya terminó');
    await this.prisma.$transaction([
      this.prisma.campaign.update({
        where: { id },
        data: { status: 'CANCELLED', completedAt: this.clock.now(), nextRunAt: null, waitReason: null },
      }),
      this.prisma.campaignMessage.updateMany({
        where: { campaignId: id, status: 'PENDING' },
        data: { status: 'SKIPPED', skipReason: 'CANCELLED' },
      }),
    ]);
    await this.queue.unschedule(id);
    await this.audit.record({ userId: actor.id, action: 'campaign.cancel', entity: 'Campaign', entityId: id });
    this.emit(id);
    return this.detail(id);
  }

  private emit(campaignId: string) {
    this.realtime.emitToPanel('campaign:progress', { campaignId });
  }
}
