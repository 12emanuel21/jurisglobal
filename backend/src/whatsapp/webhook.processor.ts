import { Injectable, Logger } from '@nestjs/common';
import { CampaignMsgStatus, MsgStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AiService } from '../ai/ai.service';
import { loadEnv } from '../config/env';
import { toE164 } from '../common/phone';
import { maskPhone } from '../common/redact';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { WhatsAppCloudApi } from './cloud-api.client';
import { ChatQueue } from './chat-queue';
import { parseInboundMessage, webhookValues, type ParsedInbound } from './inbound-parse';
import { describeChatMedia, storeChatMedia, type StoredChatMedia } from './media';
import { isStatusUpgrade, parseMetaStatus } from './message-status';

/** Mensajes con más antigüedad que esto se descartan (anti-replay; idea del módulo Django) */
const MAX_MESSAGE_AGE_MS = 30 * 60 * 1000;

/**
 * Procesa los webhooks ya autenticados: mensajes entrantes (con adjuntos y notas de voz) y estados
 * de entrega. Guarda todo en Conversation/Message para el Inbox. El flujo del chatbot se conecta
 * en la Etapa 4 (handleInboundForBot); en la Etapa 1 solo se registra y se notifica al panel.
 */
@Injectable()
export class WebhookProcessor {
  private readonly logger = new Logger(WebhookProcessor.name);
  private readonly queue = new ChatQueue();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly cloudApi: WhatsAppCloudApi,
    private readonly ai: AiService,
  ) {}

  async handlePayload(payload: any): Promise<void> {
    const ownPhoneId = loadEnv().WHATSAPP_PHONE_NUMBER_ID;
    for (const value of webhookValues(payload)) {
      // Solo el número de JurisGlobal (la app de Meta puede tener otros números suscritos)
      if (ownPhoneId && value?.metadata?.phone_number_id !== ownPhoneId) continue;

      const profiles = new Map<string, string>();
      for (const c of Array.isArray(value.contacts) ? value.contacts : []) {
        if (typeof c?.wa_id === 'string' && typeof c?.profile?.name === 'string') profiles.set(c.wa_id, c.profile.name);
      }
      for (const raw of Array.isArray(value.messages) ? value.messages : []) {
        const msg = parseInboundMessage(raw);
        if (!msg) continue;
        // Mensajes en ráfaga del mismo chat: de a uno y en orden
        await this.queue.run(msg.from, () => this.handleInbound(msg, profiles.get(msg.from) ?? null));
      }
      for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
        await this.handleStatus(status);
      }
    }
  }

  private async handleInbound(msg: ParsedInbound, profileName: string | null): Promise<void> {
    const waId = toE164(msg.from);
    if (!waId) return;
    if (msg.timestamp && Date.now() - msg.timestamp.getTime() > MAX_MESSAGE_AGE_MS) {
      this.logger.warn(`Mensaje antiguo descartado de ${maskPhone(waId)}`);
      return;
    }
    // Deduplicación: Meta reintenta webhooks
    if (await this.prisma.message.findUnique({ where: { waMessageId: msg.waMessageId }, select: { id: true } })) return;

    const media = await this.captureMedia(msg);
    let body = msg.text;
    if (media?.stored?.kind === 'AUDIO' && media.buffer && loadEnv().GOOGLE_GENERATIVE_AI_API_KEY) {
      body = await this.ai.transcribeAudio(media.buffer, media.stored.mime).catch((error) => {
        this.logger.warn(`No se pudo transcribir una nota de voz: ${(error as Error).message}`);
        return '';
      });
    }
    if (media && !body)
      body = describeChatMedia(media.stored?.kind ?? 'UNSUPPORTED', null, media.stored?.name ?? msg.media?.filename);

    const now = new Date();
    const conversation = await this.prisma.conversation.upsert({
      where: { waId },
      create: { waId, profileName, lastInboundAt: now, lastMessageAt: now },
      update: { lastInboundAt: now, lastMessageAt: now, ...(profileName ? { profileName } : {}) },
    });

    try {
      const saved = await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: 'INBOUND',
          author: 'CONTACT',
          type: msg.type,
          body: body || null,
          payload: msg.interactiveId ? { interactiveId: msg.interactiveId } : undefined,
          waMessageId: msg.waMessageId,
          status: 'RECEIVED',
          ...(media
            ? {
                mediaKind: media.stored?.kind ?? 'UNSUPPORTED',
                mediaFile: media.stored?.file ?? null,
                mediaName: media.stored?.name ?? msg.media?.filename ?? null,
                mediaMime: media.stored?.mime ?? null,
              }
            : {}),
        },
      });
      this.realtime.emitToPanel('message:new', { conversationId: conversation.id, messageId: saved.id });
    } catch (error) {
      if (isUniqueViolation(error)) return; // el mismo wamid llegó en paralelo
      throw error;
    }
    // Etapa 4: aquí entra el flujo del chatbot (consentimiento, datos, motivo, STOP).
  }

  /** Descarga y guarda el adjunto. Video y sticker se anotan como no soportados. Nunca lanza. */
  private async captureMedia(
    msg: ParsedInbound,
  ): Promise<{ stored: StoredChatMedia | null; buffer: Buffer | null } | null> {
    if (!msg.media) return null;
    if (msg.media.type === 'video' || msg.media.type === 'sticker' || !msg.media.id || !this.cloudApi.isConfigured()) {
      return { stored: null, buffer: null };
    }
    try {
      const { buffer, mime } = await this.cloudApi.downloadMedia(msg.media.id);
      const stored = await storeChatMedia(buffer, msg.media.mime ?? mime, msg.media.filename);
      return { stored, buffer };
    } catch (error) {
      this.logger.error(`No se pudo guardar un adjunto (${msg.media.type}): ${(error as Error).message}`);
      return { stored: null, buffer: null };
    }
  }

  private async handleStatus(raw: any): Promise<void> {
    const waMessageId = typeof raw?.id === 'string' ? raw.id : null;
    const next = parseMetaStatus(raw?.status);
    if (!waMessageId || !next) return;
    const error = Array.isArray(raw.errors) ? raw.errors[0] : null;
    const errorCode = typeof error?.code === 'number' ? error.code : null;
    const errorDetail = error
      ? [error.title, error.message, error.error_data?.details].filter(Boolean).join(' — ').slice(0, 500)
      : null;

    const message = await this.prisma.message.findUnique({
      where: { waMessageId },
      select: { id: true, status: true, conversationId: true },
    });
    if (message && isStatusUpgrade(message.status, next)) {
      await this.prisma.message.update({
        where: { id: message.id },
        data: { status: next, ...(next === MsgStatus.FAILED ? { errorCode, errorDetail } : {}) },
      });
      this.realtime.emitToPanel('message:status', {
        conversationId: message.conversationId,
        messageId: message.id,
        status: next,
      });
    }

    // Masivos (Etapa 6): mismo orden monótono sobre el destinatario de la campaña
    const target = await this.prisma.campaignMessage.findUnique({
      where: { waMessageId },
      select: { id: true, status: true },
    });
    if (target && ['SENT', 'DELIVERED', 'READ', 'QUEUED', 'PENDING'].includes(target.status)) {
      const current = target.status === 'QUEUED' || target.status === 'PENDING' ? null : (target.status as MsgStatus);
      if (isStatusUpgrade(current, next)) {
        const at = new Date();
        await this.prisma.campaignMessage.update({
          where: { id: target.id },
          data: {
            status: next as CampaignMsgStatus,
            ...(next === 'DELIVERED'
              ? { deliveredAt: at }
              : next === 'READ'
                ? { readAt: at }
                : next === 'FAILED'
                  ? { failedAt: at, errorCode, errorDetail }
                  : { sentAt: at }),
          },
        });
      }
    }
  }
}
