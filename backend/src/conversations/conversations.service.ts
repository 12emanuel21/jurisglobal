import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createReadStream, promises as fs } from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { WhatsAppApiError, WhatsAppCloudApi, WhatsAppNotConfiguredError } from '../whatsapp/cloud-api.client';
import { chatMediaMime, chatMediaPath } from '../whatsapp/media';
import {
  BOT_PAUSED_MARKER,
  BOT_RESUMED_MARKER,
  isOutsideServiceWindow,
  resolveHandover,
  type HandoverState,
} from './handover';

const SNIPPET_LENGTH = 160;

const messageSelect = {
  id: true,
  direction: true,
  author: true,
  type: true,
  body: true,
  mediaKind: true,
  mediaFile: true,
  mediaName: true,
  mediaMime: true,
  status: true,
  errorDetail: true,
  createdAt: true,
  sentBy: { select: { name: true } },
} as const;

export interface ConversationStatus extends HandoverState {
  lastInboundAt: Date | null;
  /** Pasada la ventana de 24 h, Meta solo acepta plantillas aprobadas */
  outsideServiceWindow: boolean;
}

/**
 * Inbox (adaptado de ChatsService de KovalCloud, sin tenant ni Baileys): bandeja de conversaciones,
 * historial con adjuntos, envío manual y pausa del bot.
 */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudApi: WhatsAppCloudApi,
    private readonly realtime: RealtimeGateway,
  ) {}

  private async findOrThrow(id: string) {
    const conversation = await this.prisma.conversation.findUnique({ where: { id } });
    if (!conversation) throw new NotFoundException('Conversación no encontrada');
    return conversation;
  }

  async list() {
    const now = new Date();
    const rows = await this.prisma.conversation.findMany({
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
      include: {
        contact: { select: { name: true, lead: { select: { id: true, fullName: true } } } },
        messages: {
          where: { author: { not: 'SYSTEM' } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { body: true, author: true, createdAt: true },
        },
        _count: { select: { messages: { where: { author: { not: 'SYSTEM' } } } } },
      },
    });
    return rows.map((c) => {
      const last = c.messages[0];
      const text = last?.body ?? '';
      return {
        id: c.id,
        waId: c.waId,
        displayName: c.contact?.lead?.fullName ?? c.contact?.name ?? c.profileName ?? null,
        leadId: c.contact?.lead?.id ?? null,
        lastMessage: text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH)}…` : text,
        lastAuthor: last?.author ?? null,
        lastMessageAt: c.lastMessageAt,
        messageCount: c._count.messages,
        botPaused: resolveHandover(c.botPausedAt, c.lastAgentAt, now).botPaused,
      };
    });
  }

  async messages(id: string) {
    await this.findOrThrow(id);
    return this.prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      take: 1000,
      select: messageSelect,
    });
  }

  async status(id: string): Promise<ConversationStatus> {
    const c = await this.findOrThrow(id);
    return {
      ...resolveHandover(c.botPausedAt, c.lastAgentAt),
      lastInboundAt: c.lastInboundAt,
      outsideServiceWindow: isOutsideServiceWindow(c.lastInboundAt),
    };
  }

  async setBotPaused(id: string, botPaused: boolean) {
    const c = await this.findOrThrow(id);
    const current = resolveHandover(c.botPausedAt, c.lastAgentAt).botPaused;
    if (current !== botPaused) {
      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.conversation.update({ where: { id }, data: { botPausedAt: botPaused ? now : null } }),
        this.prisma.message.create({
          data: {
            conversationId: id,
            direction: 'OUTBOUND',
            author: 'SYSTEM',
            type: 'system',
            body: botPaused ? BOT_PAUSED_MARKER : BOT_RESUMED_MARKER,
          },
        }),
      ]);
      this.realtime.emitToPanel('conversation:updated', { conversationId: id });
    }
    return this.status(id);
  }

  /**
   * Mensaje manual del equipo. Pausa el bot (si estaba activo) para que no interrumpa al humano.
   * El mensaje solo se registra si WhatsApp lo aceptó.
   */
  async sendManual(id: string, text: string, userId: string) {
    const c = await this.findOrThrow(id);
    const body = text.trim();
    if (!body) throw new BadRequestException('Escribe un mensaje');

    let waMessageId: string;
    try {
      ({ waMessageId } = await this.cloudApi.sendText(c.waId, body));
    } catch (error) {
      if (error instanceof WhatsAppNotConfiguredError)
        throw new ServiceUnavailableException('WhatsApp aún no está configurado en esta instancia');
      const outside = isOutsideServiceWindow(c.lastInboundAt);
      this.logger.warn(`Envío manual rechazado (código ${error instanceof WhatsAppApiError ? error.code : '—'})`);
      throw new BadGatewayException(
        outside
          ? 'WhatsApp no entregó el mensaje: la persona no escribe hace más de 24 h y Meta solo permite plantillas aprobadas.'
          : 'WhatsApp no entregó el mensaje. Intenta de nuevo en unos minutos.',
      );
    }

    const now = new Date();
    const wasPaused = resolveHandover(c.botPausedAt, c.lastAgentAt).botPaused;
    const message = await this.prisma.$transaction(async (tx) => {
      // Marcador antes del mensaje: en el historial se lee "bot pausado" y luego la respuesta humana
      if (!wasPaused) {
        await tx.message.create({
          data: {
            conversationId: id,
            direction: 'OUTBOUND',
            author: 'SYSTEM',
            type: 'system',
            body: BOT_PAUSED_MARKER,
          },
        });
      }
      const saved = await tx.message.create({
        data: {
          conversationId: id,
          direction: 'OUTBOUND',
          author: 'AGENT',
          type: 'text',
          body,
          waMessageId,
          status: 'SENT',
          sentById: userId,
        },
        select: messageSelect,
      });
      await tx.conversation.update({
        where: { id },
        data: { lastAgentAt: now, lastMessageAt: now, ...(wasPaused ? {} : { botPausedAt: now }) },
      });
      return saved;
    });
    this.realtime.emitToPanel('conversation:updated', { conversationId: id });
    return { message, status: await this.status(id) };
  }

  /** Abre un adjunto para servirlo (404 si el nombre no es válido o no existe) */
  async openMedia(file: string) {
    const filePath = chatMediaPath(file);
    if (
      !filePath ||
      !(await fs
        .stat(filePath)
        .then((s) => s.isFile())
        .catch(() => false))
    ) {
      throw new NotFoundException('Archivo no encontrado');
    }
    const message = await this.prisma.message.findFirst({ where: { mediaFile: file }, select: { mediaName: true } });
    if (!message) throw new NotFoundException('Archivo no encontrado');
    return { stream: createReadStream(filePath), mime: chatMediaMime(file), downloadName: message.mediaName ?? file };
  }
}
