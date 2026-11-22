#!/usr/bin/env bash
# Copia de seguridad de la BD de JurisGlobal (formato custom de pg_dump) con retención.
# No contiene secretos: usa el socket local del contenedor (sin contraseña) y lee usuario/BD del .env.
set -euo pipefail

cd "$(dirname "$0")/.."
POSTGRES_USER="$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2- || true)"
POSTGRES_DB="$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2- || true)"
POSTGRES_USER="${POSTGRES_USER:-jg_admin}"
POSTGRES_DB="${POSTGRES_DB:-jurisglobal}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p backups
FILE="backups/jurisglobal_$(date +%Y%m%d_%H%M%S).dump"
docker compose -p jurisglobal -f docker-compose.yml exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$FILE"
echo "Backup: $FILE ($(du -h "$FILE" | cut -f1))"

find backups -name 'jurisglobal_*.dump' -mtime +"$RETENTION_DAYS" -print -delete
