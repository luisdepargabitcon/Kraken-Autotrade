-- Migration: Add manual cycle + exchange + fees columns to institutional_dca_cycles
-- Date: 2026-03-20
-- Run with: docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -f /tmp/add_manual_cycle_columns.sql
-- Or copy-paste into psql session

ALTER TABLE institutional_dca_cycles
  ADD COLUMN IF NOT EXISTS is_manual_cycle BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exchange_source TEXT,
  ADD COLUMN IF NOT EXISTS estimated_fee_pct NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS estimated_fee_usd NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS fees_override_manual BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS import_warning_acknowledged BOOLEAN NOT NULL DEFAULT false;

-- Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'institutional_dca_cycles'
  AND column_name IN ('is_manual_cycle', 'exchange_source', 'estimated_fee_pct', 'estimated_fee_usd', 'fees_override_manual', 'import_warning_acknowledged')
ORDER BY column_name;
