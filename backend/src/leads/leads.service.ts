import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Channel, ConsentPurpose, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SettingsService } from '../settings/settings.service';
import { toColombianPhone } from '../common/phone';
import { phoneHash } from '../common/crypto';
import { maskPhone } from '../common/redact';
import { isUniqueViolation } from '../prisma/prisma-errors';
import type { ConsentText } from '../settings/defaults';
import { LeadNotifier } from './lead-notifier';

export type LeadChannel = 'WEB' | 'WHATSAPP';

/** Entrada única para la web (POST /leads) y el chatbot (Etapa 4, llamada interna) */
export interface SubmitLeadInput {
  fullName: string;
  phone: string;
  email: string;
  /** id o nombre de un motivo activo */
  motivo: string;
  channel: LeadChannel;
  consents: { privacyAndTerms?: boolean; contactAndDataProcessing: boolean };
  /** web: {ip, userAgent}; whatsapp: {wamid, buttonId} */
  evidence?: Record<string, string | null | undefined>;
  utm?: Record<string, string | undefined>;
  /**
   * Autorizaciones ya registradas en el momento en que se dieron (el bot guarda el Consent al tocar
   * «Acepto», antes de pedir los datos). Se enlazan al lead en lugar de duplicarlas; solo cuentan las
   * otorgadas al mismo teléfono y aún sin lead.
   */
  recordedConsentIds?: string[];
  /** Lo que la persona contó que necesita (WhatsApp): queda como nota del lead */
  message?: string;
}

export interface SubmitLeadResult {
  leadId: string;
  isNew: boolean;
  /** E.164 con "+": +573001234567 */
  phone: string;
  submissionCount: number;
  differences: string[];
}

const CHANNEL_LABEL: Record<LeadChannel, string> = { WEB: 'el formulario web', WHATSAPP: 'WhatsApp' };

const normalizeName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Registro de leads (ESP §5): valida, normaliza el teléfono (+57), deduplica por teléfono, registra
 * cada autorización en Consent (Ley 1581) y avisa al equipo por correo y Socket.io sin bloquear.
 */
@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly realtime: RealtimeGateway,
    private readonly notifier: LeadNotifier,
  ) {}

  /** Motivo activo por id o por nombre (sin distinguir mayúsculas ni tildes) */
  async resolveMotivo(value: string) {
    const active = await this.prisma.motivo.findMany({ where: { isActive: true } });
    const wanted = normalizeName(value);
    const motivo = active.find((m) => (UUID.test(value) && m.id === value) || normalizeName(m.name) === wanted);
    if (!motivo) throw new BadRequestException('El motivo no es válido');
    return motivo;
  }

  /** Textos vigentes que la persona aceptó, según el canal */
  private async consentTexts(input: SubmitLeadInput) {
    const t = await this.settings.getMany([
      'consent.web.privacy',
      'consent.web.contact',
      'consent.whatsapp.contact',
    ] as const);
    const entry = (purpose: ConsentPurpose, key: string, text: ConsentText) => ({
      purpose,
      textVersion: `${key}@${text.version}`,
      textSnapshot: text.text,
    });
    if (input.channel === 'WHATSAPP') {
      return [
        entry(ConsentPurpose.CONTACT_AND_DATA_PROCESSING, 'consent.whatsapp.contact', t['consent.whatsapp.contact']),
      ];
    }
    return [
      entry(ConsentPurpose.PRIVACY_TERMS_COOKIES, 'consent.web.privacy', t['consent.web.privacy']),
      entry(ConsentPurpose.CONTACT_AND_DATA_PROCESSING, 'consent.web.contact', t['consent.web.contact']),
    ];
  }

  async submit(input: SubmitLeadInput): Promise<SubmitLeadResult> {
    const phone = toColombianPhone(input.phone);
    if (!phone)
      throw new BadRequestException('El teléfono debe ser un número de Colombia válido (celular o fijo, 10 dígitos)');
    if (!input.consents.contactAndDataProcessing || (input.channel === 'WEB' && !input.consents.privacyAndTerms)) {
      throw new BadRequestException('Las autorizaciones son obligatorias para registrar tus datos');
    }
    const motivo = await this.resolveMotivo(input.motivo);
    const consents = await this.consentTexts(input);
    const hash = phoneHash(phone);

    // Dos envíos simultáneos del mismo número: el segundo choca con el índice único y se reintenta como recontacto
    let result: SubmitLeadResult;
    try {
      result = await this.persist(input, phone, hash, motivo, consents);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      result = await this.persist(input, phone, hash, motivo, consents);
    }

    this.logger.log(
      `${result.isNew ? '🆕 Lead nuevo' : '🔁 Recontacto'} ${result.leadId} por ${input.channel} (${maskPhone(phone)})`,
    );
    this.realtime.emitToPanel(result.isNew ? 'lead:new' : 'lead:updated', {
      leadId: result.leadId,
      isNew: result.isNew,
    });
    // No bloqueante: un fallo de SMTP nunca impide guardar el lead
    void this.notifier.notify({
      leadId: result.leadId,
      isNew: result.isNew,
      fullName: input.fullName,
      phone,
      email: input.email,
      motivo: motivo.name,
      origin: input.channel,
      submissionCount: result.submissionCount,
      receivedAt: new Date(),
      differences: result.differences,
    });
    return result;
  }

  private persist(
    input: SubmitLeadInput,
    phone: string,
    hash: string,
    motivo: { id: string; name: string },
    consents: Array<{ purpose: ConsentPurpose; textVersion: string; textSnapshot: string }>,
  ): Promise<SubmitLeadResult> {
    const channel = input.channel as Channel;
    return this.prisma.$transaction(async (tx) => {
      // Contacto (base para bajas y conversaciones), por seudónimo: también encuentra al titular
      // anonimizado que vuelve a escribir. Solo se completan datos vacíos; la baja se conserva.
      const contact = await tx.contact.upsert({
        where: { phoneHash: hash },
        create: { phone, phoneHash: hash, name: input.fullName, email: input.email, source: channel },
        update: {},
      });
      if (!contact.phone || !contact.name || !contact.email) {
        await tx.contact.update({
          where: { id: contact.id },
          data: {
            phone: contact.phone ?? phone,
            name: contact.name ?? input.fullName,
            email: contact.email ?? input.email,
            ...(contact.phone ? {} : { anonymizedAt: null }),
          },
        });
      }
      if (channel === Channel.WHATSAPP) {
        await tx.conversation.updateMany({ where: { waId: phone, contactId: null }, data: { contactId: contact.id } });
      }

      const existing = await tx.lead.findUnique({ where: { phone }, include: { motivo: true } });
      let leadId: string;
      let submissionCount = 1;
      const differences: string[] = [];

      if (!existing) {
        const lead = await tx.lead.create({
          data: {
            fullName: input.fullName,
            phone,
            phoneHash: hash,
            email: input.email,
            motivoId: motivo.id,
            origin: channel,
            lastOrigin: channel,
            contactId: contact.id,
            utm: input.utm ? (input.utm as Prisma.InputJsonValue) : undefined,
          },
        });
        leadId = lead.id;
      } else {
        // Recontacto: solo se completan datos vacíos; lo que difiere queda en una nota para el equipo
        if (existing.fullName && existing.fullName !== input.fullName) differences.push(`Nombre: «${input.fullName}»`);
        if (existing.email && existing.email !== input.email) differences.push(`Correo: «${input.email}»`);
        if (existing.motivoId !== motivo.id)
          differences.push(`Motivo: «${motivo.name}» (registrado: «${existing.motivo.name}»)`);
        const updated = await tx.lead.update({
          where: { id: existing.id },
          data: {
            fullName: existing.fullName || input.fullName,
            email: existing.email || input.email,
            lastOrigin: channel,
            submissionCount: { increment: 1 },
            lastSubmittedAt: new Date(),
            contactId: existing.contactId ?? contact.id,
          },
        });
        leadId = updated.id;
        submissionCount = updated.submissionCount;
        await tx.leadNote.create({
          data: {
            leadId,
            body:
              `Recontacto automático por ${CHANNEL_LABEL[input.channel]} (envío #${submissionCount}). ` +
              (differences.length
                ? `Datos recibidos que difieren del registro: ${differences.join('; ')}.`
                : 'Mismos datos del registro.'),
          },
        });
      }

      const message = input.message?.replace(/\s+/g, ' ').trim().slice(0, 500);
      if (message) {
        await tx.leadNote.create({
          data: { leadId, body: `Consulta contada por ${CHANNEL_LABEL[input.channel]}: «${message}»` },
        });
      }

      const recorded = input.recordedConsentIds?.length
        ? await tx.consent.findMany({
            where: { id: { in: input.recordedConsentIds }, leadId: null, phoneHash: hash, granted: true },
            select: { id: true, purpose: true },
          })
        : [];
      if (recorded.length) {
        await tx.consent.updateMany({
          where: { id: { in: recorded.map((c) => c.id) } },
          data: { leadId, contactId: contact.id },
        });
      }
      await tx.consent.createMany({
        data: consents
          .filter((c) => !recorded.some((r) => r.purpose === c.purpose))
          .map((c) => ({
            ...c,
            leadId,
            contactId: contact.id,
            phone,
            phoneHash: hash,
            granted: true,
            channel,
            evidence: input.evidence ? (input.evidence as Prisma.InputJsonValue) : undefined,
          })),
      });

      return { leadId, isNew: !existing, phone: `+${phone}`, submissionCount, differences };
    });
  }
}
