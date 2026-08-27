-- 090_spot_ai_forward_training_trades.sql
-- IA SPOT FORWARD TWIN — Durable training dataset storage.
--
-- PROBLEM:
--   Forward Twin raw snapshots have SPOT_FORWARD_TWIN_RETENTION_DAYS = 7.
--   The IA requires 100-200 completed trades to train. We cannot depend on
--   producing 100-200 trades in 7 days. Raw snapshots are heavy and must not
--   be retained indefinitely.
--
-- SOLUTION:
--   Persist compact, versioned training episodes/trades when a trade becomes
--   COMPLETED (BUY + SCAN + SUPERVISOR + SELL + outcome). Forward Twin raw
--   can keep its 7-day retention; the IA-derived compact data persists longer
--   (90 days minimum, or no auto-delete initially).
--
-- PROPERTIES:
--   - Additive only (no destructive changes).
--   - Idempotent (IF NOT EXISTS on all objects).
--   - No secrets stored.
--   - Retention: NO_AUTO_DELETE_UNTIL_VALIDATED (R4).
--
-- NOT TO BE APPLIED IN THIS PHASE.
-- Requires explicit authorization before deployment.
-- R3: created and audited only. NO DEPLOY.
-- R4: added forward_twin_schema_version, gross_pnl_usd, entry_fee_usd,
--     exit_fee_usd, executed_qty, weighted_avg_exit_price.
-- R5: added weighted_avg_entry_price, total_entry_volume, total_exit_volume,
--     closed_qty, is_trainable. Renamed executed_qty semantics to closed_qty
--     (executed_qty kept for backward compat = closed_qty).

-- ─── Completed training trades (entry model) ─────────────────────────────────
-- One row per COMPLETED Forward Twin trade (full causal chain).
CREATE TABLE IF NOT EXISTS spot_ai_forward_training_trades (
  id                    SERIAL PRIMARY KEY,
  feature_schema_version INTEGER NOT NULL,
  -- R4: Forward Twin snapshot schema version (1=v1, 2=v2 with currentR).
  forward_twin_schema_version INTEGER NOT NULL DEFAULT 1,
  lot_id                TEXT NOT NULL,
  pair                  TEXT NOT NULL,
  entry_scan_id         TEXT NOT NULL,
  entry_time            BIGINT NOT NULL,
  exit_time             BIGINT NOT NULL,
  entry_price           DOUBLE PRECISION NOT NULL,
  exit_price            DOUBLE PRECISION NOT NULL,
  -- R4: immutable initial stop from causal SCAN sizing (NOT sgCurrentStopPrice).
  stop_price            DOUBLE PRECISION NOT NULL,
  -- R4: immutable initial risk (USD) from causal SCAN sizing.
  risk_usd              DOUBLE PRECISION NOT NULL,
  mfe                   DOUBLE PRECISION NOT NULL,
  mae                   DOUBLE PRECISION NOT NULL,
  mfe_r                 DOUBLE PRECISION NOT NULL,
  mae_r                 DOUBLE PRECISION NOT NULL,
  -- R4: NET PnL (gross - fees).
  net_pnl_usd           DOUBLE PRECISION NOT NULL,
  -- R4: gross PnL = (exitPrice - entryPrice) * executedQty.
  gross_pnl_usd         DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- R4: entry fee (USD).
  entry_fee_usd         DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- R4: exit fee (USD).
  exit_fee_usd          DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- R4: executed entry volume (base currency, from fillVolume).
  -- R5: kept for backward compat; closed_qty is the canonical field.
  executed_qty          DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- R4: weighted average exit price across SELL fills.
  weighted_avg_exit_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- R5: weighted average entry price across BUY fills.
  weighted_avg_entry_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- R5: total executed entry volume (base currency).
  total_entry_volume    DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- R5: total executed exit volume (base currency).
  total_exit_volume     DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- R5: actually closed quantity (min of entry and exit within dust tolerance).
  closed_qty            DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- R5: whether this row is trainable (valid economy + causal + features + labels).
  is_trainable          BOOLEAN NOT NULL DEFAULT false,
  exit_reason_type      TEXT,
  -- Entry features (compact JSON, versioned by feature_schema_version).
  -- R5: MUST be non-empty for is_trainable=true. Backfill must reconstruct
  -- real features, not persist {}.
  entry_features_json   JSONB NOT NULL DEFAULT '{}',
  -- Entry labels (compact JSON).
  -- R5: MUST be non-empty for is_trainable=true. Backfill must reconstruct
  -- real labels, not persist {}.
  entry_labels_json     JSONB NOT NULL DEFAULT '{}',
  policy_version        TEXT NOT NULL,
  dataset_fingerprint   TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lot_id, pair)
);

CREATE INDEX IF NOT EXISTS idx_spot_ai_ft_trades_pair
  ON spot_ai_forward_training_trades (pair);
CREATE INDEX IF NOT EXISTS idx_spot_ai_ft_trades_entry_time
  ON spot_ai_forward_training_trades (entry_time DESC);
CREATE INDEX IF NOT EXISTS idx_spot_ai_ft_trades_schema
  ON spot_ai_forward_training_trades (feature_schema_version);
CREATE INDEX IF NOT EXISTS idx_spot_ai_ft_trades_ft_schema
  ON spot_ai_forward_training_trades (forward_twin_schema_version);
-- R5: index for trainable filtering (training guard uses this).
CREATE INDEX IF NOT EXISTS idx_spot_ai_ft_trades_trainable
  ON spot_ai_forward_training_trades (is_trainable) WHERE is_trainable = true;

-- ─── Giveback samples (giveback model) ───────────────────────────────────────
-- One row per SUPERVISOR snapshot for a completed trade (state at time T +
-- future outcome label computed from path > T).
CREATE TABLE IF NOT EXISTS spot_ai_forward_giveback_samples (
  id                    SERIAL PRIMARY KEY,
  feature_schema_version INTEGER NOT NULL,
  -- R4: Forward Twin snapshot schema version (1=v1, 2=v2 with currentR).
  forward_twin_schema_version INTEGER NOT NULL DEFAULT 1,
  lot_id                TEXT NOT NULL,
  pair                  TEXT NOT NULL,
  timestamp             BIGINT NOT NULL,
  -- State known up to T (FEATURE side, compact JSON)
  state_json            JSONB NOT NULL DEFAULT '{}',
  -- Future outcome label (computed from path > T)
  labels_json           JSONB,
  -- Whether this sample has a future label (trade closed)
  has_label             BOOLEAN NOT NULL DEFAULT false,
  policy_version        TEXT NOT NULL,
  dataset_fingerprint   TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lot_id, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_spot_ai_ft_giveback_lot
  ON spot_ai_forward_giveback_samples (lot_id);
CREATE INDEX IF NOT EXISTS idx_spot_ai_ft_giveback_pair
  ON spot_ai_forward_giveback_samples (pair);
CREATE INDEX IF NOT EXISTS idx_spot_ai_ft_giveback_timestamp
  ON spot_ai_forward_giveback_samples (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_spot_ai_ft_giveback_schema
  ON spot_ai_forward_giveback_samples (feature_schema_version);
CREATE INDEX IF NOT EXISTS idx_spot_ai_ft_giveback_ft_schema
  ON spot_ai_forward_giveback_samples (forward_twin_schema_version);
CREATE INDEX IF NOT EXISTS idx_spot_ai_ft_giveback_has_label
  ON spot_ai_forward_giveback_samples (has_label);

-- ─── Retention ───────────────────────────────────────────────────────────────
-- R4: DURABLE_RETENTION_POLICY=NO_AUTO_DELETE_UNTIL_VALIDATED
-- No auto-delete until:
--   >=200 trades + dataset audit approved + explicit authorization.
-- After that, a scheduled cleanup job can enforce 90/180/etc days.
