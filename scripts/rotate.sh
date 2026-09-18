#!/usr/bin/env bash

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

NEW_PASSWORD="app-$(openssl rand -hex 8)"

echo "1. ALTER ROLE in Postgres…"
docker compose exec -T db psql -U admin -d rental \
  -c "ALTER ROLE app_user WITH PASSWORD '${NEW_PASSWORD}';" >/dev/null


echo "2. Updating secret file…"
printf '%s' "${NEW_PASSWORD}" > ../secrets/app_pg_password

echo "3. Closing all connections app_user…"
docker compose exec -T db psql -U admin -d rental -tA \
  -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename = 'app_user';"
