import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from './config/env';
import { WorkerModule } from './worker/worker.module';

const LOG_LEVELS = ['error', 'warn', 'log', 'debug', 'verbose'] as const;

/** Worker de masivos (contenedor aparte): procesa la cola de Redis sin bloquear la API */
async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: [...LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(env.LOG_LEVEL) + 1)],
  });
  app.enableShutdownHooks();
  new Logger('Bootstrap').log(`🛠️ Worker de masivos JurisGlobal (${env.NODE_ENV})`);
}

void bootstrap();
