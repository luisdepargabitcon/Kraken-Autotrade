#!/usr/bin/env bash
# check-migrations-idempotent.sh
# Detects PostgreSQL-invalid patterns in SQL migration files.
#
# Usage:
#   bash scripts/check-migrations-idempotent.sh
#
# Exits with code 1 if any problematic pattern is found.
# Safe to run locally and in CI.

set -euo pipefail

MIGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/db/migrations"
ERRORS=0

echo "===== MIGRATION IDEMPOTENCY CHECK ====="
echo "Scanning: $MIGRATIONS_DIR"
echo ""

# ─── Check 1: ADD CONSTRAINT IF NOT EXISTS ───────────────────────────────────
# PostgreSQL does NOT support this syntax. Use DO $$ + pg_constraint instead.
echo "--- Check 1: ADD CONSTRAINT IF NOT EXISTS (invalid PostgreSQL syntax) ---"
MATCHES=$(grep -rn --include="*.sql" -i "ADD CONSTRAINT IF NOT EXISTS" "$MIGRATIONS_DIR" || true)

if [ -n "$MATCHES" ]; then
  echo "ERROR: Found invalid 'ADD CONSTRAINT IF NOT EXISTS' in:"
  echo "$MATCHES"
  echo ""
  echo "Fix: Replace with:"
  echo "  DO \$\$ BEGIN"
  echo "    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'your_constraint_name') THEN"
  echo "      ALTER TABLE ... ADD CONSTRAINT ...;"
  echo "    END IF;"
  echo "  END \$\$;"
  echo ""
  ERRORS=$((ERRORS + 1))
else
  echo "OK: No 'ADD CONSTRAINT IF NOT EXISTS' found."
fi

echo ""

# ─── Check 2: Bare ADD CONSTRAINT without any guard ──────────────────────────
# Warns about ADD CONSTRAINT lines that are NOT:
#   - inside a DO $$ block
#   - preceded by DROP CONSTRAINT IF EXISTS on the same constraint name
# This is a heuristic — not all bare ADD CONSTRAINTs are wrong, but they should
# be reviewed to ensure idempotency.
echo "--- Check 2: Bare ADD CONSTRAINT (not inside DO block, not preceded by DROP) ---"
WARN_COUNT=0

while IFS= read -r file; do
  # Check if file has ADD CONSTRAINT but NOT wrapped in DO $$ and NOT preceded by DROP CONSTRAINT IF EXISTS
  HAS_ADD=$(grep -c -i "ADD CONSTRAINT" "$file" || true)
  HAS_DO=$(grep -c -i "DO \$\$\|DO\$\$" "$file" || true)
  HAS_DROP_GUARD=$(grep -c -i "DROP CONSTRAINT IF EXISTS" "$file" || true)

  if [ "$HAS_ADD" -gt 0 ] && [ "$HAS_DO" -eq 0 ] && [ "$HAS_DROP_GUARD" -eq 0 ]; then
    echo "WARN: $file — has ADD CONSTRAINT but no DO \$\$ block or DROP CONSTRAINT IF EXISTS guard"
    WARN_COUNT=$((WARN_COUNT + 1))
  fi
done < <(find "$MIGRATIONS_DIR" -name "*.sql" -type f | sort)

if [ "$WARN_COUNT" -eq 0 ]; then
  echo "OK: All ADD CONSTRAINT usages appear to have idempotency guards."
else
  echo ""
  echo "WARN: $WARN_COUNT file(s) may have unguarded ADD CONSTRAINT. Review them manually."
  echo "(Warnings do NOT cause this script to exit 1 — only Check 1 errors do.)"
fi

echo ""

# ─── Check 3: Direct ALTER TABLE ... ADD CONSTRAINT in TypeScript files ──────
# Detects runtime schema modifications that bypass idempotency checks.
echo "--- Check 3: Direct ALTER TABLE ADD CONSTRAINT in TypeScript (storage.ts, etc.) ---"

# Search in server/ and script/ directories for .ts files
TS_CHECK_DIRS=("$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/server" "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/script")
TS_ERROR_COUNT=0

for dir in "${TS_CHECK_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    # Find direct ALTER TABLE ... ADD CONSTRAINT ... UNIQUE that is NOT inside a DO $$ block
    while IFS= read -r -d '' file; do
      # Check if file contains the problematic pattern but NOT inside DO $$ block
      # Heuristic: if the file has ALTER TABLE.*ADD CONSTRAINT.*UNIQUE and lot_id
      if grep -q "ALTER TABLE.*ADD CONSTRAINT.*UNIQUE.*lot_id" "$file" 2>/dev/null; then
        # Check if it's inside a DO $$ block (look for DO $$ before and END $$ after)
        if ! grep -B5 -A5 "ALTER TABLE.*ADD CONSTRAINT.*UNIQUE.*lot_id" "$file" | grep -q "DO \$\$"; then
          echo "ERROR: $file — found direct 'ALTER TABLE ... ADD CONSTRAINT ... UNIQUE (lot_id)' without DO \$\$ block"
          TS_ERROR_COUNT=$((TS_ERROR_COUNT + 1))
        fi
      fi
    done < <(find "$dir" -name "*.ts" -type f -print0 2>/dev/null || true)
  fi
done

if [ "$TS_ERROR_COUNT" -eq 0 ]; then
  echo "OK: No direct ALTER TABLE ADD CONSTRAINT UNIQUE (lot_id) without DO \$\$ guard found."
else
  echo ""
  echo "Fix: Wrap the constraint creation in a DO \$\$ block with pg_constraint check:"
  echo "  DO \$\$ BEGIN"
  echo "    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'constraint_name') THEN"
  echo "      ALTER TABLE ... ADD CONSTRAINT ... UNIQUE (lot_id);"
  echo "    END IF;"
  echo "  END \$\$;"
  ERRORS=$((ERRORS + TS_ERROR_COUNT))
fi

echo ""

echo "===== RESULT ====="
if [ "$ERRORS" -gt 0 ]; then
  echo "FAILED: $ERRORS critical error(s) found. Fix before deploying."
  exit 1
else
  echo "PASSED: No critical migration syntax errors detected."
  exit 0
fi
