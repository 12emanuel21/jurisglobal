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

/**
 * Etapa 1: bases. Leads, configuración, notificaciones, chatbot y masivos se agregan en las
 * etapas 2–6 (docs/02-plan-de-etapas.md).
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
  ],
})
export class AppModule {}
