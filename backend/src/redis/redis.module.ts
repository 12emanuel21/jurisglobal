import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { loadEnv } from '../config/env';

export const REDIS = Symbol('REDIS');

@Injectable()
class RedisShutdown implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }
}

/**
 * Cliente Redis compartido (health, deduplicación, y en etapas siguientes BullMQ y throttler).
 * Redis corre con maxmemory-policy noeviction + AOF: las colas no pierden trabajos.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () => {
        const logger = new Logger('Redis');
        const client = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
        client.on('error', (err) => logger.error(`Redis: ${err.message}`));
        return client;
      },
    },
    RedisShutdown,
  ],
  exports: [REDIS],
})
export class RedisModule {}
