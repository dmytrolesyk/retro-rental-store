#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

seed_database="${SEED_DATABASE:-rental}"
seed_file="${1:-db/seed.sql}"
if [[ ! ${seed_database} =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "Invalid seed database name: ${seed_database}" >&2
  exit 1
fi

docker compose exec -T db sh -c '
  exec psql \
    --username "$POSTGRES_USER" \
    --dbname "$1" \
    -v ON_ERROR_STOP=1
' sh "${seed_database}" < "${seed_file}"
