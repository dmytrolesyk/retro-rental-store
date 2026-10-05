#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <query-file.sql>" >&2
  exit 2
fi

query_file=$1

if [[ ! -f $query_file || ! -r $query_file ]]; then
  echo "Query file is not readable: ${query_file}" >&2
  exit 2
fi

query=$(<"${query_file}")
project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

echo "sql> EXPLAIN (ANALYZE, BUFFERS) ${query}"

cd "${project_root}"
docker compose exec -T db psql -U admin -d rental \
  -P pager=off \
  -v ON_ERROR_STOP=1 \
  -c "EXPLAIN (ANALYZE, BUFFERS) ${query}"
