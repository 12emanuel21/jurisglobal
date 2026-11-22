import { z } from 'zod';

/**
 * Variables de entorno validadas al arrancar (fail-fast): si falta una obligatoria o tiene un
 * formato inválido, el proceso no inicia. Nunca hay valores por defecto para secretos.
 * Las credenciales de Meta, Gemini y SMTP son opcionales en la Etapa 1: el módulo que las use
 * falla de forma explícita (fail-closed) si no están.
 */
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_TIMEZONE: z.string().default('America/Bogota'),
  PUBLIC_BASE_URL: z.string().url(),
  /** Orígenes permitidos para CORS (lista separada por comas) */
  CORS_ORIGINS: optional,

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  /** Prefijo de las claves propias en Redis (límite por IP y colas BullMQ). Las pruebas usan uno aparte */
  REDIS_KEY_PREFIX: z
    .string()
    .regex(/^[\w:.-]{1,60}$/)
    .default('jg:'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  /** true en producción (HTTPS detrás de Cloudflare): la cookie de sesión solo viaja por HTTPS */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** 32 bytes en hex (64 caracteres): cifrado AES-256-GCM y seudónimo de teléfonos */
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY debe ser 64 caracteres hex (32 bytes)'),

  GOOGLE_GENERATIVE_AI_API_KEY: optional,
  GEMINI_MODEL: optional,
  GEMINI_FALLBACK_MODEL: optional,
  GEMINI_TIMEOUT_MS: optional,

  WHATSAPP_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v22.0'),
  WHATSAPP_PHONE_NUMBER_ID: optional,
  WHATSAPP_WABA_ID: optional,
  WHATSAPP_ACCESS_TOKEN: optional,
  META_APP_SECRET: optional,
  WHATSAPP_VERIFY_TOKEN: optional,

  /** SMTP (Gmail con contraseña de aplicación). Sin configurar: la API arranca y advierte; no se envían correos */
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  /** Remitente ("JurisGlobal <correo@dominio>"); por defecto SMTP_USER */
  SMTP_FROM: optional,
  /** Destinatarios del aviso de lead (coma). El valor de Configuración (notify.leadEmails) tiene prioridad */
  LEAD_NOTIFICATION_EMAIL: optional,

  /** Masivos: true = el worker nunca llama a Meta aunque haya credenciales (todas las campañas simulan) */
  CAMPAIGNS_FORCE_DRY_RUN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /** Envíos por minuto e IP a POST /leads */
  LEADS_RATE_LIMIT: z.coerce.number().int().positive().default(5),
  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Lee y valida process.env una sola vez. Lanza con todos los problemas juntos. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached && source === process.env) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida (.env):\n${problems}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

/** Solo para pruebas */
export function resetEnvCache() {
  cached = null;
}
