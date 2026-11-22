import { Module } from '@nestjs/common';
import { WhatsAppApiModule } from '../whatsapp/whatsapp-api.module';
import { CampaignEngine } from './campaign-engine';
import { CampaignQueue } from './campaign-queue';
import { CampaignTracking } from './campaign-tracking';
import { CLOCK, systemClock } from './clock';
import { QualityGuard } from './quality-guard';

/**
 * Núcleo de masivos compartido por la API y el worker: cola, motor de envío y seguimiento de
 * estados/respuestas. Necesita un RealtimeGateway global (el real en la API, RealtimePublisher en
 * el worker), PrismaModule y SettingsModule (globales).
 */
@Module({
  imports: [WhatsAppApiModule],
  providers: [CampaignQueue, CampaignEngine, CampaignTracking, QualityGuard, { provide: CLOCK, useValue: systemClock }],
  exports: [CampaignQueue, CampaignEngine, CampaignTracking, QualityGuard, CLOCK],
})
export class CampaignsCoreModule {}
