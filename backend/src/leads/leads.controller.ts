import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { loadEnv } from '../config/env';
import { SubmitLeadDto } from './dto/submit-lead.dto';
import { LeadsService } from './leads.service';

/** Misma respuesta para lead nuevo y recontacto: no revela si un número ya está registrado */
export const LEAD_RECEIVED_RESPONSE = {
  ok: true,
  message: 'Recibimos tus datos. Un asesor de JurisGlobal se comunicará contigo por llamada o correo.',
} as const;

/**
 * POST /leads (vía nginx: /api/leads). Público, con límite por IP. El canal "whatsapp" no se acepta
 * desde Internet: el chatbot registra sus leads llamando a LeadsService dentro del backend.
 */
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: () => loadEnv().LEADS_RATE_LIMIT, ttl: 60_000 } })
  async submit(@Body() dto: SubmitLeadDto, @Req() req: Request) {
    if (dto.website) return LEAD_RECEIVED_RESPONSE; // honeypot: bot de spam, se descarta en silencio
    if (dto.origin !== 'web') throw new ForbiddenException('El canal whatsapp solo se registra desde el chatbot');

    await this.leads.submit({
      fullName: dto.fullName,
      phone: dto.phone,
      email: dto.email,
      motivo: dto.motivo,
      channel: 'WEB',
      consents: { privacyAndTerms: dto.privacyAndTerms, contactAndDataProcessing: dto.contactAndDataProcessing },
      evidence: { ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 300) ?? null },
      utm: dto.utm ? { ...dto.utm } : undefined,
    });
    return LEAD_RECEIVED_RESPONSE;
  }
}
