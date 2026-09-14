#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

mkdir -p secrets

for name in admin_pg_password app_pg_password; do
  file="secrets/${name}"
  if [[ -s ${file} ]]; then
    echo "${file} already exists, skipping"
  else
    openssl rand -hex 16 > "${file}"
    chmod 600 "${file}"
    echo "${file} generated"
  fi
done
