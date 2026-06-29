-- Migration 060: IDCA Hybrid Grid traceability and events
-- Adds rich columns to idca_grid_legs and creates idca_hybrid_events.
-- Idempotent: all ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS.

-- ── idca_grid_legs enrichment ────────────────────────────────────────────────
ALTER TABLE idca_grid_legs
  ADD COLUMN IF NOT EXISTS grid_plan_id      text        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS planned_entry_price numeric(20, 8) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS planned_exit_price  numeric(20, 8) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS planned_notional_usd numeric(20, 8) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS planned_capital_pct_of_cycle numeric(10, 4) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS expected_gross_profit_usd numeric(20, 8) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS expected_fees_usd   numeric(20, 8) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS expected_net_profit_usd numeric(20, 8) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trigger_condition_json jsonb,
  ADD COLUMN IF NOT EXISTS cancel_condition_json jsonb,
  ADD COLUMN IF NOT EXISTS regime_at_creation   text        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS atr_pct_at_creation  numeric(10, 4) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS z_score_at_creation  numeric(10, 4) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS vwap_at_creation     numeric(20, 8) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS current_price_at_creation numeric(20, 8) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS triggered_at       timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS closed_at            timestamptz DEFAULT NULL;

-- Backfill: planned_entry_price = planned_price for existing rows if null
UPDATE idca_grid_legs
  SET planned_entry_price = planned_price
  WHERE planned_entry_price IS NULL AND planned_price IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_idca_grid_legs_plan_id ON idca_grid_legs (grid_plan_id);
CREATE INDEX IF NOT EXISTS idx_idca_grid_legs_status_pair ON idca_grid_legs (status, pair);

-- ── idca_hybrid_events ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS idca_hybrid_events (
  id              serial PRIMARY KEY,
  ts              timestamptz NOT NULL DEFAULT NOW(),
  pair            text        NOT NULL,
  cycle_id        integer,
  event_type      text        NOT NULL,
  severity        text        NOT NULL DEFAULT 'info',
  observer_only   boolean     NOT NULL DEFAULT true,
  grid_plan_id    text,
  leg_index       integer,
  state_before    text,
  state_after     text,
  price           numeric(20, 8),
  quantity        numeric(20, 8),
  notional_usd    numeric(20, 8),
  expected_pnl_usd numeric(20, 8),
  reason          text,
  natural_reason  text,
  raw_json        jsonb,
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idca_hybrid_events_ts           ON idca_hybrid_events (ts DESC);
CREATE INDEX IF NOT EXISTS idx_idca_hybrid_events_pair          ON idca_hybrid_events (pair);
CREATE INDEX IF NOT EXISTS idx_idca_hybrid_events_cycle_id      ON idca_hybrid_events (cycle_id);
CREATE INDEX IF NOT EXISTS idx_idca_hybrid_events_pair_cycle_ts ON idca_hybrid_events (pair, cycle_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_idca_hybrid_events_type          ON idca_hybrid_events (event_type);

-- Auto-cleanup: keep events 90 days, cancelled/closed legs 90 days (already in 057, preserved here)
CREATE OR REPLACE FUNCTION cleanup_old_idca_hybrid_state()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM idca_hybrid_state WHERE updated_at < NOW() - INTERVAL '60 days';
  DELETE FROM idca_grid_legs   WHERE updated_at < NOW() - INTERVAL '90 days'
    AND status IN ('cancelled', 'closed');
  DELETE FROM idca_hybrid_events WHERE ts < NOW() - INTERVAL '90 days';
END;
$$;
