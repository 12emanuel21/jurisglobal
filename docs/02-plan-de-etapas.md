# 02 · Plan de etapas 1 a 7

Este plan ajusta la ESP §12 a lo encontrado en la Etapa 0 (ver `00-mapa-reutilizacion.md` y `01-propuesta-estructura-y-esquema.md`).

Reglas de trabajo en todas las etapas:
- Nunca se toca `~/dev/kovalcloud` ni sus contenedores. El código de KovalCloud se **copia y adapta** dentro de `./`; no se comparten imports.
- Todo `docker compose` se ejecuta con `-p jurisglobal` (desde el `Makefile`).
- Cada etapa termina con sus pruebas en verde y una demostración. Se espera la aprobación antes de pasar a la siguiente.

**Tareas externas que deben arrancar ya**, porque tienen tiempos de espera fuera de nuestro control:
- (a) Confirmar la app de Meta, la WABA, el número en Cloud API y la verificación del negocio (pregunta 3).
- (b) Redactar las plantillas de marketing **con opción de baja** y enviarlas a aprobación (ESP §13.7).
- (c) Obtener la prueba de autorización de la base de 2.000 contactos (pregunta 4).
- (d) Crear el túnel y el hostname de Cloudflare de pruebas.

---

## Etapa 1 · Bases del monorepo — ✅ completada el 22-nov-2026 (pendiente de tu aprobación)

El alcance se amplió según tus respuestas a la Etapa 0. Además de las bases, se portó desde KovalCloud el código reutilizable:

- Autenticación: cookie `httpOnly`, 2FA y modo sudo.
- Cliente oficial de Cloud API: texto, botones, listas, plantillas, documentos, descarga de adjuntos y marcar como leído.
- Webhook estricto.
- Inbox multimedia: backend y página del panel.
- Gemini con fallback.
- Ventanas semanales y festivos.
- Importador xlsx/csv de contactos (solo el parser).
- El **esquema de Prisma completo** con su migración inicial, y el *seed* idempotente.

Lo que se movió de etapa:
- `worker.ts` y BullMQ pasan a la Etapa 6, cuando haya trabajos que encolar.
- Hoy el webhook procesa en el mismo proceso, con la cola serial por chat de KovalCloud.

Resultado verificado:
- Levanta con un comando (`./jg dev` o `./jg up`). El servidor no tiene `make`, por eso se agregó `./jg`.
- `/health` responde `{db: ok, redis: ok}` directo y vía nginx.
- Responden la web pública, el login y el panel (con redirección al login si no hay sesión).
- `prisma migrate deploy` corre sin migraciones pendientes y el *seed* es idempotente en dev y en prod.
- 79 pruebas en verde (17 suites); tipos y lint limpios en backend y frontend.
- Las imágenes de producción compilan y arrancan con *healthcheck* sano.
- KovalCloud quedó intacto: mismos contenedores, mismas horas de arranque y 0 reinicios.

## Ajustes al plan por las decisiones de la Etapa 0

- **Etapa 3 (landing) y Etapa 4 (bot):** leen `showConsultationPrice` y `consultationPrice`. Con el interruptor apagado no muestran ningún valor y nunca dicen «gratis» (un asesor confirma las condiciones); encendido, muestran el valor configurado. La edición se hace en la Etapa 5 (Configuración).
- **Etapa 4:** el Inbox, la descarga y validación de adjuntos y la transcripción de notas de voz ya están hechos. Queda conectar el flujo del bot en el punto marcado en `webhook.processor.ts`.
- **Etapa 5:** el Inbox ya existe. Faltan los leads, la configuración (con el interruptor de precio), los usuarios y la **anonimización por ADMIN** (Ley 1581): borra nombre, correo y teléfono del lead o contacto, conserva `Consent` con `phoneHash` y la supresión, y queda auditada.
- **Etapa 6:** el importador exige Origen y Autorización. Los lotes sin soporte documental para JurisGlobal quedan `UNVERIFIED` y solo admiten campañas `OPT_IN` (confirmación) antes de cualquier marketing. Topes iniciales: 1/día, 2/semana y 250/día.

## Etapa 2 · API de leads y modelo de datos — ✅ completada el 22-nov-2026 (pendiente de tu aprobación)

Lo construido:
- `GET /api/public/config`: motivos activos ordenados, `showConsultationPrice` y `consultationPrice` (solo con el interruptor encendido), enlaces legales (`legal.links`), textos y versión de las autorizaciones, y nombre y lema de la empresa. Se cachea 60 s.
- `POST /api/leads`: formulario unificado.
  - Valida con DTO y rechaza campos desconocidos.
  - El teléfono se normaliza de forma estricta a Colombia: celular `3xx` o fijo `60x`. Se guarda como `57XXXXXXXXXX` (igual que el `wa_id` de WhatsApp, para deduplicar entre web y bot) y la API lo expone como `+57XXXXXXXXXX`.
  - El motivo se acepta por id o por nombre, solo si está activo.
  - Exige las dos autorizaciones y registra un `Consent` por cada una, con versión, texto exacto, IP y user-agent.
  - Rechaza `origin: "whatsapp"` desde Internet (403): el bot usa `LeadsService.submit()` internamente.
  - Tiene un *honeypot* (`website`) y límite por IP: `LEADS_RATE_LIMIT` en Nest más `limit_req` en nginx.
  - La respuesta es idéntica para lead nuevo y recontacto, así no revela si un número ya está registrado.
- Recontacto:
  - No duplica ni sobrescribe: solo completa campos vacíos, deja una **nota automática** con lo que difiere y suma `submissionCount`.
  - Agrega consentimientos nuevos y crea o enlaza el `Contact` (y la conversación, si viene de WhatsApp).
- Avisos:
  - Correo HTML y texto en español: wa.me, mailto, motivo, origen y enlace al panel.
  - Se envía sin bloquear, con 3 intentos (0 s, 5 s, 30 s). Un SMTP caído nunca impide guardar.
  - Destinatarios: `notify.leadEmails` (Configuración) y, si está vacío, `LEAD_NOTIFICATION_EMAIL`.
  - Socket.io emite `lead:new` o `lead:updated`.
- Sin SMTP configurado la API arranca y advierte.

Pruebas:
- 107 unitarias (20 suites).
- 24 de integración contra PostgreSQL real (base `jurisglobal_test`, creada y migrada automáticamente) con SMTP simulado.
- Lint y tipos limpios. Las imágenes de producción compilan y arrancan.

**Qué se construye** (plan original)
- Prisma: `Motivo`, `Lead`, `LeadNote`, `Consent`, `Contact` (mínimo: teléfono, nombre, fuente y baja).
- Semilla con:
  - los motivos Tránsito, Cartera, Deudas y Otro;
  - los textos de autorización v1 a nombre de **JurisGlobal**;
  - los ajustes `advisory.price` y `notify.emails`.
- `common/phone.ts`: E.164 para Colombia, adaptado de `KC/be/src/orders/phone.ts`, con pruebas.
- `POST /api/public/leads`:
  - DTO validado (nombre, teléfono, correo, `motivoId` activo y dos autorizaciones obligatorias);
  - *rate limit* en Redis;
  - captcha opcional;
  - *upsert* por teléfono (actualiza, incrementa `submissionCount` y `lastOrigin`);
  - un `Consent` por autorización con `textVersion`, `textSnapshot` y evidencia (IP y UA);
  - todo en una sola transacción;
  - evento `lead.created` / `lead.updated`.
- `LeadsService.submit()` es el **mismo servicio** que usará el chatbot, con canal = WHATSAPP.
- `notifications/`: cola `mail` con correo de lead nuevo, reintentos y plantilla sobria sin datos de más.
- `GET /api/public/form-config`: motivos activos y textos de autorización vigentes.

**Terminado cuando**
- Las pruebas cubren: alta nueva, duplicado por teléfono (actualiza sin duplicar), correo inválido, motivo inactivo, autorización faltante (400), normalización de los formatos `300…`, `+57 300…`, `57300…` y `0300…`, y un `Consent` guardado con el texto exacto.
- Con `curl`, el lead aparece en la BD y el correo llega al buzón configurado.
- Superar el *rate limit* devuelve 429.

## Etapa 3 · Landing y formulario — ✅ completada el 22-nov-2026 (pendiente de tu aprobación)

Lo construido:
- **Landing `/`** (estática, *mobile-first*), con estas secciones:
  - encabezado con navegación y WhatsApp;
  - hero con propuesta de valor y bloque dinámico de la asesoría inicial;
  - servicios: Tránsito como foco, Cartera, Deudas y Orientación jurídica general, con redacción prudente y aviso de que no es asesoría;
  - «Por qué JurisGlobal», con valores y socios fundadores;
  - formulario unificado;
  - banda de cierre, pie de página y botón flotante de WhatsApp.
- **Precio de la asesoría:** el bloque lee `GET /api/public/config`. Con el interruptor encendido muestra `$100.000 COP`; apagado, sin valor o sin configuración, muestra un llamado neutro, sin decir «gratis».
- **Formulario:**
  - Motivos y textos de autorización vivos, con enlaces legales.
  - Validación por campo: teléfono `+57` (celular `3xx` o fijo `60x`), correo y nombre.
  - Honeypot, avisos de 429 y 400, y tarjeta de confirmación.
  - Las tarjetas de servicio preseleccionan el motivo.
- **Logotipo vectorial provisional** en `components/brand/Logo.tsx`: globo, apretón de manos estilizado y flecha dorada. Para usar el archivo final basta con reemplazar ese componente.
- **Páginas legales provisionales** `/legal/privacidad`, `/legal/terminos` y `/legal/cookies`, marcadas como borrador para revisión jurídica. `legal.links` ahora apunta a esas rutas.
- **Datos públicos** por `NEXT_PUBLIC_*`, incrustados al compilar mediante *build args* del compose; los valores son provisionales.
- Se corrigieron dos fallos detectados al probar en el navegador:
  - `allowedDevOrigins` ahora incluye `127.0.0.1`. En desarrollo, el panel y la landing no se hidrataban al entrar por nginx.
  - `AuthProvider` pasó del layout raíz al login y al panel. La landing ya no consulta `/auth/profile`, que daba 401 en la consola.

Pruebas:
- **Frontend:** 27 pruebas con Vitest + Testing Library.
- **Backend:** 107 unitarias y 24 de integración.
- **Navegador real:** Chromium con Playwright contra nginx, en desarrollo y producción:
  - sin errores en consola;
  - sin scroll horizontal y con los botones de 44 px o más;
  - el WhatsApp flotante se oculta sobre el formulario;
  - el envío real responde 201.
- **Lighthouse móvil (producción):** accesibilidad 96, buenas prácticas 96, SEO 100, rendimiento 83. El único aviso de contraste es el «GLOBAL» dorado del logotipo, que las WCAG eximen como parte de la marca; se revisará con el logo oficial.

**Qué se construye** (plan original)

**Qué se construye**
- Landing *mobile-first* con:
  - perfil de la firma, servicios y modalidades (virtual y presencial);
  - CTA y botón wa.me (`WHATSAPP_DISPLAY_NUMBER`);
  - lema y cierre (ESP §2);
  - botones de 44 px como mínimo;
  - español de Colombia.
- Formulario conectado a `form-config` y `public/leads`:
  - las dos autorizaciones con enlaces a `/privacidad`, `/terminos` y `/cookies` (páginas provisionales);
  - estados de envío y error;
  - página de gracias.
- Revisión de redacción según la ESP §11: sin promesas de resultado y "sin costo" solo si `advisory.isFree`.
- Metadatos SEO básicos, favicon y logo (pendiente recibir el archivo).

**Terminado cuando**
- Un envío desde el celular crea el lead con origen WEB y dos `Consent`, y llega el correo.
- Lighthouse en móvil: accesibilidad ≥ 90 y sin errores de consola.
- Los textos de autorización dicen JurisGlobal y se toman de la configuración, no del código.
- No aparecen los datos de contacto de relleno (ESP §2), o quedan marcados como provisionales en variables.

## Etapa 4 · Chatbot de WhatsApp (Cloud API) — ✅ completada el 22-nov-2026 (pendiente de tu aprobación)

Lo construido:
- **Flujo determinista** (`backend/src/chatbot/flow.ts`, lógica pura, y `chatbot.service.ts`), con el estado y los datos temporales en `Conversation.flowState` / `flowData`:
  - `IDLE → ASK_CONSENT → ASK_NAME → ASK_EMAIL → (ASK_PHONE) → ASK_MOTIVO → DONE`.
  - Saludo con la identidad de JurisGlobal y autorización (Ley 1581) con botones **Acepto / No acepto** y el enlace al Aviso de Privacidad, en un solo mensaje interactivo.
  - «Acepto» registra el `Consent` en ese momento (canal WHATSAPP, texto exacto, versión, `wamid`, botón y hora). Al registrar el lead ese mismo `Consent` se enlaza, sin duplicarlo.
  - «No acepto»: explica que sin autorización no se puede registrar, comparte la web y el correo institucional y vuelve a `IDLE` sin lead. La negativa queda en `Consent` solo con el seudónimo (`phoneHash`).
  - Nombre: solo letras; quita «me llamo…», capitaliza y rechaza números, símbolos, saludos y peticiones.
  - Correo: se extrae del texto («mi correo es…») y se valida igual que en la web; si es inválido se pide de nuevo sin perder el avance.
  - Motivo: motivos activos desde la BD; **lista interactiva** si hay más de 3 y **botones** si hay 3 o menos. También acepta el número o el nombre escrito.
  - Teléfono: el del remitente (`57XXXXXXXXXX`). Si el WhatsApp no es colombiano, se pide un número de Colombia (`ASK_PHONE`).
  - Registro con `LeadsService.submit()` (`origin WHATSAPP`): deduplicación, nota automática, correo y Socket.io, igual que la web. Luego, resumen y cierre.
  - Reinicio limpio tras **24 h** sin mensajes o con «reiniciar» / «inicio».
- **Inbox:** si la conversación está pausada (`botPausedAt`, con reactivación a las 12 h), el mensaje se guarda y se notifica por Socket.io, pero el bot no responde.
- **STOP:**
  - Palabras inequívocas como mensaje completo: «STOP», «BAJA», «NO QUIERO MÁS MENSAJES»… «No quiero que me embarguen» no es una baja.
  - Marca el `Contact` como `OPTED_OUT`, agrega el seudónimo a `Suppression`, registra la revocación (`Consent MARKETING_WHATSAPP granted=false`), deja una nota en el lead y un marcador en el Inbox, y confirma.
  - Se honra aunque el bot esté pausado (sin respuesta automática).
  - Después el bot calla hasta que la persona escriba «INICIO».
- **Fuera de flujo:** Gemini con cadena de modelos y tiempo máximo por intento.
  - El prompt lleva la identidad (Barranquilla, atención virtual y presencial inicial, cobertura nacional) y la tarifa real: «$100.000 COP» con el interruptor encendido; apagado, «un asesor confirmará las condiciones», nunca «gratis».
  - La respuesta se recorta a 2 frases y se descarta si dice «gratis», promete o garantiza. El bot añade la repregunta del paso pendiente.
  - Respuesta fija segura si Gemini falla, tarda, no está configurado o se pasa el tope de 6 respuestas por sesión.
  - A Gemini solo le llega la pregunta, no los datos ya capturados.
  - Un modelo inexistente o retirado (404) también salta al siguiente de la cadena.
- **Multimedia:**
  - Nota de voz: se usa su transcripción si trae el dato; si no, se pide por escrito. La autorización nunca se toma de un audio.
  - PDF o imagen: queda en el Inbox y se pide el dato pendiente.
- **Webhook:**
  - `POST /webhooks/whatsapp` es la URL a registrar en Meta; `/meta/webhook` queda como alias. nginx tiene su propia `location`.
  - Las respuestas del bot se guardan en `Message` (author BOT) con su `wamid`. Los `statuses` (`sent`, `delivered`, `read`, `failed`) las actualizan en orden monótono, con código y detalle del error, lo que deja lista la base para la Etapa 6.
  - Si Meta rechaza un envío o WhatsApp no está configurado, el mensaje queda `FAILED` y visible en el Inbox.
- `./jg lint` ahora también corre ESLint en el backend.

Pruebas:
- 52 unitarias nuevas: 51 del flujo y el prompt, y 1 del modelo 404. En total son 155 unitarias en 20 suites; se retiró `chat-session.ts` (sesión de 3 h, sin uso: la regla ahora es de 24 h).
- Frontend: 27 de Vitest, sin cambios.
- 20 de integración nuevas con webhooks firmados con HMAC contra PostgreSQL real, cubriendo:
  - flujo completo, botones con 3 motivos o menos, «No acepto» y correo inválido;
  - Gemini con el interruptor encendido y apagado, saturado y con «gratis» descartado;
  - STOP, Inbox pausado, deduplicación con la web y estados de entrega;
  - firma inválida, `wamid` duplicado, reinicio a las 24 h y «reiniciar»;
  - nota de voz, PDF y número extranjero.
  - Con las 24 de la Etapa 2 suman 44.
- E2E por nginx (`127.0.0.1:8088/webhooks/whatsapp`) con firma real: flujo completo, lead WHATSAPP, STOP y silencio posterior. Los datos de prueba se borraron.

Pendiente para la prueba real (Etapa 4/7):
- Credenciales de la app de Meta propia (`WHATSAPP_*` y `META_APP_SECRET` reales) y la clave de Gemini.
- Registrar el webhook y probar con el número de JurisGlobal.
- Confirmar en la documentación vigente de Meta la versión de Graph y los límites de interactivos.

**Qué se construye** (plan original)
- `whatsapp/cloud-api.client.ts`:
  - texto, interactivos `button` y `list`, plantilla, marcar como leído y descarga de media;
  - versión de Graph tomada de una variable.
- Antes de codificar se verifican en la documentación vigente de Meta la versión de Graph, los límites de botones y listas y el formato de los estados.
- `webhook.controller.ts`:
  - GET de verificación **estricto** (`hub.mode=subscribe` y `hub.verify_token === WHATSAPP_VERIFY_TOKEN`);
  - POST con HMAC obligatorio sobre `rawBody`;
  - responde 200 de inmediato;
  - recorre **todos** los `entry`/`changes` y encola en `wa-inbound` y `wa-status`;
  - deduplica por `waMessageId @unique`;
  - logger que oculta datos personales.
- Prisma: `Conversation` y `Message`.
- `chatbot/flow.ts`: máquina de estados pura (`GREETING → ASK_CONSENT → ASK_NAME → ASK_EMAIL → ASK_MOTIVO → CONFIRM → DONE`), además de `DECLINED` y el modo de edición en `CONFIRM`.
  - El teléfono se toma del chat.
  - El consentimiento se pide con botones Acepto / No acepto y se guarda con su `wamid`.
  - Si el número ya tiene lead, se actualiza.
- STOP:
  - palabras clave configurables;
  - registra la baja en `Contact`, confirma al usuario y deja de enviar marketing;
  - el bot sigue respondiendo si la persona escribe de nuevo.
- Fuera del flujo: Gemini con `model-fallback.ts` (copiado de KovalCloud) y un esquema Zod `{reply, backToStep}`.
  - El *prompt* prohíbe dar asesoría jurídica y prometer resultados, tiempos o precios cerrados.
  - Si fallan todos los modelos, responde un texto fijo y vuelve al paso.
- Sesión de 3 h y *handover* (adaptado de `KC/be/src/meta-whatsapp/chat-session.ts` y `chats/handover.ts`).
- Herramienta de desarrollo: un *quick tunnel* propio para registrar el webhook en Meta.

**Terminado cuando**
- Pruebas unitarias:
  - todas las transiciones del flujo;
  - correo inválido → vuelve a pedirlo;
  - "No acepto" → mensaje de cierre sin pedir datos;
  - STOP en cualquier paso;
  - HMAC inválido → no procesa;
  - webhook duplicado → se procesa una sola vez;
  - verificación GET con un token incorrecto → 403.
- Prueba real con el número de JurisGlobal: una conversación completa crea el lead con origen WHATSAPP, `Consent` y notificación por correo.
- Una pregunta fuera del flujo recibe una respuesta breve y el bot vuelve al formulario.
- Con un modelo inexistente configurado como principal, el fallback funciona.

## Etapa 5 · Panel de administración — ✅ completada el 22-nov-2026 (pendiente de tu aprobación)

Lo construido:
- **Panel con la marca:** fondo claro, azul marino y dorado, *mobile-first* y botones de 44 px o más.
  - Menú: Leads (inicio), Inbox, Masivos, Configuración, Usuarios y Mi cuenta.
  - El ASESOR solo ve Leads, Inbox y Mi cuenta; las rutas de ADMIN lo redirigen a Leads y la API le responde 403.
- **Leads** (`/api/admin/leads`, ADMIN y ASESOR):
  - Tarjetas por estado (Nuevos, Contactados, Agendados, Cerrados) que también sirven de filtro.
  - Búsqueda por nombre, teléfono o correo y filtros por estado (acepta `nuevo|contactado|agendado|cerrado`), motivo, origen (`web|whatsapp`) y fechas en hora de Colombia.
  - Paginación en el servidor.
  - Tiempo real por Socket.io: un lead nuevo o un recontacto muestra un aviso discreto y refresca sin recargar; los cambios hechos en el panel (`lead:changed`) refrescan en silencio.
  - Detalle en panel lateral, con enlace directo `?lead=`:
    - datos, envíos y recontactos;
    - historial de `Consent` (canal, fecha, versión y texto aceptado) e insignia de baja;
    - botón «Abrir chat en el Inbox» (`/panel/conversaciones?c=`);
    - estado, responsable (usuarios activos) y notas internas con autor y fecha.
  - Todo cambio queda en `AuditLog`.
- **Exportación CSV** con los filtros activos, pensada para Excel en Colombia:
  - UTF-8 con BOM y separador `;`;
  - teléfono como `="+57…"`, para que Excel no pierda el «+»;
  - protección contra inyección de fórmulas;
  - tope de 10.000 filas;
  - auditada sin guardar el texto buscado.
- **Anonimización Ley 1581** (solo ADMIN; con 2FA activo pide Sudo Mode), confirmada escribiendo `ANONIMIZAR`:
  - Nombre → «Titular anonimizado». Correo, teléfono y UTM → `null`.
  - El contenido de las notas se reemplaza.
  - En `Consent` se borran el teléfono y la evidencia identificable (IP, user-agent, texto escrito); se conservan la finalidad, el canal, la versión, el texto, la fecha y `phoneHash`.
  - El contacto queda solo con el seudónimo, en baja, y el seudónimo entra a `Suppression` (motivo `ANONYMIZED`).
  - Se eliminan la conversación de WhatsApp y sus adjuntos.
  - Migración `lead_contact_anonymization`: `Lead.phone`, `Lead.email` y `Contact.phone` pasan a ser anulables. Los contactos ahora se buscan por `phoneHash`, así un titular anonimizado que vuelve a escribir genera un lead nuevo sin romper índices y su baja se mantiene.
- **Configuración** (solo ADMIN: `/api/admin/settings`, `/motivos`, `/send-windows`, `/holidays`):
  - **Asesoría y contacto:**
    - interruptor `showConsultationPrice` y valor en COP (no se puede encender sin valor);
    - correos del aviso de lead;
    - correo y teléfono institucionales: el bot los usa en el mensaje de «No acepto», en lugar de `NEXT_PUBLIC_CONTACT_EMAIL`.
  - **Motivos:** crear, renombrar (máx. 20 caracteres, el límite de un botón de WhatsApp), reordenar y activar o desactivar. Siempre queda al menos uno activo y se reflejan al instante en `/api/public/config` y en el bot.
  - **Textos del chatbot:** saludo, rechazo, cierre y confirmación de STOP. El servidor rechaza «gratis» y las promesas.
  - **Horarios** por día, validados contra la Ley 2300: L–V 7:00–19:00, sábado 8:00–15:00, domingo sin envíos.
  - **Festivos** por año: agregar, quitar (los manuales se borran; los oficiales se desactivan para que el seed no los recree) y restaurar.
  - **Topes de envío:** diario y semanal por contacto (el semanal no puede ser menor que el diario) y límite diario global.
- **Usuarios** (solo ADMIN): listar, crear, cambiar rol, activar o desactivar y restablecer contraseña (con Sudo Mode si el ADMIN tiene 2FA).
  - No se puede desactivar ni degradar al último ADMIN activo.
  - Nadie puede desactivar su propia cuenta.
- **Masivos:** vista provisional «Próximamente — Etapa 6», solo para ADMIN.
- **Infraestructura de desarrollo:**
  - las imágenes de desarrollo se llaman `jurisglobal-api-dev` y `jurisglobal-web-dev`, porque `./jg build` sobrescribía la imagen de desarrollo con la de producción;
  - `./jg lint` incluye ESLint del backend.

Diferencias con el plan original:
- Los **textos de autorización** (`consent.*`) no se editan desde el panel. Cambiarlos exige revisión jurídica y subir la versión; queda para cuando los abogados entreguen el texto final.
- El aviso de lead nuevo es visual, como pediste, sin alerta sonora.
- Exportar no exige Sudo Mode: el ASESOR puede exportar y la exportación queda auditada.

Pruebas:
- Backend:
  - 166 unitarias (21 suites), entre ellas CSV, filtros y reglas de Configuración;
  - 60 de integración contra PostgreSQL real, de las cuales 16 son nuevas del panel: filtros, paginación, estado, responsable, notas, CSV, anonimización (incluido el 403 del ASESOR y el Sudo Mode), configuración, motivos, horarios, festivos y usuarios, con 403 para el ASESOR.
- Frontend: 42 de Vitest. Las 15 nuevas cubren el listado y los filtros, el tiempo real, el detalle (estado, responsable y notas), la confirmación de la anonimización, el interruptor de precio y los motivos.
- Navegador real (Chromium por nginx en `127.0.0.1:8088`): 25 comprobaciones como ADMIN en escritorio y ASESOR en celular, más las capturas del filtro en 3 anchos. Las cuentas y los datos de prueba se borraron.

**Qué se construye** (plan original)
- Autenticación adaptada de KovalCloud:
  - login con TOTP;
  - revocación por cambio de contraseña;
  - modo sudo para acciones sensibles (exportar, borrar, lanzar campañas);
  - roles ADMIN y ASESOR con *deny-by-default*;
  - sesión con cookie httpOnly o JWT, según la pregunta 8;
  - script para crear el primer ADMIN.
- Shell del panel: layout, Sidebar y TopBar adaptados con la marca.
- **Leads**:
  - listado con filtros (motivo, estado, origen, fechas) y búsqueda;
  - paginación del lado del servidor;
  - detalle con consentimientos, notas, estado y responsable;
  - exportar CSV en UTF-8 con BOM (para Excel), auditado.
- Tiempo real: Socket.io con evento `lead:new` y alerta sonora.
- **Configuración**: motivos (CRUD y orden), precio y gratuidad de la asesoría, textos del bot, textos de autorización (cada cambio crea una versión nueva), correos de notificación, usuarios, mi cuenta y 2FA.
- Conversaciones (si se aprueba la pregunta 11): historial de solo lectura y pausa o reanudación del bot.
- `AuditLog` para cambios de estado, exportaciones y configuración.

**Terminado cuando**
- Un ASESOR no puede entrar a Configuración, Usuarios ni Exportar (pruebas de guards).
- Un JWT emitido antes de un cambio de contraseña es rechazado.
- Con 2FA activo, el login sin código falla.
- El flujo completo funciona: llega un lead → aparece en vivo → se asigna → se agrega una nota → pasa a CONTACTADO → se exporta el CSV con filtros → la exportación queda en la auditoría.
- Cambiar el texto de autorización genera una nueva `textVersion` y los consentimientos anteriores conservan el texto antiguo.

## Etapa 6 · Envíos masivos

**Qué se construye**
- **Primero se valida el cumplimiento.** Se confirman los valores iniciales con el texto vigente de la Ley 2300 de 2023 (art. 3 y art. 5, parágrafos 2 y 3; resultado preliminar en `00` §4.2) y se dejan documentados.
- Prisma: `ContactImport`, `MessageTemplate`, `Campaign`, `CampaignMessage`, `SendWindow`, `Holiday`; `Contact` completo.
- **Importador**:
  - xlsx/csv con alias de columnas (adaptado de `KC/be/src/restaurants/menu-spreadsheet.ts`) y limpieza de BOM;
  - E.164 y deduplicación contra la base;
  - origen declarado **obligatorio** por importación y autorización por fila o por lote;
  - reporte por fila y plantilla descargable.
- **Contactos**: listado, bajas, alta y baja manual, supresión a pedido del titular (si se aprueba la pregunta 14).
- **Plantillas**: sincronización paginada desde Graph, vista previa, mapeo de variables y detección de la opción de baja (sin ella no se puede lanzar).
- **Cumplimiento**:
  - `send-window.ts` (`isWithinSendWindow`, `nextOpening`), adaptado de `business-hours.ts`;
  - semilla de festivos de Colombia con pruebas para el año en curso y el siguiente;
  - editor de ventanas, adaptado de `ScheduleCards.tsx`;
  - CRUD de festivos;
  - tope por contacto y límite diario en `Setting`.
- **Envío** (diseño en `01` §2):
  - *dispatcher* cada 60 s;
  - cola `campaign-send` con *limiter* y jitter;
  - revalidación antes de cada envío;
  - glosario de errores de Meta (a partir de la idea de `DJ/O/meta_errors.py`, corregido);
  - backoff solo para infraestructura y 429;
  - pausa automática si la calidad pasa a RED o hay un error de cuenta;
  - 131050 → baja.
- Estados monótonos por webhook; embudo y errores más frecuentes por campaña; CSV de destinatarios.
- Una respuesta a una campaña marca `repliedAt` y entra al bot.
- **Modo *dry-run***: simula envíos sin llamar a Meta para validar ritmo y ventanas (idea de `DJ/O/management/commands/simular_masivo.py`).

**Terminado cuando**
- Pruebas unitarias:
  - ventana (bordes de apertura y cierre, sábado, domingo, festivo trasladado);
  - `nextOpening` desde el viernes 19:01 → sábado 08:00;
  - tope por contacto;
  - baja excluida al armar y al enviar;
  - orden monótono de estados (un `delivered` tardío no pisa un `read`);
  - clasificación de errores (131047 ≠ "saldo").
- *Dry-run* de 2.000 contactos con el reloj simulado: nada sale fuera de la ventana, se respeta el límite diario, el resto continúa al día hábil siguiente y no hay duplicados.
- **Campaña de prueba real** a un grupo pequeño de números internos con una plantilla aprobada:
  - respeta el horario;
  - el panel muestra enviado, entregado y leído;
  - responder STOP da de baja al número y la siguiente campaña lo excluye (`SKIPPED: OPTED_OUT`);
  - responder otra cosa entra al flujo del bot.
- Una campaña programada para un domingo no envía hasta el lunes a las 07:00.

## Etapa 7 · Despliegue, pruebas y ajustes

**Qué se construye**
- Hostname de pruebas en Cloudflare (decisión: *Public Hostname* en el túnel existente), con una regla que exime `/meta/webhook` del *challenge*.
  - **Ojo:** el `cloudflared` del túnel existente corre dentro de la red Docker de KovalCloud. Desde ahí, `localhost:8088` apunta al propio contenedor, no al VPS.
  - Opciones:
    - (a) Exponer nginx de JurisGlobal en la IP del *gateway* Docker (`NGINX_BIND`) y apuntar el hostname a esa IP.
    - (b) Conectar el `cloudflared` de KovalCloud también a `jurisglobal_net`. Exige tocar el compose de KovalCloud.
    - (c) Un conector `cloudflared` propio de JurisGlobal en otro túnel de la misma cuenta. Es lo recomendado por aislamiento.
  - La decisión queda pendiente.
- Migración del número de WhatsApp desde KovalCloud: cambiar la URL del webhook en la app de Meta sin dejar a KovalCloud recibiendo mensajes de ese número. Si la app de Meta es compartida, la URL del webhook es por app, así que hay que coordinarlo.
- `.env` de producción con secretos nuevos, sin reutilizar ninguno de KovalCloud.
- `prisma migrate deploy` como parte del despliegue.
- Backups: `scripts/backup_db.sh` sin secretos en el archivo, cron diario, retención y **prueba de restauración**.
- Endurecimiento:
  - nginx con `limit_req` en `/api/public/*` y `/meta/webhook`, y cabeceras de seguridad;
  - Cloudflare WAF;
  - logs con redacción de datos personales y rotación.
- Webhook de Meta apuntando al dominio de pruebas; suscripción a `messages` y a los estados.
- Revisión final de textos: legales con nombre y NIT (pendientes ESP §13.1-2), datos de contacto reales (§13.3), precio (§13.4) y promesas de resultado (§11).
- *Checklist* de cambio a dominio y correo definitivos solo por variables de entorno (§13.5).

**Terminado cuando**
- La instancia responde por HTTPS en el dominio de pruebas.
- Prueba de humo completa: formulario web → lead → correo; chat de WhatsApp → lead; campaña de prueba dentro del horario; STOP.
- KovalCloud sigue funcionando sin cambios: `docker ps`, su dominio responde y sus volúmenes no se tocaron.
- El backup restaura correctamente en una BD temporal.
- Existe una lista de pendientes de contenido para publicar (ESP §13), con responsable.
