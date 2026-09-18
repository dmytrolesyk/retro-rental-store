#!/usr/bin/env bash
set -euo pipefail

APP_PASSWORD="$(cat /run/secrets/app_pg_password)"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	CREATE ROLE app_user LOGIN PASSWORD '${APP_PASSWORD}';
	GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO app_user;
EOSQL
