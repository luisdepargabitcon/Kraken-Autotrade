-- Migration 044: FISCO opening balances (saldo inicial fiscal) + fetch stats column
-- Allows registering manual opening lots for assets acquired before available history.
-- fetch_stats_json stores per-exchange download metadata for each rebuild run.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Fetch-stats column on fisco_rebuild_runs
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE fisco_rebuild_runs
  ADD COLUMN IF NOT EXISTS fetch_stats_json JSONB NOT NULL DEFAULT '{}';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Opening balances table
--    Each row represents a synthetic BUY lot that pre-dates available history.
--    These are injected into the FIFO engine as ordinary trade_buy operations.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fisco_opening_balances (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset             TEXT        NOT NULL,
  quantity          DECIMAL(28, 10) NOT NULL,
  acquisition_date  TIMESTAMPTZ NOT NULL,
  cost_basis_eur    DECIMAL(20, 6) NOT NULL,
  exchange          TEXT        NOT NULL DEFAULT 'manual',
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,

  CONSTRAINT fisco_ob_positive_qty  CHECK (quantity > 0),
  CONSTRAINT fisco_ob_positive_cost CHECK (cost_basis_eur >= 0)
);

CREATE INDEX IF NOT EXISTS idx_fisco_ob_asset  ON fisco_opening_balances(asset);
CREATE INDEX IF NOT EXISTS idx_fisco_ob_active ON fisco_opening_balances(is_active)
  WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_fisco_ob_date   ON fisco_opening_balances(acquisition_date);
