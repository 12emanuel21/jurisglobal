import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Env } from './config/env';

/** Configuración HTTP común a main.ts y a las pruebas de integración (misma app que en producción) */
export function configureApp(app: NestExpressApplication, env: Env) {
  // Detrás de cloudflared + nginx: solo se confía en proxies de la red interna. El límite por IP y la
  // evidencia de los leads usan common/client-ip.ts (CF-Connecting-IP > X-Real-IP > X-Forwarded-For)
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
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
