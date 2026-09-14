#!/usr/bin/env bash
set -euo pipefail

export PGPASSWORD="$(cat /run/secrets/admin_pg_password)"

rotate() {
  local new_password
  new_password="app-$(head -c 32 /dev/urandom | md5sum | head -c 16)"

  psql -v ON_ERROR_STOP=1 \
    -c "ALTER ROLE app_user WITH PASSWORD '${new_password}';" >/dev/null

  printf '%s' "${new_password}" > /secrets/app_pg_password

  psql -tA \
    -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename = 'app_user';" \
    | xargs -I{} echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') rotated app_user password, terminated {} connection(s)"
}

echo "rotator started, interval: ${ROTATE_INTERVAL:-86400}s"
while true; do
  sleep "${ROTATE_INTERVAL:-86400}"
  rotate
done
