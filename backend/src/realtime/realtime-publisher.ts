import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { RealtimeGateway } from './realtime.gateway';
import { realtimeChannel } from './realtime-bus';

/**
 * Sustituto de RealtimeGateway en el proceso worker: mismo método emitToPanel, pero publica en
 * Redis (la API lo reenvía a los navegadores). Así los servicios compartidos no cambian.
 */
@Injectable()
export class RealtimePublisher {
  private readonly logger = new Logger(RealtimePublisher.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  emitToPanel(event: string, payload: unknown) {
    this.redis
      .publish(realtimeChannel(), JSON.stringify({ event, payload }))
      .catch((err: Error) => this.logger.warn(`No se pudo publicar ${event}: ${err.message}`));
  }

  disconnectUser() {
    /* el worker no tiene sockets */
  }
}

@Global()
@Module({
  providers: [{ provide: RealtimeGateway, useClass: RealtimePublisher }],
  exports: [RealtimeGateway],
})
export class RealtimePublisherModule {}
