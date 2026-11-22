import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type LeadStatus } from '@prisma/client';
import { promises as fs } from 'fs';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { AuditService } from '../../audit/audit.service';
import { TwoFactorAuthService } from '../../auth/two-factor-auth.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { withPlus } from '../../common/phone';
import { chatMediaPath } from '../../whatsapp/media';
import type { LeadFiltersDto, LeadQueryDto } from './dto/lead-query.dto';
import type { UpdateLeadDto } from './dto/update-lead.dto';
import { ANONYMIZED_NAME, ANONYMIZED_NOTE, LEAD_STATUSES, ORIGIN_LABEL, STATUS_LABEL } from './lead-labels';
import { csvDate, phoneCell, toCsv } from './leads-csv';

/** Tope de filas por exportación (más que eso: acotar con filtros) */
export const EXPORT_MAX_ROWS = 10_000;

/** Evidencia de Consent que se conserva al anonimizar (sin IP, user-agent ni texto escrito) */
const EVIDENCE_KEPT_KEYS = ['wamid', 'buttonId', 'messageTimestamp', 'consentId', 'importId', 'row', 'source'];

const listInclude = {
  motivo: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true, role: true } },
  contact: { select: { consentStatus: true, conversation: { select: { id: true } } } },
} satisfies Prisma.LeadInclude;

type LeadRow = Prisma.LeadGetPayload<{ include: typeof listInclude }>;

/** Inicio y fin del día en Colombia (UTC-5 todo el año, sin horario de verano) */
const dayStart = (date: string) => new Date(`${date}T00:00:00.000-05:00`);
const dayEnd = (date: string) => new Date(`${date}T23:59:59.999-05:00`);

/** Filtros del panel -> where de Prisma (los usan el listado y la exportación) */
export function buildLeadWhere(f: LeadFiltersDto): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = [];
  if (f.status) and.push({ status: f.status });
  if (f.motivoId) and.push({ motivoId: f.motivoId });
  if (f.origin) and.push({ origin: f.origin });
  if (f.from || f.to) {
    if (f.from && f.to && f.from > f.to) throw new BadRequestException('La fecha inicial es posterior a la final');
    and.push({ createdAt: { ...(f.from ? { gte: dayStart(f.from) } : {}), ...(f.to ? { lte: dayEnd(f.to) } : {}) } });
  }
  const q = f.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, '');
    and.push({
      OR: [
        { fullName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

/**
 * Leads en el panel (ESP §8): listado con filtros, detalle con consentimientos, estado, responsable,
 * notas, exportación CSV y anonimización (Ley 1581, solo ADMIN). Todo cambio queda en la bitácora
 * y se avisa a los demás paneles por Socket.io.
 */
@Injectable()
export class AdminLeadsService {
  private readonly logger = new Logger(AdminLeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
    private readonly twoFactorAuth: TwoFactorAuthService,
  ) {}

  async list(query: LeadQueryDto) {
    const where = buildLeadWhere(query);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        include: listInclude,
        orderBy: [{ lastSubmittedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const conversations = await this.conversationsByPhone(rows);
    return {
      items: rows.map((r) => this.toListItem(r, conversations)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      pages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  /** Tarjetas del panel: leads por estado (sin filtros) */
  async summary() {
    const groups = await this.prisma.lead.groupBy({ by: ['status'], _count: { _all: true } });
    const byStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
    for (const g of groups) byStatus[g.status] = g._count._all;
    return { byStatus, total: Object.values(byStatus).reduce((a, b) => a + b, 0) };
  }

  /** Posibles responsables: usuarios activos (ADMIN o ASESOR) */
  assignees() {
    return this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
  }

  async detail(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        ...listInclude,
        contact: { select: { consentStatus: true, optedOutAt: true, conversation: { select: { id: true } } } },
        notes: { orderBy: { createdAt: 'desc' }, include: { author: { select: { id: true, name: true } } } },
        consents: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!lead) throw new NotFoundException('Lead no encontrado');
    const conversationId =
      lead.contact?.conversation?.id ??
      (lead.phone
        ? ((await this.prisma.conversation.findUnique({ where: { waId: lead.phone }, select: { id: true } }))?.id ??
          null)
        : null);
    return {
      ...this.toListItem(lead, new Map(conversationId && lead.phone ? [[lead.phone, conversationId]] : [])),
      conversationId,
      optedOutAt: lead.contact?.optedOutAt ?? null,
      utm: lead.utm,
      notes: lead.notes.map((n) => ({
        id: n.id,
        body: n.body,
        createdAt: n.createdAt,
        author: n.author ? { id: n.author.id, name: n.author.name } : null,
      })),
      consents: lead.consents.map((c) => ({
        id: c.id,
        purpose: c.purpose,
        granted: c.granted,
        channel: c.channel,
        textVersion: c.textVersion,
        textSnapshot: c.textSnapshot,
        createdAt: c.createdAt,
      })),
    };
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateLeadDto) {
    const lead = await this.prisma.lead.findUnique({ where: { id }, select: { status: true, assignedToId: true } });
    if (!lead) throw new NotFoundException('Lead no encontrado');
    const data: Prisma.LeadUncheckedUpdateInput = {};
    if (dto.status && dto.status !== lead.status) data.status = dto.status;
    if (dto.assignedToId !== undefined && dto.assignedToId !== lead.assignedToId) {
      if (dto.assignedToId) {
        const user = await this.prisma.user.findUnique({ where: { id: dto.assignedToId }, select: { isActive: true } });
        if (!user?.isActive) throw new BadRequestException('El responsable debe ser un usuario activo');
      }
      data.assignedToId = dto.assignedToId;
    }
    if (Object.keys(data).length) {
      await this.prisma.lead.update({ where: { id }, data });
      if (data.status) {
        await this.audit.record({
          userId: actor.id,
          action: 'LEAD_STATUS_CHANGED',
          entity: 'Lead',
          entityId: id,
          data: { from: lead.status, to: dto.status! },
        });
      }
      if (data.assignedToId !== undefined) {
        await this.audit.record({
          userId: actor.id,
          action: 'LEAD_ASSIGNED',
          entity: 'Lead',
          entityId: id,
          data: { from: lead.assignedToId, to: dto.assignedToId ?? null },
        });
      }
      this.realtime.emitToPanel('lead:changed', { leadId: id });
    }
    return this.detail(id);
  }

  async addNote(actor: AuthenticatedUser, id: string, body: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id }, select: { id: true } });
    if (!lead) throw new NotFoundException('Lead no encontrado');
    const note = await this.prisma.leadNote.create({
      data: { leadId: id, authorId: actor.id, body },
      include: { author: { select: { id: true, name: true } } },
    });
    await this.audit.record({ userId: actor.id, action: 'LEAD_NOTE_ADDED', entity: 'Lead', entityId: id });
    this.realtime.emitToPanel('lead:changed', { leadId: id });
    return { id: note.id, body: note.body, createdAt: note.createdAt, author: note.author };
  }

  /** CSV (UTF-8 con BOM, ";") con los filtros activos. Auditado sin guardar el texto buscado */
  async exportCsv(actor: AuthenticatedUser, filters: LeadFiltersDto): Promise<{ csv: string; count: number }> {
    const rows = await this.prisma.lead.findMany({
      where: buildLeadWhere(filters),
      include: listInclude,
      orderBy: [{ lastSubmittedAt: 'desc' }, { id: 'asc' }],
      take: EXPORT_MAX_ROWS + 1,
    });
    if (rows.length > EXPORT_MAX_ROWS) {
      throw new BadRequestException(
        `La exportación supera ${EXPORT_MAX_ROWS.toLocaleString('es-CO')} leads: acota los filtros (fechas, estado o motivo)`,
      );
    }
    const csv = toCsv(
      [
        'Fecha de registro',
        'Último envío',
        'Nombre',
        'Teléfono',
        'Correo',
        'Motivo',
        'Origen',
        'Último origen',
        'Estado',
        'Responsable',
        'Envíos',
        'Baja de mensajes',
        'Anonimizado',
      ],
      rows.map((r) => [
        csvDate(r.createdAt),
        csvDate(r.lastSubmittedAt),
        r.fullName,
        phoneCell(r.phone),
        r.email ?? '',
        r.motivo.name,
        ORIGIN_LABEL[r.origin],
        ORIGIN_LABEL[r.lastOrigin],
        STATUS_LABEL[r.status],
        r.assignedTo?.name ?? '',
        r.submissionCount,
        r.contact?.consentStatus === 'OPTED_OUT' ? 'Sí' : 'No',
        r.anonymizedAt ? 'Sí' : 'No',
      ]),
    );
    const { q, ...rest } = filters;
    await this.audit.record({
      userId: actor.id,
      action: 'LEADS_EXPORTED',
      entity: 'Lead',
      data: { filters: { ...rest, hasSearch: Boolean(q) }, count: rows.length },
    });
    return { csv, count: rows.length };
  }

  /**
   * Anonimización a solicitud del titular (Ley 1581, solo ADMIN; con 2FA activo exige Sudo Mode):
   * - Lead: nombre -> "Titular anonimizado"; correo, teléfono y UTM se borran; se desliga del contacto.
   * - Notas: su contenido se reemplaza (texto libre: puede tener datos personales).
   * - Consent: se conservan (finalidad, canal, versión, texto y fecha) con el seudónimo; se borran el
   *   teléfono y la evidencia identificable (IP, user-agent, texto escrito).
   * - Contact: queda solo el seudónimo, en baja; el seudónimo entra a Suppression (no se le vuelve a
   *   escribir ni se reimporta).
   * - Conversación de WhatsApp: se elimina con sus mensajes y adjuntos.
   */
  async anonymize(actor: AuthenticatedUser, id: string, sudoToken?: string | string[]) {
    if (actor.isTwoFactorEnabled) await this.twoFactorAuth.assertSudo({ user: actor, sudoToken });
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: { contact: { include: { conversation: { select: { id: true } } } } },
    });
    if (!lead) throw new NotFoundException('Lead no encontrado');
    if (lead.anonymizedAt) throw new ConflictException('Este lead ya fue anonimizado');

    const conversationId =
      lead.contact?.conversation?.id ??
      (lead.phone
        ? (await this.prisma.conversation.findUnique({ where: { waId: lead.phone }, select: { id: true } }))?.id
        : undefined);
    const mediaFiles = conversationId
      ? (
          await this.prisma.message.findMany({
            where: { conversationId, mediaFile: { not: null } },
            select: { mediaFile: true },
          })
        ).map((m) => m.mediaFile!)
      : [];
    const now = new Date();

    const consentsKept = await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id },
        data: {
          fullName: ANONYMIZED_NAME,
          email: null,
          phone: null,
          utm: Prisma.DbNull,
          contactId: null,
          anonymizedAt: now,
        },
      });
      await tx.leadNote.updateMany({ where: { leadId: id }, data: { body: ANONYMIZED_NOTE } });

      const consents = await tx.consent.findMany({
        where: { OR: [{ leadId: id }, { phoneHash: lead.phoneHash }] },
        select: { id: true, evidence: true },
      });
      for (const c of consents) {
        await tx.consent.update({
          where: { id: c.id },
          data: { phone: null, evidence: minimalEvidence(c.evidence, now) },
        });
      }

      const contact = lead.contact ?? (await tx.contact.findUnique({ where: { phoneHash: lead.phoneHash } }));
      if (contact) {
        await tx.contact.update({
          where: { id: contact.id },
          data: {
            phone: null,
            name: null,
            email: null,
            sourceDetail: null,
            tags: [],
            anonymizedAt: now,
            consentStatus: 'OPTED_OUT',
            optedOutAt: contact.optedOutAt ?? now,
            optOutChannel: contact.optOutChannel ?? 'PANEL',
          },
        });
        await tx.campaignMessage.updateMany({
          where: { contactId: contact.id },
          data: { phone: '', variables: {} },
        });
      }
      await tx.suppression.upsert({
        where: { phoneHash: lead.phoneHash },
        create: { phoneHash: lead.phoneHash, reason: 'ANONYMIZED' },
        update: {},
      });
      if (conversationId) await tx.conversation.delete({ where: { id: conversationId } });
      return consents.length;
    });

    for (const file of mediaFiles) {
      const path = chatMediaPath(file);
      if (path) await fs.unlink(path).catch(() => undefined);
    }
    await this.audit.record({
      userId: actor.id,
      action: 'LEAD_ANONYMIZED',
      entity: 'Lead',
      entityId: id,
      data: { consentsKept, conversationDeleted: Boolean(conversationId), filesDeleted: mediaFiles.length },
    });
    this.logger.log(`🧹 Lead ${id} anonimizado (Ley 1581)`);
    this.realtime.emitToPanel('lead:changed', { leadId: id });
    if (conversationId) this.realtime.emitToPanel('conversation:updated', { conversationId });
    return this.detail(id);
  }

  // ─────────────────────────── Auxiliares ───────────────────────────

  private async conversationsByPhone(rows: LeadRow[]): Promise<Map<string, string>> {
    const phones = rows.filter((r) => r.phone && !r.contact?.conversation).map((r) => r.phone!);
    if (!phones.length) return new Map();
    const found = await this.prisma.conversation.findMany({
      where: { waId: { in: phones } },
      select: { id: true, waId: true },
    });
    return new Map(found.map((c) => [c.waId, c.id]));
  }

  private toListItem(r: LeadRow, conversations: Map<string, string>) {
    return {
      id: r.id,
      fullName: r.fullName,
      phone: r.phone ? withPlus(r.phone) : null,
      email: r.email,
      motivo: r.motivo,
      origin: r.origin,
      lastOrigin: r.lastOrigin,
      status: r.status,
      assignedTo: r.assignedTo,
      submissionCount: r.submissionCount,
      createdAt: r.createdAt,
      lastSubmittedAt: r.lastSubmittedAt,
      anonymizedAt: r.anonymizedAt,
      optedOut: r.contact?.consentStatus === 'OPTED_OUT',
      conversationId: r.contact?.conversation?.id ?? (r.phone ? (conversations.get(r.phone) ?? null) : null),
    };
  }
}

function minimalEvidence(evidence: Prisma.JsonValue, at: Date): Prisma.InputJsonValue {
  const kept =
    evidence && typeof evidence === 'object' && !Array.isArray(evidence)
      ? Object.fromEntries(Object.entries(evidence).filter(([k]) => EVIDENCE_KEPT_KEYS.includes(k)))
      : {};
  return { ...kept, anonymizedAt: at.toISOString() };
}
