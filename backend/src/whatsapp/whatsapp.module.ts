import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { WhatsAppApiModule } from './whatsapp-api.module';
import { CampaignsCoreModule } from '../campaigns/campaigns-core.module';
import { WebhookController } from './webhook.controller';
import { WebhookProcessor } from './webhook.processor';

@Module({
  imports: [AiModule, WhatsAppApiModule, ChatbotModule, CampaignsCoreModule],
  controllers: [WebhookController],
  providers: [WebhookProcessor],
  exports: [WhatsAppApiModule],
})
export class WhatsAppModule {}
