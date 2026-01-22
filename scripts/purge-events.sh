#!/bin/bash
# =============================================================================
# PURGE EVENTS & LOGS - Limpieza automática de eventos y logs antiguos
# =============================================================================
# Este script elimina eventos (bot_events) y logs del servidor (server_logs)
# con más de N días de antigüedad. Diseñado para ejecutarse via cron diariamente.
#
# USO:
#   ./purge-events.sh [RETENTION_DAYS] [API_URL]
#
# EJEMPLOS:
#   ./purge-events.sh                    # 7 días, localhost:3020
#   ./purge-events.sh 14                 # 14 días, localhost:3020
#   ./purge-events.sh 7 http://app:3020  # 7 días, URL custom (Docker)
#
# CRON (03:00 UTC diario):
#   0 3 * * * /opt/krakenbot-staging/scripts/purge-events.sh >> /var/log/krakenbot-purge.log 2>&1
# =============================================================================

set -e

# Configuración
RETENTION_DAYS="${1:-7}"
API_URL="${2:-http://127.0.0.1:3020}"
LOG_PREFIX="[PURGE]"
DATE=$(date '+%Y-%m-%d %H:%M:%S UTC' -u)

echo "$LOG_PREFIX [$DATE] Iniciando purga (retención: ${RETENTION_DAYS} días)..."

# Verificar que la API está disponible
if ! curl -s -o /dev/null -w "%{http_code}" "${API_URL}/api/health" | grep -q "200"; then
    echo "$LOG_PREFIX [$DATE] ERROR: API no disponible en ${API_URL}"
    exit 1
fi

# ============================================================================
# 1) Purgar EVENTOS (bot_events)
# ============================================================================
echo "$LOG_PREFIX [$DATE] Purgando eventos..."
RESPONSE_EVENTS=$(curl -s -X POST "${API_URL}/api/admin/purge-events" \
    -H "Content-Type: application/json" \
    -d "{\"retentionDays\":${RETENTION_DAYS},\"dryRun\":false,\"confirm\":true}")

# Parsear respuesta eventos
SUCCESS_EVENTS=$(echo "$RESPONSE_EVENTS" | grep -o '"success":true' || echo "")
DELETED_EVENTS=$(echo "$RESPONSE_EVENTS" | grep -o '"deletedCount":[0-9]*' | grep -o '[0-9]*' || echo "0")
REMAINING_EVENTS=$(echo "$RESPONSE_EVENTS" | grep -o '"remainingCount":[0-9]*' | grep -o '[0-9]*' || echo "?")

if [ -n "$SUCCESS_EVENTS" ]; then
    echo "$LOG_PREFIX [$DATE] EVENTOS: Eliminados ${DELETED_EVENTS}, quedan ${REMAINING_EVENTS}"
else
    echo "$LOG_PREFIX [$DATE] ERROR eventos: $RESPONSE_EVENTS"
fi

# ============================================================================
# 2) Purgar LOGS del servidor (server_logs)
# ============================================================================
echo "$LOG_PREFIX [$DATE] Purgando logs del servidor..."
RESPONSE_LOGS=$(curl -s -X POST "${API_URL}/api/admin/purge-logs" \
    -H "Content-Type: application/json" \
    -d "{\"retentionDays\":${RETENTION_DAYS},\"dryRun\":false,\"confirm\":true}")

# Parsear respuesta logs
SUCCESS_LOGS=$(echo "$RESPONSE_LOGS" | grep -o '"success":true' || echo "")
DELETED_LOGS=$(echo "$RESPONSE_LOGS" | grep -o '"deletedCount":[0-9]*' | grep -o '[0-9]*' || echo "0")
REMAINING_LOGS=$(echo "$RESPONSE_LOGS" | grep -o '"remainingCount":[0-9]*' | grep -o '[0-9]*' || echo "?")

if [ -n "$SUCCESS_LOGS" ]; then
    echo "$LOG_PREFIX [$DATE] LOGS: Eliminados ${DELETED_LOGS}, quedan ${REMAINING_LOGS}"
else
    echo "$LOG_PREFIX [$DATE] ERROR logs: $RESPONSE_LOGS"
fi

# ============================================================================
# Resumen final
# ============================================================================
echo "$LOG_PREFIX [$DATE] Purga completada - Eventos: -${DELETED_EVENTS}, Logs: -${DELETED_LOGS}"
