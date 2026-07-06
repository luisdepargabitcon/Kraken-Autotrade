#!/usr/bin/env bash
set -euo pipefail

echo "===== TABLES ====="
docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('telegram_bot_tokens','telegram_alert_rules','telegram_chats','telegram_alert_events')
ORDER BY table_name;"

echo ""
echo "===== TELEGRAM_CHATS COLUMNS ====="
docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'telegram_chats'
AND column_name IN ('token_id','enabled_modes','enabled_alerts')
ORDER BY column_name;"

echo ""
echo "===== TELEGRAM_ALERT_EVENTS COLUMNS ====="
docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'telegram_alert_events'
AND column_name IN ('token_id','channel_id','chat_id','status','block_reason')
ORDER BY column_name;"

echo ""
echo "===== SCHEMA_MIGRATIONS 066/067 ====="
docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "
SELECT id, applied_at FROM schema_migrations WHERE id LIKE '066%' OR id LIKE '067%' ORDER BY id;"

echo ""
echo "===== ALERT RULES DATA ====="
docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "
SELECT id, chat_id, mode, alert_type, enabled FROM telegram_alert_rules ORDER BY mode, alert_type LIMIT 20;"

echo ""
echo "===== ENDPOINTS ====="
echo "TOKENS:"
curl -s http://127.0.0.1:3020/api/telegram/tokens
echo ""
echo "ALERT_RULES:"
curl -s http://127.0.0.1:3020/api/telegram/alert-rules
echo ""
echo "COMMANDS_COUNT:"
curl -s http://127.0.0.1:3020/api/telegram/commands | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "parse_error"
echo ""
echo "GRID_ALERT_CATALOG_COUNT:"
curl -s http://127.0.0.1:3020/api/telegram/grid-alert-catalog | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "parse_error"

echo ""
echo "===== LOGS ERRORS ====="
docker compose -f /opt/krakenbot-staging/docker-compose.staging.yml logs --tail=500 krakenbot-staging-app 2>&1 | grep -Ei "DATABASE_ERROR|ERROR CRITICAL|column.*token_id|migration.*066|migration.*067" | tail -10 || echo "NO_ERRORS_FOUND"

echo ""
echo "===== DONE ====="
