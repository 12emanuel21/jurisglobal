import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { LeadsModule } from '../leads/leads.module';
import { WhatsAppApiModule } from '../whatsapp/whatsapp-api.module';
import { ChatbotService } from './chatbot.service';
import { OptOutService } from './opt-out.service';

@Module({
  imports: [AiModule, LeadsModule, WhatsAppApiModule],
  providers: [ChatbotService, OptOutService],
  exports: [ChatbotService, OptOutService],
})
export class ChatbotModule {}
