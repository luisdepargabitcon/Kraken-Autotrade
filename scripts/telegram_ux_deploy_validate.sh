#!/usr/bin/env bash
set -euo pipefail

cd /opt/krakenbot-staging

echo "===== 1) GIT STATUS ANTES ====="
git status --short

echo ""
echo "===== 2) GIT FETCH/PULL ====="
git fetch origin
git pull --ff-only origin main

echo ""
echo "===== 3) COMMIT VPS ====="
git log --oneline -12

echo ""
echo "===== 4) DEPLOY STAGING ====="
docker compose -f docker-compose.staging.yml up -d --build

echo ""
echo "===== 5) ESPERAR APP ====="
sleep 50

echo ""
echo "===== 6) DOCKER PS ====="
docker compose -f docker-compose.staging.yml ps

echo ""
echo "===== 7) HEALTH ====="
curl -s http://127.0.0.1:3020/api/health | jq .

echo ""
echo "===== 8) API TELEGRAM CHANNELS ====="
curl -s http://127.0.0.1:3020/api/telegram/channels | jq .

echo ""
echo "===== 9) API TELEGRAM TOKENS ====="
curl -s http://127.0.0.1:3020/api/telegram/tokens | jq .

echo ""
echo "===== 10) API TELEGRAM ALERT RULES ====="
curl -s http://127.0.0.1:3020/api/telegram/alert-rules | jq '{
  total: length,
  byMode: group_by(.mode) | map({mode: .[0].mode, total: length, enabled: map(select(.enabled == true)) | length, disabled: map(select(.enabled == false)) | length})
}'

echo ""
echo "===== 11) API TELEGRAM AUDIT ====="
curl -s http://127.0.0.1:3020/api/telegram/audit | jq .

echo ""
echo "===== 12) API TELEGRAM COMMANDS ====="
curl -s http://127.0.0.1:3020/api/telegram/commands | jq '{
  total: length,
  required: [
    "/telegram_status",
    "/grid_status",
    "/grid_observer",
    "/idca_status",
    "/spot_status",
    "/health",
    "/status"
  ],
  foundRequired: [.[] | select(.name as $n | ["/telegram_status","/grid_status","/grid_observer","/idca_status","/spot_status","/health","/status"] | index($n)) | .name]
}'

echo ""
echo "===== 13) API GRID ALERT CATALOG ====="
curl -s http://127.0.0.1:3020/api/telegram/grid-alert-catalog | jq '{
  total: length,
  observerForbidden: [.[] | select(.observerOnlyType == true) | select(.naturalTemplate | test("ejecutado|orden creada|compra preparada"; "i"))],
  first: .[0]
}'

echo ""
echo "===== 14) DB TABLAS TELEGRAM ====="
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
echo "===== 15) DB COLUMNAS TELEGRAM_CHATS ====="
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
echo "===== 16) DB COLUMNAS TELEGRAM_ALERT_EVENTS ====="
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
echo "===== 17) DB CANALES ====="
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
echo "===== 18) DB ALERT RULES POR CANAL ====="
docker compose -f docker-compose.staging.yml exec -T krakenbot-staging-db sh -lc '
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
SELECT
  c.id AS channel_id,
  c.name,
  c.is_active,
  c.alert_preferences,
  r.mode,
  r.alert_type,
  r.enabled,
  r.min_severity,
  r.cooldown_seconds
FROM telegram_chats c
LEFT JOIN telegram_alert_rules r ON r.chat_id = c.id
ORDER BY c.id, r.mode, r.alert_type;
"
'

echo ""
echo "===== 19) DB MIGRATIONS 066/067/068 ====="
docker compose -f docker-compose.staging.yml exec -T krakenbot-staging-db sh -lc '
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
SELECT id, applied_at
FROM schema_migrations
WHERE id IN (
  '\''066_telegram_bot_tokens'\'',
  '\''067_telegram_alert_rules'\'',
  '\''068_disable_legacy_alert_rules'\''
)
ORDER BY id;
"
'

echo ""
echo "===== 20) API TEST CRUD CANAL TEMPORAL ====="

CREATE_RESPONSE=$(curl -s -X POST http://127.0.0.1:3020/api/telegram/channels \
  -H "Content-Type: application/json" \
  -d '{
    "name":"TEST API CANAL INACTIVO",
    "chatId":"-999999999001",
    "isActive":false,
    "isDefault":false,
    "alertTrades":false,
    "alertErrors":false,
    "alertSystem":false,
    "alertBalance":false,
    "alertHeartbeat":false,
    "enabledModes":[],
    "enabledAlerts":[]
  }')

echo "$CREATE_RESPONSE" | jq .

TEST_ID=$(echo "$CREATE_RESPONSE" | jq -r ".id // empty")

if [ -z "$TEST_ID" ]; then
  echo "ERROR: No se pudo crear canal temporal por API"
  exit 1
fi

echo ""
echo "Canal temporal creado con ID=$TEST_ID"

echo ""
echo "===== 21) API TEST EDITAR CANAL TEMPORAL ====="
curl -s -X PUT "http://127.0.0.1:3020/api/telegram/channels/$TEST_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"TEST API CANAL EDITADO",
    "chatId":"-999999999001",
    "isActive":false,
    "isDefault":false,
    "alertTrades":false,
    "alertErrors":false,
    "alertSystem":false,
    "alertBalance":false,
    "alertHeartbeat":false,
    "enabledModes":[],
    "enabledAlerts":[]
  }' | jq .

echo ""
echo "===== 22) API TEST VERIFICAR CANAL TEMPORAL ====="
curl -s http://127.0.0.1:3020/api/telegram/channels | jq '.[] | select(.chatId=="-999999999001")'

echo ""
echo "===== 23) API TEST BORRAR CANAL TEMPORAL ====="
curl -s -X DELETE "http://127.0.0.1:3020/api/telegram/channels/$TEST_ID" | jq .

echo ""
echo "===== 24) API TEST VERIFICAR BORRADO ====="
REMAINING=$(curl -s http://127.0.0.1:3020/api/telegram/channels | jq '[.[] | select(.chatId=="-999999999001")] | length')
echo "remaining_temp_channels=$REMAINING"
if [ "$REMAINING" != "0" ]; then
  echo "ERROR: Canal temporal no fue eliminado"
  exit 1
fi

echo ""
echo "===== 25) VALIDAR BUNDLE/FRONTEND TEXTOS UX NUEVA ====="
docker compose -f docker-compose.staging.yml exec -T krakenbot-staging-app sh -lc '
echo "--- Buscar Tokens ---"
grep -R "Tokens" /app/dist/public/assets/*.js | head -3 || true

echo "--- Buscar Añadir canal ---"
grep -R "Añadir canal\|Añadir Canal" /app/dist/public/assets/*.js | head -3 || true

echo "--- Buscar SPOT Dry Run ---"
grep -R "SPOT Dry Run" /app/dist/public/assets/*.js | head -3 || true

echo "--- Buscar Grid / Hybrid ---"
grep -R "Grid / Hybrid" /app/dist/public/assets/*.js | head -3 || true

echo "--- Buscar Alertas por modo viejo ---"
grep -R "Alertas por modo" /app/dist/public/assets/*.js | head -3 || true

echo "--- Buscar Configurar Grid Isolated viejo ---"
grep -R "Configurar Grid Isolated" /app/dist/public/assets/*.js | head -3 || true

echo "--- Buscar Configurar alertas fiscales viejo ---"
grep -R "Configurar alertas fiscales" /app/dist/public/assets/*.js | head -3 || true
'

echo ""
echo "===== 26) VALIDAR HTTP SPA CACHE-BUST ====="
curl -s -I "http://127.0.0.1:3020/telegram?v=telegram-ux-final-ad2c683" | head -20

echo ""
echo "===== 27) LOGS ERRORES TELEGRAM ====="
docker compose -f docker-compose.staging.yml logs --tail=1000 krakenbot-staging-app 2>&1 | grep -Ei "DATABASE_ERROR|ERROR CRITICAL|telegram/channels|telegram/tokens|telegram/alert-rules|NOT_FOUND| 500 |token completo|this.chatId|fallback|legacy|column .*token_id|telegram_alert_rules" || true

echo ""
echo "===== 28) DOCKER PS FINAL ====="
docker compose -f docker-compose.staging.yml ps

echo ""
echo "===== VALIDACIÓN VPS/API/DB/FRONTEND COMPLETADA ====="
