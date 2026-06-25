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
  ('transfer_matching_time_window_days', '5'),
  ('transfer_matching_amount_tolerance_pct', '5'),
  ('dust_threshold_default', '0.0001'),
  ('crypto_fee_treatment', 'inventory_reduction'),
  ('block_if_reward_without_price', 'false'),
  ('block_if_sell_without_cost_basis', 'true'),
  ('block_if_transfer_mismatch', 'false'),
  ('block_if_balance_mismatch_critical', 'true')
ON CONFLICT (key) DO NOTHING;
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
