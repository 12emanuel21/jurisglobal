import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
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

  // Detrás de nginx: req.ip = IP real (X-Forwarded-For), necesario para el rate limiting
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cookieParser());

  // Mismo origen por nginx; CORS solo para los orígenes declarados (nunca "*" con cookies)
  const origins =
    env.CORS_ORIGINS?.split(',')
      .map((o) => o.trim())
      .filter(Boolean) ?? [];
  app.enableCors({ origin: origins.length ? origins : false, credentials: true });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();

  await app.listen(env.PORT, '0.0.0.0');
  new Logger('Bootstrap').log(`🚀 API JurisGlobal en :${env.PORT} (${env.NODE_ENV})`);
}

void bootstrap();
