#!/usr/bin/env bash
set -euo pipefail

rotate() {
  # Scheduled and manual rotations share this lock in the credentials volume.
  exec 9>/run/secrets/.rotation.lock
  flock -x 9

  local new_password
  new_password="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"

  psql -v ON_ERROR_STOP=1 --set=app_user="$DB_APP_USER" --set=new_password="$new_password" <<-'EOSQL' >/dev/null
    ALTER ROLE :"app_user" WITH PASSWORD :'new_password';
EOSQL

  # Rename within the shared directory prevents readers seeing a partial file.
  local temporary_file
  temporary_file="$(mktemp /run/secrets/.db_app_password.XXXXXX)"
  trap 'rm -f "$temporary_file"' EXIT
  printf '%s' "$new_password" > "$temporary_file"
  chmod 644 "$temporary_file"
  mv "$temporary_file" /run/secrets/db_app_password
  trap - EXIT

  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') rotated application password; existing sessions retained"

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
