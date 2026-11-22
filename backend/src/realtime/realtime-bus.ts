import { loadEnv } from '../config/env';

/**
 * Canal de Redis por el que el worker de masivos (otro proceso, sin Socket.io) publica eventos del
 * panel; la API los reenvía a los navegadores conectados (RealtimeBridge).
 */
export const realtimeChannel = () => `${loadEnv().REDIS_KEY_PREFIX}realtime`;

export interface RealtimeEnvelope {
  event: string;
  payload: unknown;
}
