# 03 · Guía de despliegue y operación (paso a vivo)

Guía para poner JurisGlobal en línea en este mismo VPS **sin tocar KovalCloud**. Sigue los pasos en
orden. Todo se hace desde `/root/dev/jurisglobal` con `./jg` (fija el proyecto `jurisglobal`).

> **Reglas que no cambian**
> - Nunca uses `docker compose` sin `-p jurisglobal` (usa `./jg`).
> - No reutilices tokens, secretos ni contraseñas de KovalCloud.
> - `.env` nunca se sube a git ni se comparte por chat. Después de editarlo, revisa sus permisos: `chmod 600 .env`.

Nombres de variables: este proyecto usa los nombres de `.env.example`. Si en Meta o en Google ves
otro nombre, esta es la equivalencia:

| Lo que te entrega el proveedor | Variable en `.env` |
|---|---|
| Phone Number ID (Meta) | `WHATSAPP_PHONE_NUMBER_ID` |
| WhatsApp Business Account ID (Meta) | `WHATSAPP_WABA_ID` |
| Token de acceso permanente (usuario del sistema de Meta) | `WHATSAPP_ACCESS_TOKEN` |
| App Secret (Meta) | `META_APP_SECRET` |
| Token de verificación del webhook (lo inventas tú) | `WHATSAPP_VERIFY_TOKEN` |
| API key de Gemini (Google AI Studio) | `GOOGLE_GENERATIVE_AI_API_KEY` |
| Token del conector de Cloudflare Tunnel | `CLOUDFLARE_TUNNEL_TOKEN` |

---

## 0. Antes de empezar

1. Arranca en producción y comprueba que todo responde:
   ```bash
   ./jg up        # o ./jg prod: imágenes compiladas, solo 127.0.0.1:8088
   ./jg migrate   # aplica migraciones pendientes (no borra datos)
   ./jg smoke     # debe terminar en "✅ Smoke test OK"
   ```
2. Si vienes de desarrollo (`./jg dev`), `./jg up` reemplaza los contenedores por los de producción;
   los datos (PostgreSQL, Redis, adjuntos) se conservan porque viven en volúmenes.
3. Si después de cambiar `nginx/nginx.conf` las cabeceras no cambian, reinicia nginx:
   `docker compose -p jurisglobal -f docker-compose.yml restart nginx` (el archivo se monta suelto).

---

## 1. Cloudflare: túnel propio y dominio

JurisGlobal usa **su propio túnel** (contenedor `jurisglobal_cloudflared` dentro de `jurisglobal_net`).
No se toca el túnel ni la red de KovalCloud.

1. Entra a **Cloudflare Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**.
2. Tipo **Cloudflared**. Nombre: `jurisglobal`. Guarda.
3. En «Install and run a connector» elige **Docker**. Del comando que muestra, copia **solo el token**
   (el texto largo después de `--token`). No ejecutes ese comando: el contenedor ya está en el compose.
4. Pega el token en `.env`:
   ```
   CLOUDFLARE_TUNNEL_TOKEN=eyJ...
   ```
5. En la pestaña **Public Hostname** del túnel → **Add a public hostname**:
   - Subdomain: `jurisglobal` · Domain: `autobotsdev.dev` → `jurisglobal.autobotsdev.dev`
   - Service: **HTTP** · URL: `nginx:80`
   - Guarda. Cloudflare crea el registro DNS solo.
6. Actualiza `.env` con el dominio real y la cookie segura (todo el tráfico público llega por HTTPS):
   ```
   PUBLIC_BASE_URL=https://jurisglobal.autobotsdev.dev
   CORS_ORIGINS=https://jurisglobal.autobotsdev.dev
   COOKIE_SECURE=true
   ```
7. Levanta de nuevo: `./jg up` (con token, también levanta `cloudflared`; sin token avisa y no lo levanta).
8. Verifica desde afuera:
   ```bash
   PUBLIC_URL=https://jurisglobal.autobotsdev.dev ./jg smoke
   ```
   Debe responder `/api/health` por el túnel y enviar `Strict-Transport-Security`.
9. **Reglas recomendadas en Cloudflare** (Security → WAF):
   - Deja **sin** desafío (Bot Fight / Managed Challenge) la ruta `/webhooks/whatsapp`: Meta no
     resuelve desafíos y los mensajes se perderían.
   - SSL/TLS en **Full** (el túnel ya cifra hasta el servidor).

**IP real de los visitantes.** Cloudflare envía `CF-Connecting-IP`; nginx solo la acepta si la conexión
viene de la red interna (cloudflared) y se la pasa a la API ya resuelta. Así, el límite de envíos del
formulario (`POST /api/leads`) y del login cuenta por visitante, no por la IP de nginx ni de Cloudflare.
Si alguien intenta conectarse directo con una IP pública, se ignoran las cabeceras.

> `cloudflare/cloudflared:latest` se actualiza solo con cada `./jg up`. Si prefieres control, fija la
> versión en `docker-compose.yml` (por ejemplo `cloudflare/cloudflared:2025.x.y`).

---

## 2. Meta: app propia de JurisGlobal y webhook

La URL del webhook es **por app** de Meta. Para no afectar a KovalCloud, JurisGlobal usa **su propia
app**.

1. En **Meta for Developers** → **My Apps** → **Create app** → tipo **Business**. Nombre: `JurisGlobal`.
   Asóciala al **Business Manager** de JurisGlobal.
2. Agrega el producto **WhatsApp**. Vincula la **WhatsApp Business Account (WABA)** y el número de
   JurisGlobal. El número **no** puede estar activo en la app de WhatsApp del teléfono.
3. Token permanente: Business Settings → **Users** → **System users** → crea uno (Admin) → **Generate
   token** para la app JurisGlobal con los permisos `whatsapp_business_messaging` y
   `whatsapp_business_management`. Asigna al usuario del sistema la WABA y la app.
4. Copia a `.env`:
   ```
   WHATSAPP_PHONE_NUMBER_ID=...   # WhatsApp → API Setup
   WHATSAPP_WABA_ID=...           # WhatsApp → API Setup
   WHATSAPP_ACCESS_TOKEN=...      # el token permanente del paso 3
   META_APP_SECRET=...            # App settings → Basic → App secret
   WHATSAPP_VERIFY_TOKEN=...      # inventa uno largo: openssl rand -hex 24
   ```
5. Aplica: `./jg up`.
6. En la app → **WhatsApp** → **Configuration** → **Webhook** → **Edit**:
   - Callback URL: `https://jurisglobal.autobotsdev.dev/webhooks/whatsapp`
   - Verify token: el mismo `WHATSAPP_VERIFY_TOKEN`
   - Verificar y guardar. En los logs debe aparecer «✅ Webhook de Meta verificado» (`./jg logs api`).
7. En **Webhook fields**, suscribe: **`messages`** (mensajes y estados de entrega) y
   **`phone_number_quality_update`** (calidad del número: si pasa a ROJO, se pausan todas las campañas).
8. Prueba: escribe «Hola» al número desde otro WhatsApp. El bot debe saludar y pedir la autorización.
9. Plantillas: créalas en **WhatsApp Manager** → Message templates, **con opción de baja** (botón
   «No recibir más» o pie «Responde STOP…»). Cuando Meta las apruebe: panel → **Masivos** →
   **Plantillas** → **Sincronizar con Meta**, y revisa el rol de cada botón.
10. Primera campaña real: hazla a un grupo pequeño de números internos. Mientras validas, puedes activar
    el **modo simulación** en la campaña o poner `CAMPAIGNS_FORCE_DRY_RUN=true` en `.env`.

**Calidad del número.** Con credenciales reales, el worker consulta `quality_rating` en Graph antes de
cada lote y cada ~50 envíos. Si Meta responde **RED**, o llega el aviso `phone_number_quality_update`,
todas las campañas activas quedan **pausadas** («Meta marcó la calidad del número en ROJO») y el panel
muestra una alerta roja. Al reanudar, se vuelve a consultar y solo envía si dejó de estar en rojo. Sin
credenciales (desarrollo o simulación) la consulta se omite.

---

## 3. Gemini, correo y datos públicos de contacto

1. **Gemini** (respuestas fuera del flujo y transcripción de notas de voz): crea la clave en Google AI
   Studio y ponla en `GOOGLE_GENERATIVE_AI_API_KEY=...`. Opcional: `GEMINI_MODEL` y `GEMINI_FALLBACK_MODEL`.
2. **SMTP con Gmail** (aviso de lead nuevo):
   - En la cuenta de Google: activa la verificación en 2 pasos → **Contraseñas de aplicaciones** →
     crea una para «JurisGlobal».
   - En `.env`:
     ```
     SMTP_HOST=smtp.gmail.com
     SMTP_PORT=465
     SMTP_SECURE=true
     SMTP_USER=cuenta@dominio.com
     SMTP_PASS=la-contraseña-de-aplicación-de-16-letras
     SMTP_FROM=JurisGlobal <cuenta@dominio.com>
     ```
   - Los destinatarios del aviso se configuran en el panel → **Configuración** → Asesoría y contacto.
3. **Datos públicos** (`NEXT_PUBLIC_*`: número de WhatsApp de la web, teléfono, correo y NIT). Reemplaza
   los valores provisionales de `.env.example` por los reales.
   > **Importante:** Next.js copia las variables `NEXT_PUBLIC_*` dentro de la imagen web **al compilar**.
   > Después de cambiarlas hay que **reconstruir**: `./jg up` (incluye `--build`). Reiniciar no basta.
4. Aplica todo con `./jg up` y verifica con `./jg smoke`.

---

## 4. Administrador definitivo con 2FA

1. Entra al panel con la cuenta inicial `admin@jurisglobal.test`.
2. **Usuarios** → **Nuevo usuario**: tu correo real, rol **ADMIN** y una contraseña fuerte (12+ caracteres).
3. Cierra sesión y entra con la cuenta nueva.
4. **Mi cuenta** → **Activar autenticación en 2 pasos**: escanea el QR con Google Authenticator,
   Microsoft Authenticator o similar y confirma con el código. No hay códigos de respaldo y el panel
   no permite quitar el 2FA de otra cuenta: si pierdes el teléfono, hay que desactivarlo desde el
   servidor (base de datos, `User.isTwoFactorEnabled`). Por eso conviene tener **dos** ADMIN con 2FA
   y guardar la app autenticadora con copia en la nube.
5. **Usuarios** → `admin@jurisglobal.test` → **Desactivar**. Una cuenta no se puede desactivar a sí
   misma, ni se puede desactivar al último ADMIN activo; por eso se hace desde la cuenta nueva.
6. Quita `ADMIN_PASSWORD` de `.env` (el seed solo lo usa la primera vez).
7. Crea las cuentas de asesores con rol **ASESOR** (ven Leads, Inbox y Mi cuenta).

Con 2FA activo, las acciones sensibles piden de nuevo el código (Sudo Mode): anonimizar un lead,
cambiar contraseñas o roles y **lanzar campañas**.

---

## 5. Respaldo y restauración de PostgreSQL

**Respaldo** (formato `pg_dump -Fc`, con retención de 14 días en `backups/`):
```bash
./jg backup
# Backup: backups/jurisglobal_AAAAMMDD_HHMMSS.dump
```
Programa uno diario con cron (`crontab -e`):
```
30 2 * * * cd /root/dev/jurisglobal && ./scripts/backup_db.sh >> backups/backup.log 2>&1
```
Copia periódicamente `backups/` **fuera del servidor**: un respaldo en el mismo disco no protege de
una falla del VPS.

**Prueba de restauración** (no toca la base real; hazla al menos una vez al mes):
```bash
C="docker compose -p jurisglobal -f docker-compose.yml"
F=backups/jurisglobal_AAAAMMDD_HHMMSS.dump
$C exec -T db sh -c 'createdb -U "$POSTGRES_USER" jurisglobal_restore_test'
$C exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d jurisglobal_restore_test --no-owner' < "$F"
$C exec -T db sh -c 'psql -U "$POSTGRES_USER" -d jurisglobal_restore_test -c "SELECT count(*) FROM \"Lead\""'
$C exec -T db sh -c 'dropdb -U "$POSTGRES_USER" jurisglobal_restore_test'
```

**Restauración real** (reemplaza los datos actuales: haz antes un respaldo nuevo):
```bash
./jg backup                                   # respaldo del estado actual, por si acaso
$C stop api worker                            # nadie escribe mientras se restaura
$C exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < "$F"
$C start api worker
./jg migrate && ./jg smoke
```

Alternativa en SQL plano (legible, más pesada):
```bash
$C exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > backups/manual.sql
$C exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backups/manual.sql   # sobre una base vacía
```

---

## 6. Operación diaria

| Tarea | Comando |
|---|---|
| Estado | `./jg ps` |
| Logs de la API / del worker de masivos | `./jg logs api` · `./jg worker-logs` |
| Comprobación completa (salud, cabeceras, webhook, worker, KovalCloud) | `./jg smoke` |
| Actualizar a una versión nueva del código | `git pull && ./jg up && ./jg migrate && ./jg smoke` |
| Respaldo manual | `./jg backup` |
| Detener JurisGlobal (conserva datos) | `./jg down` |

Señales de alerta:
- `./jg smoke` falla en «Worker conectado a Redis»: `./jg worker-logs` y `docker compose -p jurisglobal -f docker-compose.yml restart worker`.
- Campañas pausadas con «calidad en ROJO»: revisa la calidad del número en WhatsApp Manager antes de reanudar.
- Campañas pausadas con «problema con la cuenta» o «token vencido (190)»: renueva `WHATSAPP_ACCESS_TOKEN` y `./jg up`.
- El bot no responde: `./jg logs api` (firma inválida = `META_APP_SECRET` no coincide con la app).

## 7. Lista de verificación final antes de anunciar el sitio

- [ ] `./jg smoke` OK, también con `PUBLIC_URL=https://jurisglobal.autobotsdev.dev`.
- [ ] Webhook verificado y suscrito a `messages` y `phone_number_quality_update`.
- [ ] «Hola» al número → el bot responde; «STOP» → baja.
- [ ] Formulario web → lead en el panel y correo de aviso recibido.
- [ ] Textos legales revisados por los abogados: nombre, NIT, aviso de privacidad, términos (ESP §11 y §13).
- [ ] Datos públicos reales en `NEXT_PUBLIC_*` (imagen web reconstruida).
- [ ] ADMIN definitivo con 2FA; `admin@jurisglobal.test` desactivado.
- [ ] Respaldo diario programado y una restauración de prueba hecha.
- [ ] Plantillas aprobadas con opción de baja; primera campaña a números internos.
- [ ] Prueba documental de la autorización de la base de contactos antes de cualquier campaña de marketing.
