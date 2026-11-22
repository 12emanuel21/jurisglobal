import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { PrismaModule } from './prisma/prisma.module';
import { REDIS, RedisModule } from './redis/redis.module';
import { RedisThrottlerStorage } from './redis/redis-throttler.storage';
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
import { CampaignsModule } from './campaigns/campaigns.module';

/**
 * API HTTP. Etapa 6: + masivos (contactos, plantillas y campañas). Los envíos los hace el proceso
 * worker aparte (src/worker.ts) desde la cola de Redis; la API solo encola.
 */
@Module({
  imports: [
    // Límite por IP (login, 2FA y POST /api/leads), contado en Redis: sobrevive a reinicios
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [REDIS],
      useFactory: (redis: Redis) => ({
        throttlers: [{ ttl: 60_000, limit: 20 }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
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
    CampaignsModule,
  ],
})
export class AppModule {}
