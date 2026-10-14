#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
backup="backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
compose=(docker compose -f compose.production.yaml)
bot_container="$("${compose[@]}" ps -q telegram-bot)"
bot_running=false
if [[ -n "$bot_container" ]] && [[ "$(docker inspect -f '{{.State.Running}}' "$bot_container")" == true ]]; then
  bot_running=true
  "${compose[@]}" stop telegram-bot
fi
restore_services() {
  "${compose[@]}" start website >/dev/null
  if $bot_running; then "${compose[@]}" start telegram-bot >/dev/null; fi
}
trap restore_services EXIT
"${compose[@]}" stop website
"${compose[@]}" cp website:/app/data "$backup/data"
"${compose[@]}" cp website:/app/public/assets/uploads "$backup/uploads"
if [[ -n "$bot_container" ]]; then "${compose[@]}" cp telegram-bot:/app/state "$backup/telegram-state"; fi
cp .env "$backup/env"
cp deploy/Caddyfile "$backup/Caddyfile"
git rev-parse HEAD > "$backup/commit.txt"
echo "Backup saved: $backup"
