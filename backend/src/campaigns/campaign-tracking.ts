import { Injectable, Logger } from '@nestjs/common';
import { ConsentPurpose, type CampaignMsgStatus, type MsgStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { phoneHash } from '../common/crypto';
import { maskPhone } from '../common/redact';
import { normalizeHeader } from '../contacts/contacts-spreadsheet';
import { isStatusUpgrade } from '../whatsapp/message-status';
import { OPT_OUT_ATTRIBUTION_MS, applyOptOut } from '../compliance/opt-out-core';
import { classifyMetaError } from './meta-errors';
import type { ButtonRole, TemplateButton } from './template-rules';

export interface CampaignReply {
  campaignMessageId: string | null;
  /** Rol del botón de la plantilla que tocó la persona (null si escribió) */
  buttonRole: ButtonRole | null;
}

const sameText = (a: string, b: string) => normalizeHeader(a) === normalizeHeader(b);

/**
 * Lado "webhook" de los masivos (proceso API):
 * - estados de Meta (sent/delivered/read/failed) sobre CampaignMessage, en orden monótono y por
 *   wamid; un failed con 131050 da de baja al contacto;
 * - respuestas: marcan repliedAt y reconocen los botones de la plantilla (baja o aceptación del
 *   opt-in). Después el mensaje sigue al chatbot (flujo guiado de la Etapa 4).
 */
@Injectable()
export class CampaignTracking {
  private readonly logger = new Logger(CampaignTracking.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async onStatus(
    waMessageId: string,
    next: MsgStatus,
    errorCode: number | null,
    errorDetail: string | null,
    at = new Date(),
  ): Promise<void> {
    const target = await this.prisma.campaignMessage.findUnique({
      where: { waMessageId },
      select: { id: true, status: true, campaignId: true, phone: true, sentAt: true },
    });
    if (!target || target.status === 'SKIPPED') return;
    const current = target.status === 'QUEUED' || target.status === 'PENDING' ? null : (target.status as MsgStatus);
    if (!isStatusUpgrade(current, next)) return;

    const failed = next === 'FAILED';
    await this.prisma.campaignMessage.update({
      where: { id: target.id },
      data: {
        status: next as CampaignMsgStatus,
        ...(next === 'SENT' && !target.sentAt ? { sentAt: at } : {}),
        ...(next === 'DELIVERED' ? { deliveredAt: at } : {}),
        ...(next === 'READ' ? { readAt: at } : {}),
        ...(failed
          ? { failedAt: at, errorCode, errorDetail, errorCategory: classifyMetaError(errorCode, 400).category }
          : {}),
      },
    });
    if (failed && errorCode === 131050) await this.optOutFromStatus(target);
    this.realtime.emitToPanel('campaign:progress', { campaignId: target.campaignId });
  }

  private async optOutFromStatus(target: { id: string; campaignId: string; phone: string }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const core = await applyOptOut(tx, {
        phone: target.phone,
        channel: 'META_131050',
        detail: 'error 131050',
        evidence: { campaignId: target.campaignId, campaignMessageId: target.id, metaCode: 131050 },
      });
      await tx.campaignMessage.updateMany({
        where: { id: target.id, optedOutAt: null },
        data: { optedOutAt: new Date() },
      });
      return core;
    });
    this.logger.log(`🚫 Baja automática por 131050 (${maskPhone(target.phone)})`);
    this.realtime.emitToPanel('contact:changed', { contactId: result.contactId });
    if (result.leadId) this.realtime.emitToPanel('lead:changed', { leadId: result.leadId });
  }

  /**
   * Mensaje entrante: ¿responde a una campaña? Por el contexto (wamid citado, así llegan los
   * botones de plantilla) o, si escribió, por el último envío a ese número en los últimos 7 días.
   */
  async onInbound(input: {
    phone: string;
    waMessageId: string;
    contextId: string | null;
    type: string;
    text: string;
    interactiveId: string | null;
  }): Promise<CampaignReply> {
    const since = new Date(Date.now() - OPT_OUT_ATTRIBUTION_MS);
    const select = {
      id: true,
      campaignId: true,
      contactId: true,
      repliedAt: true,
      variables: true,
      campaign: { select: { kind: true, template: { select: { name: true, buttons: true, bodyText: true } } } },
    } as const;
    const target =
      (input.contextId
        ? await this.prisma.campaignMessage.findUnique({ where: { waMessageId: input.contextId }, select })
        : null) ??
      (await this.prisma.campaignMessage.findFirst({
        where: { phone: input.phone, sentAt: { gte: since } },
        orderBy: { sentAt: 'desc' },
        select,
      }));
    if (!target) return { campaignMessageId: null, buttonRole: null };

    if (!target.repliedAt) {
      await this.prisma.campaignMessage.update({ where: { id: target.id }, data: { repliedAt: new Date() } });
      this.realtime.emitToPanel('campaign:progress', { campaignId: target.campaignId });
    }

    // Botón de respuesta rápida de la plantilla (type "button"; payload = texto por defecto)
    let buttonRole: ButtonRole | null = null;
    if (input.type === 'button' || input.type === 'interactive') {
      const buttons = (Array.isArray(target.campaign.template.buttons)
        ? target.campaign.template.buttons
        : []) as unknown as TemplateButton[];
      const pressed = buttons.find(
        (b) => sameText(b.text, input.text) || (input.interactiveId ? sameText(b.text, input.interactiveId) : false),
      );
      buttonRole = pressed?.role ?? null;
      if (buttonRole === 'OPT_IN_ACCEPT') await this.confirmOptIn(target, input, pressed!.text);
    }
    return { campaignMessageId: target.id, buttonRole };
  }

  /** La persona aceptó en la plantilla de confirmación: queda CONFIRMED y apta para marketing */
  private async confirmOptIn(
    target: {
      id: string;
      campaignId: string;
      contactId: string;
      campaign: { template: { name: string; bodyText: string } };
    },
    input: { phone: string; waMessageId: string; contextId: string | null },
    buttonText: string,
  ) {
    const contact = await this.prisma.contact.findUnique({ where: { id: target.contactId } });
    // Una baja vigente solo se revierte si la persona vuelve a escribir INICIO y acepta en el bot
    if (!contact || contact.consentStatus === 'OPTED_OUT' || contact.consentStatus === 'CONFIRMED') return;
    const lead = await this.prisma.lead.findUnique({ where: { phone: input.phone }, select: { id: true } });
    await this.prisma.$transaction([
      this.prisma.contact.update({ where: { id: contact.id }, data: { consentStatus: 'CONFIRMED' } }),
      this.prisma.consent.create({
        data: {
          leadId: lead?.id ?? null,
          contactId: contact.id,
          phone: input.phone,
          phoneHash: phoneHash(input.phone),
          purpose: ConsentPurpose.MARKETING_WHATSAPP,
          granted: true,
          channel: 'WHATSAPP',
          textVersion: `optin.template:${target.campaign.template.name}`,
          textSnapshot: `Aceptó con el botón «${buttonText}» de la plantilla «${target.campaign.template.name}»: ${target.campaign.template.bodyText.slice(0, 900)}`,
          evidence: { wamid: input.waMessageId, contextWamid: input.contextId, campaignId: target.campaignId },
        },
      }),
    ]);
    this.logger.log(`✅ Autorización de marketing confirmada por WhatsApp (${maskPhone(input.phone)})`);
    this.realtime.emitToPanel('contact:changed', { contactId: contact.id });
  }
}
