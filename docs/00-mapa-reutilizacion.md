# 00 · Mapa de reutilización (Etapa 0, solo lectura)

Fecha: 2026-11-22 · Fuente de alcance: `docs/JurisGlobal_Especificaciones_v1.docx` (en adelante **ESP §n**).

**Convención de rutas**
- `KC/` = `~/dev/kovalcloud/` (KovalCloud). `KC/be/` = `KC/backend_koval/`, `KC/fe/` = `KC/frontend_koval/`.
- `DJ/` = `./referencias/chat_1/chat/` (módulo Django + Next de masivos). `DJ/O/` = `DJ/chatbots_ccob/orquestador/`.
- ⚠️ El encargo mencionaba `./referencias/django-masivos`; esa ruta **no existe**. El material real está en `./referencias/chat_1/chat` (ver pregunta 1).

---

## 1. Resumen ejecutivo

1. **KovalCloud ya trae Meta Cloud API** (`KC/be/src/meta-whatsapp/`) además de Baileys. Quitar Baileys es borrar `KC/whatsapp_service/`, `KC/be/src/whatsapp-gateway/` y la rama `x-source: baileys` del webhook. No hay que reemplazar nada.
2. Lo que falta del lado WhatsApp: **plantillas, mensajes interactivos (botones/listas), persistencia de estados (sent/delivered/read/failed) y deduplicación por `wamid`**. Ninguno existe en KovalCloud (`meta-whatsapp.service.ts` solo envía texto y documentos).
3. **Redis está declarado pero no se usa** en KovalCloud (`KC/docker-compose.prod.yml:37` dice BullMQ, pero `KC/be/package.json` no lo tiene). La cola de envíos es trabajo nuevo.
4. Reutilizable casi tal cual: la cadena Gemini con fallback y timeouts (`KC/be/src/ai/model-fallback.ts`), el núcleo de auth (JWT, revocación, 2FA, modo sudo, *deny-by-default*), la validación HMAC, el horario semanal en America/Bogota (`KC/be/src/restaurants/business-hours.ts` + editor `KC/fe/.../ScheduleCards.tsx`), el importador xlsx/csv y el shell del panel.
5. Unos 2/3 de KovalCloud es lógica de restaurante (menú, pedidos, domicilios, sedes, KDS, Wompi, carta pública, multi-tenant por subdominio) y se **elimina**.
6. Del módulo Django sirve la **mecánica**, no el código: campaña + destinatario con `wamid`, envío por lotes con throttling adaptativo, glosario de errores de Meta, embudo de métricas y colas separadas. Ese código tiene **bugs reales** (§4.2) y es de otro cliente (cobranza/inmobiliaria).
7. **Controles de cumplimiento en Django**:
   - Ventana horaria: está fija en el código y solo se valida al crear la campaña.
   - Festivos: el código existe pero está muerto (falta la librería `holidays`).
   - Tope por contacto, STOP/baja y registro de consentimiento: **no existen**.
   - Todos estos controles se construyen desde cero.
8. **KovalCloud está en producción en este mismo servidor** (proyecto compose `kovalcloud`, nginx en `127.0.0.1:80`). La instancia nueva debe usar su propio `name:`, su red, sus volúmenes, su puerto de loopback y su túnel.
9. **Riesgo de cumplimiento principal**: la base de 2.000 contactos viene de una consultoría. Hay que confirmar que la autorización cubre a **JurisGlobal** como responsable y al **WhatsApp de marketing** como finalidad (Ley 1581).

---

## 2. Tabla de decisiones

Decisiones: **REUTILIZAR** (tal cual, con cambios cosméticos) · **ADAPTAR** · **ELIMINAR** · **REIMPLEMENTAR** (reescribir con la idea de la fuente) · **NUEVO** (no existe en ninguna fuente).

### 2.1 KovalCloud – infraestructura

| Ruta | Decisión | Justificación |
|---|---|---|
| `KC/docker-compose.prod.yml` | ADAPTAR | Buen patrón: healthchecks, `depends_on: service_healthy`, solo nginx publica en loopback y usa cloudflared con token. Cambiar `name:`, red, volúmenes y puerto; quitar `baileys`; agregar `worker`. |
| `KC/docker-compose.yml` (base) | ELIMINAR | Publica `80:80` en 0.0.0.0, usa `container_name` globales (`koval_*`) y no tiene healthchecks. |
| `KC/docker-compose.dev.yml` | ADAPTAR | El overlay con bind mounts y puertos en 127.0.0.1 sirve, pero con puertos distintos (§01-3). Quitar `cloudflared:latest` (versión sin fijar). |
| `KC/nginx/nginx.prod.conf` | ADAPTAR | Upstreams con `resolve`, `/api/` sin prefijo, `/meta/` intacto (lo necesita el HMAC), socket.io con timeout de 1 h e IP real desde Cloudflare. Agregar `limit_req` para el formulario y el webhook, y cabeceras de seguridad. |
| `KC/nginx/nginx.conf` | ELIMINAR | Variante de dev/base. |
| `KC/be/Dockerfile`, `KC/fe/Dockerfile` | REUTILIZAR | Multi-stage `node:20`, usuario `node`. Agregar `prisma migrate deploy` en el arranque o como paso del despliegue. |
| `KC/start.sh`, `KC/update_service.py`, `KC/script.js` | ELIMINAR | Desactualizados o sintácticamente rotos; rutas fijas a otro usuario. |
| `KC/backup_db.sh` | ADAPTAR (idea) | `pg_dump -Fc` con retención de 7 días. Tiene la contraseña escrita en el archivo (línea 6): reescribir leyendo el `.env`. |
| `KC/botpress/` | ELIMINAR | No se usa; no hay contenedor ni llamadas. |
| `KC/whatsapp_service/` (Baileys 6.7.x) | ELIMINAR | ESP §4: solo Cloud API. |
| `KC/.env.example` | ADAPTAR | Patrón de documentar variables y fallar si falta una (`${VAR:?}`). |
| `KC/radiografia-codigo.md` | ELIMINAR (de la raíz) | No documenta el código: es la definición de una *skill* de análisis. Ver §6. |

### 2.2 KovalCloud – backend NestJS (`KC/be/src/`)

| Ruta | Decisión | Justificación |
|---|---|---|
| `config/secrets.ts` | REUTILIZAR | `requireEnv`, `timingSafeEqual` e `isValidMetaSignature` (HMAC-SHA256 sobre rawBody). |
| `main.ts` | ADAPTAR | Mantener `rawBody: true`, `trust proxy` y `ValidationPipe`. Restringir CORS (hoy está abierto, L15), agregar helmet y `forbidNonWhitelisted`. |
| `app.module.ts` | ADAPTAR | Nueva lista de módulos. Throttler con Redis (hoy en memoria) y aplicado a las rutas públicas. Agregar `@nestjs/config` (validación de variables), `@nestjs/schedule` y BullMQ. |
| `prisma/*` | REUTILIZAR | `PrismaService` y los helpers `isUniqueViolation` y `isRecordNotFound`. |
| `auth/strategies/jwt.strategy.ts`, `auth/token-revocation.ts` | REUTILIZAR | JWT con verificación de `isActive` y revocación por `passwordChangedAt`. |
| `auth/guards/{jwt-auth,roles,sudo,login-throttler,two-factor-throttler}.guard.ts`, `auth/sudo.ts`, `auth/two-factor-auth.service.ts` | ADAPTAR | Renombrar roles (`SUPERADMIN/OWNER/KITCHEN` → `ADMIN/ASESOR`) y el emisor 2FA ("KovalCloud", `auth.service.ts:179`). Mantener el *deny-by-default*. |
| `auth/guards/tenant.guard.ts`, `auth/tenant-access.ts`, `auth/decorators/{tenant-param,kitchen-access}.decorator.ts` | ELIMINAR | Instancia de un solo cliente, sin multi-tenancy (`restaurantId` aparece unas 480 veces). |
| `auth/auth.controller.ts`, `auth.service.ts` | ADAPTAR | Login + TOTP. Quitar el registro abierto o dejarlo solo para ADMIN. |
| `users/*` | ADAPTAR | CRUD de usuarios del panel, cambio de contraseña y activación. Quitar `branch`. |
| `scripts/create-superadmin.ts` | ADAPTAR | Crear el primer ADMIN desde variables, sin contraseña en el código. |
| `scripts/seed*.ts`, `KC/be/{force_admin,seed_admin,seed_autoreply,test_totp,test_otplib}.js`, `KC/be/7.9.1` | ELIMINAR | Datos de restaurante o basura. `force_admin.js:7` y `seed_admin.js:9` tienen **contraseñas en claro** (§5). |
| `ai/model-fallback.ts` (+ spec) | REUTILIZAR | Cadena `gemini-2.5-flash → 2.5-flash-lite → 2.0-flash`, `GEMINI_TIMEOUT_MS` (10 s), `maxRetries: 0`, salto ante 429/5xx/timeout. Verificar los nombres de modelo vigentes en la Etapa 4. |
| `ai/ai.service.ts` | ADAPTAR | Mantener el patrón `generateObject` + Zod + un reintento si el esquema no valida. Reemplazar `OrderIntentSchema` por un esquema de respuesta fuera del flujo. Quitar `reviewWebOrder` y `extractMenuFromPdf`. `transcribeAudio` es opcional (pregunta 10). |
| `meta-whatsapp/prompts/waiter.prompt.ts` | REIMPLEMENTAR | Conservar la técnica (marcadores reemplazados en una pasada, bloque anti-inyección `<instrucciones_...>`, L148-201). El contenido es de restaurante. |
| `meta-whatsapp/chat-session.ts`, `chats/chat-history.ts`, `chats/handover.ts` | REUTILIZAR | Corte de sesión a 3 h, roles del historial y pausa o reanudación del bot por marcadores. |
| `meta-whatsapp/chat-queue.ts` | ADAPTAR | Cola serial por chat en memoria. Sirve con una instancia; si el webhook pasa por BullMQ se reemplaza por un *job* con clave por `waId`. |
| `meta-whatsapp/meta-whatsapp.controller.ts` | ADAPTAR | El HMAC multi-tenant y el patrón de responder 200 y procesar aparte sirven. **Reescribir la verificación GET**: hoy acepta el *slug* o la ausencia de token (L87-104). Quitar el `console.log` del payload (L220, expone datos personales) y la rama Baileys. |
| `meta-whatsapp/meta-whatsapp.service.ts` | ADAPTAR (parcial) | Reutilizar `sendTextMessage` (L196), `downloadMedia` (L686), `extractPlainText` (L81-95, ya lee `button_reply`/`list_reply`) y `captureIncomingMedia`. ELIMINAR todo el flujo de pedido (L978-1320), menú, AutoReply y `forwardToBotpress`. Graph `v22.0` está fijo en el código: pasarlo a variable de entorno. |
| `meta-whatsapp/{order-flow,branch-choice,menu-link,quick-replies}.ts` | ELIMINAR | Restaurante. `quick-replies` sirve solo como patrón de atajo sin IA. |
| `chats/chats.controller.ts`, `chats.service.ts`, `chat-media.ts` | ADAPTAR | Historial de conversaciones y adjuntos validados por *magic bytes*. Quitar el tenant. |
| `customers/customers.service.ts` | REIMPLEMENTAR | La idea de *upsert* por teléfono pasa a `Lead`/`Contact`. El consentimiento actual es implícito y no sirve (ESP §5 exige botones explícitos). |
| `orders/phone.ts` | ADAPTAR | `normalizeColombianPhone`. Quitar `lid:` y devolver E.164. |
| `orders/orders.gateway.ts` | ADAPTAR | La autenticación del socket (JWT + revocación) y las salas sirven. Eventos nuevos: `lead:new`, `campaign:progress`, `message:new`. Restringir CORS. |
| `orders/orders-export.ts` | ADAPTAR (idea) | Rangos de fecha en Bogotá. ESP §8 pide **CSV**; KovalCloud genera xlsx. |
| `restaurants/business-hours.ts` | ADAPTAR | `isWithinBusinessHours` con `Intl` y zona horaria. Base de `isWithinSendWindow`; falta calcular la próxima apertura. |
| `restaurants/menu-spreadsheet.ts` | ADAPTAR | Importador SheetJS xlsx/xls/csv con alias de cabecera, errores por fila y máximo de filas. Base del importador de contactos. |
| `restaurants/sanitize-restaurant.ts` | ADAPTAR (idea) | `maskSecret` para mostrar en el panel la configuración sin exponer secretos. |
| `restaurants/*` (resto), `orders/*` (resto), `categories`, `menu-items`, `branches`, `delivery-zones`, `drivers`, `payments` (Wompi), `admin` (tenants), `support`, `whatsapp-gateway` | ELIMINAR | Específico de restaurante, multi-tenant o Baileys. |
| Specs `*.spec.ts` (76 archivos, unos 545 casos) | ADAPTAR (patrón) | Conservar: `model-fallback.spec`, `business-hours.spec`, `phone.spec`, `jwt-auth.guard.spec`, `token-revocation.spec`, `sudo-mode.spec`, `login-security.spec`, `meta-whatsapp.controller.spec` (HMAC real). |

### 2.3 KovalCloud – frontend Next.js (`KC/fe/src/`)

| Ruta | Decisión | Justificación |
|---|---|---|
| `package.json` (Next 16.4.3, React 19.2.8, Tailwind 4, next-themes, lucide-react, socket.io-client) | REUTILIZAR | Mismo stack (ESP §4). Quitar `qrcode.react`. |
| `KC/fe/AGENTS.md` | REUTILIZAR | Aviso de cambios incompatibles en Next 16 (`proxy` reemplaza a `middleware`). |
| `context/AuthContext.tsx`, `context/SudoContext.tsx`, `lib/sudo-token.ts`, `components/security/*` | ADAPTAR | Login con TOTP, 2FA y modo sudo. JWT en localStorage: evaluar cookie httpOnly (pregunta 8). Quitar el "Modo Dios". |
| `lib/roles.ts`, `components/layout/{navigation.ts,Sidebar.tsx,TopBar.tsx}`, `app/dashboard/layout.tsx` | ADAPTAR | Shell del panel con RBAC. Nueva navegación: Leads, Conversaciones, Contactos, Campañas, Configuración. |
| `components/theme/{ThemeProvider,ThemeToggle}.tsx` | REUTILIZAR | Claro por defecto (ESP §2). |
| `components/theme/Storefront*` | ELIMINAR | Carta pública. |
| `app/globals.css` | ADAPTAR | Conservar el bloque `.koval-dashboard` (renombrarlo) y quitar los temas de la carta. Tokens nuevos: azul marino, dorado y blanco. |
| `app/login/*` | ADAPTAR | Textos y marca. |
| `app/dashboard/page.tsx`, `lib/orderMetrics.ts` | REIMPLEMENTAR | Métricas de leads y campañas. |
| `app/dashboard/chats/page.tsx`, `components/chats/ChatMedia.tsx` | ADAPTAR | Bandeja de dos paneles con *handover* y aviso de ventana de 24 h. Es la vista de conversaciones. Hoy refresca cada 10 s; pasar a socket. |
| `app/dashboard/whatsapp/page.tsx` (pestaña Meta) | ADAPTAR / ELIMINAR | Si las credenciales van en variables de entorno (recomendado, §01), queda solo una vista de estado (calidad, tier, webhook OK). Pestaña QR: ELIMINAR. |
| `app/dashboard/settings/{settings-ui,MyAccountSection,TeamSection,ScheduleCards,schedule-blocks,CustomInstructionsCard,useRestaurantSettings}.tsx/ts`, `lib/business-hours.ts` | ADAPTAR | Pestañas de configuración, cuenta, equipo, **editor de ventanas semanales** y textos del bot. |
| `app/dashboard/settings/{Branches,Drivers,DeliveryFee*,Menu*,Brand*,Banner*,Wompi*,WhatsAppConnection*,LocalData*}` | ELIMINAR | Restaurante o Baileys. |
| `components/menu/MenuImportModal.tsx` | ADAPTAR | UI de importación con plantilla descargable y errores por fila. Base del importador de contactos. |
| `components/orders/ExportOrdersButton.tsx` | ADAPTAR | Presets de fecha y descarga como *blob*. Base del botón de exportación a CSV. |
| `utils/audio.ts` | REUTILIZAR | Pitido de lead nuevo. |
| `lib/whatsapp.ts`, `lib/useIsMobileDevice.ts` | REUTILIZAR | `toWhatsAppNumber` sirve para el botón wa.me de la landing. |
| `proxy.ts`, `lib/tenant.ts`, `app/admin/*`, `app/menu/*`, `app/kitchen/*`, `app/dashboard/{menu,orders,qr,support}`, `components/{cart,storefront,orders,menu/DishImageField,admin}`, `context/CartContext.tsx`, `lib/{menu-themes,order-number,customer-phone,support-tickets}.ts` | ELIMINAR | Restaurante o multi-tenant. |
| `app/page.tsx` (redirige a `/login`) | NUEVO | **No existe landing**: se construye desde cero (Etapa 3). |
| Patrón `const API_URL = ...` (unas 30 copias) | REIMPLEMENTAR | Un único `lib/api.ts`. |

### 2.4 Módulo Django de masivos (`DJ/`)

Ningún archivo se copia (Python → TypeScript y otro cliente). Las decisiones se refieren a la **mecánica**.

| Ruta | Decisión | Mecánica genérica que se reimplementa |
|---|---|---|
| `DJ/O/models.py:352-461` (CampanaMasiva, DestinatarioCampana) | REIMPLEMENTAR | Campaña con plantilla e idioma; un registro por destinatario con `wamid`, estado, error (código, categoría, detalle) y marcas de tiempo. Corregir: falta `unique(campaña, contacto)` y los estados no están declarados. |
| `DJ/O/services.py:568-627` (`enviar_plantilla_whatsapp`) | REIMPLEMENTAR | POST `/{phone_id}/messages` `type: template` con `components.body.parameters` posicionales. Agregar HEADER y botones si las plantillas los usan. |
| `DJ/O/views.py:4876-4950` (listar plantillas) | REIMPLEMENTAR | GET `/{waba_id}/message_templates?status=APPROVED`. Corregir: paginar y no enviar el token en la *query string*. |
| `DJ/O/tasks.py:736-1222` (`procesar_envio_masivo_real`) | REIMPLEMENTAR | Lotes con concurrencia acotada, throttling adaptativo (lento/normal/rápido según errores de infraestructura), backoff solo para infraestructura, persistencia por lote y cancelación revisada cada N lotes. Agregar jitter (ESP §7.2), límite diario global y revalidación de la ventana **en cada envío**. |
| `DJ/O/meta_errors.py` | REIMPLEMENTAR | Glosario código de Meta → categoría (cliente, usuario_meta, cuenta_waba, plantilla, infraestructura). Corregir: reconocer 429/130429/131056/5xx como reintentables y que 131047 **no** sea "saldo". |
| `DJ/O/views.py:54-262` (webhook) | REIMPLEMENTAR | HMAC con comparación en tiempo constante, 200 incluso con firma inválida (con un contador de alarma) y enrutamiento de `statuses` y `messages` a colas distintas. |
| `DJ/O/tasks.py:271-341` (statuses) | REIMPLEMENTAR | Match por `wamid` con orden monótono (sent < delivered < read; failed es terminal). En Django el orden solo se aplica a Mensaje, no al destinatario: corregir. |
| `DJ/O/tasks.py:397-431` | REIMPLEMENTAR | Deduplicación de `wamid` entrante con TTL de 24 h y descarte de mensajes viejos (anti-replay). |
| `DJ/O/views.py:4955-5020, 8846-8906` | REIMPLEMENTAR | Embudo por campaña (enviados, entregados, leídos, fallidos) y errores más frecuentes. |
| `DJ/O/views.py:9419-9466` | REIMPLEMENTAR | Consulta de `quality_rating` / `messaging_limit_tier`. Agregar: **frenar** la campaña si la calidad pasa a RED (hoy solo se muestra). |
| `DJ/O/seguridad.py:410-456`, `DJ/O/services.py:630-667` | REIMPLEMENTAR | Idea de ventana horaria y festivos. Pasa a tablas `SendWindow` y `Holiday` editables (ESP §7.2). |
| `DJ/src/app/masivo/components/TabNuevoEnvio.tsx:200-262` | REIMPLEMENTAR | Limpieza de BOM y *trim* de cabeceras. Se mueve al backend (el original manda todas las filas en un solo JSON y el back exige la columna `telefono` exacta). |
| `DJ/src/app/masivo/components/{TabHistorialEnvio,ErrorEnvioModal}.tsx` | REIMPLEMENTAR (UX) | Historial con embudo, detalle paginado por destinatario, CSV y modal de error. |
| `DJ/docker-compose.yml:243-370` | REIMPLEMENTAR (idea) | Colas separadas (envío, estados, entrantes). En BullMQ son colas distintas en un mismo worker. |
| `DJ/O/fields.py`, `rotar_llave_encriptacion.py` | REIMPLEMENTAR (idea) | Cifrado de campos con prefijo de versión y rotación. Aplicarlo a `User.twoFactorSecret`; los tokens de Meta van en el entorno. |
| `DJ/O/ofuscacion.py` | REIMPLEMENTAR (idea, opcional) | Enmascarar teléfono y correo en listados y exportaciones, con auditoría al revelarlos. |
| `DJ/O/management/commands/simular_masivo.py` | REIMPLEMENTAR (idea) | Modo *dry-run* para probar ritmo y ventanas sin llamar a Meta (Etapa 6). |
| `DJ/O/models.py:941` (Solicitud), `DJ/src/app/components/chat/EnviarPlantillaModal.tsx` | ELIMINAR | Flujo de aprobación supervisor/asesor; con pocos usuarios no hace falta. |
| Botpress (`DJ/O/services.py:85-186`, `bot_admin.py`, `signals.py`), `asignaciones_bases/`, `bot_asesorar/`, `utils_rr.py`, comandos `*rr*`, `importar_rr_falabella`, `seed_cartera_propia`, `setup_asesorar`, `sync_*`, `users_db.py`, `tipificacion_providers.py`, `Comprobante`, `RespuestaRapida`, costos de WABA (`views.py:9280-9300`), `rr_dump.txt`, `rr_full.json`, `*.xlsx`, `db.sqlite3`, `celerybeat-schedule` | ELIMINAR | **Específico del otro cliente.** No se reutiliza lógica, texto, plantilla ni dato. |
| `DJ/src/app/{bot,chat,supervisor}/**`, `DJ/stack.sh`, `DJ/nginx/*` | ELIMINAR | Panel de asesores y supervisores del otro cliente; KovalCloud ya cubre el panel. |

### 2.5 NUEVO (no existe en ninguna fuente)

| Pieza | ESP |
|---|---|
| Landing pública con identidad JurisGlobal, formulario y botón wa.me | §3.1, §2 |
| API única de leads `POST /public/leads` (validación, normalización +57, deduplicación por teléfono, consentimiento, notificación) | §5 |
| Registro de consentimiento con versión y texto aceptado, canal, fecha y evidencia (IP/UA o `wamid`) | §5, §7.2, §11 |
| Flujo del chatbot como máquina de estados con botones Acepto/No acepto, lista de motivos y confirmación | §6.2 |
| Envío de mensajes **interactivos** (`button`, `list`) y de **plantillas** por Cloud API | §6.2, §7.1 |
| Persistencia de estados de entrega y deduplicación por `wamid` | §7.2 |
| Detección de STOP/baja (palabras clave + botón de baja de la plantilla + error 131050) y lista de supresión global | §6.3, §7.2 |
| Ventanas por día (`SendWindow`), festivos de Colombia (`Holiday`), tope por contacto, límite diario y programador de cola con jitter | §7.2 |
| Importador de contactos con origen y registro de autorización por contacto | §7.1, §7.2 |
| Notificación por correo de lead nuevo (no hay SMTP en KovalCloud) | §8 |
| Panel de leads (filtros, detalle, estado, notas, responsable, CSV) y configuración (motivos, precio, ventanas, festivos, textos, correo) | §8 |
| Tabla `Setting` editable (precio de asesoría, textos del bot, correos) | §8, §10.2 |
| Bitácora de auditoría (quién exportó, cambió el estado o lanzó una campaña) | §11 (recomendado) |

---

## 3. Brechas contra la especificación

| # | Requisito (ESP) | KovalCloud | Django | Qué se construye |
|---|---|---|---|---|
| 1 | API única de leads §5 | No hay; `customers.touch` hace *upsert* por teléfono | No | Endpoint público con *rate limit*, validación DTO, E.164, deduplicación por teléfono (actualizar y no duplicar, §6.3), consentimiento en transacción y notificación. |
| 2 | Consentimiento explícito §5 | Implícito ("al continuar autorizas", `customers.service.ts:9-10`) | No existe | Tabla `Consent` + texto versionado en `Setting`. En WhatsApp, botones Acepto/No acepto **antes** de pedir datos. |
| 3 | Webhook Cloud API §4 | Existe, con verificación GET débil, sin estados ni deduplicación | Existe, con HMAC correcto | Reescribir: verificar `hub.verify_token`, HMAC obligatorio, `wamid` único, colas para `messages` y `statuses`. |
| 4 | Botones y listas §6.2 | Solo lee la respuesta (`extractPlainText`) | No | `sendInteractiveButtons` (máx. 3 botones) y `sendInteractiveList` (máx. 10 filas); verificar límites vigentes en la Etapa 4. |
| 5 | Flujo guiado + Gemini fuera del flujo §6 | El flujo es de pedidos con IA en el centro | Botpress | Máquina de estados determinista; Gemini solo para preguntas fuera del flujo, con la regla de no asesorar (pregunta 9). |
| 6 | STOP/baja §6.3, §7.2 | No | No (131050 se clasifica pero no se guarda) | Palabras clave + botón de la plantilla + 131050 → `Contact.optedOutAt`, confirmación al usuario y exclusión en el armado y en el envío. |
| 7 | Ventanas por día §7.2 | Horario semanal (`business-hours.ts`) para el bot, no para envíos | Fija en el código, solo al crear la campaña | `SendWindow` editable + `nextOpening()`; el worker revalida antes de cada envío. |
| 8 | Festivos y domingos §7.2 | No | Muerto (falta `holidays`) | `Holiday` con semilla de festivos de Colombia (Ley 51/1983 + Pascua) editable desde el panel; domingos bloqueados por defecto. |
| 9 | Tope por contacto §7.2 | No | No (solo deduplicación dentro de la campaña) | `Setting` `maxPerContact` / `periodDays`, revisado al armar y al enviar. |
| 10 | Cola y ritmo con jitter y límite diario §7.2 | No hay cola (Redis sin uso) | Celery + gevent, pausa fija, sin límite global | BullMQ en Redis (`noeviction`): *dispatcher* periódico + worker con limitador global por número, jitter y tope diario. |
| 11 | Estados por campaña §7.2 | Solo se registran en el log | Existe (con bugs) | `CampaignMessage` + orden monótono + embudo. |
| 12 | Respuesta a campaña → chatbot §7.2 | n/a | Cae a Botpress; no marca "respondió" | Marcar `repliedAt` y entrar al flujo del bot (pedir consentimiento si falta). |
| 13 | Plantillas de marketing §7.1 | No hay | Lista solo BODY, sin paginar | Sincronización de plantillas (`MessageTemplate`), mapeo de variables y vista previa. La creación y aprobación se hacen en el WhatsApp Manager de Meta (pendiente ESP §13.7). |
| 14 | Importador de contactos §7.1 | Importador de menú adaptable | Parseo en el navegador | Importador en el backend: xlsx/csv, alias de columnas, E.164, deduplicación, origen y autorización por fila, reporte por fila, `ContactImport`. |
| 15 | Panel de leads §8 | No | No | Listado con filtros y búsqueda, detalle, estado, notas, responsable y CSV. |
| 16 | Correo de lead nuevo §8 | No hay SMTP | No | Módulo `notifications` (SMTP o proveedor; pregunta 6) con reintento en cola. |
| 17 | Configuración §8 | Pestañas de ajustes adaptables | No | Motivos, precio de asesoría, ventanas, festivos, textos del bot, correo de notificación. |
| 18 | Landing §3.1 | No existe (`/` → `/login`) | No | Etapa 3. |
| 19 | Textos legales §11 | No | No | Páginas `/privacidad`, `/terminos` y `/cookies` con contenido provisional y versión referenciada desde `Consent`. |
| 20 | Aislamiento §4 | Comparte servidor | n/a | `name: jurisglobal`, red, volúmenes, puertos y túnel propios (§01-3). |

---

## 4. Riesgos

### 4.1 Técnicos

1. **Choque con KovalCloud en producción.** Corre en este VPS (`kovalcloud-*`, `127.0.0.1:80`, red `kovalcloud_koval_network`). Un `docker compose` lanzado desde la carpeta equivocada, o un `container_name` repetido, puede tumbarlo. Mitigación: `name: jurisglobal`, sin `container_name`, otro puerto y un `Makefile` con `-p jurisglobal` fijo.
2. **Redis con desalojo.** BullMQ exige `maxmemory-policy noeviction`; Django usa `allkeys-lru` (`DJ/docker-compose.yml:66`), que puede perder trabajos. Con AOF activo.
3. **Programación con ETA largo** (patrón de Django `apply_async(eta=…)`). Puede perderse o repetirse. Mitigación: la "verdad" vive en Postgres (`CampaignMessage.status`); un *dispatcher* cada minuto encola solo lo que cabe en la ventana actual.
4. **Webhooks duplicados.** Meta reintenta y KovalCloud no deduplica (solo procesa `entry[0].changes[0].messages[0]`). Mitigación: `Message.waMessageId @unique` y recorrer todos los `entry`/`changes`.
5. **Versión de Graph fija** (`v22.0` en KovalCloud y Django). Mitigación: `WHATSAPP_GRAPH_VERSION` como variable; verificar la versión vigente en la Etapa 4.
6. **Nombres de modelo de Gemini** fijos (`model-fallback.ts:10-11`). Pueden quedar obsoletos; configurables por entorno.
7. **Estado en memoria** (throttler, `ChatQueue`) en KovalCloud. Funciona con una instancia; al separar API y worker, el estado compartido pasa a Redis.
8. **Next 16** cambia APIs (`KC/fe/AGENTS.md`); hay que leer la documentación incluida en `node_modules/next/dist/docs/` antes de escribir el frontend.
9. **Bugs del Django que no deben replicarse:**
   - Las campañas LIBRE nunca guardan el wamid: la función devuelve 2 valores y la tarea lee `res[2]` (`DJ/O/services.py:235` frente a `DJ/O/tasks.py:870`).
   - 131047 se toma como "saldo agotado" y corta la campaña (`DJ/O/services.py:619`).
   - `PAUSADA_HORARIO` no se reanuda nunca.
   - Errores síncronos sin `[code]`, así que se clasifican como "desconocido".
   - Endpoints sin verificación de dueño (IDOR) y permisos `masivo.*` que no se aplican.
10. **Costo y límites de Meta.** Las plantillas de marketing se cobran por mensaje. El *tier* del número limita los destinatarios únicos por 24 h, y Meta además limita los mensajes de marketing por usuario (error 131049). 2.000 contactos pueden requerir varios días. Mitigación: límite diario configurable y lectura del *tier*.

### 4.2 Cumplimiento

1. **Origen de la base de 2.000.** "Autorización vigente de una consultoría" (ESP §7.1) no implica autorización para que **JurisGlobal** envíe **marketing por WhatsApp** (Ley 1581: autorización previa, expresa e informada, por responsable y finalidad). Si no hay prueba, el primer contacto debería ser solo para obtener el consentimiento, o no enviar. Pregunta 4.
2. **Alcance de la Ley 2300 de 2023** (verificado en el texto de la compilación de la DIAN, `normograma.dian.gov.co/dian/compilacion/docs/ley_2300_2023.htm`, vigente desde el 10-oct-2023):
   - Art. 3: lunes a viernes de 7:00 a 19:00, sábados de 8:00 a 15:00, nunca domingos ni festivos. Frecuencia máxima de "una ocasión durante el mismo día" y no por varios canales en la misma semana. **El texto se refiere a la gestión de cobranza.**
   - Art. 5, parágrafo 3: los mensajes **publicitarios** por SMS, aplicaciones, web o correo "solo podrán" enviarse en los horarios del art. 3.
   - Art. 5, parágrafo 2: aceptación explícita y un mecanismo "ágil, sencillo y eficiente" de cancelación.
   - Conclusión preliminar: el horario aplica al marketing; el tope de frecuencia no está en el texto para publicidad, así que el valor del tope es una decisión de negocio (pregunta 5).
   - Si en el futuro se activa la cobranza de cartera, aplican además los art. 2-4 y 6 completos.
   - *El análisis jurídico definitivo es de los abogados de la firma.*
3. **Textos de autorización con otra empresa** (ESP §5): riesgo de publicar el texto equivocado. Mitigación: texto versionado en `Setting` y verificación previa a publicar (Etapa 7).
4. **Publicidad de servicios jurídicos** (ESP §11): el bot y las plantillas no deben prometer resultados. El *prompt* de Gemini debe prohibirlo explícitamente y las respuestas fuera del flujo deben ser breves y redirigir al formulario.
5. **Datos personales en logs.** KovalCloud imprime el payload completo (`meta-whatsapp.controller.ts:220`). Mitigación: logger con redacción de teléfono y correo.
6. **Derechos del titular** (consulta, rectificación, supresión, Ley 1581): no hay ninguna función. Proponer en el panel "eliminar/anonimizar contacto" y exportar sus datos (pregunta 14).
7. **Ley 1266 de 2008** (centrales de riesgo): en el MVP solo es un motivo de contacto; no se tratan datos crediticios.

---

## 5. Secretos detectados (solo ubicación; no se copió ningún valor)

| Archivo | Tipo |
|---|---|
| `KC/.env` | Archivo de secretos real. **No se abrió.** |
| `KC/be/force_admin.js:7` | Contraseña de admin en claro. |
| `KC/be/seed_admin.js:9` | Contraseña de admin en claro (además la imprime en el log). |
| `KC/backup_db.sh:6` | Contraseña de la BD (está en `.gitignore`). |
| `KC/be/src/config/secrets.ts:4` | Comentario: hay secretos antiguos en el historial de git. |
| `KC` Prisma `Restaurant.whatsappToken`, `metaAppSecret`, `wompi*`, `User.twoFactorSecret` | Secretos guardados en claro en la BD (diseño). |
| `DJ/chatbots_ccob/chatbots_ccob/settings.py:29` | `SECRET_KEY` con valor por defecto literal. |
| `DJ/O/views.py:9286` | Meta App Secret por defecto literal (otro cliente). |
| `DJ/O/management/commands/setup_asesorar.py:22-24` | Contraseñas por defecto y verify token. |
| `DJ/chatbots_ccob/db.sqlite3` | Puede contener tokens y hashes; solo se leyó el esquema. |
| `DJ/chatbots_ccob/.env` | 0 bytes. |

Recomendación para KovalCloud (fuera de este proyecto): eliminar `force_admin.js` y `seed_admin.js` y rotar esas contraseñas.

---

## 6. Contraste de `KC/radiografia-codigo.md` y `KC/README.md` con el código

| Afirmación | Realidad | Evidencia |
|---|---|---|
| `radiografia-codigo.md` como radiografía del código | Es la definición de una *skill* ("escanear antes de proponer cambios"), no un inventario. Lo que describe (schema, controladores, rutas del front) coincide con la estructura real. | `KC/radiografia-codigo.md` |
| "Microservicios" | Monolito NestJS + un servicio Express (Baileys). | `KC/be/src/app.module.ts`, `KC/whatsapp_service/src/server.ts` |
| "Motor de NLU" | Gemini vía Vercel AI SDK; Botpress muerto. | `KC/be/package.json` (`ai`, `@ai-sdk/google`), `KC/botpress/` |
| Redis/BullMQ (comentario en el compose) | No hay cliente de Redis ni BullMQ en el backend. | `KC/docker-compose.prod.yml:37`, `KC/be/package.json` |
| Prisma 5, Next 16, NestJS 11, PostgreSQL 15 | Coinciden (5.22, 16.4.3, ^11, `postgres:15`). | `package.json`, compose |
| README completo | Truncado en "microservicios y contenedores:"; el badge MIT apunta a un `LICENSE` que no existe. | `KC/README.md:26` |
| `start.sh` anuncia 5 contenedores y puertos 5432/5000 | La compose base no publica esos puertos; usa la base, no la de prod. | `KC/start.sh:30-40` |
| `whatsapp_service` "conexión a Botpress v12" | `botpressBridge.ts` no se importa en ningún lado. | `KC/whatsapp_service/package.json`, `src/botpressBridge.ts` |
| Subdominios por restaurante | `TENANT_ROOT_DOMAINS` no está en ninguna compose ni en `.env.example`. | `KC/fe/src/lib/tenant.ts` |
| Nombre del servicio Baileys | `koval_baileys` en la compose frente a `whatsapp_baileys` por defecto en el código. | `KC/docker-compose.yml`, `meta-whatsapp.service.ts:76` |

---

## 7. Preguntas abiertas

1. **Fuente Django:** ¿confirmas que `./referencias/chat_1/chat` es el "módulo Django de masivos"? (la ruta `./referencias/django-masivos` no existe). Incluye también un Next (`src/app/masivo`) que revisé.
2. **Servidor y Cloudflare:** ¿la instancia va en este mismo VPS donde corre KovalCloud en producción? ¿Túnel de Cloudflare **propio** (recomendado) o un hostname nuevo en el túnel existente? ¿Cuál es el dominio de pruebas?
3. **Meta:**
   - ¿Ya existen la app de Meta, la WABA y el número registrado en Cloud API? El número no puede estar activo en la app de WhatsApp.
   - ¿La app es de JurisGlobal o del desarrollador?
   - ¿El negocio ya está verificado?
   - ¿Qué *tier* de mensajería tiene hoy el número?
   - ¿Quién paga las conversaciones de marketing?
4. **Base de 2.000:**
   - ¿Hay prueba de que la autorización cubre a JurisGlobal y el WhatsApp de marketing?
   - ¿Qué columnas trae?
   - Si no hay prueba, ¿aceptas que la primera campaña sea solo para pedir el consentimiento, o que se excluyan esos contactos?
5. **Tope por contacto:** la Ley 2300 no fija frecuencia para publicidad. ¿Qué valor inicial? Propuesta: 1 mensaje por día y 2 por semana. ¿Y qué límite diario total? Propuesta: 250 al día hasta conocer el *tier*.
6. **Correo:** ¿SMTP (por ejemplo, una contraseña de aplicación de Gmail) o un proveedor transaccional? ¿A qué dirección van las notificaciones (ESP §13.9)?
7. **Ventanas horarias:** ¿una franja por día (como dice la ESP) o varias (el editor de KovalCloud permite 3)? ¿Arrancan con los valores de la Ley 2300 (L-V 7-19, sáb 8-15)?
8. **Sesión del panel:** ¿se mantiene el JWT en localStorage como KovalCloud, o se pasa a una cookie httpOnly (recomendado para datos personales)? ¿2FA obligatorio para todos?
9. **Chatbot:** ¿apruebas un flujo **determinista** (botones y validaciones) con Gemini solo para preguntas fuera del flujo (recomendado)? ¿O prefieres el estilo de KovalCloud, con la IA extrayendo los datos?
10. **Alcance del bot:** ¿se atienden notas de voz con transcripción (KovalCloud lo hace) e imágenes o documentos? ¿O el bot responde que solo procesa texto?
11. **Bandeja y atención humana:** ¿el MVP incluye ver conversaciones en el panel y responder a mano (adaptando `dashboard/chats`)? La ESP §8 no lo lista.
12. **Roles del panel:** ¿bastan ADMIN (socios) y ASESOR (equipo)? ¿Quién puede exportar CSV y lanzar campañas?
13. **Versiones:** ¿mantener las mismas de KovalCloud (Prisma 5.22, Nest 11, Next 16) para copiar con menos fricción (recomendado)? ¿O subir a Prisma 6/7?
14. **Derechos del titular:** ¿el panel debe permitir suprimir o anonimizar un contacto o lead a pedido del titular?
15. **Precio de la asesoría:** ¿dónde se muestra (landing, bot, ambos)? ¿Se muestra mientras el valor esté "por confirmar"?
16. **Repositorio:** `./` no es un repo git. ¿Lo inicializo en la Etapa 1? ¿Hay un remoto (GitHub) previsto?
17. **Clave de Gemini:** ¿una nueva y exclusiva de JurisGlobal (recomendado por aislamiento) o la misma de KovalCloud?
