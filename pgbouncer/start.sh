#!/bin/sh
set -eu

# Only the lookup role and console user have local credentials. Application
# credentials are always fetched with auth_query, including after rotation.
umask 077
quote_password() {
  printf '%s' "$1" | sed 's/"/""/g'
}
auth_password="$(cat /run/secrets/db_pool_auth_password)"
test -n "$auth_password"
test -n "${PGPASSWORD:?Set the pooler console password}"
{
  printf '"db_pool_auth" "%s"\n' "$(quote_password "$auth_password")"
  printf '"pgbouncer_admin" "%s"\n' "$(quote_password "$PGPASSWORD")"
} > /tmp/pgbouncer-userlist.txt

exec /usr/bin/pgbouncer /etc/pgbouncer/pgbouncer.ini
