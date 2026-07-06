#!/usr/bin/env bash
echo "===== ALL MIGRATIONS ====="
docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "SELECT id FROM schema_migrations ORDER BY id;"
echo ""
echo "===== 067 LOGS ====="
docker compose -f /opt/krakenbot-staging/docker-compose.staging.yml logs --tail=2000 krakenbot-staging-app 2>&1 | grep '067' | head -10
echo ""
echo "===== AUTO-MIGRATE LOGS ====="
docker compose -f /opt/krakenbot-staging/docker-compose.staging.yml logs --tail=2000 krakenbot-staging-app 2>&1 | grep 'auto-migrate' | head -20
echo ""
echo "===== RESTART COUNT ====="
docker inspect krakenbot-staging-app --format='{{.RestartCount}}'
