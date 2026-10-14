#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y docker.io docker-compose-v2
  sudo systemctl enable --now docker
fi
preview_ip="$(hostname -I | awk '{print $1}')"
sudo env PUBLIC_ORIGIN="http://${preview_ip}" PORT=80 BIND_ADDRESS=0.0.0.0 COOKIE_SECURE=0 docker compose -f compose.yaml up -d --build --wait --wait-timeout 300
echo 'Preview runs at http://VPS_IP . Admin access:'
sudo docker compose -f compose.yaml exec -T website cat /app/data/admin-access.txt
