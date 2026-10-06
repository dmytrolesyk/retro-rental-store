#!/usr/bin/env bash
set -euo pipefail

rotate() {
  # Scheduled and manual rotations share this lock in the credentials volume.
  exec 9>/run/secrets/.rotation.lock
  flock -x 9

  local new_password
  new_password="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"

  psql -v ON_ERROR_STOP=1 --set=new_password="$new_password" <<-'EOSQL' >/dev/null
    ALTER ROLE app_user WITH PASSWORD :'new_password';
EOSQL

  # Rename within the shared directory prevents readers seeing a partial file.
  local temporary_file
  temporary_file="$(mktemp /run/secrets/.app_pg_password.XXXXXX)"
  trap 'rm -f "$temporary_file"' EXIT
  printf '%s' "$new_password" > "$temporary_file"
  chmod 644 "$temporary_file"
  mv "$temporary_file" /run/secrets/app_pg_password
  trap - EXIT

  psql -v ON_ERROR_STOP=1 -tA \
    -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename = 'app_user' AND pid <> pg_backend_pid();" \
    | xargs -I{} echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') rotated app_user password, terminated {} connection(s)"

  exec 9>&-
}

if [[ "${1:-}" == "--once" ]]; then
  rotate
  exit 0
fi

echo "rotator started, interval: ${ROTATE_INTERVAL:-86400}s"
while true; do
  sleep "${ROTATE_INTERVAL:-86400}"
  rotate
done
