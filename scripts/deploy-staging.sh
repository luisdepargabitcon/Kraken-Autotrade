#!/bin/sh
set -e

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

sh ./scripts/stamp-version.sh

docker compose -f docker-compose.staging.yml up -d --build
