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

/** Masivos en la API (Etapa 6): contactos, importador, plantillas y campañas. Envía el worker */
@Module({
  imports: [AuthModule, CampaignsCoreModule, WhatsAppApiModule],
  controllers: [AdminContactsController, AdminTemplatesController, AdminCampaignsController],
  providers: [ContactsService, TemplatesService, CampaignsService],
})
export class CampaignsModule {}
