#!/usr/bin/env bash
set -euo pipefail

secret_dir="${SECRETS_DIR:-/run/secrets}"
mkdir -p "$secret_dir"
chmod 755 "$secret_dir"

password_file="$secret_dir/db_app_password"
if [[ -s "$password_file" ]]; then
  echo "Application password already exists, keeping it"
else
  temporary_file="$(mktemp "$secret_dir/.db_app_password.XXXXXX")"
  trap 'rm -f "$temporary_file"' EXIT
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "$temporary_file"
  chmod 644 "$temporary_file"
  mv "$temporary_file" "$password_file"
  echo "Application password generated"
fi
