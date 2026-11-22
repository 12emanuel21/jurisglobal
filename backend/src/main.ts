import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadEnv } from './config/env';

const LOG_LEVELS = ['error', 'warn', 'log', 'debug', 'verbose'] as const;

async function bootstrap() {
  // Falla al arrancar si la configuración es inválida (antes de abrir conexiones)
  const env = loadEnv();

  // rawBody: bytes originales del cuerpo para verificar la firma HMAC de Meta
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    logger: [...LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(env.LOG_LEVEL) + 1)],
  });
  configureApp(app, env);
  app.enableShutdownHooks();

  await app.listen(env.PORT, '0.0.0.0');
  new Logger('Bootstrap').log(`🚀 API JurisGlobal en :${env.PORT} (${env.NODE_ENV})`);
}

void bootstrap();
