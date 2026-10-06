#!/usr/bin/env bash
set -euo pipefail

app_password="$(cat /run/secrets/app_pg_password)"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$app_password" \
  --set=migration_user="$MIGRATION_USER" \
  --set=migration_password="$MIGRATION_PASSWORD" \
  --set=database_name="$POSTGRES_DB" <<-'EOSQL'
  CREATE ROLE app_user LOGIN PASSWORD :'app_password';
  CREATE ROLE :"migration_user" LOGIN PASSWORD :'migration_password';

  GRANT CONNECT ON DATABASE :"database_name" TO app_user;
  GRANT CONNECT, CREATE ON DATABASE :"database_name" TO :"migration_user";
  GRANT USAGE ON SCHEMA public TO app_user;
  GRANT USAGE, CREATE ON SCHEMA public TO :"migration_user";

  ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_user" IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
  ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_user" IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO app_user;
EOSQL
