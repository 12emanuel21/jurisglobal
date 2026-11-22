import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { applyOptOut, type OptOutChannel } from '../compliance/opt-out-core';
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
  /** KEYWORD (STOP escrito) o TEMPLATE_BUTTON (botón de baja de una campaña) */
  channel: Extract<OptOutChannel, 'KEYWORD' | 'TEMPLATE_BUTTON'>;
}

/**
 * Baja pedida por WhatsApp (STOP o botón de baja de una plantilla): aplica el núcleo de
 * compliance/opt-out-core (contacto OPTED_OUT, supresión, revocación en Consent, nota en el lead y
 * atribución a la campaña) y deja la conversación en OPTED_OUT con su marcador. Una transacción.
 */
@Injectable()
export class OptOutService {
  private readonly logger = new Logger(OptOutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async register(req: OptOutRequest): Promise<{ contactId: string; leadId: string | null }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const core = await applyOptOut(tx, {
        phone: req.phone,
        channel: req.channel,
        detail: req.text,
        evidence: { wamid: req.waMessageId },
      });
      await tx.conversation.update({
        where: { id: req.conversationId },
        data: {
          flowState: 'OPTED_OUT',
          flowData: {},
          ...(req.conversationContactId ? {} : { contactId: core.contactId }),
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
      return core;
    });

    this.logger.log(`🚫 Baja registrada por ${req.channel} (${maskPhone(req.phone)})`);
    this.realtime.emitToPanel('conversation:updated', { conversationId: req.conversationId });
    if (result.leadId) this.realtime.emitToPanel('lead:changed', { leadId: result.leadId });
    this.realtime.emitToPanel('contact:changed', { contactId: result.contactId });
    if (result.campaignId) this.realtime.emitToPanel('campaign:progress', { campaignId: result.campaignId });
    return { contactId: result.contactId, leadId: result.leadId };
  }
}
