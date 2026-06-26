-- Migration 060: FISCO Control Status — operation_set_hash + result history
-- Permite detectar cambios en el conjunto de operaciones y mantener historial
-- de resultados fiscales entre rebuilds para explicar diferencias.

-- ============================================================
-- 1. Añadir columnas a fisco_rebuild_runs para huella de datos
-- ============================================================

ALTER TABLE fisco_rebuild_runs
  ADD COLUMN IF NOT EXISTS operation_set_hash TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_year INTEGER,
  ADD COLUMN IF NOT EXISTS gains_eur DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS losses_eur DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS net_gain_loss_eur DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS previous_net_gain_loss_eur DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS delta_net_gain_loss_eur DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS delta_gains_eur DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS delta_losses_eur DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS changed_from_previous BOOLEAN DEFAULT FALSE;

-- ============================================================
-- 2. Tabla: fisco_result_history
-- Historial de resultados fiscales por año y run
-- ============================================================

CREATE TABLE IF NOT EXISTS fisco_result_history (
  id SERIAL PRIMARY KEY,
  fiscal_year INTEGER NOT NULL,
  run_id TEXT REFERENCES fisco_rebuild_runs(id),
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  operations_count INTEGER DEFAULT 0,
  lots_count INTEGER DEFAULT 0,
  disposals_count INTEGER DEFAULT 0,
  gains_eur DECIMAL(18,8) DEFAULT 0,
  losses_eur DECIMAL(18,8) DEFAULT 0,
  net_gain_loss_eur DECIMAL(18,8) DEFAULT 0,
  operation_set_hash TEXT,
  previous_net_gain_loss_eur DECIMAL(18,8),
  delta_net_gain_loss_eur DECIMAL(18,8),
  delta_gains_eur DECIMAL(18,8),
  delta_losses_eur DECIMAL(18,8),
  changed_from_previous BOOLEAN DEFAULT FALSE,
  explanation TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fisco_result_history_year
  ON fisco_result_history(fiscal_year, recorded_at DESC);

-- ============================================================
-- 3. Tabla: fisco_control_snapshots
-- Snapshots del estado de control para comparación
-- ============================================================

CREATE TABLE IF NOT EXISTS fisco_control_snapshots (
  id SERIAL PRIMARY KEY,
  fiscal_year INTEGER NOT NULL,
  operation_set_hash TEXT NOT NULL,
  operations_count INTEGER NOT NULL,
  lots_count INTEGER NOT NULL,
  disposals_count INTEGER NOT NULL,
  transfer_links_count INTEGER NOT NULL,
  last_operation_executed_at TIMESTAMPTZ,
  last_operation_created_at TIMESTAMPTZ,
  net_gain_loss_eur DECIMAL(18,8),
  fiscal_result_status TEXT NOT NULL,
  run_id TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fisco_control_snapshots_year
  ON fisco_control_snapshots(fiscal_year, recorded_at DESC);

COMMENT ON TABLE fisco_result_history IS 'FISCO: historial de resultados fiscales por año entre rebuilds';
COMMENT ON TABLE fisco_control_snapshots IS 'FISCO: snapshots de control para detectar cambios de datos';
