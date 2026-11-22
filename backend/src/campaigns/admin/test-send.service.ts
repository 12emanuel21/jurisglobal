import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { SettingsService } from '../../settings/settings.service';
import { TwoFactorAuthService } from '../../auth/two-factor-auth.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { loadEnv } from '../../config/env';
import { phoneHash } from '../../common/crypto';
import { formatPhone, isColombianMobile, toColombianPhone } from '../../common/phone';
import { maskPhone } from '../../common/redact';
import { isWithinSendWindow, nextOpening } from '../../compliance/send-window';
import { applyOptOut } from '../../compliance/opt-out-core';
import { WhatsAppApiError, WhatsAppCloudApi, WhatsAppNotConfiguredError } from '../../whatsapp/cloud-api.client';
import { CLOCK, type Clock } from '../clock';
import { CATEGORY_LABELS, META_ERROR_LABELS, classifyMetaError } from '../meta-errors';
import { cleanParam, renderBody } from '../template-rules';
import type { TestSendDto } from './dto';

const bogotaText = (d: Date) =>
  d.toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * Envío de prueba / unitario (solo ADMIN): una plantilla APROBADA a un celular colombiano, para
 * probar sin armar una campaña. Respeta siempre la baja (STOP/supresión) y, por defecto, el horario
 * de la Ley 2300 y los festivos; la casilla «omitir horario» es solo para pruebas internas y queda
 * en la bitácora (no cambia la configuración de SendWindow). No cuenta en los topes de campaña.
 */
@Injectable()
export class TestSendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly settings: SettingsService,
    private readonly cloudApi: WhatsAppCloudApi,
    private readonly twoFactorAuth: TwoFactorAuthService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async send(actor: AuthenticatedUser, dto: TestSendDto, sudoToken?: string) {
    if (actor.isTwoFactorEnabled) await this.twoFactorAuth.assertSudo({ user: actor, sudoToken });

    const template = await this.prisma.messageTemplate.findUnique({ where: { id: dto.templateId } });
    if (!template) throw new NotFoundException('Plantilla no encontrada');
    if (template.status !== 'APPROVED') throw new BadRequestException('La plantilla no está aprobada en Meta');

    const normalized = toColombianPhone(dto.phone);
    const phone = normalized && isColombianMobile(normalized) ? normalized : null;
    if (!phone) throw new BadRequestException('Escribe un celular colombiano válido (10 dígitos, empieza por 3)');

    const params = Array.from({ length: template.variableCount }, (_, i) => cleanParam(dto.variables?.[i] ?? ''));
    const missing = params.findIndex((p) => !p);
    if (missing >= 0) throw new BadRequestException(`Escribe el valor de la variable {{${missing + 1}}}`);

    // La baja se respeta SIEMPRE, también en pruebas
    const hash = phoneHash(phone);
    const [contact, suppressed] = await Promise.all([
      this.prisma.contact.findUnique({ where: { phoneHash: hash } }),
      this.prisma.suppression.findUnique({ where: { phoneHash: hash } }),
    ]);
    if (suppressed || contact?.consentStatus === 'OPTED_OUT')
      throw new ConflictException('Ese número pidió no recibir más mensajes (baja): no se le puede enviar');

    const now = this.clock.now();
    const [windows, holidays] = await Promise.all([
      this.prisma.sendWindow.findMany(),
      this.prisma.holiday.findMany({
        where: { enabled: true, date: { gte: new Date(now.getTime() - 2 * 86_400_000) } },
        select: { date: true },
      }),
    ]);
    const holidayKeys = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
    const insideWindow = isWithinSendWindow(windows, holidayKeys, now);
    const skipWindow = Boolean(dto.skipWindow);
    if (!insideWindow && !skipWindow) {
      const opening = nextOpening(windows, holidayKeys, now);
      throw new ConflictException(
        `Fuera del horario permitido por la Ley 2300 (o es festivo).${opening ? ` Próxima apertura: ${bogotaText(opening)}.` : ''} Para una prueba interna marca «Enviar inmediatamente».`,
      );
    }

    const quality = await this.settings.get('whatsapp.quality');
    if (quality?.rating === 'RED')
      throw new ConflictException(
        'Meta marcó la calidad del número en ROJO: no se envían mensajes de marketing hasta que mejore',
      );

    const simulated = loadEnv().CAMPAIGNS_FORCE_DRY_RUN || !this.cloudApi.isConfigured();
    let waMessageId: string;
    try {
      waMessageId = simulated
        ? `test.simulated.${now.getTime()}`
        : (await this.cloudApi.sendTemplate(phone, template.name, template.language, params)).waMessageId;
    } catch (error) {
      if (error instanceof WhatsAppNotConfiguredError)
        throw new ConflictException('WhatsApp Cloud API no está configurado');
      if (!(error instanceof WhatsAppApiError)) throw error;
      const meta = classifyMetaError(error.code, error.httpStatus);
      if (meta.action === 'OPT_OUT')
        await this.prisma.$transaction((tx) =>
          applyOptOut(tx, {
            phone,
            channel: 'META_131050',
            detail: 'error 131050 (envío de prueba)',
            evidence: { testSend: true, template: template.name, metaCode: error.code ?? null },
          }),
        );
      await this.audit.record({
        userId: actor.id,
        action: 'campaign.test_send_failed',
        entity: 'MessageTemplate',
        entityId: template.id,
        data: { template: template.name, phone: maskPhone(phone), code: error.code ?? null, skipWindow, insideWindow },
      });
      const label = (error.code && META_ERROR_LABELS[error.code]) || CATEGORY_LABELS[meta.category] || 'Error de Meta';
      throw new BadGatewayException(`Meta rechazó el envío${error.code ? ` (código ${error.code})` : ''}: ${label}`);
    }

    const body = renderBody(template.bodyText, params);
    const conversationId = simulated
      ? null
      : await this.prisma.$transaction(async (tx) => {
          const existing = await tx.conversation.findUnique({ where: { waId: phone } });
          const conversation = existing
            ? await tx.conversation.update({
                where: { id: existing.id },
                data: { lastMessageAt: now, ...(existing.contactId || !contact ? {} : { contactId: contact.id }) },
              })
            : await tx.conversation.create({
                data: { waId: phone, contactId: contact?.id ?? null, lastMessageAt: now },
              });
          await tx.message.create({
            data: {
              conversationId: conversation.id,
              direction: 'OUTBOUND',
              author: 'AGENT',
              type: 'template',
              body,
              payload: { template: template.name, testSend: true, params },
              waMessageId,
              status: 'SENT',
              sentById: actor.id,
            },
          });
          return conversation.id;
        });

    await this.audit.record({
      userId: actor.id,
      action: 'campaign.test_send',
      entity: 'MessageTemplate',
      entityId: template.id,
      data: {
        template: template.name,
        phone: maskPhone(phone),
        // Bitácora de la excepción: se omitió el horario Ley 2300 en una prueba fuera de horario
        skipWindow,
        insideWindow,
        windowBypassed: skipWindow && !insideWindow,
        simulated,
        waMessageId,
      },
    });
    if (conversationId) this.realtime.emitToPanel('conversation:updated', { conversationId });

    return {
      status: simulated ? ('SIMULATED' as const) : ('SENT' as const),
      waMessageId,
      phone: formatPhone(phone),
      body,
      insideWindow,
      windowBypassed: skipWindow && !insideWindow,
      conversationId,
    };
  }
}
