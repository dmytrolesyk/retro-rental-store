#!/usr/bin/env bash
set -euo pipefail

# Runs on existing databases too; PostgreSQL initdb hooks only run on empty volumes.
auth_password="$(cat /run/secrets/db_pool_auth_password)"
test -n "$auth_password"
psql -Xq -v ON_ERROR_STOP=1 \
  --set=auth_password="$auth_password" \
  --set=app_user="$DB_APP_USER" \
  --set=migration_user="$DB_MIGRATION_USER" >/dev/null <<-'SQL'
  BEGIN;
  SELECT 'CREATE ROLE db_pool_auth LOGIN'
    WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'db_pool_auth') \gexec
  SELECT 'CREATE ROLE db_pool_client NOLOGIN'
    WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'db_pool_client') \gexec
  ALTER ROLE db_pool_auth PASSWORD :'auth_password';
  GRANT CONNECT ON DATABASE rental TO db_pool_auth;
  GRANT db_pool_client TO :"app_user", :"migration_user";

  CREATE SCHEMA IF NOT EXISTS pgbouncer;
  REVOKE ALL ON SCHEMA pgbouncer FROM PUBLIC;
  GRANT USAGE ON SCHEMA pgbouncer TO db_pool_auth;

  CREATE OR REPLACE FUNCTION pgbouncer.user_lookup(requested_user text)
  RETURNS TABLE(username text, password text)
  LANGUAGE sql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT rolname::text,
      CASE WHEN rolvaliduntil < now() THEN NULL ELSE rolpassword END
    FROM pg_authid
    WHERE rolname = requested_user AND rolcanlogin AND NOT rolsuper
      AND pg_has_role(oid, 'db_pool_client', 'MEMBER')
  $$;
  REVOKE ALL ON FUNCTION pgbouncer.user_lookup(text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION pgbouncer.user_lookup(text) TO db_pool_auth;
  COMMIT;
SQL
printf 'PgBouncer authentication configured\n'
