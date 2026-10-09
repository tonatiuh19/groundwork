#!/usr/bin/env bash
# Apply pending database migrations to TiDB Cloud (reads credentials from .env).
# Tracks applied files in `schema_migrations` so re-runs skip history.
# Legacy files that predate tracking: duplicate-schema errors are treated as
# already-applied (recorded + continue). Real SQL errors still abort.
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

echo "📦 Ensuring schema_migrations ledger ..."
"${MYSQL[@]}" -e "
CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
  \`filename\` VARCHAR(255) NOT NULL,
  \`applied_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`filename\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"

is_applied() {
  local f="$1"
  local n
  n=$("${MYSQL[@]}" -N -e "SELECT COUNT(*) FROM schema_migrations WHERE filename = '$f'")
  [[ "$n" -gt 0 ]]
}

mark_applied() {
  local f="$1"
  "${MYSQL[@]}" -e "INSERT IGNORE INTO schema_migrations (filename) VALUES ('$f')"
}

is_already_applied_error() {
  local out="$1"
  # MySQL / TiDB duplicate schema objects on re-apply of legacy migrations
  grep -Eiq \
    "Duplicate column name|Duplicate key name|Duplicate entry|already exists|Can't DROP|check that column/key exists|Unknown column" \
    <<<"$out"
}

shopt -s nullglob
files=(database/migrations/*.sql)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "⚠️  No migration files in database/migrations/"
  exit 0
fi

for file in "${files[@]}"; do
  base="$(basename "$file")"
  echo ""
  if is_applied "$base"; then
    echo "⏭  Skipping $base (already in schema_migrations)"
    continue
  fi
  echo "▶ Applying $base ..."
  set +e
  out=$("${MYSQL[@]}" < "$file" 2>&1)
  status=$?
  set -e
  if [[ $status -eq 0 ]]; then
    echo "$out" | grep -v 'Using a password' || true
    mark_applied "$base"
    echo "✅ $base"
  elif is_already_applied_error "$out"; then
    echo "$out" | grep -v 'Using a password' | tail -5 || true
    mark_applied "$base"
    echo "⚠️  $base already reflected in schema — recorded and continuing"
  else
    echo "$out" | grep -v 'Using a password' || true
    echo "❌ $base failed — aborting to avoid schema drift."
    exit 1
  fi
done

echo ""
echo "🔍 Verifying core tables ..."
"${MYSQL[@]}" -e "SHOW TABLES; SELECT id, email, first_name, last_name, role, status FROM admins ORDER BY id;"

echo ""
echo "🎉 Done."
