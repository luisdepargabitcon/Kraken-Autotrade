-- Migration 057: IDCA Hybrid Intelligent Layers
-- Adds idca_hybrid_mode/config/alert_config to bot_config
-- Creates idca_hybrid_state and idca_grid_legs tables

-- ── bot_config columns ─────────────────────────────────────────────────────
ALTER TABLE bot_config
  ADD COLUMN IF NOT EXISTS idca_hybrid_mode text DEFAULT 'off';

ALTER TABLE bot_config
  ADD COLUMN IF NOT EXISTS idca_hybrid_config jsonb DEFAULT '{
    "profile": "conservative",
    "meanReversionEnabled": true,
    "gridEnabled": false,
    "dynamicVolatilityEnabled": true,
    "bearTrendBlockEnabled": true,
    "dataQualityBlockEnabled": true,
    "executionScope": "observer",
    "gridCapitalPolicy": "dynamic_low",
    "gridLevelPolicy": "dynamic_atr",
    "gridProfitPolicy": "fees_aware",
    "doNotRewriteAnchor": true,
    "maxGridCapitalPctOfCycle": 10,
    "maxGridLevels": 3,
    "allowGridWithoutActiveCycle": false
  }'::jsonb;

ALTER TABLE bot_config
  ADD COLUMN IF NOT EXISTS idca_hybrid_alert_config jsonb DEFAULT '{
    "enabled": true,
    "regimeChange": true,
    "meanReversionAllowed": true,
    "meanReversionBlocked": true,
    "gridArmed": true,
    "gridPaused": true,
    "gridExecuted": true,
    "cycleExit": true,
    "dataQuality": true,
    "dedupeMinutes": 15,
    "verbosity": "normal"
  }'::jsonb;

-- ── idca_hybrid_state ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS idca_hybrid_state (
  id             serial PRIMARY KEY,
  pair           text        NOT NULL,
  cycle_id       integer,
  mode           text        NOT NULL DEFAULT 'off',
  regime         text        NOT NULL DEFAULT 'unknown',
  mean_reversion_state text  NOT NULL DEFAULT 'neutral',
  grid_state     text        NOT NULL DEFAULT 'inactive',
  last_price     numeric(20, 8),
  vwap           numeric(20, 8),
  ema20          numeric(20, 8),
  ema50          numeric(20, 8),
  atr_pct        numeric(10, 4),
  z_score        numeric(10, 4),
  score          integer,
  reason         text,
  natural_reason text,
  raw_json       jsonb,
  created_at     timestamptz NOT NULL DEFAULT NOW(),
  updated_at     timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT idca_hybrid_state_pair_cycle_uq UNIQUE (pair, cycle_id)
);

CREATE INDEX IF NOT EXISTS idx_idca_hybrid_state_pair       ON idca_hybrid_state (pair);
CREATE INDEX IF NOT EXISTS idx_idca_hybrid_state_updated_at ON idca_hybrid_state (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_idca_hybrid_state_regime      ON idca_hybrid_state (regime);

-- ── idca_grid_legs ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS idca_grid_legs (
  id             serial PRIMARY KEY,
  pair           text        NOT NULL,
  cycle_id       integer,
  leg_index      integer     NOT NULL,
  status         text        NOT NULL DEFAULT 'planned',
  side           text        NOT NULL DEFAULT 'buy',
  planned_price  numeric(20, 8) NOT NULL,
  executed_price numeric(20, 8),
  quantity       numeric(20, 8),
  gross_pnl      numeric(20, 8),
  net_pnl        numeric(20, 8),
  fees           numeric(20, 8),
  reason         text,
  natural_reason text,
  order_id       text,
  observer_only  boolean     NOT NULL DEFAULT true,
  raw_json       jsonb,
  created_at     timestamptz NOT NULL DEFAULT NOW(),
  updated_at     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idca_grid_legs_pair       ON idca_grid_legs (pair);
CREATE INDEX IF NOT EXISTS idx_idca_grid_legs_cycle_id   ON idca_grid_legs (cycle_id);
CREATE INDEX IF NOT EXISTS idx_idca_grid_legs_status     ON idca_grid_legs (status);
CREATE INDEX IF NOT EXISTS idx_idca_grid_legs_pair_cycle ON idca_grid_legs (pair, cycle_id, leg_index);

-- ── auto-cleanup function ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_old_idca_hybrid_state()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM idca_hybrid_state WHERE updated_at < NOW() - INTERVAL '60 days';
  DELETE FROM idca_grid_legs   WHERE updated_at < NOW() - INTERVAL '90 days'
    AND status IN ('cancelled', 'closed');
END;
$$;
