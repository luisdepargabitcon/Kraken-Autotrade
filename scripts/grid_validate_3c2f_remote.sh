#!/usr/bin/env bash
set -Eeuo pipefail

cd /opt/krakenbot-staging

echo "===== FASE 3C.2-F VALIDACION LIMPIA ====="
echo "Fecha: $(date -Is)"

echo ""
echo "===== HEAD ====="
git log --oneline -10

echo ""
echo "===== CONTAINERS ====="
docker compose -f docker-compose.staging.yml ps

echo ""
echo "===== WAIT APP READY ====="
READY=0
for i in $(seq 1 36); do
  if curl -fsS http://127.0.0.1:3020/api/grid-isolated/status >/tmp/grid_status_ready_check.json 2>/tmp/grid_ready_error.txt; then
    READY=1
    echo "App ready after $i attempts."
    break
  fi
  echo "Waiting app... attempt $i/36"
  cat /tmp/grid_ready_error.txt || true
  sleep 5
done

if [ "$READY" != "1" ]; then
  echo "ERROR: app not ready after 180 seconds"
  echo ""
  echo "===== CONTAINERS AFTER WAIT FAIL ====="
  docker compose -f docker-compose.staging.yml ps || true
  echo ""
  echo "===== APP LOGS AFTER WAIT FAIL ====="
  docker compose -f docker-compose.staging.yml logs --tail=300 || true
  exit 20
fi

echo ""
echo "===== STATUS BEFORE ====="
curl -fsS http://127.0.0.1:3020/api/grid-isolated/status > /tmp/grid_status_before_3c2f.json
cat /tmp/grid_status_before_3c2f.json
echo ""

echo ""
echo "===== READ-ONLY PROFESSIONAL GENERATOR VALIDATION ====="
curl -fsS -X POST http://127.0.0.1:3020/api/grid-isolated/professional-generator/validate > /tmp/grid_prof_validate_3c2f.json
cat /tmp/grid_prof_validate_3c2f.json
echo ""

echo ""
echo "===== STATUS AFTER ====="
curl -fsS http://127.0.0.1:3020/api/grid-isolated/status > /tmp/grid_status_after_3c2f.json
cat /tmp/grid_status_after_3c2f.json
echo ""

echo ""
echo "===== AUDIT RUNTIME RAW HEAD ====="
curl -fsS http://127.0.0.1:3020/api/grid-isolated/monitor/audit > /tmp/grid_audit_3c2f.json
head -c 12000 /tmp/grid_audit_3c2f.json
echo ""

echo ""
echo "===== JSON VALIDATION SUMMARY ====="
python3 - <<'PY'
import json

def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

before = load("/tmp/grid_status_before_3c2f.json")
validate = load("/tmp/grid_prof_validate_3c2f.json")
after = load("/tmp/grid_status_after_3c2f.json")
audit = load("/tmp/grid_audit_3c2f.json")

summary = {
    "before": {
        "mode": before.get("mode"),
        "isActive": before.get("isActive"),
        "isRunning": before.get("isRunning"),
        "activeRangeVersionId": before.get("activeRangeVersionId"),
        "openLevels": before.get("openLevels"),
        "plannedLevelsCount": before.get("plannedLevelsCount"),
        "activeOrdersCount": before.get("activeOrdersCount"),
        "globalLevelsCount": before.get("globalLevelsCount"),
        "globalPlannedLevelsCount": before.get("globalPlannedLevelsCount"),
        "orphanPlannedLevelsCount": before.get("orphanPlannedLevelsCount"),
        "realOpenOrdersCount": before.get("realOpenOrdersCount"),
        "openCycles": before.get("openCycles"),
        "configLoaded": before.get("configLoaded"),
        "configSource": before.get("configSource"),
    },
    "validate": {
        "ok": validate.get("ok"),
        "readOnly": validate.get("readOnly"),
        "professionalGeneratorExecuted": validate.get("professionalGeneratorExecuted"),
        "legacyGeneratorUsed": validate.get("legacyGeneratorUsed"),
        "persistsLevels": validate.get("persistsLevels"),
        "placesOrders": validate.get("placesOrders"),
        "changesMode": validate.get("changesMode"),
        "rebuild": validate.get("rebuild"),
        "sideEffectsDetected": validate.get("sideEffectsDetected"),
        "runtimeBefore": validate.get("runtimeBefore"),
        "runtimeAfter": validate.get("runtimeAfter"),
        "viabilityStatus": validate.get("viabilityStatus"),
        "levelsCount": validate.get("levelsCount"),
        "generatedBuyLevels": validate.get("generatedBuyLevels"),
        "generatedSellLevels": validate.get("generatedSellLevels"),
        "spacingPct": validate.get("spacingPct"),
        "minSpacingPctReal": validate.get("minSpacingPctReal"),
        "configUsed": validate.get("configUsed"),
    },
    "after": {
        "mode": after.get("mode"),
        "isActive": after.get("isActive"),
        "isRunning": after.get("isRunning"),
        "activeRangeVersionId": after.get("activeRangeVersionId"),
        "openLevels": after.get("openLevels"),
        "plannedLevelsCount": after.get("plannedLevelsCount"),
        "activeOrdersCount": after.get("activeOrdersCount"),
        "globalLevelsCount": after.get("globalLevelsCount"),
        "globalPlannedLevelsCount": after.get("globalPlannedLevelsCount"),
        "orphanPlannedLevelsCount": after.get("orphanPlannedLevelsCount"),
        "realOpenOrdersCount": after.get("realOpenOrdersCount"),
        "openCycles": after.get("openCycles"),
        "configLoaded": after.get("configLoaded"),
        "configSource": after.get("configSource"),
    },
    "audit": {
        "mode": audit.get("mode"),
        "summary": audit.get("summary"),
        "levelsSummary": audit.get("levelsSummary"),
        "professionalGeneratorRuntime": audit.get("professionalGeneratorRuntime"),
    }
}

print(json.dumps(summary, indent=2, ensure_ascii=False))

# hard safety checks
errors = []

if validate.get("ok") is not True:
    errors.append("validate.ok is not true")
if validate.get("readOnly") is not True:
    errors.append("validate.readOnly is not true")
if validate.get("professionalGeneratorExecuted") is not True:
    errors.append("professionalGeneratorExecuted is not true")
if validate.get("legacyGeneratorUsed") is not False:
    errors.append("legacyGeneratorUsed is not false")
if validate.get("persistsLevels") is not False:
    errors.append("persistsLevels is not false")
if validate.get("placesOrders") is not False:
    errors.append("placesOrders is not false")
if validate.get("changesMode") is not False:
    errors.append("changesMode is not false")
if validate.get("rebuild") is not False:
    errors.append("rebuild is not false")
if validate.get("sideEffectsDetected") is not False:
    errors.append("sideEffectsDetected is not false")

rb = validate.get("runtimeBefore") or {}
ra = validate.get("runtimeAfter") or {}

for key in ["mode", "isActive", "isRunning", "activeRangeVersionId", "tickIntervalActive"]:
    if rb.get(key) != ra.get(key):
        errors.append(f"runtime changed: {key}: before={rb.get(key)} after={ra.get(key)}")

if after.get("realOpenOrdersCount") != 0:
    errors.append("realOpenOrdersCount is not 0")
if after.get("openCycles") != 0:
    errors.append("openCycles is not 0")

if errors:
    print("\n===== HARD VALIDATION FAILED =====")
    for e in errors:
        print(f"- {e}")
    raise SystemExit(30)

print("\n===== HARD VALIDATION PASSED =====")
PY

echo ""
echo "===== LOGS FILE ====="
docker compose -f docker-compose.staging.yml logs --tail=300 > /tmp/grid_logs_3c2f.txt

echo ""
echo "===== LOGS PROFESSIONAL GENERATOR ====="
grep -E 'professional-generator|validateProfessionalGeneratorReadOnly|generateProfessionalGridLevels' /tmp/grid_logs_3c2f.txt || true

echo ""
echo "===== LOGS ERRORS ====="
grep -E 'ERROR|TypeError|ReferenceError|Unhandled|column .* does not exist|migration|DB error' /tmp/grid_logs_3c2f.txt || true

echo ""
echo "===== VALIDACION TERMINADA OK ====="
