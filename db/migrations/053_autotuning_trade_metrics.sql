-- 053_autotuning_trade_metrics.sql
-- Periodic MFE/MAE/drawdown samples for open positions and IDCA cycles
-- Sampled every 5 minutes. Retained for configurable period.
-- Tracked by AutoMigrationRunner — idempotent via IF NOT EXISTS

CREATE TABLE IF NOT EXISTS trade_metrics (
  id                      BIGSERIAL    PRIMARY KEY,
  source_mode             TEXT         NOT NULL,   -- REAL | DRY_RUN | IDCA_SIMULATION
  strategy_type           TEXT         NOT NULL,   -- BOT_SPOT | IDCA
  source_trade_id         TEXT         NOT NULL,   -- lot_id / sim_txid / cycle_id
  pair                    TEXT         NOT NULL,
  sampled_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Price snapshot
  current_price           DECIMAL(18,8),
  entry_price             DECIMAL(18,8),

  -- Floating P&L
  floating_pnl_usd        DECIMAL(18,8),
  floating_pnl_pct        DECIMAL(10,4),

  -- Excursion tracking
  mfe_pct                 DECIMAL(8,4),
  mae_pct                 DECIMAL(8,4),
  max_drawdown_pct        DECIMAL(8,4),
  high_price_seen         DECIMAL(18,8),
  low_price_seen          DECIMAL(18,8),

  -- State at sample time
  trailing_activated      BOOLEAN      DEFAULT FALSE,
  time_positive_minutes   INTEGER      DEFAULT 0,
  time_negative_minutes   INTEGER      DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_trade_metrics_source
  ON trade_metrics(source_trade_id, source_mode);
CREATE INDEX IF NOT EXISTS idx_trade_metrics_pair
  ON trade_metrics(pair);
CREATE INDEX IF NOT EXISTS idx_trade_metrics_sampled
  ON trade_metrics(sampled_at);
-- Index for retention cleanup
CREATE INDEX IF NOT EXISTS idx_trade_metrics_cleanup
  ON trade_metrics(sampled_at, source_mode);
