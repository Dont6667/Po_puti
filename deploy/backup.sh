#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
backup="backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
compose=(docker compose -f compose.production.yaml)
"${compose[@]}" stop website
trap '"${compose[@]}" start website >/dev/null' EXIT
"${compose[@]}" cp website:/app/data "$backup/data"
"${compose[@]}" cp website:/app/public/assets/uploads "$backup/uploads"
cp .env "$backup/env"
git rev-parse HEAD > "$backup/commit.txt"
echo "Backup saved: $backup"
