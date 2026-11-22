import { Controller, Get, Header } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/**
 * GET /public/config (vía nginx: /api/public/config). Parámetros vivos para la landing (Etapa 3) y
 * el chatbot (Etapa 4): motivos activos, precio de la asesoría, enlaces legales y textos de autorización.
 */
@Controller('public')
export class PublicConfigController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Get('config')
  @Header('Cache-Control', 'public, max-age=60')
  async config() {
    const [motivos, s] = await Promise.all([
      this.prisma.motivo.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true },
      }),
      this.settings.getMany([
        'showConsultationPrice',
        'consultationPrice',
        'legal.links',
        'consent.web.privacy',
        'consent.web.contact',
        'company.name',
        'company.slogan',
      ] as const),
    ]);
    const showConsultationPrice = s.showConsultationPrice === true;
    return {
      motivos,
      showConsultationPrice,
      // Interruptor apagado: la asesoría se presenta sin costo y el valor no se publica
      consultationPrice: showConsultationPrice && typeof s.consultationPrice === 'number' ? s.consultationPrice : null,
      currency: 'COP',
      legal: s['legal.links'],
      consents: {
        privacyAndTerms: s['consent.web.privacy'],
        contactAndDataProcessing: s['consent.web.contact'],
      },
      company: { name: s['company.name'], slogan: s['company.slogan'] },
    };
  }
}
