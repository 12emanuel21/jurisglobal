import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CampaignSchedule } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { TwoFactorAuthService } from '../../auth/two-factor-auth.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { isWithinSendWindow, nextOpening } from '../../compliance/send-window';
import { CLOCK, type Clock } from '../clock';
import { mappingOrReject, LaunchRejected } from '../campaign-launcher';
import { ruleOf } from '../schedule-runner';
import { describeRule, nextRunAfter, upcomingRuns, validateRule, type RecurrenceRule } from '../recurrence';
import { templateLaunchProblems, type TemplateButton } from '../template-rules';
import type { CreateScheduleDto, RecurrenceDto } from './dto';

/**
 * Campañas recurrentes (solo ADMIN): se guarda la plantilla, la audiencia, las variables y la regla
 * (diaria, semanal o mensual a una hora de Colombia). El worker crea una campaña en cada ejecución;
 * la audiencia se vuelve a calcular cada vez (entran los contactos nuevos de ese origen).
 */
@Injectable()
export class SchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly twoFactorAuth: TwoFactorAuthService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private rule(dto: RecurrenceDto): RecurrenceRule {
    try {
      return validateRule({
        frequency: dto.frequency,
        daysOfWeek: dto.daysOfWeek ?? [],
        dayOfMonth: dto.dayOfMonth ?? null,
        timeOfDay: dto.timeOfDay,
        startDate: dto.startDate ?? null,
        endDate: dto.endDate ?? null,
      });
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  /** Próximas ejecuciones con aviso si caen fuera del horario Ley 2300 (la campaña esperaría) */
  async preview(dto: RecurrenceDto) {
    const rule = this.rule(dto);
    const now = this.clock.now();
    const runs = upcomingRuns(rule, now, 5);
    const [windows, holidays] = await Promise.all([
      this.prisma.sendWindow.findMany(),
      this.prisma.holiday.findMany({
        where: { enabled: true, date: { gte: new Date(now.getTime() - 2 * 86_400_000) } },
      }),
    ]);
    const keys = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
    return {
      description: describeRule(rule),
      runs: runs.map((at) => {
        const inside = isWithinSendWindow(windows, keys, at);
        return { at, insideWindow: inside, startsAt: inside ? at : nextOpening(windows, keys, at) };
      }),
    };
  }

  private serialize(
    s: CampaignSchedule & { template: { name: string }; createdBy: { name: string } | null },
    lastCampaign: { id: string; name: string; status: string } | null,
  ) {
    return {
      id: s.id,
      name: s.name,
      template: { id: s.templateId, name: s.template.name },
      audience: s.audienceFilter,
      dryRun: s.dryRun,
      description: describeRule(ruleOf(s)),
      recurrence: ruleOf(s),
      isActive: s.isActive,
      nextRunAt: s.nextRunAt,
      lastRunAt: s.lastRunAt,
      lastSkipReason: s.lastSkipReason,
      lastCampaign,
      runs: s.runs,
      createdBy: s.createdBy?.name ?? null,
      createdAt: s.createdAt,
    };
  }

  async list() {
    const rows = await this.prisma.campaignSchedule.findMany({
      orderBy: { createdAt: 'desc' },
      include: { template: { select: { name: true } }, createdBy: { select: { name: true } } },
    });
    const lastIds = rows.map((r) => r.lastCampaignId).filter((x): x is string => Boolean(x));
    const last = await this.prisma.campaign.findMany({
      where: { id: { in: lastIds } },
      select: { id: true, name: true, status: true },
    });
    return rows.map((r) => this.serialize(r, last.find((c) => c.id === r.lastCampaignId) ?? null));
  }

  private async one(id: string) {
    const s = await this.prisma.campaignSchedule.findUnique({
      where: { id },
      include: { template: { select: { name: true } }, createdBy: { select: { name: true } } },
    });
    if (!s) throw new NotFoundException('Campaña recurrente no encontrada');
    const lastCampaign = s.lastCampaignId
      ? await this.prisma.campaign.findUnique({
          where: { id: s.lastCampaignId },
          select: { id: true, name: true, status: true },
        })
      : null;
    return this.serialize(s, lastCampaign);
  }

  /** Crear es tan sensible como lanzar: con 2FA activo exige Sudo Mode */
  async create(actor: AuthenticatedUser, dto: CreateScheduleDto, sudoToken?: string) {
    if (actor.isTwoFactorEnabled) await this.twoFactorAuth.assertSudo({ user: actor, sudoToken });
    const template = await this.prisma.messageTemplate.findUnique({ where: { id: dto.templateId } });
    if (!template) throw new NotFoundException('Plantilla no encontrada');
    const problems = templateLaunchProblems({
      status: template.status,
      purpose: template.purpose,
      buttons: (Array.isArray(template.buttons) ? template.buttons : []) as unknown as TemplateButton[],
    });
    if (problems.length) throw new BadRequestException(problems.join('. '));
    const a = dto.audience;
    if (a.type === 'source' && !a.sources?.length) throw new BadRequestException('Elige al menos un origen');
    if (a.type === 'selection' && !a.contactIds?.length)
      throw new BadRequestException('Selecciona al menos un contacto');
    let mapping;
    try {
      mapping = mappingOrReject(dto.variableMapping, template.variableCount);
    } catch (error) {
      throw new BadRequestException((error as LaunchRejected).message);
    }
    const rule = this.rule(dto.recurrence);
    const nextRunAt = nextRunAfter(rule, this.clock.now());
    if (!nextRunAt) throw new BadRequestException('Con esas fechas no queda ninguna ejecución futura');

    const created = await this.prisma.campaignSchedule.create({
      data: {
        name: dto.name,
        templateId: template.id,
        variableMapping: mapping,
        audienceFilter: { type: a.type, sources: a.sources, contactIds: a.contactIds },
        dryRun: dto.dryRun ?? false,
        ...rule,
        nextRunAt,
        createdById: actor.id,
      },
    });
    await this.audit.record({
      userId: actor.id,
      action: 'schedule.create',
      entity: 'CampaignSchedule',
      entityId: created.id,
      data: { name: created.name, template: template.name, rule: describeRule(rule), dryRun: created.dryRun },
    });
    this.emit(created.id);
    return this.one(created.id);
  }

  async pause(actor: AuthenticatedUser, id: string) {
    const s = await this.one(id);
    if (!s.isActive) throw new ConflictException('La campaña recurrente ya está pausada');
    await this.prisma.campaignSchedule.update({ where: { id }, data: { isActive: false, nextRunAt: null } });
    await this.audit.record({ userId: actor.id, action: 'schedule.pause', entity: 'CampaignSchedule', entityId: id });
    this.emit(id);
    return this.one(id);
  }

  /** Reanudar no recupera las ejecuciones perdidas: sigue desde la próxima fecha */
  async resume(actor: AuthenticatedUser, id: string) {
    const s = await this.one(id);
    if (s.isActive) throw new ConflictException('La campaña recurrente ya está activa');
    const nextRunAt = nextRunAfter(s.recurrence, this.clock.now());
    if (!nextRunAt) throw new BadRequestException('Ya pasó la fecha de fin: no quedan ejecuciones');
    await this.prisma.campaignSchedule.update({
      where: { id },
      data: { isActive: true, nextRunAt, lastSkipReason: null },
    });
    await this.audit.record({ userId: actor.id, action: 'schedule.resume', entity: 'CampaignSchedule', entityId: id });
    this.emit(id);
    return this.one(id);
  }

  /** Eliminar la programación no toca las campañas ya creadas (quedan en el historial) */
  async remove(actor: AuthenticatedUser, id: string) {
    const s = await this.one(id);
    await this.prisma.campaignSchedule.delete({ where: { id } });
    await this.audit.record({
      userId: actor.id,
      action: 'schedule.delete',
      entity: 'CampaignSchedule',
      entityId: id,
      data: { name: s.name, runs: s.runs },
    });
    this.emit(id);
    return { ok: true };
  }

  private emit(scheduleId: string) {
    this.realtime.emitToPanel('schedule:changed', { scheduleId });
  }
}
