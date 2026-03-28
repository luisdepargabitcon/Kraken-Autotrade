-- Migration: Add audit columns for imported cycle editing
-- Date: 2026-03-28
-- Run with: docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -f /tmp/add_idca_audit_columns.sql

ALTER TABLE institutional_dca_cycles
  ADD COLUMN IF NOT EXISTS last_manual_edit_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_manual_edit_reason TEXT,
  ADD COLUMN IF NOT EXISTS edit_history_json JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS skipped_safety_levels INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_levels_detail JSONB;

-- Also add columns for effective safety levels that were added recently
ALTER TABLE institutional_dca_cycles
  ADD COLUMN IF NOT EXISTS skipped_safety_levels INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_levels_detail JSONB;

-- Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'institutional_dca_cycles'
  AND column_name IN ('last_manual_edit_at', 'last_manual_edit_reason', 'edit_history_json', 'skipped_safety_levels', 'skipped_levels_detail')
ORDER BY column_name;
