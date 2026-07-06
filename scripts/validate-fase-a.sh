#!/bin/bash
# FASE A validation script for VPS staging
echo "=== FASE A VALIDATION ==="

echo ""
echo "=== 1. Health check ==="
curl -s http://localhost:3020/api/health
echo ""

echo ""
echo "=== 2. Docker containers ==="
docker ps --format '{{.Names}} {{.Status}}'

echo ""
echo "=== 3. Migration 065 + tables ==="
docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -t -c "SELECT tablename FROM pg_tables WHERE tablename IN ('telegram_global_config','telegram_alert_events','telegram_command_log') ORDER BY tablename;"

echo ""
echo "=== 4. Telegram global config ==="
docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -t -c "SELECT * FROM telegram_global_config LIMIT 1;"

echo ""
echo "=== 5. Active telegram chats ==="
docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -t -c "SELECT id, chat_id, name, is_active FROM telegram_chats ORDER BY id;"

echo ""
echo "=== 6. API: telegram global config ==="
curl -s http://localhost:3020/api/telegram/global-config
echo ""

echo ""
echo "=== 7. API: telegram commands ==="
curl -s http://localhost:3020/api/telegram/commands
echo ""

echo ""
echo "=== 8. API: telegram alert events ==="
curl -s "http://localhost:3020/api/telegram/alert-events?limit=5"
echo ""

echo ""
echo "=== 9. API: telegram command logs ==="
curl -s "http://localhost:3020/api/telegram/command-logs?limit=5"
echo ""

echo ""
echo "=== 10. App logs (last 30 lines, filter telegram/errors) ==="
docker logs krakenbot-staging-app --tail 100 2>&1 | grep -i "telegram\|error\|migration\|065" | tail -30

echo ""
echo "=== 11. Check for CRITICAL errors ==="
docker logs krakenbot-staging-app --tail 200 2>&1 | grep -i "CRITICAL\|FATAL" | tail -10

echo ""
echo "=== VALIDATION COMPLETE ==="
