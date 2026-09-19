#!/usr/bin/env bash
set -euo pipefail

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "Falta pg_dump. En macOS instala PostgreSQL con: brew install libpq"
  exit 1
fi

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "Falta SUPABASE_DB_URL. Agrégala temporalmente a tu terminal o al archivo .env local."
  exit 1
fi

backup_dir="${BACKUP_DIR:-./backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output_path="${backup_dir}/noventia-supabase-${timestamp}.dump"

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
pg_dump --dbname="$SUPABASE_DB_URL" --format=custom --no-owner --no-privileges --file="$output_path"
chmod 600 "$output_path"

echo "Respaldo creado correctamente en: $output_path"
echo "Conserva una copia en una ubicación privada distinta de tu computadora."
