import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { WhatsAppCloudApi } from './cloud-api.client';
import { WebhookController } from './webhook.controller';
import { WebhookProcessor } from './webhook.processor';

@Module({
  imports: [AiModule],
  controllers: [WebhookController],
  providers: [WhatsAppCloudApi, WebhookProcessor],
  exports: [WhatsAppCloudApi],
})
export class WhatsAppModule {}
