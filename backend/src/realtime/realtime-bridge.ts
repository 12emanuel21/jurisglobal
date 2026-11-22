import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { loadEnv } from '../config/env';
import { RealtimeGateway } from './realtime.gateway';
import { realtimeChannel, type RealtimeEnvelope } from './realtime-bus';

/** Reenvía al panel (Socket.io) los eventos que publica el worker en Redis */
@Injectable()
export class RealtimeBridge implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeBridge.name);
  private subscriber: Redis | null = null;

  constructor(private readonly gateway: RealtimeGateway) {}

  async onModuleInit() {
    const sub = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
    sub.on('error', (err) => this.logger.error(`Redis (tiempo real): ${err.message}`));
    sub.on('message', (_channel, raw) => {
      try {
        const { event, payload } = JSON.parse(raw) as RealtimeEnvelope;
        if (typeof event === 'string') this.gateway.emitToPanel(event, payload);
      } catch {
        /* mensaje mal formado: se ignora */
      }
    });
    await sub.subscribe(realtimeChannel());
    this.subscriber = sub;
  }

  async onModuleDestroy() {
    await this.subscriber?.quit().catch(() => undefined);
  }
}
