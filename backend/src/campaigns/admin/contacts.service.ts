import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConsentPurpose, Prisma, type ContactConsentStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { phoneHash } from '../../common/crypto';
import { formatPhone, isColombianMobile, toColombianPhone } from '../../common/phone';
import { applyOptOut } from '../../compliance/opt-out-core';
import { parseContactSpreadsheet, type ContactImportRow } from '../../contacts/contacts-spreadsheet';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { ContactQueryDto, ContactStatusFilter, CreateContactDto } from './dto';

const STATUS_FILTER: Record<ContactStatusFilter, ContactConsentStatus[]> = {
  verified: ['DOCUMENTED', 'CONFIRMED'],
  unverified: ['UNVERIFIED'],
  opted_out: ['OPTED_OUT'],
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export function contactStatusLabel(status: ContactConsentStatus): ContactStatusFilter {
  if (status === 'OPTED_OUT') return 'opted_out';
  return status === 'UNVERIFIED' ? 'unverified' : 'verified';
}

export interface UploadedSpreadsheet {
  buffer: Buffer;
  originalname: string;
  size: number;
}

export interface ImportSummary {
  importId: string;
  fileName: string;
  totalRows: number;
  imported: number;
  updated: number;
  /** Repetidos dentro del archivo + ya existentes sin cambios */
  duplicates: number;
  duplicatesInFile: number;
  duplicatesExisting: number;
  /** Ya estaban de baja o anonimizados: no se tocan ni se reactivan */
  optedOutSkipped: number;
  invalid: number;
  invalidDetails: string[];
  warnings: string[];
  /** De lo importado/actualizado: aptos para marketing vs. solo confirmación opt-in */
  verified: number;
  unverified: number;
}

/**
 * Contactos de masivos (solo ADMIN): listado, alta y baja manual e importación de bases
 * (.xlsx/.csv). Regla de cumplimiento: con soporte documental explícito para JurisGlobal el
 * contacto entra DOCUMENTED (apto para marketing); sin soporte entra UNVERIFIED y solo puede
 * recibir la campaña de confirmación (OPT_IN). Una baja o una supresión nunca se reactivan.
 */
@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private where(q: ContactQueryDto): Prisma.ContactWhereInput {
    const where: Prisma.ContactWhereInput = { phone: { not: null }, anonymizedAt: null };
    if (q.status) where.consentStatus = { in: STATUS_FILTER[q.status] };
    if (q.source) where.sourceDetail = q.source;
    if (q.q) {
      const digits = q.q.replace(/\D/g, '');
      where.OR = [
        { name: { contains: q.q, mode: 'insensitive' } },
        { email: { contains: q.q, mode: 'insensitive' } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ];
    }
    return where;
  }

  async list(q: ContactQueryDto) {
    const where = this.where(q);
    const visible = { phone: { not: null }, anonymizedAt: null } as const;
    const [rows, total, groups] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { import: { select: { fileName: true } } },
      }),
      this.prisma.contact.count({ where }),
      this.prisma.contact.groupBy({ by: ['consentStatus'], where: visible, _count: { _all: true } }),
    ]);
    const by = (s: ContactConsentStatus[]) =>
      groups.filter((g) => s.includes(g.consentStatus)).reduce((n, g) => n + g._count._all, 0);
    return {
      items: rows.map((c) => ({
        id: c.id,
        phone: formatPhone(c.phone!),
        name: c.name,
        email: c.email,
        source: c.source,
        sourceDetail: c.sourceDetail,
        tags: c.tags,
        status: contactStatusLabel(c.consentStatus),
        consentStatus: c.consentStatus,
        optedOutAt: c.optedOutAt,
        optOutChannel: c.optOutChannel,
        lastMarketingAt: c.lastMarketingAt,
        importFile: c.import?.fileName ?? null,
        createdAt: c.createdAt,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
      counts: {
        verified: by(STATUS_FILTER.verified),
        unverified: by(STATUS_FILTER.unverified),
        optedOut: by(STATUS_FILTER.opted_out),
      },
    };
  }

  /** Orígenes declarados (para filtrar y armar audiencias) */
  async sources() {
    const groups = await this.prisma.contact.groupBy({
      by: ['sourceDetail'],
      where: { phone: { not: null }, anonymizedAt: null, sourceDetail: { not: null } },
      _count: { _all: true },
      orderBy: { sourceDetail: 'asc' },
    });
    return groups.map((g) => ({ source: g.sourceDetail!, count: g._count._all }));
  }

  async imports() {
    return this.prisma.contactImport.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        fileName: true,
        sourceLabel: true,
        rowsTotal: true,
        rowsCreated: true,
        rowsUpdated: true,
        rowsSkipped: true,
        createdAt: true,
        createdBy: { select: { name: true } },
      },
    });
  }

  private normalizePhone(raw: string): string {
    const phone = toColombianPhone(raw);
    if (!phone || !isColombianMobile(phone))
      throw new BadRequestException('Escribe un celular colombiano válido (10 dígitos, empieza por 3)');
    return phone;
  }

  async create(actor: AuthenticatedUser, dto: CreateContactDto) {
    const phone = this.normalizePhone(dto.phone);
    const email = dto.email?.toLowerCase();
    if (email && !EMAIL.test(email)) throw new BadRequestException('Correo electrónico no válido');
    const hash = phoneHash(phone);
    if (await this.prisma.suppression.findUnique({ where: { phoneHash: hash } }))
      throw new ConflictException(
        'Este número pidió la baja o la supresión de sus datos: no se puede volver a agregar',
      );
    if (await this.prisma.contact.findUnique({ where: { phoneHash: hash } }))
      throw new ConflictException('Ya existe un contacto con ese celular');

    const contact = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contact.create({
        data: {
          phone,
          phoneHash: hash,
          name: dto.name ?? null,
          email: email ?? null,
          source: 'PANEL',
          sourceDetail: dto.source,
          consentStatus: dto.consent,
        },
      });
      if (dto.consent === 'DOCUMENTED') {
        await tx.consent.create({
          data: {
            contactId: created.id,
            phone,
            phoneHash: hash,
            purpose: ConsentPurpose.MARKETING_WHATSAPP,
            granted: true,
            channel: 'PANEL',
            textVersion: 'panel.documented@1',
            textSnapshot: `Autorización documentada declarada desde el panel (origen «${dto.source}»)${dto.consentNote ? `: ${dto.consentNote}` : ''}`,
            evidence: { userId: actor.id, source: dto.source, note: dto.consentNote ?? null },
          },
        });
      }
      return created;
    });
    await this.audit.record({
      userId: actor.id,
      action: 'contact.create',
      entity: 'Contact',
      entityId: contact.id,
      data: { consent: dto.consent, source: dto.source },
    });
    this.realtime.emitToPanel('contact:changed', { contactId: contact.id });
    return { id: contact.id, status: contactStatusLabel(contact.consentStatus) };
  }

  async optOut(actor: AuthenticatedUser, id: string, note?: string) {
    const contact = await this.prisma.contact.findUnique({ where: { id } });
    if (!contact?.phone) throw new NotFoundException('Contacto no encontrado');
    if (contact.consentStatus === 'OPTED_OUT') throw new ConflictException('El contacto ya está de baja');
    const result = await this.prisma.$transaction((tx) =>
      applyOptOut(tx, {
        phone: contact.phone!,
        channel: 'PANEL',
        detail: note || 'sin nota',
        evidence: { userId: actor.id, note: note ?? null },
        createSource: 'PANEL',
      }),
    );
    await this.audit.record({ userId: actor.id, action: 'contact.opt_out', entity: 'Contact', entityId: id });
    this.realtime.emitToPanel('contact:changed', { contactId: id });
    if (result.leadId) this.realtime.emitToPanel('lead:changed', { leadId: result.leadId });
    return { ok: true };
  }

  async import(
    actor: AuthenticatedUser,
    file: UploadedSpreadsheet | undefined,
    consentNote?: string,
  ): Promise<ImportSummary> {
    if (!file?.buffer?.length) throw new BadRequestException('Adjunta un archivo .xlsx o .csv');
    if (file.size > MAX_IMPORT_BYTES) throw new BadRequestException('El archivo supera 5 MB');
    const fileName = file.originalname.slice(0, 200);
    if (!/\.(xlsx|xls|csv)$/i.test(fileName))
      throw new BadRequestException('Solo se aceptan archivos .xlsx, .xls o .csv');

    const parsed = parseContactSpreadsheet(file.buffer, fileName);
    if (parsed.fatal) throw new BadRequestException(parsed.errors[0]);

    const rows = parsed.rows.map((r) => ({ ...r, hash: phoneHash(r.phone) }));
    const hashes = rows.map((r) => r.hash);
    const [existing, suppressed] = await Promise.all([
      this.prisma.contact.findMany({ where: { phoneHash: { in: hashes } } }),
      this.prisma.suppression.findMany({ where: { phoneHash: { in: hashes } }, select: { phoneHash: true } }),
    ]);
    const byHash = new Map(existing.map((c) => [c.phoneHash, c]));
    const blocked = new Set(suppressed.map((s) => s.phoneHash));
    const sourceLabel = [...new Set(rows.map((r) => r.source))].join(', ').slice(0, 150) || '—';

    const summary: ImportSummary = {
      importId: '',
      fileName,
      totalRows: rows.length + parsed.invalidRows + parsed.duplicateRows,
      imported: 0,
      updated: 0,
      duplicates: parsed.duplicateRows,
      duplicatesInFile: parsed.duplicateRows,
      duplicatesExisting: 0,
      optedOutSkipped: 0,
      invalid: parsed.invalidRows,
      invalidDetails: parsed.errors,
      warnings: parsed.warnings,
      verified: 0,
      unverified: 0,
    };

    const importRow = await this.prisma.contactImport.create({
      data: {
        fileName,
        sourceLabel,
        hasDocumentedConsent: rows.some((r) => r.consent === 'DOCUMENTED'),
        consentNote: consentNote ?? null,
        rowsTotal: summary.totalRows,
        rowsCreated: 0,
        rowsUpdated: 0,
        rowsSkipped: 0,
        createdById: actor.id,
      },
    });
    summary.importId = importRow.id;

    const consentFor = (r: ContactImportRow & { hash: string }, contactId: string) => ({
      contactId,
      phone: r.phone,
      phoneHash: r.hash,
      purpose: ConsentPurpose.MARKETING_WHATSAPP,
      granted: true,
      channel: 'IMPORT' as const,
      textVersion: 'import.documented@1',
      textSnapshot: `Autorización documentada declarada en la importación «${fileName}» (fila ${r.row}, origen «${r.source}»)${consentNote ? `: ${consentNote}` : ''}`,
      evidence: { importId: importRow.id, row: r.row, source: r.source, file: fileName },
    });

    const creates: Prisma.ContactCreateManyInput[] = [];
    const consents: Prisma.ConsentCreateManyInput[] = [];
    const updates: Array<{ id: string; data: Prisma.ContactUpdateInput }> = [];

    for (const r of rows) {
      const ex = byHash.get(r.hash);
      if (blocked.has(r.hash) || ex?.consentStatus === 'OPTED_OUT' || (ex && (!ex.phone || ex.anonymizedAt))) {
        summary.optedOutSkipped++;
        continue;
      }
      if (!ex) {
        const id = randomUUID();
        creates.push({
          id,
          // Escalonado (1 ms por fila): la audiencia y el envío siguen el orden del archivo
          createdAt: new Date(importRow.createdAt.getTime() + creates.length),
          phone: r.phone,
          phoneHash: r.hash,
          name: r.name,
          email: r.email,
          tags: r.tags,
          source: 'IMPORT',
          sourceDetail: r.source,
          consentStatus: r.consent,
          importId: importRow.id,
        });
        if (r.consent === 'DOCUMENTED') consents.push(consentFor(r, id));
        summary.imported++;
        summary[r.consent === 'DOCUMENTED' ? 'verified' : 'unverified']++;
        continue;
      }
      // Ya existe: solo se completa lo vacío y se sube de UNVERIFIED a DOCUMENTED (nunca se baja)
      const data: Prisma.ContactUpdateInput = {};
      if (!ex.name && r.name) data.name = r.name;
      if (!ex.email && r.email) data.email = r.email;
      if (!ex.sourceDetail) data.sourceDetail = r.source;
      const newTags = r.tags.filter((t) => !ex.tags.includes(t));
      if (newTags.length) data.tags = [...ex.tags, ...newTags].slice(0, 30);
      const upgrade = ex.consentStatus === 'UNVERIFIED' && r.consent === 'DOCUMENTED';
      if (upgrade) {
        data.consentStatus = 'DOCUMENTED';
        consents.push(consentFor(r, ex.id));
      }
      if (Object.keys(data).length) {
        updates.push({ id: ex.id, data });
        summary.updated++;
        summary[upgrade || ex.consentStatus !== 'UNVERIFIED' ? 'verified' : 'unverified']++;
      } else {
        summary.duplicatesExisting++;
        summary.duplicates++;
      }
    }

    await this.prisma.$transaction(
      async (tx) => {
        for (let i = 0; i < creates.length; i += 500) await tx.contact.createMany({ data: creates.slice(i, i + 500) });
        for (const u of updates) await tx.contact.update({ where: { id: u.id }, data: u.data });
        for (let i = 0; i < consents.length; i += 500)
          await tx.consent.createMany({ data: consents.slice(i, i + 500) });
        await tx.contactImport.update({
          where: { id: importRow.id },
          data: {
            rowsCreated: summary.imported,
            rowsUpdated: summary.updated,
            rowsSkipped: summary.totalRows - summary.imported - summary.updated,
            errors: { invalid: parsed.errors, warnings: parsed.warnings },
          },
        });
      },
      { timeout: 60_000 },
    );

    await this.audit.record({
      userId: actor.id,
      action: 'contacts.import',
      entity: 'ContactImport',
      entityId: importRow.id,
      data: {
        fileName,
        imported: summary.imported,
        updated: summary.updated,
        duplicates: summary.duplicates,
        invalid: summary.invalid,
        optedOutSkipped: summary.optedOutSkipped,
      },
    });
    this.realtime.emitToPanel('contact:changed', { importId: importRow.id });
    return summary;
  }
}
