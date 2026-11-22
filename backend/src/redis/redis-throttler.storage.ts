import { Inject, Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { loadEnv } from '../config/env';
import { REDIS } from './redis.module';

/**
 * Ventana deslizante atómica: un sorted set por clave con un miembro por intento (score = ms).
 * Devuelve [intentos en la ventana, ms hasta que vence el más antiguo, ms de bloqueo restante].
 */
const SLIDING_WINDOW = `
local key, blockKey = KEYS[1], KEYS[2]
local now, ttl, limit, blockMs = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
local blocked = redis.call('PTTL', blockKey)
if blocked > 0 then
  return {redis.call('ZCARD', key), redis.call('PTTL', key), blocked}
end
redis.call('ZREMRANGEBYSCORE', key, 0, now - ttl)
redis.call('ZADD', key, now, now .. '-' .. ARGV[5])
redis.call('PEXPIRE', key, ttl)
local hits = redis.call('ZCARD', key)
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local expires = ttl
if oldest[2] then expires = tonumber(oldest[2]) + ttl - now end
if hits > limit and blockMs > 0 then
  redis.call('SET', blockKey, '1', 'PX', blockMs)
  return {hits, expires, blockMs}
end
return {hits, expires, 0}
`;

/**
 * Almacenamiento del límite por IP (@nestjs/throttler) en Redis, en reemplazo del Map en memoria de
 * la Etapa 2: el conteo de POST /api/leads y del login sobrevive a reinicios y se comparte entre
 * procesos de la API.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private seq = 0;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string) {
    const base = `${loadEnv().REDIS_KEY_PREFIX}throttle:${throttlerName}:${key}`;
    const [hits, expiresMs, blockMs] = (await this.redis.eval(
      SLIDING_WINDOW,
      2,
      base,
      `${base}:blocked`,
      Date.now(),
      ttl,
      limit,
      blockDuration,
      `${process.pid}-${++this.seq}`,
    )) as [number, number, number];
    return {
      totalHits: hits,
      timeToExpire: Math.max(0, Math.ceil(expiresMs / 1000)),
      isBlocked: blockMs > 0,
      timeToBlockExpire: Math.max(0, Math.ceil(blockMs / 1000)),
    };
  }
}
