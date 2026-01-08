#!/bin/bash
# Script to ensure no Revolut Business code exists in the codebase
# This blocks Business API patterns that should never be in this project

echo "Checking for prohibited Revolut Business patterns..."

ERRORS=0

# Check source files only (exclude node_modules, cache, etc.)
SRC_DIRS="server client shared"

# Pattern 1: RevolutBusiness class/module names
if grep -rE "RevolutBusiness|revolut.business" $SRC_DIRS 2>/dev/null; then
  echo "ERROR: Found RevolutBusiness pattern"
  ERRORS=$((ERRORS + 1))
fi

# Pattern 2: Business API endpoints
if grep -rE '"/treasury"|"/payouts"|"/invoices"|"/counterparties"|"/bank_accounts"' $SRC_DIRS 2>/dev/null; then
  echo "ERROR: Found Business API endpoint"
  ERRORS=$((ERRORS + 1))
fi

# Pattern 3: Business-specific fields
if grep -rE "business_id|merchant_id|REVOLUT_BUSINESS" $SRC_DIRS 2>/dev/null; then
  echo "ERROR: Found Business-specific field"
  ERRORS=$((ERRORS + 1))
fi

# Pattern 4: "Business" in Revolut context (case-insensitive, exclude date-fns)
if grep -riE "cuenta.*business|business.*account" $SRC_DIRS 2>/dev/null | grep -iv "date-fns\|BusinessDays"; then
  echo "ERROR: Found Business account reference"
  ERRORS=$((ERRORS + 1))
fi

if [ $ERRORS -gt 0 ]; then
  echo ""
  echo "FAILED: Found prohibited Business pattern(s)."
  echo "This project uses Revolut X (crypto exchange retail) only."
  exit 1
fi

echo "OK: No prohibited Business patterns found."
exit 0
