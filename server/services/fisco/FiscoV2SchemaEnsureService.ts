/**
 * FiscoV2SchemaEnsureService — Ensures FISCO V2 import/config tables exist at startup.
 * Uses inline SQL (no file dependency) so it works inside Docker containers
 * where migration files may not be copied to dist/.
 *
 * Idempotent: CREATE TABLE IF NOT EXISTS + ON CONFLICT DO NOTHING.
 */

import { pool } from "../../db";

const ENSURE_SQL = `
-- fisco_import_batches
CREATE TABLE IF NOT EXISTS fisco_import_batches (
  id BIGSERIAL PRIMARY KEY,
  import_batch_id TEXT NOT NULL UNIQUE,
  exchange TEXT NOT NULL CHECK (exchange IN ('kraken', 'revolutx')),
  year INTEGER NOT NULL CHECK (year >= 2020 AND year <= 2100),
  status TEXT NOT NULL DEFAULT 'preview' CHECK (status IN ('preview', 'confirmed', 'rejected', 'partial')),
  dry_run BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  options_json JSONB DEFAULT '{}'::jsonb,
  summary_json JSONB DEFAULT '{}'::jsonb,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_fisco_import_batches_year ON fisco_import_batches(year);
CREATE INDEX IF NOT EXISTS idx_fisco_import_batches_exchange ON fisco_import_batches(exchange);
CREATE INDEX IF NOT EXISTS idx_fisco_import_batches_status ON fisco_import_batches(status);

-- fisco_import_rows
CREATE TABLE IF NOT EXISTS fisco_import_rows (
  id BIGSERIAL PRIMARY KEY,
  import_batch_id TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  exchange TEXT NOT NULL,
  raw_type TEXT NOT NULL,
  normalized_type TEXT,
  buy_amount NUMERIC(30, 12),
  buy_asset TEXT,
  sell_amount NUMERIC(30, 12),
  sell_asset TEXT,
  fee_amount NUMERIC(30, 12),
  fee_asset TEXT,
  executed_at TIMESTAMPTZ,
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'warning', 'error', 'duplicate', 'skipped')),
  message TEXT,
  hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_import_rows_batch FOREIGN KEY (import_batch_id)
    REFERENCES fisco_import_batches(import_batch_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fisco_import_rows_batch ON fisco_import_rows(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_fisco_import_rows_status ON fisco_import_rows(status);
CREATE INDEX IF NOT EXISTS idx_fisco_import_rows_hash ON fisco_import_rows(hash) WHERE hash IS NOT NULL;

-- fisco_config
CREATE TABLE IF NOT EXISTS fisco_config (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert defaults idempotently
INSERT INTO fisco_config (key, value) VALUES
  ('fisco_engine_mode', 'v2_shadow'),
  ('fee_mode', 'AEAT_INTEGRATED_TRACEABLE'),
  ('transfer_matching_time_window_days', '5'),
  ('transfer_matching_amount_tolerance_pct', '5'),
  ('dust_threshold_default', '0.0001'),
  ('crypto_fee_treatment', 'inventory_reduction'),
  ('rewards_as_income', 'true'),
  ('block_if_reward_without_price', 'false'),
  ('block_if_sell_without_cost_basis', 'true'),
  ('block_if_transfer_mismatch', 'false'),
  ('block_if_balance_mismatch_critical', 'true')
ON CONFLICT (key) DO NOTHING;

-- V2 engine tables
CREATE TABLE IF NOT EXISTS fisco_v2_lots (
  v2_lot_id TEXT PRIMARY KEY,
  source_event_id TEXT NOT NULL,
  source_operation_id INTEGER NOT NULL,
  asset TEXT NOT NULL,
  quantity_acquired NUMERIC(18,8) NOT NULL,
  quantity_remaining NUMERIC(18,8) NOT NULL,
  gross_acquisition_eur NUMERIC(18,8),
  direct_fee_eur NUMERIC(18,8) DEFAULT 0,
  acquisition_value_eur NUMERIC(18,8),
  fee_treatment TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL,
  exchange TEXT NOT NULL,
  transfer_link_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fisco_v2_lots_asset ON fisco_v2_lots(asset);
CREATE INDEX IF NOT EXISTS idx_fisco_v2_lots_op ON fisco_v2_lots(source_operation_id);

CREATE TABLE IF NOT EXISTS fisco_v2_disposals (
  v2_disposal_id TEXT PRIMARY KEY,
  source_event_id TEXT NOT NULL,
  sell_operation_id INTEGER NOT NULL,
  asset TEXT NOT NULL,
  quantity_disposed NUMERIC(18,8) NOT NULL,
  gross_transmission_eur NUMERIC(18,8),
  direct_fee_eur NUMERIC(18,8) DEFAULT 0,
  transmission_value_eur NUMERIC(18,8),
  cost_basis_eur NUMERIC(18,8),
  gain_loss_eur NUMERIC(18,8),
  fee_treatment TEXT NOT NULL,
  lots_consumed JSONB,
  executed_at TIMESTAMPTZ NOT NULL,
  exchange TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fisco_v2_disposals_asset ON fisco_v2_disposals(asset);
CREATE INDEX IF NOT EXISTS idx_fisco_v2_disposals_op ON fisco_v2_disposals(sell_operation_id);

CREATE TABLE IF NOT EXISTS fisco_v2_fee_events (
  fee_id TEXT PRIMARY KEY,
  source_operation_id INTEGER NOT NULL,
  fee_eur NUMERIC(18,8),
  fee_asset TEXT,
  fee_quantity NUMERIC(18,8),
  fee_treatment TEXT NOT NULL,
  linked_operation_id INTEGER,
  included_in_acquisition_value BOOLEAN DEFAULT false,
  included_in_transmission_value BOOLEAN DEFAULT false,
  creates_explicit_disposal BOOLEAN DEFAULT false,
  is_network_fee BOOLEAN DEFAULT false,
  is_third_asset_fee BOOLEAN DEFAULT false,
  executed_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fisco_v2_fee_events_op ON fisco_v2_fee_events(source_operation_id);

CREATE TABLE IF NOT EXISTS fisco_v2_audit_log (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('activate', 'rollback', 'controlled_commit')),
  year INTEGER NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  operation_set_hash TEXT,
  legacy_result JSONB,
  v2_result JSONB,
  differences JSONB,
  fee_treatment_summary JSONB,
  backup_id TEXT,
  details JSONB
);
CREATE INDEX IF NOT EXISTS idx_fisco_v2_audit_log_year ON fisco_v2_audit_log(year);

CREATE TABLE IF NOT EXISTS fisco_v2_backups (
  backup_id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  engine_mode TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  config_snapshot JSONB,
  disposals_snapshot JSONB,
  lots_snapshot JSONB
);
`;

export async function ensureFiscoV2Schema(): Promise<void> {
  console.log("[FISCO_V2_SCHEMA] ensuring import/config tables");
  try {
    await pool.query(ENSURE_SQL);
    console.log("[FISCO_V2_SCHEMA] ensured import/config tables");
  } catch (e: any) {
    console.error("[FISCO_V2_SCHEMA] ERROR ensuring schema:", e.message);
    throw e;
  }
}
