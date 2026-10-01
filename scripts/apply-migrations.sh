#!/usr/bin/env bash
# Apply pending database migrations to TiDB Cloud (reads credentials from .env).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "❌ .env not found at $ROOT/.env"
  exit 1
fi

DB_PASS=$(grep "^DB_PASSWORD" .env | cut -d'=' -f2-)
DB_HOST=$(grep "^DB_HOST" .env | cut -d'=' -f2-)
DB_PORT=$(grep "^DB_PORT" .env | cut -d'=' -f2-)
DB_USER=$(grep "^DB_USER" .env | cut -d'=' -f2-)
DB_NAME=$(grep "^DB_NAME" .env | cut -d'=' -f2-)

MYSQL=(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME"
  --ssl-mode=REQUIRED --protocol=TCP)

echo "🔍 Connecting to TiDB ($DB_HOST / $DB_NAME) ..."
"${MYSQL[@]}" -e "SELECT DATABASE() AS db, NOW() AS now;"

shopt -s nullglob
files=(database/migrations/*.sql)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "⚠️  No migration files in database/migrations/"
  exit 0
fi

for file in "${files[@]}"; do
  echo ""
  echo "▶ Applying $(basename "$file") ..."
  if "${MYSQL[@]}" < "$file" 2>&1; then
    echo "✅ $(basename "$file")"
  else
    echo "❌ $(basename "$file") failed — aborting to avoid schema drift."
    exit 1
  fi
done

echo ""
echo "🔍 Verifying core tables ..."
"${MYSQL[@]}" -e "SHOW TABLES; SELECT id, email, first_name, last_name, role, status FROM admins ORDER BY id;"

echo ""
echo "🎉 Done."
