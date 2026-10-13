#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env ]]; then
  [[ -n "${1:-}" ]] || { echo 'Usage: bash deploy/start.sh example.ru'; exit 1; }
  [[ "$1" =~ ^[a-zA-Z0-9.-]+$ ]] || { echo 'Invalid domain'; exit 1; }
  umask 077
  printf 'DOMAIN=%s\n' "$1" > .env
fi
command -v docker >/dev/null || { echo 'Install Docker first: see DEPLOY.md'; exit 1; }
docker compose -f compose.production.yaml up -d --build --wait --wait-timeout 300
echo 'Admin access (use your domain instead of the internal host):'
docker compose -f compose.production.yaml exec -T website cat /app/data/admin-access.txt
