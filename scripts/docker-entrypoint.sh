#!/bin/sh
set -eu

echo "[E-SOLUTIONS] Waiting for PostgreSQL..."
until npx prisma db execute --stdin >/dev/null 2>&1 <<'SQL'
SELECT 1;
SQL
do
  sleep 2
done

echo "[E-SOLUTIONS] Applying checked-in database migrations..."
npx prisma migrate deploy

# Seed only with explicit bootstrap credentials. The seed never resets an existing account.
if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  npm run seed
else
  echo "[E-SOLUTIONS] Bootstrap credentials not configured; preserving existing accounts."
fi

echo "[E-SOLUTIONS] Starting Next.js..."
exec npm run dev
