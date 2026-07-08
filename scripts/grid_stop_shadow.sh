#!/usr/bin/env bash
set -Eeuo pipefail

echo '{"mode":"OFF"}' > /tmp/grid_mode_off.json
echo "Payload:"
cat /tmp/grid_mode_off.json
echo ""

echo "===== MODE OFF ====="
curl -sS -X POST http://127.0.0.1:3020/api/grid-isolated/mode \
  -H 'Content-Type: application/json' \
  -d @/tmp/grid_mode_off.json
echo ""

echo "===== STATUS AFTER ====="
curl -sS http://127.0.0.1:3020/api/grid-isolated/status
echo ""
