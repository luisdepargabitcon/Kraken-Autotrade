-- 055_autotuning_tuning_proposals.sql
-- Tuning proposals for parameter improvements. Autoapply OFF by default.
-- Tracked by AutoMigrationRunner — idempotent via IF NOT EXISTS

CREATE TABLE IF NOT EXISTS tuning_proposals (
  id                      SERIAL       PRIMARY KEY,
  strategy_type           TEXT         NOT NULL,   -- BOT_SPOT | IDCA
  pair                    TEXT,                    -- NULL = all pairs
  profile_id              INTEGER      REFERENCES strategy_profiles(id),
  proposed_profile_id     INTEGER      REFERENCES strategy_profiles(id),
  parameter_changes_json  JSONB,                   -- {param: {from, to, reason}}
  metrics_before_json     JSONB,                   -- snapshot of metrics when proposal created
  metrics_after_json      JSONB,                   -- snapshot of metrics after validation period
  confidence_score        DECIMAL(5,2),            -- 0-100
  risk_score              DECIMAL(5,2),            -- 0-100 (higher = riskier)
  recommendation          TEXT,
  -- Status flow: OBSERVING → TESTING → READY → APPROVED → ACTIVE | REJECTED
  -- From any state: → ROLLBACK
  status                  TEXT         NOT NULL DEFAULT 'OBSERVING',
  rejection_reason        TEXT,
  approved_by             TEXT,
  sample_count_at_decision INTEGER,               -- n samples used to decide
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  approved_at             TIMESTAMPTZ,
  applied_at              TIMESTAMPTZ,
  rolled_back_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tp_status        ON tuning_proposals(status);
CREATE INDEX IF NOT EXISTS idx_tp_strategy_type ON tuning_proposals(strategy_type);
CREATE INDEX IF NOT EXISTS idx_tp_pair          ON tuning_proposals(pair) WHERE pair IS NOT NULL;
