import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { SettingsModule } from '../settings/settings.module';
import { RealtimePublisherModule } from '../realtime/realtime-publisher';
import { CampaignsCoreModule } from '../campaigns/campaigns-core.module';
import { CampaignWorkerService } from '../campaigns/campaign-worker';

/** Proceso worker de masivos: sin HTTP ni Socket.io (los eventos del panel salen por Redis) */
@Module({
  imports: [PrismaModule, RedisModule, SettingsModule, RealtimePublisherModule, CampaignsCoreModule],
  providers: [CampaignWorkerService],
})
export class WorkerModule {}
