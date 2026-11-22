import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CampaignsCoreModule } from './campaigns-core.module';
import { WhatsAppApiModule } from '../whatsapp/whatsapp-api.module';
import {
  AdminCampaignsController,
  AdminContactsController,
  AdminTemplatesController,
} from './admin/masivos.controller';
import { ContactsService } from './admin/contacts.service';
import { TemplatesService } from './admin/templates.service';
import { CampaignsService } from './admin/campaigns.service';
import { TestSendService } from './admin/test-send.service';

/** Masivos en la API (Etapa 6): contactos, importador, plantillas, campañas y envío de prueba. Las campañas las envía el worker */
@Module({
  imports: [AuthModule, CampaignsCoreModule, WhatsAppApiModule],
  controllers: [AdminContactsController, AdminTemplatesController, AdminCampaignsController],
  providers: [ContactsService, TemplatesService, CampaignsService, TestSendService],
})
export class CampaignsModule {}
