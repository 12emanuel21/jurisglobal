import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConsentPurpose, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SettingsService } from '../settings/settings.service';
import { SETTING_DEFAULTS } from '../settings/defaults';
import { LeadsService } from '../leads/leads.service';
import { AiService } from '../ai/ai.service';
import { loadEnv } from '../config/env';
import { phoneHash } from '../common/crypto';
import { formatPhone, toColombianPhone } from '../common/phone';
import { maskPhone } from '../common/redact';
import { resolveHandover } from '../conversations/handover';
import {
  INTERACTIVE_LIMITS,
  WhatsAppApiError,
  WhatsAppCloudApi,
  type ListRow,
  type ReplyButton,
} from '../whatsapp/cloud-api.client';
import {
  CONSENT_NO_ID,
  CONSENT_YES_ID,
  FLOW_RESET_MS,
  MAX_AI_ANSWERS_PER_SESSION,
  MOTIVO_ID_PREFIX,
  extractColombianPhone,
  extractEmail,
  fallbackAnswer,
  isRequestInsteadOfName,
  isRestartCommand,
  isStopCommand,
  looksLikeQuestion,
  matchMotivo,
  parseConsentAnswer,
  parseFlowState,
  parseFullName,
  sanitizeAiReply,
  visibleConsultationPrice,
  type FlowData,
  type FlowState,
  type MotivoOption,
} from './flow';
import { OptOutService } from './opt-out.service';

/** Mensaje entrante ya guardado en el Inbox, listo para el bot */
export interface BotInbound {
  conversation: {
    id: string;
    waId: string;
    contactId: string | null;
    flowState: string;
    flowData: Prisma.JsonValue | null;
    botPausedAt: Date | null;
    lastAgentAt: Date | null;
  };
  /** Último mensaje de la conversación ANTES de este (null si es nueva): reinicio a las 24 h */
  previousMessageAt: Date | null;
  waMessageId: string;
  /** text, interactive, button, audio, image, document, reaction… */
  type: string;
  /** Texto escrito, caption o título del botón */
  text: string;
  interactiveId: string | null;
  /** Adjunto (AUDIO = nota de voz) */
  mediaKind: 'IMAGE' | 'AUDIO' | 'DOCUMENT' | 'UNSUPPORTED' | null;
  /** Transcripción de la nota de voz ('' si no se pudo) */
  transcript: string | null;
  timestamp: Date | null;
}

type Reply =
  | { kind: 'text'; body: string }
  | { kind: 'buttons'; body: string; buttons: ReplyButton[] }
  | { kind: 'list'; body: string; button: string; rows: ListRow[] };

const text = (body: string): Reply => ({ kind: 'text', body });

const STEP_LABEL: Record<FlowState, string> = {
  IDLE: 'su autorización para el tratamiento de datos',
  ASK_CONSENT: 'su autorización para el tratamiento de datos',
  ASK_NAME: 'su nombre completo',
  ASK_EMAIL: 'su correo electrónico',
  ASK_PHONE: 'un número de teléfono de Colombia',
  ASK_MOTIVO: 'el motivo de su consulta',
  DONE: 'nada más: sus datos ya están registrados',
  OPTED_OUT: 'nada',
};

const RETRY = {
  consent: 'Para continuar necesito tu respuesta 👇',
  consentByVoice: 'Para registrar tu autorización necesito que toques *Acepto* o *No acepto* 👇',
  name: 'No logré leer tu nombre 🙏. Escríbelo solo con letras, por ejemplo: *Ana María Pérez*.',
  email: 'Ese correo no parece válido 🤔. Revísalo y escríbelo de nuevo, por ejemplo: *nombre@correo.com*.',
  phone: 'Ese número no es válido. Escribe un celular (3xx) o fijo (60x) de Colombia, de 10 dígitos.',
  motivo: 'No reconocí esa opción. Elige el motivo en la lista o escribe su número.',
  voice: 'No logré entender bien tu nota de voz 🎙️. Para evitar errores en tus datos, ¿me lo escribes, por favor?',
  technical:
    'Tuvimos un inconveniente técnico al registrar tus datos 🙏. Elige de nuevo el motivo en unos minutos para intentarlo otra vez.',
};
const DONE_REMINDER =
  'Tus datos ya están registrados ✅. Un asesor de JurisGlobal se comunicará contigo pronto. Si necesitas actualizarlos, escribe *INICIO*.';

/** Ajustes que lee el bot en cada mensaje (los cambios de Configuración aplican al instante) */
const BOT_SETTINGS = [
  'bot.greeting',
  'bot.declined',
  'bot.closing',
  'bot.optOutConfirmation',
  'consent.whatsapp.contact',
  'legal.links',
  'marketing.stopKeywords',
  'showConsultationPrice',
  'consultationPrice',
  'company.website',
  'company.email',
  'company.phone',
] as const;
type BotSettings = { [K in (typeof BOT_SETTINGS)[number]]: (typeof SETTING_DEFAULTS)[K] };

/**
 * Chatbot de WhatsApp (ESP §6): captura guiada de datos con autorización previa (Ley 1581) y
 * registro por el mismo LeadsService de la web (origin WHATSAPP). No clasifica, no asesora y no
 * promete. Gemini solo responde preguntas fuera del flujo; si falla, hay respuesta fija.
 * Los mensajes de un mismo chat llegan aquí en serie (ChatQueue del webhook).
 */
@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly leads: LeadsService,
    private readonly ai: AiService,
    private readonly cloudApi: WhatsAppCloudApi,
    private readonly realtime: RealtimeGateway,
    private readonly optOut: OptOutService,
  ) {}

  async handleInbound(msg: BotInbound): Promise<void> {
    const conv = msg.conversation;
    const now = msg.timestamp ?? new Date();
    let state = parseFlowState(conv.flowState);
    let data: FlowData = isPlainObject(conv.flowData) ? { ...(conv.flowData as FlowData) } : {};

    // Sesión vencida: empieza limpio (la baja es permanente y no se reinicia sola)
    if (
      state !== 'OPTED_OUT' &&
      msg.previousMessageAt &&
      now.getTime() - msg.previousMessageAt.getTime() > FLOW_RESET_MS
    ) {
      state = 'IDLE';
      data = {};
    }

    const s: BotSettings = await this.settings.getMany(BOT_SETTINGS);
    const paused = resolveHandover(conv.botPausedAt, conv.lastAgentAt, new Date()).botPaused;
    const typed = msg.mediaKind === 'AUDIO' ? (msg.transcript ?? '') : msg.text;

    // STOP: se honra siempre, también con el bot pausado (en ese caso sin respuesta automática)
    if (typed && msg.mediaKind !== 'AUDIO' && isStopCommand(typed, s['marketing.stopKeywords'])) {
      await this.optOut.register({
        conversationId: conv.id,
        conversationContactId: conv.contactId,
        phone: conv.waId,
        text: typed,
        waMessageId: msg.waMessageId,
        channel: 'KEYWORD',
      });
      if (!paused) await this.send(conv, [text(s['bot.optOutConfirmation'])]);
      return;
    }

    // Handover: el equipo atiende desde el Inbox; el mensaje ya quedó guardado y notificado
    if (paused) return;
    if (msg.type === 'reaction') return;

    if (typed && isRestartCommand(typed)) {
      state = 'IDLE';
      data = { aiAnswers: data.aiAnswers }; // el tope de IA no se reinicia con "inicio"
    }
    // Tras una baja el bot calla (los mensajes siguen llegando al Inbox) hasta que pidan INICIO
    if (state === 'OPTED_OUT') return;

    void this.cloudApi.markAsRead(msg.waMessageId).catch(() => undefined);

    const motivos =
      state === 'ASK_MOTIVO' || state === 'ASK_EMAIL' || state === 'ASK_PHONE' ? await this.motivos() : [];
    const ctx: StepContext = { msg, typed, s, data, motivos };
    let outcome: StepOutcome;
    switch (state) {
      case 'IDLE':
        outcome = await this.onIdle(ctx);
        break;
      case 'ASK_CONSENT':
        outcome = await this.onConsent(ctx);
        break;
      case 'ASK_NAME':
        outcome = await this.onName(ctx);
        break;
      case 'ASK_EMAIL':
        outcome = await this.onEmail(ctx);
        break;
      case 'ASK_PHONE':
        outcome = await this.onPhone(ctx);
        break;
      case 'ASK_MOTIVO':
        outcome = await this.onMotivo(ctx);
        break;
      case 'DONE':
        outcome = await this.onDone(ctx);
        break;
    }

    await this.prisma.conversation.update({
      where: { id: conv.id },
      data: { flowState: outcome.state, flowData: outcome.data as Prisma.InputJsonValue },
    });
    if (outcome.replies.length) await this.send(conv, outcome.replies);
  }

  // ─────────────────────────── Pasos ───────────────────────────

  private async onIdle(ctx: StepContext): Promise<StepOutcome> {
    const parts: string[] = [ctx.s['bot.greeting']];
    const ack = mediaAck(ctx.msg.mediaKind);
    if (ack) parts.push(ack);
    if (ctx.typed && looksLikeQuestion(ctx.typed)) parts.push(await this.answer(ctx, 'ASK_CONSENT'));
    return {
      state: 'ASK_CONSENT',
      data: { aiAnswers: ctx.data.aiAnswers },
      replies: withPrefix(parts.join('\n\n'), this.consentReply(ctx.s)),
    };
  }

  private async onConsent(ctx: StepContext): Promise<StepOutcome> {
    const { msg, typed, s, data } = ctx;
    const consent = this.consentReply(s);
    if (msg.mediaKind === 'AUDIO') return stay('ASK_CONSENT', data, withPrefix(RETRY.consentByVoice, consent));

    const answer = parseConsentAnswer(typed, msg.interactiveId);
    if (answer === 'yes') {
      const record = await this.prisma.consent.create({
        data: {
          contactId: msg.conversation.contactId,
          phone: msg.conversation.waId,
          phoneHash: phoneHash(msg.conversation.waId),
          purpose: ConsentPurpose.CONTACT_AND_DATA_PROCESSING,
          granted: true,
          channel: 'WHATSAPP',
          textVersion: this.consentVersion(s),
          textSnapshot: consent.body,
          evidence: this.consentEvidence(msg),
        },
      });
      return {
        state: 'ASK_NAME',
        data: { ...data, consentId: record.id },
        replies: [text(`¡Gracias por autorizarnos! ✅\n\n${this.stepPrompt('ASK_NAME', ctx).body}`)],
      };
    }
    if (answer === 'no') {
      // Se deja constancia de la negativa solo con el seudónimo: sin teléfono ni datos
      await this.prisma.consent.create({
        data: {
          phoneHash: phoneHash(msg.conversation.waId),
          purpose: ConsentPurpose.CONTACT_AND_DATA_PROCESSING,
          granted: false,
          channel: 'WHATSAPP',
          textVersion: this.consentVersion(s),
          textSnapshot: consent.body,
          evidence: this.consentEvidence(msg),
        },
      });
      return { state: 'IDLE', data: { aiAnswers: data.aiAnswers }, replies: [text(this.declinedText(s))] };
    }

    const ack = mediaAck(msg.mediaKind);
    if (ack) return stay('ASK_CONSENT', data, withPrefix(ack, consent));
    if (typed && looksLikeQuestion(typed))
      return stay('ASK_CONSENT', data, withPrefix(await this.answer(ctx, 'ASK_CONSENT'), consent));
    return stay('ASK_CONSENT', data, withPrefix(RETRY.consent, consent));
  }

  private async onName(ctx: StepContext): Promise<StepOutcome> {
    const { msg, typed, data } = ctx;
    const early = this.commonChecks(ctx, 'ASK_NAME');
    if (early) return early;
    if (isRequestInsteadOfName(typed)) return this.offFlow(ctx, 'ASK_NAME');
    const fullName = parseFullName(typed);
    if (!fullName) return stay('ASK_NAME', data, [text(msg.mediaKind === 'AUDIO' ? RETRY.voice : RETRY.name)]);
    const firstName = fullName.split(' ')[0];
    return {
      state: 'ASK_EMAIL',
      data: { ...data, fullName },
      replies: [text(`Gracias, ${firstName}. ${this.stepPrompt('ASK_EMAIL', ctx).body}`)],
    };
  }

  private async onEmail(ctx: StepContext): Promise<StepOutcome> {
    const { msg, typed, data } = ctx;
    const early = this.commonChecks(ctx, 'ASK_EMAIL');
    if (early) return early;
    const email = extractEmail(typed);
    if (email) {
      const next: FlowState = toColombianPhone(msg.conversation.waId) ? 'ASK_MOTIVO' : 'ASK_PHONE';
      return { state: next, data: { ...data, email }, replies: [this.stepPrompt(next, ctx)] };
    }
    if (msg.mediaKind === 'AUDIO') return stay('ASK_EMAIL', data, [text(RETRY.voice)]);
    if (looksLikeQuestion(typed)) return this.offFlow(ctx, 'ASK_EMAIL');
    return stay('ASK_EMAIL', data, [text(RETRY.email)]);
  }

  private async onPhone(ctx: StepContext): Promise<StepOutcome> {
    const { msg, typed, data } = ctx;
    const early = this.commonChecks(ctx, 'ASK_PHONE');
    if (early) return early;
    const phone = extractColombianPhone(typed);
    if (phone) return { state: 'ASK_MOTIVO', data: { ...data, phone }, replies: [this.stepPrompt('ASK_MOTIVO', ctx)] };
    if (msg.mediaKind === 'AUDIO') return stay('ASK_PHONE', data, [text(RETRY.voice)]);
    if (looksLikeQuestion(typed)) return this.offFlow(ctx, 'ASK_PHONE');
    return stay('ASK_PHONE', data, [text(RETRY.phone)]);
  }

  private async onMotivo(ctx: StepContext): Promise<StepOutcome> {
    const { msg, typed, data, s, motivos } = ctx;
    const early = this.commonChecks(ctx, 'ASK_MOTIVO');
    if (early) return early;
    const motivo = matchMotivo(typed, msg.interactiveId, motivos);
    if (!motivo) {
      if (!msg.interactiveId && typed && looksLikeQuestion(typed)) return this.offFlow(ctx, 'ASK_MOTIVO');
      return stay(
        'ASK_MOTIVO',
        data,
        withPrefix(msg.mediaKind === 'AUDIO' ? RETRY.voice : RETRY.motivo, this.stepPrompt('ASK_MOTIVO', ctx)),
      );
    }
    if (!data.fullName || !data.email) {
      // Estado incoherente (p. ej. datos editados a mano): se retoma desde el nombre
      return { state: 'ASK_NAME', data: { consentId: data.consentId }, replies: [this.stepPrompt('ASK_NAME', ctx)] };
    }

    const phone = data.phone ?? msg.conversation.waId;
    try {
      const result = await this.leads.submit({
        fullName: data.fullName,
        phone,
        email: data.email,
        motivo: motivo.id,
        channel: 'WHATSAPP',
        consents: { contactAndDataProcessing: true },
        evidence: { wamid: msg.waMessageId, consentId: data.consentId ?? null },
        recordedConsentIds: data.consentId ? [data.consentId] : [],
      });
      const summary = [
        'Estos son los datos que registramos:',
        `• *Nombre:* ${data.fullName}`,
        `• *Teléfono:* ${formatPhone(phone)}`,
        `• *Correo:* ${data.email}`,
        `• *Motivo:* ${motivo.name}`,
        '',
        s['bot.closing'],
        '',
        'Si algún dato no es correcto, escribe *INICIO* para registrarlo de nuevo.',
      ].join('\n');
      return { state: 'DONE', data: { leadId: result.leadId, aiAnswers: data.aiAnswers }, replies: [text(summary)] };
    } catch (error) {
      if (error instanceof BadRequestException) {
        this.logger.warn(`Lead por WhatsApp rechazado: ${error.message}`);
        return stay('ASK_MOTIVO', data, withPrefix(RETRY.motivo, this.stepPrompt('ASK_MOTIVO', ctx)));
      }
      this.logger.error(`No se pudo registrar el lead por WhatsApp: ${(error as Error).message}`);
      return stay('ASK_MOTIVO', data, [text(RETRY.technical)]);
    }
  }

  private async onDone(ctx: StepContext): Promise<StepOutcome> {
    const { msg, typed, data } = ctx;
    const ack = mediaAck(msg.mediaKind);
    if (ack) return stay('DONE', data, [text(`${ack}\n\n${DONE_REMINDER}`)]);
    if (typed && looksLikeQuestion(typed)) {
      return stay('DONE', data, [text(`${await this.answer(ctx, 'DONE')}\n\n${DONE_REMINDER}`)]);
    }
    if (data.doneReminded) return stay('DONE', data, []);
    return stay('DONE', { ...data, doneReminded: true }, [text(DONE_REMINDER)]);
  }

  /** Adjuntos, notas de voz sin texto y botones de otro paso: se reconoce y se repite la pregunta */
  private commonChecks(ctx: StepContext, step: FlowState): StepOutcome | null {
    const { msg, typed, data } = ctx;
    const ack = mediaAck(msg.mediaKind);
    if (ack) return stay(step, data, withPrefix(ack, this.stepPrompt(step, ctx)));
    if (msg.mediaKind === 'AUDIO' && !typed)
      return stay(step, data, withPrefix(RETRY.voice, this.stepPrompt(step, ctx)));
    const ownButton = step === 'ASK_MOTIVO' && msg.interactiveId?.startsWith(MOTIVO_ID_PREFIX);
    if ((msg.interactiveId && !ownButton) || !typed) {
      return stay(step, data, [this.stepPrompt(step, ctx)]);
    }
    return null;
  }

  private async offFlow(ctx: StepContext, step: FlowState): Promise<StepOutcome> {
    const answer = await this.answer(ctx, step);
    return stay(step, ctx.data, withPrefix(answer, this.stepPrompt(step, ctx)));
  }

  // ─────────────────────────── IA ───────────────────────────

  /** Respuesta breve de Gemini con la tarifa real; respaldo fijo si falla, tarda o se pasa de la raya */
  private async answer(ctx: StepContext, step: FlowState): Promise<string> {
    const price = visibleConsultationPrice(ctx.s.showConsultationPrice, ctx.s.consultationPrice);
    const used = ctx.data.aiAnswers ?? 0;
    if (loadEnv().GOOGLE_GENERATIVE_AI_API_KEY && used < MAX_AI_ANSWERS_PER_SESSION) {
      ctx.data.aiAnswers = used + 1;
      try {
        const { reply } = await this.ai.answerOutOfFlow(ctx.typed, {
          consultationPrice: price,
          pendingStep: STEP_LABEL[step],
        });
        const clean = sanitizeAiReply(reply);
        if (clean) return clean;
        this.logger.warn('Respuesta de la IA descartada por las reglas de seguridad: se usa la respuesta fija');
      } catch (error) {
        this.logger.warn(`IA no disponible para una pregunta fuera de flujo: ${(error as Error).message}`);
      }
    }
    return fallbackAnswer(ctx.typed, price);
  }

  // ─────────────────────────── Mensajes ───────────────────────────

  private stepPrompt(step: FlowState, ctx: StepContext): Reply {
    switch (step) {
      case 'IDLE':
      case 'ASK_CONSENT':
        return this.consentReply(ctx.s);
      case 'ASK_NAME':
        return text('¿Cuál es tu *nombre completo*?');
      case 'ASK_EMAIL':
        return text('¿Cuál es tu *correo electrónico*?');
      case 'ASK_PHONE':
        return text(
          'Tu WhatsApp no es un número de Colombia. ¿A qué *número colombiano* (celular o fijo) te podemos llamar?',
        );
      case 'ASK_MOTIVO':
        return motivoReply(ctx.motivos);
      default:
        return text(DONE_REMINDER);
    }
  }

  private consentReply(s: BotSettings): Reply & { kind: 'buttons' } {
    const consent = s['consent.whatsapp.contact'];
    const privacy = absoluteUrl(s['legal.links']?.privacy || '/legal/privacidad');
    return {
      kind: 'buttons',
      body: `${consent.text}\n\n📄 Aviso de Privacidad: ${privacy}`,
      buttons: [
        { id: CONSENT_YES_ID, title: 'Acepto' },
        { id: CONSENT_NO_ID, title: 'No acepto' },
      ],
    };
  }

  private consentVersion(s: BotSettings): string {
    return `consent.whatsapp.contact@${s['consent.whatsapp.contact'].version}`;
  }

  private consentEvidence(msg: BotInbound): Prisma.InputJsonValue {
    return {
      wamid: msg.waMessageId,
      buttonId: msg.interactiveId,
      typed: msg.interactiveId ? null : msg.text.slice(0, 100),
      messageTimestamp: msg.timestamp?.toISOString() ?? null,
    };
  }

  private declinedText(s: BotSettings): string {
    const website = s['company.website'] || loadEnv().PUBLIC_BASE_URL;
    // Canales institucionales de Configuración (Etapa 5); los vacíos no se muestran
    const email = s['company.email']?.trim();
    const phone = s['company.phone']?.trim();
    return [
      s['bot.declined'],
      '',
      `🌐 Web: ${website}`,
      ...(email ? [`✉️ Correo: ${email}`] : []),
      ...(phone ? [`📞 Teléfono: ${phone}`] : []),
    ].join('\n');
  }

  private motivos(): Promise<MotivoOption[]> {
    return this.prisma.motivo.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    });
  }

  /**
   * Envía en orden y registra cada respuesta en el Inbox (author BOT) con su wamid, para que los
   * estados de entrega (sent/delivered/read/failed) la actualicen. Si Meta la rechaza o WhatsApp no
   * está configurado, queda como FAILED con el motivo: el equipo la ve en el Inbox.
   */
  private async send(conv: BotInbound['conversation'], replies: Reply[]): Promise<void> {
    for (const reply of replies) {
      let waMessageId: string | null = null;
      let errorCode: number | null = null;
      let errorDetail: string | null = null;
      try {
        if (!this.cloudApi.isConfigured()) throw new Error('WhatsApp Cloud API no está configurado');
        ({ waMessageId } =
          reply.kind === 'text'
            ? await this.cloudApi.sendText(conv.waId, reply.body)
            : reply.kind === 'buttons'
              ? await this.cloudApi.sendButtons(conv.waId, reply.body, reply.buttons)
              : await this.cloudApi.sendList(conv.waId, reply.body, reply.button, reply.rows));
      } catch (error) {
        errorCode = error instanceof WhatsAppApiError ? (error.code ?? null) : null;
        errorDetail = (error as Error).message.slice(0, 500);
        this.logger.warn(`Respuesta del bot no enviada a ${maskPhone(conv.waId)}: ${errorDetail}`);
      }
      const saved = await this.prisma.message.create({
        data: {
          conversationId: conv.id,
          direction: 'OUTBOUND',
          author: 'BOT',
          type: reply.kind === 'text' ? 'text' : 'interactive',
          body: inboxBody(reply),
          payload:
            reply.kind === 'buttons'
              ? { buttons: reply.buttons.map((b) => ({ ...b })) }
              : reply.kind === 'list'
                ? { rows: reply.rows.map((r) => ({ ...r })) }
                : undefined,
          waMessageId,
          status: waMessageId ? 'SENT' : 'FAILED',
          errorCode,
          errorDetail,
        },
      });
      await this.prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
      this.realtime.emitToPanel('message:new', { conversationId: conv.id, messageId: saved.id });
      if (!waMessageId) break; // no seguir enviando a medias
    }
  }
}

// ─────────────────────────── Auxiliares ───────────────────────────

interface StepContext {
  msg: BotInbound;
  /** Texto útil: lo escrito o la transcripción de la nota de voz */
  typed: string;
  s: BotSettings;
  /** Mutable: el contador de IA se actualiza durante el paso */
  data: FlowData;
  motivos: MotivoOption[];
}

interface StepOutcome {
  state: FlowState;
  data: FlowData;
  replies: Reply[];
}

const stay = (state: FlowState, data: FlowData, replies: Reply[]): StepOutcome => ({ state, data, replies });

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function mediaAck(kind: BotInbound['mediaKind']): string | null {
  switch (kind) {
    case 'IMAGE':
    case 'DOCUMENT':
      return 'Recibimos tu archivo 📎. Quedará en tu conversación para que el asesor lo revise.';
    case 'UNSUPPORTED':
      return 'No podemos abrir ese tipo de archivo, pero el asesor verá tu conversación.';
    default:
      return null;
  }
}

/** Antepone un texto a la respuesta; si no cabe en el cuerpo de un interactivo, va como mensaje aparte */
function withPrefix(prefix: string, reply: Reply): Reply[] {
  const body = `${prefix}\n\n${reply.body}`;
  if (reply.kind !== 'text' && body.length > INTERACTIVE_LIMITS.body) return [text(prefix), reply];
  return [{ ...reply, body }];
}

function motivoReply(motivos: MotivoOption[]): Reply {
  const lines = motivos.map((m, i) => `${i + 1}. ${m.name}`).join('\n');
  const body = `¿Cuál es el *motivo de tu consulta*? Elige una opción o escribe su número:\n${lines}`;
  if (!motivos.length) return text('¿Cuál es el *motivo de tu consulta*?');
  if (motivos.length <= INTERACTIVE_LIMITS.buttons) {
    return {
      kind: 'buttons',
      body,
      buttons: motivos.map((m) => ({
        id: `${MOTIVO_ID_PREFIX}${m.id}`,
        title: m.name.slice(0, INTERACTIVE_LIMITS.buttonTitle),
      })),
    };
  }
  return {
    kind: 'list',
    body,
    button: 'Ver opciones',
    rows: motivos
      .slice(0, INTERACTIVE_LIMITS.rows)
      .map((m) => ({ id: `${MOTIVO_ID_PREFIX}${m.id}`, title: m.name.slice(0, INTERACTIVE_LIMITS.rowTitle) })),
  };
}

/** Texto que ve el equipo en el Inbox (incluye las opciones ofrecidas) */
function inboxBody(reply: Reply): string {
  if (reply.kind === 'buttons') return `${reply.body}\n\n🔘 ${reply.buttons.map((b) => b.title).join(' · ')}`;
  if (reply.kind === 'list') return `${reply.body}\n\n📋 ${reply.button}`;
  return reply.body;
}

function absoluteUrl(link: string): string {
  if (/^https?:\/\//i.test(link)) return link;
  return `${loadEnv().PUBLIC_BASE_URL.replace(/\/+$/, '')}/${link.replace(/^\/+/, '')}`;
}
