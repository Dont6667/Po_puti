#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo 'First configure the website and DOMAIN in .env.'; exit 1; }
umask 077
read -r -s -p 'BotFather token (hidden): ' telegram_token
printf '\n'
[[ "$telegram_token" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]] || { echo 'Invalid bot token format.'; exit 1; }
read -r -p 'Admin IDs [6056397902,5673533667,923586346]: ' telegram_admins
telegram_admins="${telegram_admins:-6056397902,5673533667,923586346}"
[[ "$telegram_admins" =~ ^[0-9]+(,[0-9]+)*$ ]] || { echo 'Use comma-separated numeric user IDs.'; exit 1; }
telegram_key="$(awk -F= '$1=="TELEGRAM_API_KEY"{print substr($0,index($0,"=")+1)}' .env | tail -1)"
if [[ ! "$telegram_key" =~ ^[a-f0-9]{64}$ ]]; then
  telegram_key="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
fi
env_backup=".env.telegram-backup-$(date -u +%Y%m%dT%H%M%SZ)"
cp .env "$env_backup"
chmod 600 "$env_backup"
temporary_env="$(mktemp .env.telegram.XXXXXX)"
trap 'rm -f "$temporary_env"' EXIT
awk '!/^(TELEGRAM_BOT_TOKEN|TELEGRAM_ADMIN_IDS|TELEGRAM_API_KEY|COMPOSE_PROFILES)=/' .env > "$temporary_env"
printf '\nTELEGRAM_BOT_TOKEN=%s\nTELEGRAM_ADMIN_IDS=%s\nTELEGRAM_API_KEY=%s\nCOMPOSE_PROFILES=telegram\n' "$telegram_token" "$telegram_admins" "$telegram_key" >> "$temporary_env"
chmod 600 "$temporary_env"
mv "$temporary_env" .env
unset telegram_token telegram_key
bash deploy/start.sh
echo 'Both admins must open the bot in Telegram and press Start.'
