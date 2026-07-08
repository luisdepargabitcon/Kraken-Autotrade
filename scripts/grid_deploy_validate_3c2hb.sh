#!/usr/bin/env bash
set -Eeuo pipefail

cd /opt/krakenbot-staging

echo "===== DEPLOY STAGING FASE 3C.2-H-B ====="
git pull origin main
docker compose -f docker-compose.staging.yml up -d --build

echo ""
echo "===== ESPERAR APP ====="
READY=0
for i in $(seq 1 36); do
  if curl -fsS http://127.0.0.1:3020/api/grid-isolated/status >/tmp/grid_status_ready_3c2hb.json 2>/tmp/grid_ready_err_3c2hb.txt; then
    READY=1
    echo "App ready after $i attempts."
    break
  fi
  echo "Waiting app... attempt $i/36"
  cat /tmp/grid_ready_err_3c2hb.txt || true
  sleep 5
done

if [ "$READY" != "1" ]; then
  echo "ERROR: app not ready after 180 seconds"
  docker compose -f docker-compose.staging.yml ps || true
  docker compose -f docker-compose.staging.yml logs --tail=300 || true
  exit 20
fi

echo ""
echo "===== HEAD ====="
git log --oneline -12

echo ""
echo "===== CONTENEDORES ====="
docker compose -f docker-compose.staging.yml ps

echo ""
echo "===== STATUS SAFE ====="
curl -fsS http://127.0.0.1:3020/api/grid-isolated/status > /tmp/grid_status_3c2hb.json
cat /tmp/grid_status_3c2hb.json
echo ""

echo ""
echo "===== CLEANUP PREVIEW DRY-RUN ====="
curl -fsS -X POST http://127.0.0.1:3020/api/grid-isolated/shadow-cleanup/preview > /tmp/grid_cleanup_preview_3c2hb.json
cat /tmp/grid_cleanup_preview_3c2hb.json
echo ""

echo ""
echo "===== AUDIT ====="
curl -fsS http://127.0.0.1:3020/api/grid-isolated/monitor/audit > /tmp/grid_audit_3c2hb.json
head -c 12000 /tmp/grid_audit_3c2hb.json
echo ""

echo ""
echo "===== VALIDACION JSON ====="
python3 - <<'PY'
import json

def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

status = load("/tmp/grid_status_3c2hb.json")
preview = load("/tmp/grid_cleanup_preview_3c2hb.json")
audit = load("/tmp/grid_audit_3c2hb.json")

summary = audit.get("summary", {})
shadow_cleanup = audit.get("shadowCleanup", {})

report = {
    "status": {
        "mode": status.get("mode"),
        "isActive": status.get("isActive"),
        "isRunning": status.get("isRunning"),
        "runtimeLoaded": status.get("runtimeLoaded"),
        "statusSource": status.get("statusSource"),
        "configLoaded": status.get("configLoaded"),
        "configSource": status.get("configSource"),
        "activeRangeVersionId": status.get("activeRangeVersionId"),
        "realOpenOrdersCount": status.get("realOpenOrdersCount"),
        "openCycles": status.get("openCycles"),
        "activeOpenCyclesCount": status.get("activeOpenCyclesCount"),
        "globalOpenCyclesCount": status.get("globalOpenCyclesCount"),
        "orphanOpenCyclesCount": status.get("orphanOpenCyclesCount"),
        "historicalOpenCyclesCount": status.get("historicalOpenCyclesCount"),
    },
    "cleanupPreview": {
        "ok": preview.get("ok"),
        "dryRun": preview.get("dryRun"),
        "readOnly": preview.get("readOnly"),
        "realOrdersAffected": preview.get("risk", {}).get("realOrdersAffected"),
        "safeToArchiveShadowOnly": preview.get("risk", {}).get("safeToArchiveShadowOnly"),
        "totalOpenCycles": preview.get("cycles", {}).get("totalOpenCycles"),
        "activeRangeOpenCycles": preview.get("cycles", {}).get("activeRangeOpenCycles"),
        "orphanOpenCycles": preview.get("cycles", {}).get("orphanOpenCycles"),
        "historicalOpenCycles": preview.get("cycles", {}).get("historicalOpenCycles"),
        "affectedCyclesCount": preview.get("risk", {}).get("affectedCyclesCount"),
        "affectedLevelsCount": preview.get("risk", {}).get("affectedLevelsCount"),
    },
    "auditShadowCleanup": shadow_cleanup,
    "auditSummary": {
        "realOpenOrdersCount": summary.get("realOpenOrdersCount"),
        "activeOpenCyclesCount": summary.get("activeOpenCyclesCount"),
        "globalOpenCyclesCount": summary.get("globalOpenCyclesCount"),
        "orphanOpenCyclesCount": summary.get("orphanOpenCyclesCount"),
    }
}

print(json.dumps(report, indent=2, ensure_ascii=False))

errors = []

if status.get("realOpenOrdersCount") != 0:
    errors.append("realOpenOrdersCount != 0")

if status.get("statusSource") not in ["runtime", "db_snapshot"]:
    errors.append(f"statusSource invalid: {status.get('statusSource')}")

if status.get("configSource") == "default_runtime_empty":
    errors.append("configSource is still default_runtime_empty; should be memory or db_snapshot if config DB exists")

if preview.get("dryRun") is not True:
    errors.append("cleanup preview dryRun is not true")

if preview.get("readOnly") is not True:
    errors.append("cleanup preview readOnly is not true")

if preview.get("risk", {}).get("realOrdersAffected") is not False:
    errors.append("realOrdersAffected is not false")

if "cycles" not in preview:
    errors.append("preview does not include cycles block")

if "levels" not in preview:
    errors.append("preview does not include levels block")

if "risk" not in preview:
    errors.append("preview does not include risk block")

if "preview" not in preview:
    errors.append("preview does not include preview block")

if errors:
    print("\n===== HARD VALIDATION FAILED =====")
    for e in errors:
        print(f"- {e}")
    raise SystemExit(30)

print("\n===== HARD VALIDATION PASSED =====")
PY

echo ""
echo "===== LOGS FILE ====="
docker compose -f docker-compose.staging.yml logs --tail=300 > /tmp/grid_logs_3c2hb.txt

echo ""
echo "===== LOGS CLEANUP/STATUS ====="
grep -E 'shadow-cleanup|cleanup|statusSource|getStatusSafe|getStatusFromDb|db_snapshot' /tmp/grid_logs_3c2hb.txt || true

echo ""
echo "===== LOGS ERRORS ====="
grep -E 'ERROR|TypeError|ReferenceError|Unhandled|column .* does not exist|migration|DB error' /tmp/grid_logs_3c2hb.txt || true

echo ""
echo "===== ASEGURAR GRID OFF AL FINAL ====="
curl -sS -X POST http://127.0.0.1:3020/api/grid-isolated/mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"OFF"}' || true

curl -sS -X POST http://127.0.0.1:3020/api/grid-isolated/activate \
  -H "Content-Type: application/json" \
  -d '{"active":false}' || true

echo ""
echo "===== STATUS FINAL ====="
curl -sS http://127.0.0.1:3020/api/grid-isolated/status

echo ""
echo "===== VALIDACION TERMINADA ====="
