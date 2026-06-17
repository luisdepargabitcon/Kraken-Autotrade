#!/usr/bin/env bash
set -euo pipefail

# vps-predeploy-clean-sync.sh
# Limpieza segura + sincronización del repo en VPS antes del deploy.
#
# USO:
#   bash scripts/vps-predeploy-clean-sync.sh
#
# Este script NO ejecuta docker compose NI hace deploy.
# Su único objetivo es dejar el repo limpio y en sync con origin/main.
#
# SEGURO: No borra backups/, *.sql, informes fiscales ni rutas del proyecto.

cd /opt/krakenbot-staging

echo "===== PREDEPLOY SAFE CLEAN + SYNC ====="

echo ""
echo "===== ESTADO INICIAL ====="
git status --short

echo ""
echo "===== RESTAURAR PACKAGE LOCAL SI ESTÁ MODIFICADO ====="
git restore package.json package-lock.json 2>/dev/null || true

echo ""
echo "===== LIMPIAR BASURA CONOCIDA ====="
# Archivos generados por comandos mal pegados en el shell del VPS
rm -f \
  "168h." \
  "72h." \
  "F1-03:" \
  "F3-05:" \
  "FiscoAutoSyncService" \
  "docker" \
  "events.ndjson" \
  "git" \
  "instanceId" \
  "logs.txt" \
  "npm" \
  "npx" \
  "rest-express@1.0.0" \
  "tsc" \
  "umbral:" \
  || true

echo ""
echo "===== FETCH ORIGIN ====="
git fetch origin --prune

echo ""
echo "===== PULL MAIN ====="
git pull origin main

echo ""
echo "===== VERIFICAR HEAD ====="
LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse origin/main)"

echo "LOCAL_HEAD=$LOCAL_HEAD"
echo "REMOTE_HEAD=$REMOTE_HEAD"

if [ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]; then
  echo "ERROR: HEAD local no coincide con origin/main"
  exit 1
fi

echo ""
echo "===== ÚLTIMOS COMMITS ====="
git log --oneline -5

echo ""
echo "===== ESTADO FINAL ====="
git status --short

echo ""
echo "OK: Repo sincronizado. Ya puedes ejecutar el deploy docker."
echo ""
echo "  docker compose -f docker-compose.staging.yml up -d --build"
echo ""
