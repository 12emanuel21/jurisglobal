import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Env } from './config/env';

/** Configuración HTTP común a main.ts y a las pruebas de integración (misma app que en producción) */
export function configureApp(app: NestExpressApplication, env: Env) {
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
  return app;
}
