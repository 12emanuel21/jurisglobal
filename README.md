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
Las imágenes de desarrollo (`jurisglobal-*-dev`) y las de producción (`jurisglobal-api`, `jurisglobal-web`)
tienen nombres distintos: `./jg build` no altera el entorno de desarrollo.

| Servicio | URL (solo 127.0.0.1) |
|---|---|
| Entrada única (nginx) | http://127.0.0.1:8088 · `/` web · `/panel` panel · `/api/*` API · `/webhooks/whatsapp` |
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
| `GET/POST /webhooks/whatsapp` | Webhook de WhatsApp Cloud API (token de verificación + firma HMAC). Alias: `/meta/webhook` |

## Web pública (Etapa 3)

| Ruta | Contenido |
|---|---|
| `/` | Landing: hero con asesoría inicial dinámica, servicios, nosotros, formulario unificado, WhatsApp |
| `/legal/privacidad`, `/legal/terminos`, `/legal/cookies` | Textos legales **provisionales** (pendientes de revisión jurídica) |

Datos de contacto públicos (`NEXT_PUBLIC_WHATSAPP_NUMBER`, `NEXT_PUBLIC_WHATSAPP_MESSAGE`,
`NEXT_PUBLIC_CONTACT_PHONE`, `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_NIT_INFO`): Next los incrusta
al compilar, así que cambiarlos en `.env` exige reconstruir la imagen web (`./jg up`). En desarrollo
basta con reiniciar el contenedor `web`. Los valores actuales son de relleno.

Logotipo: `frontend/src/components/brand/Logo.tsx` es un vectorial provisional; para usar el archivo
oficial, ponerlo en `frontend/public/brand/` y reemplazar `<LogoMark/>` en ese componente.

## Chatbot de WhatsApp (Etapa 4)

Flujo guiado y determinista en `backend/src/chatbot/`: autorización (Acepto / No acepto) → nombre →
correo → motivo (lista si hay más de 3 activos, botones si hay 3 o menos) → lead `WHATSAPP` por el
mismo `LeadsService` de la web. No clasifica, no asesora y no promete.

- **STOP / BAJA / NO QUIERO MÁS MENSAJES** (mensaje completo): baja inmediata en `Contact`,
  `Suppression` y `Consent`; luego el bot calla hasta «INICIO».
- **Inbox:** con la conversación pausada el bot no responde (el mensaje se guarda y se notifica).
- **Preguntas fuera de flujo:** Gemini con respaldo y tarifa real (`showConsultationPrice`). Si falla,
  hay respuesta fija; nunca dice «gratis».
- Reinicio tras 24 h sin mensajes o con «reiniciar» / «inicio».
- Textos editables en `Setting` (`bot.*`, `consent.whatsapp.contact`, `marketing.stopKeywords`,
  `company.website`, `company.email`).

## Panel de administración (Etapa 5)

`/panel` (cookie httpOnly + 2FA). ADMIN ve todo; ASESOR solo Leads, Inbox y Mi cuenta.

| Sección | API | Rol |
|---|---|---|
| Leads: resumen, filtros, detalle, estado, responsable, notas, CSV | `/api/admin/leads` | ADMIN y ASESOR |
| Anonimizar (Ley 1581) | `POST /api/admin/leads/:id/anonymize` | ADMIN (Sudo Mode si tiene 2FA) |
| Configuración: precio, contacto, motivos, textos del bot, horarios Ley 2300, festivos, topes | `/api/admin/settings`, `/motivos`, `/send-windows`, `/holidays` | ADMIN |
| Usuarios | `/api/users` | ADMIN |

La exportación CSV está pensada para Excel en Colombia (UTF-8 con BOM, `;`, teléfono `="+57…"`).

## Masivos (Etapa 6)

`/panel/masivos` (solo ADMIN): pestañas Campañas, Contactos y Plantillas. Los envíos los hace el
**worker** (contenedor `jurisglobal_worker`, cola BullMQ en Redis); la API solo encola.

| Sección | API |
|---|---|
| Contactos, importador .xlsx/.csv, baja manual | `/api/admin/contacts` (`/import`, `/:id/opt-out`, `/sources`) |
| Plantillas de Meta (manual o sincronizadas) | `/api/admin/templates` (`/sync`) |
| Campañas: vista previa, lanzar (Sudo Mode con 2FA), pausar, reanudar, cancelar, métricas | `/api/admin/campaigns` |

- **Verificados** (soporte documental o «Sí, acepto» por WhatsApp) reciben marketing; los **no verificados** solo la campaña de confirmación (opt-in); las **bajas** nada.
- Antes de cada envío, el worker revisa la baja, el horario Ley 2300 y los festivos, los topes (por contacto y global) y aplica el jitter. Fuera de horario, la campaña espera y se reanuda sola.
- Modo simulación por campaña, o `CAMPAIGNS_FORCE_DRY_RUN=true` para todo el servidor.
- `./jg worker-logs` muestra el log del worker.

## Producción (Etapa 7)

Guía paso a paso: [`docs/03-guia-despliegue-y-operacion.md`](docs/03-guia-despliegue-y-operacion.md).

```bash
./jg up      # (o ./jg prod) imágenes de producción; con CLOUDFLARE_TUNNEL_TOKEN también el túnel propio
./jg smoke   # salud, cabeceras, webhook 403, worker en Redis y KovalCloud intacto
./jg backup  # respaldo de PostgreSQL (backups/, 14 días)
```

## Pruebas

```bash
./jg test       # backend (unitarias + integración, crea y migra la BD jurisglobal_test) y frontend (Vitest)
./jg test-unit  # backend: solo unitarias
./jg test-e2e   # backend: solo integración (PostgreSQL y Redis reales; incluye la simulación de 2.000 contactos, ~2 min)
./jg test-web   # frontend: Vitest + Testing Library
./jg lint       # tipos y lint de backend y frontend
```
