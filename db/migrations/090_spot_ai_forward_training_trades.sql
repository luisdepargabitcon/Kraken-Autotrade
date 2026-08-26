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
--   - Retention: 90 days for training trades / giveback samples (or no
--     auto-delete initially; a scheduled job can enforce it later).
--
-- NOT TO BE APPLIED IN THIS PHASE.
-- Requires explicit authorization before deployment.
-- R3: created and audited only. NO DEPLOY.

-- ─── Completed training trades (entry model) ─────────────────────────────────
-- One row per COMPLETED Forward Twin trade (full causal chain).
CREATE TABLE IF NOT EXISTS spot_ai_forward_training_trades (
  id                    SERIAL PRIMARY KEY,
  feature_schema_version INTEGER NOT NULL,
  lot_id                TEXT NOT NULL,
  pair                  TEXT NOT NULL,
  entry_scan_id         TEXT NOT NULL,
  entry_time            BIGINT NOT NULL,
  exit_time             BIGINT NOT NULL,
  entry_price           DOUBLE PRECISION NOT NULL,
  exit_price            DOUBLE PRECISION NOT NULL,
  stop_price            DOUBLE PRECISION NOT NULL,
  risk_usd              DOUBLE PRECISION NOT NULL,
  mfe                   DOUBLE PRECISION NOT NULL,
  mae                   DOUBLE PRECISION NOT NULL,
  mfe_r                 DOUBLE PRECISION NOT NULL,
  mae_r                 DOUBLE PRECISION NOT NULL,
  net_pnl_usd           DOUBLE PRECISION NOT NULL,
  exit_reason_type      TEXT,
  -- Entry features (compact JSON, versioned by feature_schema_version)
  entry_features_json   JSONB NOT NULL DEFAULT '{}',
  -- Entry labels (compact JSON)
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

-- ─── Giveback samples (giveback model) ───────────────────────────────────────
-- One row per SUPERVISOR snapshot for a completed trade (state at time T +
-- future outcome label computed from path > T).
CREATE TABLE IF NOT EXISTS spot_ai_forward_giveback_samples (
  id                    SERIAL PRIMARY KEY,
  feature_schema_version INTEGER NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_spot_ai_ft_giveback_has_label
  ON spot_ai_forward_giveback_samples (has_label);

-- ─── Retention ───────────────────────────────────────────────────────────────
-- 90 days minimum for training trades / giveback samples.
-- Implemented via a scheduled cleanup job (not a trigger) that deletes rows
-- with created_at < now() - interval '90 days'.
-- Initially (R3): no auto-delete until the pipeline is validated.
