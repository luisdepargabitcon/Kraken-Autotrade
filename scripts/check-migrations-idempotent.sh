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
echo "===== RESULT ====="
if [ "$ERRORS" -gt 0 ]; then
  echo "FAILED: $ERRORS critical error(s) found. Fix before deploying."
  exit 1
else
  echo "PASSED: No critical migration syntax errors detected."
  exit 0
fi
