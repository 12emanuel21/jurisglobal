#!/usr/bin/env bash
# Smoke test de producción de JurisGlobal (`./jg smoke`). Solo LEE: no cambia contenedores, datos ni
# configuración, y nunca imprime secretos. Sale con código 1 si alguna comprobación falla.
#   BASE_URL=http://127.0.0.1:8088 (por defecto) · PUBLIC_URL=https://dominio (opcional, por el túnel)
set -uo pipefail
cd "$(dirname "$0")/.."

BASE_URL="${BASE_URL:-http://127.0.0.1:8088}"
PUBLIC_URL="${PUBLIC_URL:-}"
C=(docker compose -p jurisglobal -f docker-compose.yml)
fails=0
ok() { printf '  ✅ %s\n' "$1"; }
ko() { printf '  ❌ %s\n' "$1"; fails=$((fails + 1)); }
info() { printf '  ℹ️  %s\n' "$1"; }
check() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else ko "$1"; fi; }

echo "▶ Contenedores de JurisGlobal"
for svc in db redis api worker web nginx; do
  name="jurisglobal_$svc"
  state=$(docker inspect -f '{{.State.Status}}{{if .State.Health}}/{{.State.Health.Status}}{{end}}' "$name" 2>/dev/null || echo "ausente")
  restart=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$name" 2>/dev/null || echo "-")
  image=$(docker inspect -f '{{.Config.Image}}' "$name" 2>/dev/null || echo "-")
  case "$state" in running|running/healthy) ok "$name $state · $image · restart=$restart" ;; *) ko "$name $state" ;; esac
  [ "$restart" = "unless-stopped" ] || info "$name no tiene restart: unless-stopped ($restart): ¿está en modo desarrollo?"
  case "$image" in *-dev) info "$name usa una imagen de DESARROLLO ($image): para producción, ./jg up" ;; esac
done
if docker inspect jurisglobal_cloudflared >/dev/null 2>&1; then
  check "cloudflared (túnel propio) en ejecución" '[ "$(docker inspect -f "{{.State.Status}}" jurisglobal_cloudflared)" = running ]'
else
  info "cloudflared no está levantado (sin CLOUDFLARE_TUNNEL_TOKEN): solo acceso local"
fi

echo "▶ API y nginx ($BASE_URL)"
health=$(curl -s --max-time 10 "$BASE_URL/api/health" || true)
check "/api/health responde ok (db y redis ok)" 'echo "$health" | grep -q "\"status\":\"ok\"" && echo "$health" | grep -q "\"db\":\"ok\"" && echo "$health" | grep -q "\"redis\":\"ok\""'
headers=$(curl -s -D - -o /dev/null --max-time 15 "$BASE_URL/" | tr -d '\r')
check "X-Content-Type-Options: nosniff" 'echo "$headers" | grep -qi "^x-content-type-options: nosniff"'
check "X-Frame-Options: SAMEORIGIN" 'echo "$headers" | grep -qi "^x-frame-options: SAMEORIGIN"'
check "Referrer-Policy: strict-origin-when-cross-origin" 'echo "$headers" | grep -qi "^referrer-policy: strict-origin-when-cross-origin"'
check "Server sin versión (server_tokens off)" '! echo "$headers" | grep -Eqi "^server: .*nginx/[0-9]"'
check "Sin X-Powered-By" '! echo "$headers" | grep -qi "^x-powered-by"'
check "Una sola cabecera X-Frame-Options (sin duplicados)" '[ "$(echo "$headers" | grep -ci "^x-frame-options")" = 1 ]'
api_headers=$(curl -s -D - -o /dev/null --max-time 10 "$BASE_URL/api/health" | tr -d '\r')
check "La API también sale con nosniff y SAMEORIGIN" 'echo "$api_headers" | grep -qi "^x-content-type-options: nosniff" && echo "$api_headers" | grep -qi "^x-frame-options: SAMEORIGIN"'

chunk=$(curl -s --max-time 15 "$BASE_URL/" | grep -oE '/_next/static/chunks/[^"]+\.js' | head -1)
if [ -n "$chunk" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE_URL$chunk.map")
  check "Sin source maps públicos ($chunk.map → $code)" '[ "$code" = 404 ]'
else
  info "No se encontró un chunk de Next para revisar source maps"
fi

echo "▶ Webhook de WhatsApp"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$BASE_URL/webhooks/whatsapp" \
  -H 'Content-Type: application/json' -H 'X-Hub-Signature-256: sha256=firma-invalida' \
  --data-binary '{"object":"whatsapp_business_account","entry":[]}')
check "Firma inválida → 403 (respondió $code)" '[ "$code" = 403 ]'
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE_URL/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=incorrecto&hub.challenge=123")
check "Verificación con token incorrecto → 403 (respondió $code)" '[ "$code" = 403 ]'

echo "▶ Worker de masivos"
check "Healthcheck del worker (señal de vida < 90 s)" '[ "$(docker inspect -f "{{.State.Health.Status}}" jurisglobal_worker)" = healthy ]'
workers=$(docker exec jurisglobal_worker node -e '
const { Queue } = require("bullmq");
const q = new Queue("campaigns", { connection: { url: process.env.REDIS_URL }, prefix: `${process.env.REDIS_KEY_PREFIX || "jg:"}bull` });
q.getWorkers().then((w) => { console.log(w.length); return q.close(); }).catch(() => { console.log(0); process.exit(0); });' 2>/dev/null || echo 0)
check "Worker conectado a Redis y escuchando la cola campaigns ($workers)" '[ "${workers:-0}" -ge 1 ]'

if [ -n "$PUBLIC_URL" ]; then
  echo "▶ Dominio público ($PUBLIC_URL)"
  pub=$(curl -s --max-time 15 "$PUBLIC_URL/api/health" || true)
  check "/api/health por el túnel" 'echo "$pub" | grep -q "\"status\":\"ok\""'
  pub_headers=$(curl -s -D - -o /dev/null --max-time 15 "$PUBLIC_URL/" | tr -d '\r')
  check "HSTS por HTTPS" 'echo "$pub_headers" | grep -qi "^strict-transport-security: max-age="'
fi

echo "▶ KovalCloud intacto (solo lectura)"
koval=$(docker ps -a --filter label=com.docker.compose.project=kovalcloud --format '{{.Names}} {{.State}}')
if [ -z "$koval" ]; then
  info "No se encontraron contenedores del proyecto kovalcloud en este servidor"
else
  total=$(echo "$koval" | wc -l | tr -d ' ')
  running=$(echo "$koval" | grep -c ' running$' || true)
  check "Contenedores de KovalCloud en ejecución ($running/$total)" '[ "$running" = "$total" ]'
  shared=0
  for net in $(docker network ls --filter label=com.docker.compose.project=kovalcloud --format '{{.Name}}'); do
    docker network inspect -f '{{range .Containers}}{{.Name}} {{end}}' "$net" | grep -q 'jurisglobal_' && shared=1
  done
  check "Ningún contenedor de JurisGlobal en las redes de KovalCloud" '[ "$shared" = 0 ]'
  check "La red de JurisGlobal no tiene contenedores de KovalCloud" '! docker network inspect -f "{{range .Containers}}{{.Name}} {{end}}" jurisglobal_net | grep -qi koval'
  kc=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:80/ || echo 000)
  check "nginx de KovalCloud responde en 127.0.0.1:80 (HTTP $kc)" '[ "$kc" != 000 ]'
fi

echo
if [ "$fails" -eq 0 ]; then echo "✅ Smoke test OK"; else echo "❌ $fails comprobación(es) fallaron"; exit 1; fi
