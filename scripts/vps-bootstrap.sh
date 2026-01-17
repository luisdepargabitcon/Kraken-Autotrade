#!/usr/bin/env sh
set -eu

# VPS bootstrap script for Krakenbot staging
# - Pull latest code
# - Rebuild app image
# - Start containers (DB + app)
# - Run non-interactive migrations on container start (Dockerfile runs script/migrate.ts)
# - Quick health check

COMPOSE_FILE="docker-compose.staging.yml"

printf "[vps-bootstrap] Updating repo...\n"
git pull origin main

printf "[vps-bootstrap] Building image (no cache)...\n"
docker compose -f "$COMPOSE_FILE" build --no-cache

printf "[vps-bootstrap] Starting services...\n"
docker compose -f "$COMPOSE_FILE" up -d

printf "[vps-bootstrap] Waiting a few seconds for app to come up...\n"
sleep 5

printf "[vps-bootstrap] Health check...\n"
# Uses VPS_PANEL_URL for curl if provided; fallback to localhost:3020
BASE_URL=${VPS_PANEL_URL:-"http://127.0.0.1:3020"}

curl -fsS "$BASE_URL/api/health" | head -c 500 || true
printf "\n[vps-bootstrap] Done.\n"
