-- 052_autotuning_trade_snapshots.sql
-- Complete entry+exit snapshots for BOT SPOT, IDCA, shadow, dry-run
-- Tracked by AutoMigrationRunner — idempotent via IF NOT EXISTS

CREATE TABLE IF NOT EXISTS trade_snapshots (
  id                      BIGSERIAL    PRIMARY KEY,
  source_mode             TEXT         NOT NULL,  -- REAL | DRY_RUN | SHADOW | IDCA_SIMULATION
  strategy_type           TEXT         NOT NULL,  -- BOT_SPOT | IDCA
  source_trade_id         TEXT         NOT NULL,  -- buyTxid / simTxid / cycle_id / lot_id
  source_table            TEXT         NOT NULL,  -- trades | dry_run_trades | institutional_dca_cycles
  snapshot_type           TEXT         NOT NULL,  -- ENTRY | EXIT | CYCLE_START | SAFETY_BUY | TP | BREAKEVEN
  evidence_weight         DECIMAL(4,3) NOT NULL DEFAULT 1.000,
  pair                    TEXT         NOT NULL,

  -- Timing
  entry_ts_utc            TIMESTAMPTZ,
  exit_ts_utc             TIMESTAMPTZ,
  session_label           TEXT,           -- ASIA | EU | USA

  -- Price / size
  entry_price             DECIMAL(18,8),
  exit_price              DECIMAL(18,8),
  executed_amount         DECIMAL(18,8),
  entry_fee_usd           DECIMAL(18,8),
  exit_fee_usd            DECIMAL(18,8),
  slippage_entry_pct      DECIMAL(10,6),
  slippage_exit_pct       DECIMAL(10,6),

  -- Signal context
  signal_score            DECIMAL(6,3),
  spread_pct              DECIMAL(8,4),
  regime                  TEXT,
  trend_1h                TEXT,
  trend_4h                TEXT,
  trend_1d                TEXT,

  -- Technical indicators at entry
  ema10                   DECIMAL(18,8),
  ema20                   DECIMAL(18,8),
  atr_pct                 DECIMAL(8,4),
  rsi14                   DECIMAL(6,2),
  macd_hist               DECIMAL(18,8),
  volume_ratio            DECIMAL(8,4),
  distance_to_vwap_pct    DECIMAL(8,4),
  distance_to_anchor_pct  DECIMAL(8,4),

  -- Capital context
  capital_available_usd   DECIMAL(18,2),
  total_exposure_usd      DECIMAL(18,2),
  pair_exposure_usd       DECIMAL(18,2),

  -- Config / rules
  config_snapshot_json    JSONB,
  entry_rules_met_json    JSONB,
  entry_rules_blocked_json JSONB,

  -- Exit info
  exit_reason             TEXT,
  exit_category           TEXT,   -- TIME_BASED_EXIT | PROFIT_EXIT | RISK_EXIT | TRAILING_EXIT | SMART_EXIT
  was_time_stop           BOOLEAN NOT NULL DEFAULT FALSE,

  -- Outcome
  pnl_gross_usd           DECIMAL(18,8),
  pnl_net_usd             DECIMAL(18,8),
  pnl_pct                 DECIMAL(10,4),
  mfe_pct                 DECIMAL(8,4),
  mae_pct                 DECIMAL(8,4),
  max_drawdown_pct        DECIMAL(8,4),
  hold_time_minutes       INTEGER,
  trade_quality_score     INTEGER,

  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_snapshot_event
  ON trade_snapshots(source_trade_id, source_mode, snapshot_type);

CREATE INDEX IF NOT EXISTS idx_ts_source_mode    ON trade_snapshots(source_mode, strategy_type);
CREATE INDEX IF NOT EXISTS idx_ts_pair           ON trade_snapshots(pair);
CREATE INDEX IF NOT EXISTS idx_ts_entry_ts       ON trade_snapshots(entry_ts_utc) WHERE entry_ts_utc IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ts_exit_reason    ON trade_snapshots(exit_reason)  WHERE exit_reason IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ts_regime         ON trade_snapshots(regime)        WHERE regime IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ts_snapshot_type  ON trade_snapshots(snapshot_type);
