-- Migration: FISCO Rebuild & Reconciliation Tables
-- Description: Staging tables for controlled FISCO rebuild with backup, dry-run,
--              validation and post-rebuild reconciliation storage.
-- Date: 2026-06-06

-- ============================================================
-- STAGING TABLES (dry-run / pre-commit data)
-- ============================================================

CREATE TABLE IF NOT EXISTS fisco_staging_operations (
  id SERIAL PRIMARY KEY,
  exchange TEXT NOT NULL,
  external_id TEXT NOT NULL,
  op_type TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount DECIMAL(18,8) NOT NULL,
  price_eur DECIMAL(18,8),
  total_eur DECIMAL(18,8),
  fee_eur DECIMAL(18,8) DEFAULT 0,
  counter_asset TEXT,
  pair TEXT,
  executed_at TIMESTAMP NOT NULL,
  raw_data JSONB,
  requires_eur_price BOOLEAN DEFAULT FALSE,
  rebuild_run_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(exchange, external_id, rebuild_run_id)
);

CREATE TABLE IF NOT EXISTS fisco_staging_lots (
  id SERIAL PRIMARY KEY,
  operation_id INTEGER NOT NULL,
  asset TEXT NOT NULL,
  quantity DECIMAL(18,8) NOT NULL,
  remaining_qty DECIMAL(18,8) NOT NULL,
  cost_eur DECIMAL(18,8) NOT NULL,
  unit_cost_eur DECIMAL(18,8) NOT NULL,
  fee_eur DECIMAL(18,8) DEFAULT 0,
  acquired_at TIMESTAMP NOT NULL,
  is_closed BOOLEAN DEFAULT FALSE,
  rebuild_run_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fisco_staging_disposals (
  id SERIAL PRIMARY KEY,
  sell_operation_id INTEGER NOT NULL,
  lot_id_str TEXT,
  asset TEXT NOT NULL,
  quantity DECIMAL(18,8) NOT NULL,
  proceeds_eur DECIMAL(18,8) NOT NULL,
  cost_basis_eur DECIMAL(18,8) NOT NULL,
  gain_loss_eur DECIMAL(18,8) NOT NULL,
  disposed_at TIMESTAMP NOT NULL,
  rebuild_run_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fisco_staging_summary (
  id SERIAL PRIMARY KEY,
  fiscal_year INTEGER NOT NULL,
  asset TEXT NOT NULL,
  total_acquisitions DECIMAL(18,8) DEFAULT 0,
  total_disposals DECIMAL(18,8) DEFAULT 0,
  total_cost_basis_eur DECIMAL(18,8) DEFAULT 0,
  total_proceeds_eur DECIMAL(18,8) DEFAULT 0,
  total_gain_loss_eur DECIMAL(18,8) DEFAULT 0,
  total_fees_eur DECIMAL(18,8) DEFAULT 0,
  rebuild_run_id TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- BACKUP TABLES (snapshot before any official commit)
-- ============================================================

CREATE TABLE IF NOT EXISTS fisco_backup_operations (
  id SERIAL PRIMARY KEY,
  backup_id TEXT NOT NULL,
  original_id INTEGER,
  exchange TEXT NOT NULL,
  external_id TEXT NOT NULL,
  op_type TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount DECIMAL(18,8) NOT NULL,
  price_eur DECIMAL(18,8),
  total_eur DECIMAL(18,8),
  fee_eur DECIMAL(18,8) DEFAULT 0,
  counter_asset TEXT,
  pair TEXT,
  executed_at TIMESTAMP NOT NULL,
  raw_data JSONB,
  backed_up_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fisco_backup_lots (
  id SERIAL PRIMARY KEY,
  backup_id TEXT NOT NULL,
  original_id INTEGER,
  operation_id INTEGER,
  asset TEXT NOT NULL,
  quantity DECIMAL(18,8) NOT NULL,
  remaining_qty DECIMAL(18,8) NOT NULL,
  cost_eur DECIMAL(18,8) NOT NULL,
  unit_cost_eur DECIMAL(18,8) NOT NULL,
  fee_eur DECIMAL(18,8) DEFAULT 0,
  acquired_at TIMESTAMP NOT NULL,
  is_closed BOOLEAN DEFAULT FALSE,
  backed_up_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fisco_backup_disposals (
  id SERIAL PRIMARY KEY,
  backup_id TEXT NOT NULL,
  original_id INTEGER,
  sell_operation_id INTEGER,
  lot_id_str TEXT,
  asset TEXT NOT NULL,
  quantity DECIMAL(18,8) NOT NULL,
  proceeds_eur DECIMAL(18,8) NOT NULL,
  cost_basis_eur DECIMAL(18,8) NOT NULL,
  gain_loss_eur DECIMAL(18,8) NOT NULL,
  disposed_at TIMESTAMP NOT NULL,
  backed_up_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- REBUILD RUNS: tracks each rebuild attempt
-- ============================================================

CREATE TABLE IF NOT EXISTS fisco_rebuild_runs (
  id TEXT PRIMARY KEY,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  mode TEXT NOT NULL DEFAULT 'dry_run',
  status TEXT NOT NULL DEFAULT 'running',
  triggered_by TEXT,
  backup_id TEXT,
  exchange_filter TEXT,
  operations_count INTEGER DEFAULT 0,
  lots_count INTEGER DEFAULT 0,
  disposals_count INTEGER DEFAULT 0,
  critical_errors_count INTEGER DEFAULT 0,
  warnings_count INTEGER DEFAULT 0,
  is_safe_for_report BOOLEAN DEFAULT FALSE,
  errors_json JSONB,
  warnings_json JSONB,
  comparison_json JSONB,
  notes TEXT
);

-- ============================================================
-- RECONCILIATION
-- ============================================================

CREATE TABLE IF NOT EXISTS fisco_reconciliation_runs (
  id TEXT PRIMARY KEY,
  rebuild_run_id TEXT REFERENCES fisco_rebuild_runs(id),
  reconciled_at TIMESTAMP NOT NULL DEFAULT NOW(),
  year_from INTEGER,
  year_to INTEGER,
  exchange_filter TEXT,
  total_operations_checked INTEGER DEFAULT 0,
  discrepancies_found INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',
  summary_json JSONB
);

CREATE TABLE IF NOT EXISTS fisco_reconciliation_items (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES fisco_reconciliation_runs(id),
  item_type TEXT NOT NULL,
  exchange TEXT,
  external_id TEXT,
  asset TEXT,
  expected_value DECIMAL(18,8),
  actual_value DECIMAL(18,8),
  diff_value DECIMAL(18,8),
  detail TEXT,
  severity TEXT NOT NULL DEFAULT 'warning'
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_fisco_staging_ops_run ON fisco_staging_operations(rebuild_run_id);
CREATE INDEX IF NOT EXISTS idx_fisco_staging_lots_run ON fisco_staging_lots(rebuild_run_id);
CREATE INDEX IF NOT EXISTS idx_fisco_staging_disp_run ON fisco_staging_disposals(rebuild_run_id);
CREATE INDEX IF NOT EXISTS idx_fisco_backup_ops_id ON fisco_backup_operations(backup_id);
CREATE INDEX IF NOT EXISTS idx_fisco_backup_lots_id ON fisco_backup_lots(backup_id);
CREATE INDEX IF NOT EXISTS idx_fisco_backup_disp_id ON fisco_backup_disposals(backup_id);
CREATE INDEX IF NOT EXISTS idx_fisco_recon_items_run ON fisco_reconciliation_items(run_id);
