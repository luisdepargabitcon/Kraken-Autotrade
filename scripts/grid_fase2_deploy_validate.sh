#!/usr/bin/env bash
set -euo pipefail

echo "===== DEPLOY GRID FASE 2 SEGURA ====="
cd /opt/krakenbot-staging

echo ""
echo "===== BEFORE HEAD ====="
git log --oneline -5 || true

echo ""
echo "===== GIT PULL ====="
git pull origin main

echo ""
echo "===== AFTER HEAD ====="
git log --oneline -8

echo ""
echo "===== DOCKER BUILD/UP ====="
docker compose -f docker-compose.staging.yml up -d --build

echo ""
echo "===== DOCKER STATUS ====="
docker compose -f docker-compose.staging.yml ps

echo ""
echo "===== GRID STATUS ====="
curl -s 'http://127.0.0.1:3020/api/grid-isolated/status' | jq '{
  mode,
  isActive,
  isRunning,
  realOpenOrdersCount,
  openCycles,
  activeRangeVersionId
}'

echo ""
echo "===== AUDIT SUMMARY ====="
curl -s 'http://127.0.0.1:3020/api/grid-isolated/monitor/audit' | jq '{
  activeRangeVersionId: .levelsSummary.activeRangeVersionId,
  currentPlannedLevelsCount: .levelsSummary.currentPlannedLevelsCount,
  plannedLevelsCount: .levelsSummary.plannedLevelsCount,
  capitalAllocationSummary: .levelsSummary.capitalAllocationSummary
}'

echo ""
echo "===== LOGS RECIENTES ====="
docker compose -f docker-compose.staging.yml logs --since=8m krakenbot-staging-app 2>&1 \
  | grep -Ei 'ERROR|TypeError|ReferenceError|Unhandled|column .* does not exist|relation .* does not exist' \
  | tail -100 || true

echo ""
echo "===== DEPLOY VALIDATION COMPLETE ====="
