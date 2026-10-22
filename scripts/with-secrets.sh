#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || -z "$1" ]]; then
  printf 'Usage: bash scripts/with-secrets.sh <environment> <command> [args...]\n' >&2
  exit 2
fi

secrets_environment="$1"
shift

# Explicit grading/local fallback: use DB_* already present in the environment.
if [[ "${SKIP_VAULT:-0}" == "1" ]]; then
  exec "$@"
fi

if ! command -v infisical >/dev/null 2>&1; then
  printf 'Infisical CLI is unavailable. For local DB_* credentials, set SKIP_VAULT=1.\n' >&2
  exit 1
fi

exec infisical run --env="$secrets_environment" -- "$@"
