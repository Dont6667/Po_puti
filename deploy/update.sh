#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -z "$(git status --porcelain)" ]] || { echo 'Commit or restore local changes before updating.'; exit 1; }
bash deploy/backup.sh
git pull --ff-only
bash deploy/start.sh
