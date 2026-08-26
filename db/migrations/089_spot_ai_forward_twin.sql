-- 089_spot_ai_forward_twin.sql
-- IA SPOT FORWARD TWIN — Advisory prediction logs and model registry.
--
-- PROPERTIES:
--   - Additive only (no destructive changes).
--   - Idempotent (IF NOT EXISTS on all objects).
--   - No secrets stored.
--   - Retention: 90 days for advisory logs.
--
-- NOT TO BE APPLIED IN THIS PHASE.
-- Requires explicit authorization before deployment.

-- Advisory prediction log (one row per scan evaluated by AI)
CREATE TABLE IF NOT EXISTS spot_ai_advisory_logs (
  id           SERIAL PRIMARY KEY,
  scan_id      TEXT NOT NULL,
  pair         TEXT NOT NULL,
  model_name   TEXT NOT NULL,
  model_version TEXT NOT NULL,
  feature_schema_version INTEGER NOT NULL,
  entry_quality_score REAL,
  prob_0_5R    REAL,
  prob_1R      REAL,
  prob_2R      REAL,
  expected_mfe_r REAL,
  expected_mae_r REAL,
  prob_net_profit REAL,
  giveback_risk_score REAL,
  lot_id       TEXT,
  timestamp    BIGINT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spot_ai_advisory_logs_scan_id
  ON spot_ai_advisory_logs (scan_id);
CREATE INDEX IF NOT EXISTS idx_spot_ai_advisory_logs_pair
  ON spot_ai_advisory_logs (pair);
CREATE INDEX IF NOT EXISTS idx_spot_ai_advisory_logs_timestamp
  ON spot_ai_advisory_logs (timestamp DESC);

-- Model registry (one row per model version)
CREATE TABLE IF NOT EXISTS spot_ai_model_registry (
  id                   SERIAL PRIMARY KEY,
  model_name           TEXT NOT NULL,
  model_version        TEXT NOT NULL,
  feature_schema_version INTEGER NOT NULL,
  status               TEXT NOT NULL DEFAULT 'CANDIDATE',
  dataset_start        BIGINT,
  dataset_end          BIGINT,
  trade_count          INTEGER,
  git_sha              TEXT,
  trained_at           BIGINT NOT NULL,
  metrics_json         JSONB NOT NULL DEFAULT '{}',
  model_path           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_name, model_version)
);

CREATE INDEX IF NOT EXISTS idx_spot_ai_model_registry_name
  ON spot_ai_model_registry (model_name);
CREATE INDEX IF NOT EXISTS idx_spot_ai_model_registry_status
  ON spot_ai_model_registry (status);

-- Retention: 90 days for advisory logs
-- (implemented via cron or scheduled job, not trigger)
