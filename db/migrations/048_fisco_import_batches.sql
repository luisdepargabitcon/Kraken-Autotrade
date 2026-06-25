-- Migration 048: FISCO Import Batches
-- Tabla para tracking de importaciones de CSV (Kraken/RevolutX) con preview antes de confirmar
-- Soporta hash dedupe, dry-run, y rollback de batches

CREATE TABLE IF NOT EXISTS fisco_import_batches (
  id BIGSERIAL PRIMARY KEY,
  import_batch_id TEXT NOT NULL UNIQUE, -- UUID generado en preview
  exchange TEXT NOT NULL, -- 'kraken' | 'revolutx'
  year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'preview', -- 'preview' | 'confirmed' | 'rejected' | 'partial'
  dry_run BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  options_json JSONB, -- opciones de importación (skip_fiat, detect_duplicates, etc.)
  summary_json JSONB, -- { total_rows, normalized, duplicates, skipped, errors, warnings }
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_fisco_import_batches_year ON fisco_import_batches(year);
CREATE INDEX IF NOT EXISTS idx_fisco_import_batches_exchange ON fisco_import_batches(exchange);
CREATE INDEX IF NOT EXISTS idx_fisco_import_batches_status ON fisco_import_batches(status);

-- Tabla para tracking de filas individuales de CSV con estado de normalización
CREATE TABLE IF NOT EXISTS fisco_import_rows (
  id BIGSERIAL PRIMARY KEY,
  import_batch_id TEXT NOT NULL REFERENCES fisco_import_batches(import_batch_id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  exchange TEXT NOT NULL,
  raw_type TEXT NOT NULL, -- tipo en CSV original
  normalized_type TEXT, -- tipo tras normalización (trade_buy, deposit, etc.)
  buy_amount NUMERIC(30, 12),
  buy_asset TEXT,
  sell_amount NUMERIC(30, 12),
  sell_asset TEXT,
  fee_amount NUMERIC(30, 12),
  fee_asset TEXT,
  executed_at TIMESTAMPTZ,
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'ok' | 'warning' | 'error' | 'duplicate' | 'skipped'
  message TEXT, -- detalle de warning/error
  hash TEXT, -- para dedupe: hash de (exchange, external_id, amount, executed_at)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fisco_import_rows_batch ON fisco_import_rows(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_fisco_import_rows_status ON fisco_import_rows(status);
CREATE INDEX IF NOT EXISTS idx_fisco_import_rows_hash ON fisco_import_rows(hash) WHERE hash IS NOT NULL;

-- Tabla para configuración FISCO V2 (FASE H)
CREATE TABLE IF NOT EXISTS fisco_config (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO fisco_config (key, value) VALUES
  ('fisco_engine_mode', 'v2_shadow'), -- 'legacy' | 'v2_shadow' | 'v2_official'
  ('transfer_matching_time_window_days', '5'),
  ('transfer_matching_amount_tolerance_pct', '5'),
  ('dust_threshold_default', '0.0001'),
  ('crypto_fee_treatment', 'inventory_reduction'), -- 'inventory_reduction' | 'explicit_disposal'
  ('block_if_reward_without_price', 'false'),
  ('block_if_sell_without_cost_basis', 'true'),
  ('block_if_transfer_mismatch', 'false'),
  ('block_if_balance_mismatch_critical', 'true')
ON CONFLICT (key) DO NOTHING;

-- Comentario
COMMENT ON TABLE fisco_import_batches IS 'FISCO V2: tracking de importaciones CSV con preview y dedupe';
COMMENT ON TABLE fisco_import_rows IS 'FISCO V2: filas individuales de CSV con estado de normalización';
COMMENT ON TABLE fisco_config IS 'FISCO V2: configuración del motor fiscal y parámetros de matching';
