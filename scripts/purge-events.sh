#!/bin/bash
# =============================================================================
# PURGE EVENTS - Limpieza automática de eventos antiguos
# =============================================================================
# Este script elimina eventos de bot_events con más de N días de antigüedad.
# Diseñado para ejecutarse via cron diariamente.
#
# USO:
#   ./purge-events.sh [RETENTION_DAYS] [API_URL]
#
# EJEMPLOS:
#   ./purge-events.sh                    # 7 días, localhost:3020
#   ./purge-events.sh 14                 # 14 días, localhost:3020
#   ./purge-events.sh 7 http://app:3020  # 7 días, URL custom (Docker)
#
# CRON (03:30 UTC diario):
#   30 3 * * * /opt/krakenbot-staging/scripts/purge-events.sh >> /var/log/krakenbot-purge.log 2>&1
# =============================================================================

set -e

# Configuración
RETENTION_DAYS="${1:-7}"
API_URL="${2:-http://127.0.0.1:3020}"
LOG_PREFIX="[PURGE-EVENTS]"
DATE=$(date '+%Y-%m-%d %H:%M:%S UTC' -u)

echo "$LOG_PREFIX [$DATE] Iniciando purga de eventos (retención: ${RETENTION_DAYS} días)..."

# Verificar que la API está disponible
if ! curl -s -o /dev/null -w "%{http_code}" "${API_URL}/api/health" | grep -q "200"; then
    echo "$LOG_PREFIX [$DATE] ERROR: API no disponible en ${API_URL}"
    exit 1
fi

# Ejecutar purga
RESPONSE=$(curl -s -X POST "${API_URL}/api/admin/purge-events" \
    -H "Content-Type: application/json" \
    -d "{\"retentionDays\":${RETENTION_DAYS},\"dryRun\":false,\"confirm\":true}")

# Parsear respuesta
SUCCESS=$(echo "$RESPONSE" | grep -o '"success":true' || echo "")
DELETED=$(echo "$RESPONSE" | grep -o '"deletedCount":[0-9]*' | grep -o '[0-9]*' || echo "0")
REMAINING=$(echo "$RESPONSE" | grep -o '"remainingCount":[0-9]*' | grep -o '[0-9]*' || echo "?")

if [ -n "$SUCCESS" ]; then
    echo "$LOG_PREFIX [$DATE] OK: Eliminados ${DELETED} eventos, quedan ${REMAINING}"
else
    echo "$LOG_PREFIX [$DATE] ERROR: Respuesta inesperada: $RESPONSE"
    exit 1
fi

echo "$LOG_PREFIX [$DATE] Purga completada"
