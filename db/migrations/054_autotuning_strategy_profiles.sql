-- 054_autotuning_strategy_profiles.sql
-- Versioned configuration profiles for BOT SPOT and IDCA
-- Tracked by AutoMigrationRunner — idempotent via IF NOT EXISTS

CREATE TABLE IF NOT EXISTS strategy_profiles (
  id                      SERIAL       PRIMARY KEY,
  strategy_type           TEXT         NOT NULL,           -- BOT_SPOT | IDCA
  pair                    TEXT,                            -- NULL = all pairs
  profile_name            TEXT         NOT NULL,
  mode                    TEXT         NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | SHADOW | ARCHIVED
  config_json             JSONB        NOT NULL DEFAULT '{}'::jsonb,
  parent_profile_id       INTEGER      REFERENCES strategy_profiles(id),
  rollback_of_profile_id  INTEGER      REFERENCES strategy_profiles(id),
  is_active               BOOLEAN      NOT NULL DEFAULT FALSE,
  notes                   TEXT,
  approved_by             TEXT,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  applied_at              TIMESTAMPTZ,
  archived_at             TIMESTAMPTZ
);

-- Only one ACTIVE profile per strategy_type+pair combo
CREATE UNIQUE INDEX IF NOT EXISTS uq_sp_active_profile
  ON strategy_profiles(strategy_type, COALESCE(pair, '__all__'))
  WHERE is_active = TRUE AND mode = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_sp_type  ON strategy_profiles(strategy_type);
CREATE INDEX IF NOT EXISTS idx_sp_mode  ON strategy_profiles(mode);
CREATE INDEX IF NOT EXISTS idx_sp_pair  ON strategy_profiles(pair) WHERE pair IS NOT NULL;

-- Insert default baseline profiles (idempotent via is_active conflict)
INSERT INTO strategy_profiles (strategy_type, profile_name, mode, is_active, notes)
VALUES
  ('BOT_SPOT', 'Baseline v1', 'ACTIVE', TRUE,  'Perfil por defecto — sin cambios autoapply'),
  ('IDCA',     'Baseline v1', 'ACTIVE', TRUE,  'Perfil por defecto IDCA — sin cambios autoapply')
ON CONFLICT DO NOTHING;
