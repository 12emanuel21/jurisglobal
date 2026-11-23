import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type MessageTemplate } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { WhatsAppApiError, WhatsAppCloudApi } from '../../whatsapp/cloud-api.client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  TEMPLATE_LANGUAGE_PATTERN,
  TEMPLATE_NAME_PATTERN,
  countVariables,
  hasOptOutOption,
  parseGraphTemplate,
  headerTextOf,
  templateLaunchProblems,
  templateWarnings,
  DELETED_IN_META,
  type GraphTemplate,
  type TemplateButton,
} from '../template-rules';
import { ACTIVE_STATUSES } from '../campaign-engine';
import type { TemplateDto } from './dto';

export const toTemplateButtons = (raw: Prisma.JsonValue): TemplateButton[] =>
  (Array.isArray(raw) ? raw : []) as unknown as TemplateButton[];

export function serializeTemplate(t: MessageTemplate, campaigns = 0) {
  const buttons = toTemplateButtons(t.buttons);
  return {
    id: t.id,
    metaId: t.metaId,
    name: t.name,
    language: t.language,
    category: t.category,
    purpose: t.purpose,
    status: t.status,
    bodyText: t.bodyText,
    headerText: headerTextOf(t.components),
    footerText: t.footerText,
    buttons,
    variableCount: t.variableCount,
    hasOptOut: t.hasOptOut,
    source: t.source,
    lastSyncedAt: t.lastSyncedAt,
    updatedAt: t.updatedAt,
    campaigns,
    problems: templateLaunchProblems({ status: t.status, purpose: t.purpose, buttons }),
    warnings: templateWarnings(t),
  };
}

/**
 * Plantillas aprobadas en Meta (solo ADMIN). Se registran a mano con sus metadatos (nombre técnico,
 * idioma, categoría, tipo, cuerpo con {{1}}…, pie y botones con su rol) o se sincronizan desde Graph
 * cuando hay credenciales reales. JurisGlobal no crea plantillas en Meta: eso se hace en el
 * administrador de WhatsApp y Meta las aprueba.
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cloudApi: WhatsAppCloudApi,
  ) {}

  async list() {
    const rows = await this.prisma.messageTemplate.findMany({
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { campaigns: true } } },
    });
    return {
      items: rows.map((t) => serializeTemplate(t, t._count.campaigns)),
      canSync: this.cloudApi.canSyncTemplates(),
    };
  }

  private validated(dto: TemplateDto) {
    if (!TEMPLATE_NAME_PATTERN.test(dto.name))
      throw new BadRequestException('El nombre técnico solo admite minúsculas, números y guiones bajos (como en Meta)');
    if (!TEMPLATE_LANGUAGE_PATTERN.test(dto.language))
      throw new BadRequestException('Idioma no válido: usa el código de Meta, por ejemplo es, es_CO o es_MX');
    let variableCount: number;
    try {
      variableCount = countVariables(dto.bodyText);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const buttons = dto.buttons.map((b) => ({ text: b.text, role: b.role }));
    const footer = dto.footerText ?? null;
    const components = [
      { type: 'BODY', text: dto.bodyText },
      ...(footer ? [{ type: 'FOOTER', text: footer }] : []),
      ...(buttons.length
        ? [{ type: 'BUTTONS', buttons: buttons.map((b) => ({ type: 'QUICK_REPLY', text: b.text })) }]
        : []),
    ];
    return {
      name: dto.name,
      language: dto.language,
      category: dto.category,
      purpose: dto.purpose,
      status: dto.status ?? 'APPROVED',
      bodyText: dto.bodyText,
      footerText: footer,
      buttons: buttons as unknown as Prisma.InputJsonValue,
      components: components as Prisma.InputJsonValue,
      variableCount,
      hasOptOut: hasOptOutOption(footer, buttons),
    };
  }

  async create(actor: AuthenticatedUser, dto: TemplateDto) {
    const data = this.validated(dto);
    try {
      const t = await this.prisma.messageTemplate.create({ data: { ...data, source: 'MANUAL' } });
      await this.audit.record({
        userId: actor.id,
        action: 'template.create',
        entity: 'MessageTemplate',
        entityId: t.id,
        data: { name: t.name },
      });
      return serializeTemplate(t);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Ya hay una plantilla con ese nombre técnico e idioma');
      throw error;
    }
  }

  private async assertEditable(id: string) {
    const t = await this.prisma.messageTemplate.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Plantilla no encontrada');
    const active = await this.prisma.campaign.count({
      where: { templateId: id, status: { in: [...ACTIVE_STATUSES, 'PAUSED'] } },
    });
    return { t, active };
  }

  async update(actor: AuthenticatedUser, id: string, dto: TemplateDto) {
    const { t, active } = await this.assertEditable(id);
    const data = this.validated(dto);
    if (active && (data.name !== t.name || data.language !== t.language || data.bodyText !== t.bodyText))
      throw new ConflictException(
        'Hay campañas en curso con esta plantilla: cancélalas antes de cambiar el nombre, el idioma o el cuerpo',
      );
    try {
      const updated = await this.prisma.messageTemplate.update({ where: { id }, data });
      await this.audit.record({
        userId: actor.id,
        action: 'template.update',
        entity: 'MessageTemplate',
        entityId: id,
        data: { name: updated.name },
      });
      return serializeTemplate(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Ya hay una plantilla con ese nombre técnico e idioma');
      throw error;
    }
  }

  async remove(actor: AuthenticatedUser, id: string) {
    const t = await this.prisma.messageTemplate.findUnique({
      where: { id },
      include: { _count: { select: { campaigns: true, schedules: true } } },
    });
    if (!t) throw new NotFoundException('Plantilla no encontrada');
    if (t._count.schedules)
      throw new ConflictException('La plantilla está en una campaña recurrente: elimina primero esa programación');
    if (t._count.campaigns)
      throw new ConflictException('La plantilla ya se usó en campañas: no se puede eliminar (queda en el historial)');
    await this.prisma.messageTemplate.delete({ where: { id } });
    await this.audit.record({
      userId: actor.id,
      action: 'template.delete',
      entity: 'MessageTemplate',
      entityId: id,
      data: { name: t.name },
    });
    return { ok: true };
  }

  /** Trae las plantillas de la WABA; conserva el tipo y los roles de botón que ya se ajustaron a mano */
  async sync(actor: AuthenticatedUser) {
    if (!this.cloudApi.canSyncTemplates())
      throw new ServiceUnavailableException(
        'Faltan WHATSAPP_WABA_ID y WHATSAPP_ACCESS_TOKEN para sincronizar con Meta',
      );
    let remote: unknown[];
    try {
      remote = await this.cloudApi.listTemplates();
    } catch (error) {
      const code = error instanceof WhatsAppApiError ? ` (código ${error.code ?? error.httpStatus})` : '';
      throw new ServiceUnavailableException(`Meta no respondió la consulta de plantillas${code}`);
    }
    let created = 0;
    let updated = 0;
    const now = new Date();
    const seen = new Set<string>();
    for (const raw of remote) {
      const g = parseGraphTemplate(raw as GraphTemplate);
      if (!g.name || !g.language) continue;
      seen.add(`${g.name}|${g.language}`);
      const current = await this.prisma.messageTemplate.findUnique({
        where: { name_language: { name: g.name, language: g.language } },
      });
      const keptRoles = new Map(toTemplateButtons(current?.buttons ?? []).map((b) => [b.text, b.role]));
      const buttons = g.buttons.map((b) => ({ text: b.text, role: keptRoles.get(b.text) ?? b.role }));
      const data = {
        metaId: g.metaId,
        category: g.category,
        status: g.status,
        components: g.components as Prisma.InputJsonValue,
        bodyText: g.bodyText,
        footerText: g.footerText,
        buttons: buttons as unknown as Prisma.InputJsonValue,
        variableCount: g.variableCount,
        hasOptOut: hasOptOutOption(g.footerText, buttons),
        source: 'META',
        lastSyncedAt: now,
      };
      if (current) {
        await this.prisma.messageTemplate.update({ where: { id: current.id }, data });
        updated++;
      } else {
        await this.prisma.messageTemplate.create({ data: { ...data, name: g.name, language: g.language } });
        created++;
      }
    }
    // La respuesta de Graph es la lista completa de la WABA: lo que no vino ya no existe en Meta
    // (eliminada, o registrada a mano con otro nombre o idioma). Queda DELETED: no se ofrece en
    // campañas ni pruebas y se conserva para el historial. Si reaparece, la próxima sincronización
    // la actualiza con su estado real.
    // Una respuesta vacía suele ser un error de configuración (otra WABA): entonces no se marca nada
    const missing = remote.length
      ? (await this.prisma.messageTemplate.findMany({ where: { status: { not: DELETED_IN_META } } })).filter(
          (t) => !seen.has(`${t.name}|${t.language}`),
        )
      : [];
    if (missing.length) {
      await this.prisma.messageTemplate.updateMany({
        where: { id: { in: missing.map((t) => t.id) } },
        data: { status: DELETED_IN_META, lastSyncedAt: now },
      });
    }
    await this.audit.record({
      userId: actor.id,
      action: 'template.sync',
      entity: 'MessageTemplate',
      data: {
        created,
        updated,
        removed: missing.length,
        removedNames: missing.map((t) => `${t.name} (${t.language})`),
      },
    });
    return { created, updated, removed: missing.length, total: remote.length };
  }
}
