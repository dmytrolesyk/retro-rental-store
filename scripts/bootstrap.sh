#!/usr/bin/env bash
set -euo pipefail

secret_dir="${SECRETS_DIR:-/run/secrets}"
mkdir -p "$secret_dir"
chmod 755 "$secret_dir"

for secret_name in db_app_password db_pool_auth_password; do
  password_file="$secret_dir/$secret_name"
  if [[ -s "$password_file" ]]; then
    echo "$secret_name already exists, keeping it"
  else
    temporary_file="$(mktemp "$secret_dir/.$secret_name.XXXXXX")"
    trap 'rm -f "$temporary_file"' EXIT
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "$temporary_file"
    chmod 644 "$temporary_file"
    mv "$temporary_file" "$password_file"
    trap - EXIT
    echo "$secret_name generated"
  fi
done
