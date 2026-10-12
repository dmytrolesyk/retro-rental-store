#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Use the same rotation implementation and lock as the scheduled rotator.
exec docker compose exec -T rotator /usr/local/bin/rotate-loop.sh --once
