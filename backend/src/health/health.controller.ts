import { Controller, Get, HttpException, HttpStatus, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';

/** GET /health: estado de PostgreSQL y Redis (lo usan Docker y el monitoreo). Público, sin datos. */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async check() {
    const [db, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => 'ok' as const).catch(() => 'down' as const),
      this.redis
        .ping()
        .then((r) => (r === 'PONG' ? ('ok' as const) : ('down' as const)))
        .catch(() => 'down' as const),
    ]);
    const body = {
      status: db === 'ok' && redis === 'ok' ? 'ok' : 'degraded',
      db,
      redis,
      time: new Date().toISOString(),
    };
    if (body.status !== 'ok') throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }
}
