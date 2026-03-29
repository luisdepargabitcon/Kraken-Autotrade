-- Migration: Add ALL potentially missing columns to institutional_dca_cycles
-- Date: 2026-03-29 (updated - comprehensive version)
-- Run with: docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -f /tmp/add_idca_audit_columns.sql
-- Safe to run multiple times (uses IF NOT EXISTS)

-- ─── Import & Manual Cycle fields ────────────────────────────────
ALTER TABLE institutional_dca_cycles
  ADD COLUMN IF NOT EXISTS is_imported BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS imported_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS managed_by TEXT,
  ADD COLUMN IF NOT EXISTS solo_salida BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS import_notes TEXT,
  ADD COLUMN IF NOT EXISTS import_snapshot_json JSONB,
  ADD COLUMN IF NOT EXISTS is_manual_cycle BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exchange_source TEXT,
  ADD COLUMN IF NOT EXISTS estimated_fee_pct DECIMAL(8,4),
  ADD COLUMN IF NOT EXISTS estimated_fee_usd DECIMAL(18,2),
  ADD COLUMN IF NOT EXISTS fees_override_manual BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS import_warning_acknowledged BOOLEAN NOT NULL DEFAULT false;

-- ─── Entry base price (deterministic, auditable) ─────────────────
ALTER TABLE institutional_dca_cycles
  ADD COLUMN IF NOT EXISTS base_price DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS base_price_type TEXT,
  ADD COLUMN IF NOT EXISTS base_price_window_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS base_price_timestamp TIMESTAMP,
  ADD COLUMN IF NOT EXISTS base_price_meta_json JSONB,
  ADD COLUMN IF NOT EXISTS entry_dip_pct DECIMAL(10,4);

-- ─── Protection & trailing state ─────────────────────────────────
ALTER TABLE institutional_dca_cycles
  ADD COLUMN IF NOT EXISTS protection_armed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS protection_stop_price DECIMAL(18,8);

-- ─── Cycle type & plus cycles ────────────────────────────────────
ALTER TABLE institutional_dca_cycles
  ADD COLUMN IF NOT EXISTS cycle_type TEXT NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS parent_cycle_id INTEGER,
  ADD COLUMN IF NOT EXISTS plus_cycles_completed INTEGER NOT NULL DEFAULT 0;

-- ─── Manual edit audit trail ─────────────────────────────────────
ALTER TABLE institutional_dca_cycles
  ADD COLUMN IF NOT EXISTS last_manual_edit_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_manual_edit_reason TEXT,
  ADD COLUMN IF NOT EXISTS edit_history_json JSONB DEFAULT '[]'::jsonb;

-- ─── Skipped safety levels (imported cycles) ─────────────────────
ALTER TABLE institutional_dca_cycles
  ADD COLUMN IF NOT EXISTS skipped_safety_levels INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_levels_detail JSONB;

-- ─── TP breakdown JSON ───────────────────────────────────────────
ALTER TABLE institutional_dca_cycles
  ADD COLUMN IF NOT EXISTS tp_breakdown_json JSONB;

-- ─── Verify all columns exist ────────────────────────────────────
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'institutional_dca_cycles'
ORDER BY ordinal_position;
