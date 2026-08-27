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
-- R6: added total_entry_fee_usd, entry_fee_allocated_usd, residual_qty.
--     closed_qty = real executed exit qty (no phantom, no 1% tolerance).
--     entry_fee_usd = allocated portion (NOT total). total_entry_fee_usd = full.
--     No empty training rows: is_trainable=false rows are NOT inserted.
-- R8: hardened dataset_fingerprint NOT NULL, policy_version NOT NULL + CHECK.
--     Giveback labels_json NOT NULL, has_label NOT NULL (only mature samples).
-- R9: removed silent DEFAULT 0 from all economic columns the writer always
--     provides explicitly. No DEFAULT can mask a writer omission as a zero.
--     is_trainable NOT NULL + CHECK (is_trainable = true) — only trainable
--     rows are inserted by the writer.

-- ─── Completed training trades (entry model) ─────────────────────────────────
-- One row per COMPLETED Forward Twin trade (full causal chain).
CREATE TABLE IF NOT EXISTS spot_ai_forward_training_trades (
  id                    SERIAL PRIMARY KEY,
  feature_schema_version INTEGER NOT NULL,
  -- R4: Forward Twin snapshot schema version (1=v1, 2=v2 with currentR).
  -- R9: No DEFAULT — writer always provides explicitly.
  forward_twin_schema_version INTEGER NOT NULL,
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
  -- R9: No DEFAULT 0 — writer always provides explicitly.
  gross_pnl_usd         DOUBLE PRECISION NOT NULL,
  -- R4: entry fee (USD). R6: this is the ALLOCATED portion = totalEntryFeeUsd * (closedQty / totalEntryVolume).
  -- R9: No DEFAULT 0 — writer always provides explicitly.
  entry_fee_usd         DOUBLE PRECISION NOT NULL,
  -- R6: total entry fee (USD) — all BUY fills, before allocation.
  -- R9: No DEFAULT 0 — writer always provides explicitly.
  total_entry_fee_usd   DOUBLE PRECISION NOT NULL,
  -- R6: entry fee allocated to the closed portion = totalEntryFeeUsd * (closedQty / totalEntryVolume).
  -- R9: No DEFAULT 0 — writer always provides explicitly.
  entry_fee_allocated_usd DOUBLE PRECISION NOT NULL,
  -- R4: exit fee (USD).
  -- R9: No DEFAULT 0 — writer always provides explicitly.
  exit_fee_usd          DOUBLE PRECISION NOT NULL,
  -- R4: executed entry volume (base currency, from fillVolume).
  -- R5: kept for backward compat; closed_qty is the canonical field.
  -- R9: No DEFAULT 0 — writer always provides explicitly.
  executed_qty          DOUBLE PRECISION NOT NULL,
  -- R4: weighted average exit price across SELL fills.
  -- R9: No DEFAULT 0 — writer always provides explicitly.
  weighted_avg_exit_price DOUBLE PRECISION NOT NULL,
  -- R5: weighted average entry price across BUY fills.
  -- R9: No DEFAULT 0 — writer always provides explicitly.
  weighted_avg_entry_price DOUBLE PRECISION NOT NULL,
  -- R5: total executed entry volume (base currency).
  -- R9: No DEFAULT 0 — writer always provides explicitly.
  total_entry_volume    DOUBLE PRECISION NOT NULL,
  -- R5: total executed exit volume (base currency).
  -- R9: No DEFAULT 0 — writer always provides explicitly.
  total_exit_volume     DOUBLE PRECISION NOT NULL,
  -- R5: actually closed quantity. R6: = min(entry, exit) when within QTY_EPSILON.
  --     No phantom exit qty. No relative 1% tolerance.
  -- R9: No DEFAULT 0 — writer always provides explicitly.
  closed_qty            DOUBLE PRECISION NOT NULL,
  -- R6: residual quantity = totalEntryVolume - closedQty (0 when fully closed).
  -- R9: No DEFAULT 0 — writer always provides explicitly.
  residual_qty          DOUBLE PRECISION NOT NULL,
  -- R5: whether this row is trainable (valid economy + causal + features + labels).
  -- R9: NOT NULL + CHECK (is_trainable = true) — writer only inserts trainable rows.
  is_trainable          BOOLEAN NOT NULL,
  exit_reason_type      TEXT,
  -- Entry features (compact JSON, versioned by feature_schema_version).
  -- R5: MUST be non-empty for is_trainable=true. Backfill must reconstruct
  -- real features, not persist {}.
  -- R8: No DEFAULT '{}' — writer must provide real features explicitly.
  entry_features_json   JSONB NOT NULL,
  -- Entry labels (compact JSON).
  -- R5: MUST be non-empty for is_trainable=true. Backfill must reconstruct
  -- real labels, not persist {}.
  -- R8: No DEFAULT '{}' — writer must provide real labels explicitly.
  entry_labels_json     JSONB NOT NULL,
  -- R8: policy_version NOT NULL + CHECK non-empty/non-whitespace.
  policy_version        TEXT NOT NULL,
  -- R8: dataset_fingerprint NOT NULL — writer must always provide it.
  dataset_fingerprint   TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lot_id, pair),
  -- R8: Reject empty/whitespace policy_version at the DB level.
  CONSTRAINT chk_training_trades_policy_version CHECK (btrim(policy_version) <> ''),
  -- R9: Only trainable rows are inserted by the writer.
  CONSTRAINT chk_training_trades_is_trainable CHECK (is_trainable = true)
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
  -- R9: No DEFAULT — writer always provides explicitly.
  forward_twin_schema_version INTEGER NOT NULL,
  lot_id                TEXT NOT NULL,
  pair                  TEXT NOT NULL,
  timestamp             BIGINT NOT NULL,
  -- State known up to T (FEATURE side, compact JSON)
  state_json            JSONB NOT NULL,
  -- R8: Future outcome label — NOT NULL. Only mature (labeled) samples are
  -- persisted to this durable TRAINING table. Unlabeled samples are skipped
  -- by the writer (R8-01 maturation).
  labels_json           JSONB NOT NULL,
  -- R8: Whether this sample has a future label — NOT NULL, always true.
  -- Writer always sets has_label=true for mature samples.
  has_label             BOOLEAN NOT NULL,
  -- R8: policy_version NOT NULL + CHECK non-empty/non-whitespace.
  policy_version        TEXT NOT NULL,
  -- R8: dataset_fingerprint NOT NULL — writer must always provide it.
  dataset_fingerprint   TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lot_id, timestamp),
  -- R8: Reject empty/whitespace policy_version at the DB level.
  CONSTRAINT chk_giveback_policy_version CHECK (btrim(policy_version) <> ''),
  -- R8: Only mature samples in the durable training table.
  CONSTRAINT chk_giveback_has_label CHECK (has_label = true)
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
