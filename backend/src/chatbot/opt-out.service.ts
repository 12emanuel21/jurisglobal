import { Injectable, Logger } from '@nestjs/common';
import { ConsentPurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { phoneHash } from '../common/crypto';
import { maskPhone } from '../common/redact';

/** Marcador en el historial del Inbox (author SYSTEM) */
export const OPT_OUT_MARKER = '[SYSTEM_OPT_OUT]';

export interface OptOutRequest {
  conversationId: string;
  conversationContactId: string | null;
  /** Número de WhatsApp (E.164 sin "+") */
  phone: string;
  /** Texto exacto que escribió la persona (evidencia) */
  text: string;
  waMessageId: string;
  /** KEYWORD (STOP escrito) · TEMPLATE_BUTTON y META_131050 llegan con los masivos (Etapa 6) */
  channel: 'KEYWORD';
}

/**
 * Baja inmediata (Ley 2300 de 2023 y Ley 1581 de 2012): el contacto queda OPTED_OUT, el seudónimo
 * entra a la lista de supresión (sobrevive a una anonimización), se registra la revocación en
 * Consent y, si hay lead, una nota para el equipo. Todo en una transacción.
 */
@Injectable()
export class OptOutService {
  private readonly logger = new Logger(OptOutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async register(req: OptOutRequest): Promise<{ contactId: string; leadId: string | null }> {
    const hash = phoneHash(req.phone);
    const now = new Date();
    const optOut = { consentStatus: 'OPTED_OUT' as const, optedOutAt: now, optOutChannel: req.channel };

    const result = await this.prisma.$transaction(async (tx) => {
      // Por seudónimo: la baja también alcanza a un contacto ya anonimizado
      const contact = await tx.contact.upsert({
        where: { phoneHash: hash },
        create: { phone: req.phone, phoneHash: hash, source: 'WHATSAPP', ...optOut },
        update: optOut,
      });
      await tx.suppression.upsert({
        where: { phoneHash: hash },
        create: { phoneHash: hash, reason: req.channel },
        update: {},
      });
      const lead = await tx.lead.findUnique({ where: { phone: req.phone }, select: { id: true } });
      await tx.consent.create({
        data: {
          leadId: lead?.id ?? null,
          contactId: contact.id,
          phone: req.phone,
          phoneHash: hash,
          purpose: ConsentPurpose.MARKETING_WHATSAPP,
          granted: false,
          channel: 'WHATSAPP',
          textVersion: 'optout.keyword@1',
          textSnapshot: `Solicitud de baja por WhatsApp: «${req.text.slice(0, 200)}»`,
          evidence: { wamid: req.waMessageId },
        },
      });
      if (lead) {
        await tx.leadNote.create({
          data: {
            leadId: lead.id,
            body: `Baja por WhatsApp: la persona escribió «${req.text.slice(0, 80)}». No recibirá más mensajes automáticos ni masivos.`,
          },
        });
      }
      await tx.conversation.update({
        where: { id: req.conversationId },
        data: {
          flowState: 'OPTED_OUT',
          flowData: {},
          ...(req.conversationContactId ? {} : { contactId: contact.id }),
        },
      });
      await tx.message.create({
        data: {
          conversationId: req.conversationId,
          direction: 'OUTBOUND',
          author: 'SYSTEM',
          type: 'system',
          body: OPT_OUT_MARKER,
        },
      });
      return { contactId: contact.id, leadId: lead?.id ?? null };
    });

    this.logger.log(`🚫 Baja registrada por ${req.channel} (${maskPhone(req.phone)})`);
    this.realtime.emitToPanel('conversation:updated', { conversationId: req.conversationId });
    if (result.leadId) this.realtime.emitToPanel('lead:changed', { leadId: result.leadId });
    return result;
  }
}
