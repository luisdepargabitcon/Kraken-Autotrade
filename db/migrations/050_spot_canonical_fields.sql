-- Migration 050: SPOT Canonical Engine — add SPOT fields to existing tables
--
-- Adds execution_mode and SPOT-specific fields to open_positions and trades
-- so that SHADOW and REAL share the same model. No new spot_positions/spot_trades
-- tables are created — we extend the canonical existing tables.
--
-- Also adds spot_execution_mode to bot_config for persistent execution mode.
--
-- Properties: additive, idempotent, no DROP, no TRUNCATE, no DELETE.
-- Safe to re-run.

-- ─── bot_config: spot_execution_mode ──────────────────────────────────────
-- Persists SPOT execution mode across restarts. Values: OFF, SHADOW, REAL.
-- Default: OFF. Fail-safe: corrupt/unknown → OFF at runtime.
ALTER TABLE bot_config
  ADD COLUMN IF NOT EXISTS spot_execution_mode text NOT NULL DEFAULT 'OFF';

-- ─── open_positions: SPOT fields ──────────────────────────────────────────
-- Allows SHADOW positions to coexist with REAL in the same table.
ALTER TABLE open_positions
  ADD COLUMN IF NOT EXISTS execution_mode text DEFAULT 'REAL',
  ADD COLUMN IF NOT EXISTS policy_version text,
  ADD COLUMN IF NOT EXISTS setup_tag text,
  ADD COLUMN IF NOT EXISTS signal_id text,
  ADD COLUMN IF NOT EXISTS market_context_id text,
  ADD COLUMN IF NOT EXISTS regime_at_entry text,
  ADD COLUMN IF NOT EXISTS direction_at_entry text,
  ADD COLUMN IF NOT EXISTS macro_at_entry text,
  ADD COLUMN IF NOT EXISTS atr_pct_at_entry decimal(8,4),
  ADD COLUMN IF NOT EXISTS initial_stop_price decimal(18,8),
  ADD COLUMN IF NOT EXISTS initial_stop_distance_pct decimal(8,4),
  ADD COLUMN IF NOT EXISTS initial_stop_distance_usd decimal(18,8),
  ADD COLUMN IF NOT EXISTS risk_usd decimal(18,8),
  ADD COLUMN IF NOT EXISTS mfe decimal(18,8) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mae decimal(18,8) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mfe_r decimal(10,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mae_r decimal(10,4) DEFAULT 0;

-- ─── trades: SPOT fields for closed positions ─────────────────────────────
-- Allows SHADOW trades to coexist with REAL in the same table.
ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS execution_mode text DEFAULT 'REAL',
  ADD COLUMN IF NOT EXISTS policy_version text,
  ADD COLUMN IF NOT EXISTS setup_tag text,
  ADD COLUMN IF NOT EXISTS signal_id text,
  ADD COLUMN IF NOT EXISTS market_context_id text,
  ADD COLUMN IF NOT EXISTS gross_pnl_usd decimal(18,8),
  ADD COLUMN IF NOT EXISTS entry_fee_usd decimal(18,8),
  ADD COLUMN IF NOT EXISTS exit_fee_usd decimal(18,8),
  ADD COLUMN IF NOT EXISTS execution_cost_usd decimal(18,8),
  ADD COLUMN IF NOT EXISTS net_pnl_usd decimal(18,8),
  ADD COLUMN IF NOT EXISTS fee_quality text,
  ADD COLUMN IF NOT EXISTS mfe decimal(18,8) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mae decimal(18,8) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mfe_r decimal(10,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mae_r decimal(10,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit_capture_pct decimal(8,4),
  ADD COLUMN IF NOT EXISTS exit_reason_type text,
  ADD COLUMN IF NOT EXISTS lot_id text,
  ADD COLUMN IF NOT EXISTS hold_time_minutes integer;

-- ─── Index for SPOT queries ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_open_positions_execution_mode
  ON open_positions(execution_mode);

CREATE INDEX IF NOT EXISTS idx_trades_execution_mode
  ON trades(execution_mode);

CREATE INDEX IF NOT EXISTS idx_open_positions_lot_id
  ON open_positions(lot_id);

CREATE INDEX IF NOT EXISTS idx_trades_lot_id
  ON trades(lot_id);

-- ─── Backfill: existing open_positions default to REAL ────────────────────
UPDATE open_positions
  SET execution_mode = 'REAL'
  WHERE execution_mode IS NULL;

UPDATE trades
  SET execution_mode = 'REAL'
  WHERE execution_mode IS NULL;
