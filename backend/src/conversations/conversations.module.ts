import { Module } from '@nestjs/common';
import { WhatsAppApiModule } from '../whatsapp/whatsapp-api.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({ imports: [WhatsAppApiModule], controllers: [ConversationsController], providers: [ConversationsService] })
export class ConversationsModule {}
