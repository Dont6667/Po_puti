#!/usr/bin/env bash
set -euo pipefail
[[ -n "${1:-}" ]] || { echo 'Usage: bash deploy/bootstrap.sh example.ru'; exit 1; }
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y docker.io docker-compose-v2
  sudo systemctl enable --now docker
fi
sudo bash "$(dirname "$0")/start.sh" "$1"
