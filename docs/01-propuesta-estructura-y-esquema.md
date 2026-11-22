# 01 · Propuesta de estructura, esquema y despliegue

Borrador de la Etapa 0, actualizado al cerrar la Etapa 1 (22-nov-2026). Las rutas `KC/` y `DJ/` siguen la convención de `00-mapa-reutilizacion.md`.

> **Fuente de verdad desde la Etapa 1:** el esquema real está en `backend/prisma/schema.prisma` (migración `20261122012052_init`) y la infraestructura en `docker-compose.yml`, `docker-compose.dev.yml` y `nginx/nginx.conf`. Las secciones 2 a 4 de este documento son el borrador original; la sección 0 resume en qué cambió.

Versiones (iguales a KovalCloud, respuesta 13; se conservó su `package-lock`):
- Backend: NestJS 11.2.1, Prisma 5.22.0, Node 20, `ai` 6.0.297, `@ai-sdk/google` 3.0.129.
- Frontend: Next 16.4.3, React 19.2.8, Tailwind 4.3.3.
- Datos: PostgreSQL 16, Redis 7.
- Paquetes nuevos en la Etapa 1: `cookie-parser`, `helmet` e `ioredis`.
- Pendientes para etapas posteriores: BullMQ y `@nestjs/schedule` (Etapa 6), `nodemailer` (Etapa 2).
- Validación de variables: `zod`, que ya era dependencia, en lugar de `@nestjs/config`.

## 0. Decisiones cerradas tras la Etapa 0 (respuestas del 22-nov-2026)

| Tema | Decisión | Dónde quedó |
|---|---|---|
| **Inbox multimedia (entra al MVP)** | Bandeja de conversaciones de WhatsApp con respuesta manual, pausa/reanudación del bot (handover de 12 h), imágenes, notas de voz con transcripción (Gemini) y PDFs. Reutiliza el Inbox de KovalCloud sin tenant ni Baileys. Los adjuntos se validan por *magic bytes* y se sirven solo con sesión (nginx no publica `uploads/`). | `backend/src/conversations/*`, `backend/src/whatsapp/{media,webhook.processor}.ts`, `frontend/src/app/panel/conversaciones/page.tsx` |
| **Interruptor del precio de la asesoría** | `Setting.showConsultationPrice` (booleano, apagado por defecto) + `Setting.consultationPrice` (COP, `null` mientras no se confirme). Apagado = la web y el bot la presentan sin costo; encendido = muestran el valor. | `backend/src/settings/defaults.ts` (lo consumen las etapas 3 y 4) |
| Topes de masivos | 1 por día y 2 por semana por contacto, y 250 por día en total. Editables. | `Setting` `marketing.*` |
| Base sin soporte documental | `Contact.consentStatus`: `UNVERIFIED` / `DOCUMENTED` / `CONFIRMED` / `OPTED_OUT`. `Campaign.kind`: `MARKETING` solo a `DOCUMENTED`/`CONFIRMED`; `OPT_IN` (confirmación) solo a `UNVERIFIED`. El importador exige las columnas Origen y Autorización. | `schema.prisma`, `backend/src/contacts/contacts-spreadsheet.ts` |
| Anonimización (ADMIN) | `Lead.anonymizedAt` / `Contact.anonymizedAt`. `Consent.phone` es anulable y se conserva `phoneHash` (HMAC con clave del servidor). Las bajas viven en `Suppression(phoneHash)`, que sobrevive a la anonimización. | `schema.prisma`, `backend/src/common/crypto.ts` |
| Sesión | Cookie `jg_session` `httpOnly`, `SameSite=Lax`, `Secure` en producción. 2FA (TOTP cifrado AES-256-GCM) y modo sudo reutilizados de KovalCloud. | `backend/src/auth/*`, `frontend/src/context/AuthContext.tsx` |
| Roles | `ADMIN` y `ASESOR`. *Deny-by-default*: el ASESOR solo entra a rutas marcadas con `@AsesorAccess()` (Inbox, perfil, su contraseña; leads en la Etapa 5). | `backend/src/auth/guards/jwt-auth.guard.ts` |
| Docker | Proyecto `jurisglobal` y `container_name` `jurisglobal_*`. Red `jurisglobal_net`. Volúmenes `jurisglobal_{pg_data,redis_data,uploads}`. Puertos 8088/4100/3100/55432/56379, todos en 127.0.0.1. Script `./jg` (el servidor no tiene `make`). | `docker-compose*.yml`, `jg`, `Makefile` |
| Cloudflare | Nuevo *Public Hostname* en el túnel existente. **Ojo:** el `cloudflared` actual corre en un contenedor de la red de KovalCloud, y desde ahí `localhost:8088` es el propio contenedor, no el VPS. Ver pregunta abierta en `02` (Etapa 7). | `docker-compose.yml` (`NGINX_BIND`) |
| Correo | SMTP de Gmail con contraseña de aplicación, por variables de entorno. | `.env.example` (`SMTP_*`; se implementa en la Etapa 2) |
| Bot | Flujo determinista con botones y listas; Gemini solo para dudas fuera del flujo. Ya están el cliente interactivo (`buildButtonsPayload` / `buildListPayload`) y el prompt base. | `backend/src/whatsapp/cloud-api.client.ts`, `backend/src/ai/{ai.service,prompts}.ts` |

---

## 1. Estructura del monorepo

```
jurisglobal/
├── backend/                         # NestJS (API + worker, misma imagen)
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts                  # motivos, ventanas Ley 2300, festivos CO, settings, textos de consentimiento v1
│   ├── src/
│   │   ├── main.ts                  # API HTTP (rawBody, helmet, CORS restringido, ValidationPipe)
│   │   ├── worker.ts                # proceso de colas BullMQ (sin HTTP)
│   │   ├── app.module.ts
│   │   ├── worker.module.ts
│   │   ├── config/                  # env.validation.ts (zod), secrets.ts  ← KC/be/src/config/secrets.ts
│   │   ├── common/                  # phone.ts (E.164) ← KC orders/phone.ts; logger con redacción de PII; csv.ts
│   │   ├── prisma/                  # ← KC/be/src/prisma
│   │   ├── auth/                    # JWT, revocación, roles, 2FA, sudo, throttlers ← KC/be/src/auth (sin tenant)
│   │   ├── users/                   # usuarios del panel ← KC/be/src/users
│   │   ├── audit/                   # AuditLog (servicio + interceptor)
│   │   ├── settings/                # Setting clave/valor + Motivo
│   │   ├── leads/                   # API pública + panel (filtros, notas, estado, CSV)
│   │   ├── consents/                # registro de autorizaciones
│   │   ├── notifications/           # correo de lead nuevo (cola `mail`)
│   │   ├── ai/                      # model-fallback.ts ← KC; ai.service con esquema off-flow
│   │   ├── whatsapp/
│   │   │   ├── cloud-api.client.ts  # texto, interactivos, plantillas, media, templates, phone health
│   │   │   ├── webhook.controller.ts# GET verify + POST (HMAC) → colas `wa-inbound` / `wa-status`
│   │   │   ├── inbound.processor.ts # dedup wamid → chatbot
│   │   │   ├── status.processor.ts  # estados monótonos → Message / CampaignMessage
│   │   │   └── meta-errors.ts       # glosario código → categoría (idea DJ/O/meta_errors.py)
│   │   ├── chatbot/
│   │   │   ├── flow.ts              # máquina de estados pura (testeable)
│   │   │   ├── chatbot.service.ts   # orquesta flujo, Gemini off-flow, STOP, handover
│   │   │   └── prompts/
│   │   ├── conversations/           # historial para el panel ← KC chats/*
│   │   ├── contacts/                # Contact, importador xlsx/csv ← KC menu-spreadsheet.ts, bajas
│   │   ├── campaigns/
│   │   │   ├── templates.service.ts # sync de plantillas aprobadas
│   │   │   ├── campaigns.service.ts # crear / programar / pausar / cancelar / armar audiencia
│   │   │   ├── dispatcher.ts        # tick cada 60 s: ventana, cupo diario, encola con jitter
│   │   │   ├── sender.processor.ts  # cola `campaign-send`: re-verifica y envía
│   │   │   └── stats.service.ts     # embudo y errores top
│   │   ├── compliance/
│   │   │   ├── send-window.ts       # isWithinSendWindow / nextOpening ← KC business-hours.ts
│   │   │   ├── holidays.ts          # cálculo festivos CO (Ley 51/1983 + Pascua) para semilla
│   │   │   └── frequency.ts         # tope por contacto
│   │   ├── realtime/                # gateway Socket.io ← KC orders.gateway.ts (auth)
│   │   └── health/                  # /health (db, redis)
│   ├── test/
│   ├── Dockerfile
│   └── package.json
├── frontend/                        # Next.js 16 App Router
│   ├── src/app/
│   │   ├── (public)/                # landing, /privacidad, /terminos, /cookies, /gracias
│   │   ├── login/
│   │   └── panel/                   # ruta protegida (ESP §4)
│   │       ├── leads/  leads/[id]/
│   │       ├── conversaciones/      # si se aprueba (pregunta 11)
│   │       ├── contactos/  contactos/importar/
│   │       ├── campanas/  campanas/nueva/  campanas/[id]/
│   │       └── configuracion/       # motivos, precio, ventanas, festivos, textos, correo, usuarios, cuenta/2FA
│   ├── src/components/  src/context/  src/lib/api.ts
│   ├── public/plantilla-contactos.xlsx
│   ├── AGENTS.md                    # ← KC/fe/AGENTS.md
│   └── Dockerfile
├── nginx/nginx.conf                 # ← KC/nginx/nginx.prod.conf adaptado
├── scripts/backup_db.sh             # sin secretos en el archivo
├── docs/
├── docker-compose.yml               # producción
├── docker-compose.dev.yml           # overlay dev
├── Makefile                         # fija -p jurisglobal en todo comando
├── .env.example
└── README.md
```

Decisiones:
- **API y worker en la misma imagen, en procesos separados.** Así un envío masivo no bloquea la API ni el webhook, y no se suma otro lenguaje.
- **Credenciales de Meta en el entorno, no en la BD.** Es un solo número y un solo cliente, así que se elimina el riesgo de guardar tokens en claro (KovalCloud y Django los guardan en la BD).
- **Prefijo `/api`** (nginx lo quita) y **`/meta/webhook`** sin reescritura, para no alterar el *body* que se firma.

---

## 2. Borrador del esquema Prisma (alineado con ESP §9)

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

// ───────── Panel ─────────
enum Role { ADMIN ASESOR }

model User {
  id                 String    @id @default(uuid())
  email              String    @unique
  passwordHash       String
  name               String
  role               Role      @default(ASESOR)
  isActive           Boolean   @default(true)
  twoFactorSecret    String?   // cifrado AES-GCM (ENCRYPTION_KEY)
  isTwoFactorEnabled Boolean   @default(false)
  passwordChangedAt  DateTime? // revoca JWT anteriores (← KC token-revocation)
  lastLoginAt        DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  assignedLeads      Lead[]    @relation("LeadAssignee")
  notes              LeadNote[]
  campaigns          Campaign[]
  imports            ContactImport[]
  auditLogs          AuditLog[]
}

model AuditLog {
  id        String   @id @default(uuid())
  userId    String?
  user      User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  action    String   // LEAD_STATUS_CHANGED, LEADS_EXPORTED, CAMPAIGN_LAUNCHED, SETTING_UPDATED, CONTACT_ERASED…
  entity    String
  entityId  String?
  data      Json?
  ip        String?
  createdAt DateTime @default(now())
  @@index([entity, entityId])
  @@index([createdAt])
}

model Setting {
  key         String   @id      // advisory.price, advisory.isFree, notify.emails, bot.texts.*, marketing.*, consent.current.*
  value       Json
  updatedAt   DateTime @updatedAt
  updatedById String?
}

// ───────── Leads ─────────
enum Channel    { WEB WHATSAPP IMPORT MANUAL }
enum LeadStatus { NEW CONTACTED SCHEDULED CLOSED }

model Motivo {
  id        String   @id @default(uuid())
  name      String   @unique   // Tránsito, Cartera, Deudas, Otro
  isActive  Boolean  @default(true)
  sortOrder Int      @default(0)
  leads     Lead[]
}

model Lead {
  id              String     @id @default(uuid())
  fullName        String
  phone           String     @unique  // E.164 sin "+": 573001234567. Deduplicación (ESP §5, §6.3)
  email           String
  motivoId        String
  motivo          Motivo     @relation(fields: [motivoId], references: [id])
  origin          Channel    // primer canal
  lastOrigin      Channel    // último canal por el que volvió a enviar
  status          LeadStatus @default(NEW)
  assignedToId    String?
  assignedTo      User?      @relation("LeadAssignee", fields: [assignedToId], references: [id], onDelete: SetNull)
  contactId       String?    @unique
  contact         Contact?   @relation(fields: [contactId], references: [id], onDelete: SetNull)
  submissionCount Int        @default(1)
  lastSubmittedAt DateTime   @default(now())
  utm             Json?      // fuente/campaña web si existe
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt
  notes           LeadNote[]
  consents        Consent[]
  @@index([status, createdAt])
  @@index([motivoId])
  @@index([origin])
}

model LeadNote {
  id        String   @id @default(uuid())
  leadId    String
  lead      Lead     @relation(fields: [leadId], references: [id], onDelete: Cascade)
  authorId  String?
  author    User?    @relation(fields: [authorId], references: [id], onDelete: SetNull)
  body      String
  createdAt DateTime @default(now())
  @@index([leadId, createdAt])
}

// ───────── Consentimiento (Ley 1581 / Ley 2300 art. 5) ─────────
enum ConsentPurpose { PRIVACY_TERMS_COOKIES CONTACT_AND_DATA_PROCESSING MARKETING_WHATSAPP }

model Consent {
  id           String         @id @default(uuid())
  leadId       String?
  lead         Lead?          @relation(fields: [leadId], references: [id], onDelete: SetNull)
  contactId    String?
  contact      Contact?       @relation(fields: [contactId], references: [id], onDelete: SetNull)
  phone        String         // se conserva aunque se borre el lead
  purpose      ConsentPurpose
  granted      Boolean        // false = negó o revocó
  channel      Channel
  textVersion  String         // p. ej. "web-autorizacion-2@2026-11-22"
  textSnapshot String         // texto exacto mostrado/aceptado
  evidence     Json?          // web: {ip, userAgent, formId}; whatsapp: {wamid, buttonId}; import: {importId, fila, fuente}
  createdAt    DateTime       @default(now())
  @@index([phone, purpose, createdAt])
}

// ───────── WhatsApp: conversaciones ─────────
enum MsgDirection { INBOUND OUTBOUND }
enum MsgAuthor    { CONTACT BOT AGENT SYSTEM }
enum MsgStatus    { RECEIVED ACCEPTED SENT DELIVERED READ FAILED }

model Conversation {
  id            String    @id @default(uuid())
  waId          String    @unique  // teléfono E.164 del interlocutor (un solo número de empresa)
  contactId     String?   @unique
  contact       Contact?  @relation(fields: [contactId], references: [id], onDelete: SetNull)
  flowState     String    @default("IDLE") // GREETING, ASK_CONSENT, ASK_NAME, ASK_EMAIL, ASK_MOTIVO, CONFIRM, DONE, DECLINED
  flowData      Json?     // respuestas parciales
  botPausedAt   DateTime? // handover a humano (← KC chats/handover.ts)
  lastInboundAt DateTime? // ventana de 24 h de Meta
  lastMessageAt DateTime  @default(now())
  createdAt     DateTime  @default(now())
  messages      Message[]
  @@index([lastMessageAt])
}

model Message {
  id                String       @id @default(uuid())
  conversationId    String
  conversation      Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  direction         MsgDirection
  author            MsgAuthor
  type              String       // text, interactive, button, template, image, audio, document…
  body              String?
  payload           Json?        // ids de botón/lista, parámetros de plantilla (sin secretos)
  waMessageId       String?      @unique // deduplicación de webhooks y matching de estados
  status            MsgStatus?
  errorCode         Int?
  errorDetail       String?
  sentById          String?      // usuario si author=AGENT
  campaignMessageId String?      @unique
  createdAt         DateTime     @default(now())
  @@index([conversationId, createdAt])
}

// ───────── Masivos ─────────
enum ContactSource { IMPORT WEB WHATSAPP MANUAL }

model Contact {
  id              String        @id @default(uuid())
  phone           String        @unique  // E.164 sin "+"
  name            String?
  email           String?
  source          ContactSource
  sourceDetail    String?       // p. ej. nombre de la consultoría / archivo
  tags            String[]
  importId        String?
  import          ContactImport? @relation(fields: [importId], references: [id], onDelete: SetNull)
  optedOutAt      DateTime?     // baja global (STOP, botón, 131050, manual)
  optOutChannel   String?       // KEYWORD, TEMPLATE_BUTTON, META_131050, PANEL, WEB
  optOutNote      String?
  erasedAt        DateTime?     // supresión a pedido del titular (datos anonimizados)
  lastMarketingAt DateTime?     // atajo para el tope de frecuencia
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  lead            Lead?
  conversation    Conversation?
  consents        Consent[]
  campaignMsgs    CampaignMessage[]
  @@index([optedOutAt])
}

model ContactImport {
  id          String    @id @default(uuid())
  fileName    String
  sourceLabel String    // origen declarado de la base (obligatorio)
  consentNote String?   // descripción de la autorización que ampara la base
  rowsTotal   Int
  rowsCreated Int
  rowsUpdated Int
  rowsSkipped Int
  errors      Json?     // [{fila, motivo}] (máx. N)
  createdById String?
  createdBy   User?     @relation(fields: [createdById], references: [id], onDelete: SetNull)
  createdAt   DateTime  @default(now())
  contacts    Contact[]
}

model MessageTemplate {
  id            String   @id @default(uuid())
  metaId        String   @unique
  name          String
  language      String   // es, es_CO…
  category      String   // MARKETING, UTILITY…
  status        String   // APPROVED, PAUSED, REJECTED…
  components    Json     // copia de Meta (HEADER/BODY/FOOTER/BUTTONS)
  bodyText      String
  variableCount Int
  hasOptOut     Boolean  @default(false) // tiene botón/texto de baja (ESP §7.2)
  lastSyncedAt  DateTime
  campaigns     Campaign[]
  @@unique([name, language])
}

enum CampaignStatus { DRAFT SCHEDULED RUNNING PAUSED COMPLETED CANCELLED FAILED }

model Campaign {
  id              String          @id @default(uuid())
  name            String
  templateId      String
  template        MessageTemplate @relation(fields: [templateId], references: [id])
  variableMapping Json            // {"1": "contact.name", "2": {"literal": "…"}}
  audienceFilter  Json?           // tags, fuente, importId
  status          CampaignStatus  @default(DRAFT)
  scheduledAt     DateTime?       // no antes de; el envío real respeta ventanas
  dailyCap        Int?            // override del límite diario global
  startedAt       DateTime?
  completedAt     DateTime?
  pausedReason    String?         // MANUAL, QUALITY_RED, ACCOUNT_ERROR…
  createdById     String?
  createdBy       User?           @relation(fields: [createdById], references: [id], onDelete: SetNull)
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  messages        CampaignMessage[]
  @@index([status, scheduledAt])
}

enum CampaignMsgStatus { PENDING QUEUED SENT DELIVERED READ FAILED SKIPPED }

model CampaignMessage {
  id            String            @id @default(uuid())
  campaignId    String
  campaign      Campaign          @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  contactId     String
  contact       Contact           @relation(fields: [contactId], references: [id], onDelete: Cascade)
  phone         String            // copia al momento de armar
  variables     Json              // parámetros resueltos
  status        CampaignMsgStatus @default(PENDING)
  skipReason    String?           // OPTED_OUT, NO_CONSENT, FREQUENCY_CAP, DUPLICATE, INVALID_PHONE
  attempts      Int               @default(0)
  waMessageId   String?           @unique
  errorCode     Int?
  errorCategory String?           // cliente | usuario_meta | cuenta_waba | plantilla | infraestructura | desconocido
  errorDetail   String?
  queuedAt      DateTime?
  sentAt        DateTime?
  deliveredAt   DateTime?
  readAt        DateTime?
  failedAt      DateTime?
  repliedAt     DateTime?         // ESP §7.2: respuesta entra al bot
  createdAt     DateTime          @default(now())
  @@unique([campaignId, contactId])
  @@index([campaignId, status])
  @@index([contactId, sentAt])    // tope por contacto
}

// ───────── Ventanas y festivos (ESP §7.2) ─────────
model SendWindow {
  id        String  @id @default(uuid())
  dayOfWeek Int     @unique // 0=domingo … 6=sábado (una franja por día; ver pregunta 7)
  opensAt   String  // "07:00" hora America/Bogota
  closesAt  String  // "19:00"
  enabled   Boolean @default(true)
}

model Holiday {
  id      String   @id @default(uuid())
  date    DateTime @unique @db.Date
  name    String
  source  String   @default("SEED") // SEED | MANUAL
  enabled Boolean  @default(true)    // permite desmarcar sin borrar
}
```

Notas del esquema:
- **Baja y tope por teléfono.** Ambos viven en `Contact`, y todo lead de WhatsApp o de la web crea o enlaza su `Contact`. Así un STOP desde el bot excluye al número de las campañas aunque no venga de la base importada.
- **Valores iniciales de `SendWindow`:**
  - Lunes a viernes, 07:00–19:00.
  - Sábado, 08:00–15:00.
  - Domingo deshabilitado.
  - Base: Ley 2300 de 2023, art. 3 + art. 5 parágrafo 3. Los valores son editables.
- **Semilla de `Holiday`.**
  - Se generan los festivos de Colombia del año en curso y del siguiente.
  - Fijos: 1-ene, 1-may, 20-jul, 7-ago, 8-dic y 25-dic.
  - Trasladables al lunes (Ley 51 de 1983): 6-ene, 19-mar, 29-jun, 15-ago, 12-oct, 1-nov y 11-nov.
  - Dependientes de la Pascua: jueves y viernes santos; Ascensión, Corpus y Sagrado Corazón, todos trasladados al lunes.
  - Se prueban con fechas conocidas.
- **`Setting` → `marketing.*`:**
  - `dailyLimit`
  - `maxPerContact`
  - `periodDays`
  - `jitterMinMs` y `jitterMaxMs`
  - `ratePerMinute`
  - `stopKeywords`, por ejemplo `["stop","baja","no más","no quiero"]`
  - `pauseOnQuality` (RED)

### Flujo de envío propuesto

1. **Lanzar** (`DRAFT → SCHEDULED`). Se arma la audiencia y se crea un `CampaignMessage` por contacto. Quedan como `SKIPPED` los que tengan baja, no tengan consentimiento de marketing, superen el tope o tengan un teléfono inválido.
2. **Tick del *dispatcher*** (cada 60 s, `@nestjs/schedule` en el worker). Para cada campaña `SCHEDULED`/`RUNNING` cuyo `scheduledAt` ya pasó, verifica:
   - que la ventana esté abierta;
   - que no sea festivo;
   - que el número tenga calidad aceptable.

   Luego calcula el cupo: el límite diario menos lo enviado hoy, y el ritmo por minuto. Pasa N mensajes de `PENDING` a `QUEUED` y los encola en BullMQ (`campaign-send`) con `delay` aleatorio (jitter) y un *limiter* global.
3. **Worker `campaign-send`.** Revalida la ventana, la baja y el tope, porque pudieron cambiar después de encolar. Si algo ya no se cumple, devuelve el mensaje a `PENDING` o lo marca `SKIPPED`. Si todo sigue en regla:
   - llama a Graph `type: template`;
   - guarda `waMessageId` y lo deja en `SENT`;
   - ante errores de infraestructura o 429 reintenta con backoff;
   - ante un rechazo de Meta pasa a `FAILED` con su categoría;
   - ante un error de cuenta o un 131050 pausa la campaña o da de baja al contacto.
4. **Fuera de ventana** no se encola nada; se reanuda sola en la siguiente apertura. No hay ETA largos, que es el problema de Django.
5. **Webhook `statuses` → cola `wa-status`.** Actualiza en orden monótono (`SENT < DELIVERED < READ`; `FAILED` es terminal).
6. **Respuesta entrante de un número con `CampaignMessage` reciente.** Marca `repliedAt` y la conversación entra al flujo del bot.

---

## 3. docker-compose de la instancia aislada

Situación actual del VPS (leída con `docker ps` y `ss -ltn`, sin cambiar nada):
- Proyecto `kovalcloud` en producción.
- `127.0.0.1:80` lo ocupa nginx de KovalCloud.
- Red `kovalcloud_koval_network`.
- Volúmenes `kovalcloud_*`.
- Puertos libres: 8088, 4100, 3100, 55432 y 56379.

```yaml
# docker-compose.yml (producción) — borrador
name: jurisglobal

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-jg_admin}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?}
      POSTGRES_DB: ${POSTGRES_DB:-jurisglobal}
    volumes: [pg_data:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"], interval: 10s, retries: 5 }
    networks: [jg_net]

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--maxmemory-policy", "noeviction", "--requirepass", "${REDIS_PASSWORD:?}"]
    volumes: [redis_data:/data]
    healthcheck: { test: ["CMD-SHELL", "redis-cli -a $${REDIS_PASSWORD} ping | grep PONG"], interval: 10s, retries: 5 }
    environment: [REDIS_PASSWORD=${REDIS_PASSWORD}]
    networks: [jg_net]

  api:
    build: { context: ./backend, target: prod }
    restart: unless-stopped
    command: ["node", "dist/main.js"]
    env_file: .env
    expose: ["4000"]
    volumes: [uploads:/app/uploads]
    depends_on: { db: { condition: service_healthy }, redis: { condition: service_healthy } }
    networks: [jg_net]

  worker:
    build: { context: ./backend, target: prod }
    restart: unless-stopped
    command: ["node", "dist/worker.js"]
    env_file: .env
    depends_on: { db: { condition: service_healthy }, redis: { condition: service_healthy } }
    networks: [jg_net]

  web:
    build: { context: ./frontend, target: prod }
    restart: unless-stopped
    environment: [BACKEND_INTERNAL_URL=http://api:4000, NEXT_PUBLIC_SITE_URL=${PUBLIC_BASE_URL}]
    expose: ["3000"]
    depends_on: [api]
    networks: [jg_net]

  nginx:
    image: nginx:1.27-alpine
    restart: unless-stopped
    ports: ["127.0.0.1:${NGINX_HOST_PORT:-8088}:80"]   # solo loopback, para curl local
    volumes: [./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro]
    depends_on: [web, api]
    networks: [jg_net]

  cloudflared:
    image: cloudflare/cloudflared:2025.8.1            # versión fija; túnel PROPIO de JurisGlobal
    restart: unless-stopped
    command: ["tunnel", "--no-autoupdate", "run"]
    environment: [TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN:?}]
    depends_on: [nginx]
    networks: [jg_net]

volumes: { pg_data: {}, redis_data: {}, uploads: {} }
networks: { jg_net: { driver: bridge } }
```

Overlay de desarrollo (`docker-compose.dev.yml`): `target: dev`, *bind mounts* de `./backend` y `./frontend`, sin `cloudflared` (o un *quick tunnel* aparte para probar el webhook de Meta). Puertos solo en loopback:

| Servicio | Host (dev) | KovalCloud usa | ¿Choca? |
|---|---|---|---|
| db | 127.0.0.1:55432 | 5432 (dev) | No |
| redis | 127.0.0.1:56379 | — (no publicado) | No |
| api | 127.0.0.1:4100 | 4000 | No |
| web | 127.0.0.1:3100 | 3030 / 3000 | No |
| nginx | 127.0.0.1:8088 (dev y prod) | 80 | No |

Reglas de aislamiento:
- `name: jurisglobal` fijo. Docker deriva los nombres `jurisglobal-*`, `jurisglobal_jg_net` y `jurisglobal_pg_data`.
- Ningún `container_name`.
- Ninguna red externa compartida.
- `Makefile` con `docker compose -p jurisglobal -f …`.
- Nunca `docker compose down -v` sin el `-p`.

Exposición pública:
- `Internet → Cloudflare → cloudflared (jurisglobal) → nginx:80 → { web:3000 | api:4000 }`.
- La ruta `/meta/webhook` debe quedar fuera del *challenge* o *bot-fight* de Cloudflare para que Meta llegue sin bloqueo.

---

## 4. Variables de entorno (solo nombres)

| Variable | Servicio | Descripción |
|---|---|---|
| `NODE_ENV` | api, worker, web | `production` / `development` |
| `TZ` / `APP_TIMEZONE` | api, worker | `America/Bogota` |
| `PUBLIC_BASE_URL` | api, web | URL pública (dominio de pruebas por ahora; ESP §4) |
| `CORS_ORIGINS` | api | Orígenes permitidos (lista) |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | db | Credenciales de la BD nueva |
| `DATABASE_URL` | api, worker | Cadena de conexión de Prisma |
| `REDIS_PASSWORD`, `REDIS_URL` | redis, api, worker | Redis para BullMQ, throttler y deduplicación |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | api | Firma y duración de sesión del panel |
| `ENCRYPTION_KEY` | api | Clave AES-256-GCM para campos sensibles (2FA) |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | script | Primer administrador (se usan una vez) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | api, worker | Clave de Gemini |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GEMINI_TIMEOUT_MS` | api, worker | Cadena de modelos y timeout por intento |
| `WHATSAPP_GRAPH_VERSION` | api, worker | Versión de Graph API (p. ej. `v22.0`; verificar vigente) |
| `WHATSAPP_PHONE_NUMBER_ID` | api, worker | ID del número en Cloud API |
| `WHATSAPP_WABA_ID` | api, worker | ID de la cuenta de WhatsApp Business (plantillas, calidad) |
| `WHATSAPP_ACCESS_TOKEN` | api, worker | Token de usuario del sistema (permanente) |
| `META_APP_SECRET` | api | Valida `X-Hub-Signature-256` |
| `WHATSAPP_VERIFY_TOKEN` | api | Token de verificación del webhook (GET) |
| `WHATSAPP_DISPLAY_NUMBER` | web | Número para el botón wa.me de la landing |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | worker | Envío de correo (o `MAIL_PROVIDER_API_KEY` si se elige proveedor; pregunta 6) |
| `MAIL_FROM` | worker | Remitente |
| `LEAD_NOTIFY_EMAILS` | worker | Destinatarios por defecto (luego editable en `Setting`) |
| `LEADS_RATE_LIMIT` | api | Límite de envíos del formulario por IP y minuto |
| `CAPTCHA_SECRET`, `NEXT_PUBLIC_CAPTCHA_SITE_KEY` | api, web | Opcional: Cloudflare Turnstile en el formulario |
| `CLOUDFLARE_TUNNEL_TOKEN` | cloudflared | Túnel propio de JurisGlobal |
| `NGINX_HOST_PORT` | nginx | Puerto de loopback (por defecto 8088) |
| `BACKEND_INTERNAL_URL` | web | `http://api:4000` para SSR |
| `NEXT_PUBLIC_SITE_URL` | web | URL canónica (SEO, enlaces legales) |
| `LOG_LEVEL` | api, worker | Nivel de log (con redacción de PII) |
