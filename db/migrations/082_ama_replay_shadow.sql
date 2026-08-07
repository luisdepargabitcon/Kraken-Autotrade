-- 082_ama_replay_shadow.sql — AMA Replay & Shadow: Replay runs, scenarios, lab sessions
-- Depends on: 080_ama_initial.sql, 081_ama_runtime_integration.sql
-- Idempotent: uses CREATE TABLE IF NOT EXISTS
-- Safety: NOT_AUTOAPPLY — must be registered in MIGRATIONS array when authorized

-- ─── AMA Replay Runs ─────────────────────────────────────────────────
-- Deterministic historical replay sessions. No real orders.
CREATE TABLE IF NOT EXISTS ama_replay_runs (
  id SERIAL PRIMARY KEY,
  replay_run_id TEXT NOT NULL UNIQUE,
  asset TEXT NOT NULL DEFAULT 'BTC' CHECK (asset IN ('BTC', 'ETH')),
  pair TEXT NOT NULL DEFAULT 'BTC/USD',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  initial_capital_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (initial_capital_usd >= 0),
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB,
  total_tranches_executed INTEGER NOT NULL DEFAULT 0,
  total_usd_deployed NUMERIC(18, 2) NOT NULL DEFAULT 0,
  final_quantity NUMERIC(18, 8) NOT NULL DEFAULT 0,
  final_value_usd NUMERIC(18, 2),
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ama_replay_dates CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_ama_replay_status ON ama_replay_runs (status);
CREATE INDEX IF NOT EXISTS idx_ama_replay_asset ON ama_replay_runs (asset);

-- ─── AMA Replay Events (per-step trace) ──────────────────────────────
-- Append-only event log for replay runs. Deterministic.
CREATE TABLE IF NOT EXISTS ama_replay_events (
  id SERIAL PRIMARY KEY,
  replay_run_id TEXT NOT NULL,
  event_seq INTEGER NOT NULL CHECK (event_seq >= 0),
  event_type TEXT NOT NULL,
  timestamp_simulated TIMESTAMPTZ NOT NULL,
  price NUMERIC(18, 8),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (replay_run_id, event_seq)
);

CREATE INDEX IF NOT EXISTS idx_ama_replay_events_run ON ama_replay_events (replay_run_id);

-- FK: replay_event → replay_run
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_replay_events_run'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_replay_events'
  ) THEN
    ALTER TABLE ama_replay_events
      ADD CONSTRAINT fk_ama_replay_events_run
      FOREIGN KEY (replay_run_id) REFERENCES ama_replay_runs(replay_run_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ─── AMA Lab Sessions ────────────────────────────────────────────────
-- Scenario laboratory sessions for parameter exploration. No real orders.
CREATE TABLE IF NOT EXISTS ama_lab_sessions (
  id SERIAL PRIMARY KEY,
  lab_session_id TEXT NOT NULL UNIQUE,
  asset TEXT NOT NULL DEFAULT 'BTC' CHECK (asset IN ('BTC', 'ETH')),
  pair TEXT NOT NULL DEFAULT 'BTC/USD',
  scenario_name TEXT NOT NULL,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'RUNNING', 'COMPLETED', 'FAILED')),
  result_json JSONB,
  total_tranches_planned INTEGER NOT NULL DEFAULT 0,
  total_tranches_simulated INTEGER NOT NULL DEFAULT 0,
  total_usd_simulated NUMERIC(18, 2) NOT NULL DEFAULT 0,
  final_quantity NUMERIC(18, 8) NOT NULL DEFAULT 0,
  final_value_usd NUMERIC(18, 2),
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ama_lab_status ON ama_lab_sessions (status);
CREATE INDEX IF NOT EXISTS idx_ama_lab_asset ON ama_lab_sessions (asset);

-- ─── AMA Lab Tranche Results ─────────────────────────────────────────
-- Per-tranche simulation results within a lab session.
CREATE TABLE IF NOT EXISTS ama_lab_tranche_results (
  id SERIAL PRIMARY KEY,
  lab_session_id TEXT NOT NULL,
  tranche_index INTEGER NOT NULL CHECK (tranche_index >= 0),
  tranche_type TEXT NOT NULL,
  trigger_drop_pct NUMERIC(10, 4) NOT NULL,
  activation_price NUMERIC(18, 8),
  amount_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  simulated_quantity NUMERIC(18, 8) NOT NULL DEFAULT 0,
  simulated_fill_price NUMERIC(18, 8),
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'ELIGIBLE', 'SIMULATED_FILLED', 'SKIPPED', 'REJECTED')),
  eligibility_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lab_session_id, tranche_index)
);

CREATE INDEX IF NOT EXISTS idx_ama_lab_tranches_session ON ama_lab_tranche_results (lab_session_id);

-- FK: lab_tranche → lab_session
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_lab_tranches_session'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_lab_tranche_results'
  ) THEN
    ALTER TABLE ama_lab_tranche_results
      ADD CONSTRAINT fk_ama_lab_tranches_session
      FOREIGN KEY (lab_session_id) REFERENCES ama_lab_sessions(lab_session_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ─── AMA Shadow Scenarios ────────────────────────────────────────────
-- Predefined scenarios for shadow mode execution.
CREATE TABLE IF NOT EXISTS ama_shadow_scenarios (
  id SERIAL PRIMARY KEY,
  scenario_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  asset TEXT NOT NULL DEFAULT 'BTC' CHECK (asset IN ('BTC', 'ETH')),
  pair TEXT NOT NULL DEFAULT 'BTC/USD',
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED')),
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_filled INTEGER NOT NULL DEFAULT 0,
  total_simulated_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ama_shadow_scenarios_status ON ama_shadow_scenarios (status);

-- ─── AMA Shadow Reports ──────────────────────────────────────────────
-- Summary reports for shadow sessions.
CREATE TABLE IF NOT EXISTS ama_shadow_reports (
  id SERIAL PRIMARY KEY,
  report_id TEXT NOT NULL UNIQUE,
  scenario_id TEXT,
  shadow_mode TEXT NOT NULL CHECK (shadow_mode IN ('SHADOW_SCENARIO', 'SHADOW_LIVE')),
  total_orders INTEGER NOT NULL DEFAULT 0,
  filled INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  expired INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 0,
  total_simulated_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  total_simulated_quantity NUMERIC(18, 8) NOT NULL DEFAULT 0,
  average_fill_price NUMERIC(18, 8),
  slippage_pct NUMERIC(10, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ama_shadow_reports_scenario ON ama_shadow_reports (scenario_id);
