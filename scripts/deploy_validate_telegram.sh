#!/usr/bin/env bash
set -euo pipefail

cd /opt/krakenbot-staging

echo "===== 1) GIT FETCH/PULL ====="
git fetch origin
git pull --ff-only origin main

echo ""
echo "===== 2) COMMIT VPS ====="
git log --oneline -10

echo ""
echo "===== 3) DEPLOY STAGING ====="
docker compose -f docker-compose.staging.yml up -d --build

echo ""
echo "===== 4) ESPERAR APP ====="
sleep 45

echo ""
echo "===== 5) DOCKER PS ====="
docker compose -f docker-compose.staging.yml ps

echo ""
echo "===== 6) HEALTH ====="
curl -s http://127.0.0.1:3020/api/health | jq .

echo ""
echo "===== 7) VALIDAR TABLAS NUEVAS ====="
docker compose -f docker-compose.staging.yml exec -T krakenbot-staging-db sh -lc '
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
SELECT table_name
FROM information_schema.tables
WHERE table_schema = '\''public'\''
AND table_name IN (
  '\''telegram_bot_tokens'\'',
  '\''telegram_alert_rules'\'',
  '\''telegram_chats'\'',
  '\''telegram_alert_events'\''
)
ORDER BY table_name;
"
'

echo ""
echo "===== 8) VALIDAR COLUMNAS TELEGRAM_CHATS ====="
docker compose -f docker-compose.staging.yml exec -T krakenbot-staging-db sh -lc '
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = '\''public'\''
AND table_name = '\''telegram_chats'\''
AND column_name IN (
  '\''token_id'\'',
  '\''enabled_modes'\'',
  '\''enabled_alerts'\''
)
ORDER BY column_name;
"
'

echo ""
echo "===== 9) VALIDAR COLUMNAS TELEGRAM_ALERT_EVENTS ====="
docker compose -f docker-compose.staging.yml exec -T krakenbot-staging-db sh -lc '
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = '\''public'\''
AND table_name = '\''telegram_alert_events'\''
AND column_name IN (
  '\''token_id'\'',
  '\''channel_id'\'',
  '\''chat_id'\'',
  '\''status'\'',
  '\''block_reason'\''
)
ORDER BY column_name;
"
'

echo ""
echo "===== 10) VALIDAR TOKENS API ====="
curl -s http://127.0.0.1:3020/api/telegram/tokens | jq .

echo ""
echo "===== 11) VALIDAR CHANNELS API ====="
curl -s http://127.0.0.1:3020/api/telegram/channels | jq .

echo ""
echo "===== 12) VALIDAR ALERT RULES API ====="
curl -s http://127.0.0.1:3020/api/telegram/alert-rules | jq .

echo ""
echo "===== 13) VALIDAR AUDIT API ====="
curl -s http://127.0.0.1:3020/api/telegram/audit | jq .

echo ""
echo "===== 14) VALIDAR COMMANDS API ====="
curl -s http://127.0.0.1:3020/api/telegram/commands | jq '.[] | {name, permission, module, deprecated, aliasOf, requiresConfirmation}'

echo ""
echo "===== 15) VALIDAR GRID ALERT CATALOG ====="
curl -s http://127.0.0.1:3020/api/telegram/grid-alert-catalog | jq '{total: length, first: .[0]}'

echo ""
echo "===== 16) CANALES DB ====="
docker compose -f docker-compose.staging.yml exec -T krakenbot-staging-db sh -lc '
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
SELECT
  id,
  name,
  chat_id,
  token_id,
  is_active,
  is_default,
  enabled_modes,
  enabled_alerts,
  alert_preferences
FROM telegram_chats
ORDER BY id;
"
'

echo ""
echo "===== 17) TOKENS DB SIN MOSTRAR TOKEN COMPLETO ====="
docker compose -f docker-compose.staging.yml exec -T krakenbot-staging-db sh -lc '
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
SELECT
  id,
  name,
  token_last4,
  is_active,
  is_default,
  environment,
  last_validated_at,
  last_error
FROM telegram_bot_tokens
ORDER BY id;
"
'

echo ""
echo "===== 18) ALERT RULES DB ====="
docker compose -f docker-compose.staging.yml exec -T krakenbot-staging-db sh -lc '
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
SELECT
  id,
  chat_id,
  mode,
  alert_type,
  enabled,
  min_severity,
  cooldown_seconds
FROM telegram_alert_rules
ORDER BY mode, alert_type
LIMIT 80;
"
'

echo ""
echo "===== 19) ALERT EVENTS RECIENTES ====="
docker compose -f docker-compose.staging.yml exec -T krakenbot-staging-db sh -lc '
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
SELECT
  timestamp,
  source_module,
  mode,
  alert_type,
  severity,
  token_id,
  channel_id,
  chat_id,
  status,
  block_reason,
  natural_message
FROM telegram_alert_events
ORDER BY timestamp DESC
LIMIT 40;
"
'

echo ""
echo "===== 20) LOGS ERRORES ====="
docker compose -f docker-compose.staging.yml logs --tail=900 krakenbot-staging-app 2>&1 | grep -Ei "DATABASE_ERROR|ERROR CRITICAL|migration|066|067|telegram_bot_tokens|telegram_alert_rules|blocked_by_token|blocked_by_alert_rule|blocked_by_no_matching_channel|fallback|this.chatId|api_config.telegram_chat_id|institutional_dca_config.telegram_chat_id|fisco_alert_config.chat_id" || true

echo ""
echo "===== VALIDACION COMPLETADA ====="
