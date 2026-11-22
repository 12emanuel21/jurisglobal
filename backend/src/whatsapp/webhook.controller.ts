import { Controller, ForbiddenException, Get, Header, HttpCode, Logger, Post, Query, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { loadEnv } from '../config/env';
import { isValidMetaSignature, safeEqual } from '../config/secrets';
import { WebhookProcessor } from './webhook.processor';

/**
 * Webhook de WhatsApp Cloud API. Ruta /meta/webhook (nginx la deja intacta: la firma se calcula
 * sobre el cuerpo crudo). Reescrito frente a KovalCloud:
 * - GET estricto: exige hub.mode=subscribe y hub.verify_token === WHATSAPP_VERIFY_TOKEN
 *   (KovalCloud aceptaba el slug o la ausencia de token).
 * - POST: firma HMAC obligatoria con META_APP_SECRET; nunca se registra el payload (datos personales).
 * - Responde 200 de inmediato y procesa en segundo plano todos los entry/changes.
 */
@Controller('meta/webhook')
@SkipThrottle()
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly processor: WebhookProcessor) {}

  @Get()
  @Header('Content-Type', 'text/plain')
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    const expected = loadEnv().WHATSAPP_VERIFY_TOKEN;
    if (mode === 'subscribe' && expected && safeEqual(token, expected) && typeof challenge === 'string') {
      this.logger.log('✅ Webhook de Meta verificado');
      return challenge;
    }
    this.logger.warn('⛔ Verificación de webhook rechazada');
    throw new ForbiddenException();
  }

  @Post()
  @HttpCode(200)
  receive(@Req() req: RawBodyRequest<Request>) {
    const signature = req.headers['x-hub-signature-256'];
    if (
      !isValidMetaSignature(
        req.rawBody,
        typeof signature === 'string' ? signature : undefined,
        loadEnv().META_APP_SECRET,
      )
    ) {
      this.logger.warn('⛔ Webhook con firma inválida o sin META_APP_SECRET: descartado');
      throw new ForbiddenException();
    }
    void this.processor
      .handlePayload(req.body)
      .catch((error) => this.logger.error(`Error procesando webhook: ${(error as Error).message}`));
    return 'EVENT_RECEIVED';
  }
}
