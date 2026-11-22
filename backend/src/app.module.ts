import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RealtimeModule } from './realtime/realtime.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { ConversationsModule } from './conversations/conversations.module';
import { SettingsModule } from './settings/settings.module';
import { MailModule } from './mail/mail.module';
import { LeadsModule } from './leads/leads.module';
import { AdminModule } from './admin/admin.module';

/**
 * Etapa 5: + panel de administración (leads, configuración dinámica y usuarios). Los masivos
 * llegan en la Etapa 6 (docs/02-plan-de-etapas.md).
 */
@Module({
  imports: [
    // Límite por IP: solo donde se use un ThrottlerGuard (login, 2FA; en la Etapa 2, el formulario)
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 20 }] }),
    PrismaModule,
    RedisModule,
    HealthModule,
    AuditModule,
    AuthModule,
    UsersModule,
    RealtimeModule,
    WhatsAppModule,
    ConversationsModule,
    SettingsModule,
    MailModule,
    LeadsModule,
    AdminModule,
  ],
})
export class AppModule {}
