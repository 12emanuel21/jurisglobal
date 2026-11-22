import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminLeadsController } from './leads/admin-leads.controller';
import { AdminLeadsService } from './leads/admin-leads.service';
import { AdminSettingsController } from './settings/admin-settings.controller';
import { AdminSettingsService } from './settings/admin-settings.service';

/** Panel de administración (Etapa 5): leads y configuración dinámica. Usuarios: UsersModule */
@Module({
  imports: [AuthModule],
  controllers: [AdminLeadsController, AdminSettingsController],
  providers: [AdminLeadsService, AdminSettingsService],
})
export class AdminModule {}
