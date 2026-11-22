import { Module } from '@nestjs/common';
import { WhatsAppCloudApi } from './cloud-api.client';

/** Solo el cliente de Cloud API: lo usan el webhook, el chatbot y el Inbox sin dependencias circulares */
@Module({ providers: [WhatsAppCloudApi], exports: [WhatsAppCloudApi] })
export class WhatsAppApiModule {}
