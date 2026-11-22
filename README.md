# JurisGlobal

Web + chatbot de WhatsApp (Cloud API oficial de Meta) + envíos masivos + panel de administración para
JURISGLOBAL, Soluciones Jurídicas y Financieras. Instancia aislada, basada en la arquitectura de KovalCloud.

- Especificación: `docs/JurisGlobal_Especificaciones_v1.docx`
- Mapa de reutilización: `docs/00-mapa-reutilizacion.md`
- Estructura y esquema: `docs/01-propuesta-estructura-y-esquema.md`
- Plan por etapas: `docs/02-plan-de-etapas.md`

## Stack

| Capa | Tecnología |
|---|---|
| API | NestJS 11 · Prisma 5.22 · PostgreSQL 16 · Redis 7 · Socket.io |
| Web y panel | Next.js 16 (App Router) · React 19 · Tailwind 4 |
| IA | Gemini (Vercel AI SDK) con cadena de modelos de respaldo y timeout por intento |
| WhatsApp | Solo Cloud API de Meta (sin Baileys) |
| Infra | Docker Compose · nginx · Cloudflare |

## Arranque rápido

```bash
cp .env.example .env          # rellenar secretos (openssl rand -hex 32)
./jg dev                      # o: make dev  (desarrollo con hot-reload)
./jg migrate                  # aplica migraciones
./jg seed                     # motivos, ventanas Ley 2300, festivos CO, parámetros y admin inicial
```

`./jg` y el `Makefile` fijan siempre `-p jurisglobal`: nunca tocan los contenedores de KovalCloud,
que corren en el mismo servidor.

| Servicio | URL (solo 127.0.0.1) |
|---|---|
| Entrada única (nginx) | http://127.0.0.1:8088 · `/` web · `/panel` panel · `/api/*` API · `/meta/webhook` |
| API directa (dev) | http://127.0.0.1:4100/health |
| Next directo (dev) | http://127.0.0.1:3100 |
| PostgreSQL / Redis (dev) | 127.0.0.1:55432 / 127.0.0.1:56379 |

## Estructura

```
backend/    API NestJS (auth con cookie httpOnly + 2FA, WhatsApp Cloud API, Inbox, IA, cumplimiento)
frontend/   Next.js (web pública y panel /panel)
nginx/      Proxy de entrada
scripts/    backup_db.sh
docs/       Especificación y documentos de diseño
```

## API pública (Etapa 2)

| Método y ruta (vía nginx) | Uso |
|---|---|
| `GET /api/public/config` | Motivos activos, `showConsultationPrice` / `consultationPrice`, enlaces legales y textos de autorización vigentes |
| `POST /api/leads` | Formulario unificado. Cuerpo: `fullName`, `phone`, `email`, `motivo` (id o nombre), `origin: "web"`, `privacyAndTerms: true`, `contactAndDataProcessing: true`, `utm?` |
| `GET /api/health` | Estado de PostgreSQL y Redis |
| `GET/POST /meta/webhook` | Webhook de WhatsApp Cloud API (token de verificación + firma HMAC) |

## Pruebas

```bash
./jg test       # unitarias + integración (crea y migra la BD jurisglobal_test)
./jg test-unit  # solo unitarias
./jg test-e2e   # solo integración
./jg lint       # tipos y lint de backend y frontend
```
