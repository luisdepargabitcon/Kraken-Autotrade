-- 084_ama_functional_closure.sql — AMA functional closure: mandate persistence, state machine, scheduler
-- Depends on: 080_ama_initial.sql, 081_ama_runtime_integration.sql, 082_ama_replay_shadow.sql, 083_ama_real_authorization.sql
-- Idempotent: uses CREATE TABLE IF NOT EXISTS

-- ─── AMA Mandate (persistent) ──────────────────────────────────────────
-- Stores the active mandate configured by the user.
CREATE TABLE IF NOT EXISTS ama_mandate (
  mandate_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'ACTIVE', 'SUPERSEDED', 'RETIRED')),
  risk_mandate TEXT NOT NULL DEFAULT 'PRUDENTE',
  max_capital_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (max_capital_usd >= 0),
  accumulation_style TEXT NOT NULL DEFAULT 'ADAPTATIVO',
  exit_objective TEXT NOT NULL DEFAULT 'RECUPERAR_CAPITAL',
  autonomy_level TEXT NOT NULL DEFAULT 'SOLO_ANALISIS',
  pair TEXT NOT NULL DEFAULT 'BTC/USD',
  asset TEXT NOT NULL DEFAULT 'BTC',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── AMA Policy (resolved from mandate) ────────────────────────────────
-- Stores the active policy resolved from an approved mandate.
CREATE TABLE IF NOT EXISTS ama_policy (
  policy_id TEXT PRIMARY KEY,
  mandate_id TEXT NOT NULL REFERENCES ama_mandate(mandate_id),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'RESOLVED' CHECK (status IN ('RESOLVED', 'ACTIVE', 'SUPERSEDED', 'RETIRED')),
  drop_pcts JSONB NOT NULL DEFAULT '[5, 10, 15, 25, 35, 45]',
  tranche_sizes JSONB NOT NULL DEFAULT '[]',
  sleeve_allocations JSONB NOT NULL DEFAULT '{}',
  config_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── AMA Real State Machine (persistent) ───────────────────────────────
-- Tracks the operational state of REAL_LIMITED mode persistently.
CREATE TABLE IF NOT EXISTS ama_real_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  operational_state TEXT NOT NULL DEFAULT 'NOT_READY'
    CHECK (operational_state IN (
      'NOT_READY', 'READY_DISABLED', 'ARMED', 'ACTIVE',
      'PAUSED_BY_USER', 'PAUSED_BY_RESTART',
      'DISABLED_BY_USER', 'AUTO_BLOCKED', 'KILL_SWITCHED', 'EXPIRED'
    )),
  previous_state TEXT,
  transition_reason TEXT,
  transitioned_at TIMESTAMPTZ,
  kill_switch_active BOOLEAN NOT NULL DEFAULT FALSE,
  kill_switch_reason TEXT,
  kill_switch_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ama_real_state_singleton CHECK (id = 1)
);

INSERT INTO ama_real_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ─── AMA Scheduler State ───────────────────────────────────────────────
-- Tracks the AMA scheduler tick state for restart recovery.
CREATE TABLE IF NOT EXISTS ama_scheduler_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  current_mode TEXT NOT NULL DEFAULT 'OFF',
  last_tick_at TIMESTAMPTZ,
  last_cycle_id TEXT,
  tick_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ama_scheduler_singleton CHECK (id = 1)
);

INSERT INTO ama_scheduler_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ─── AMA HWM Bootstrap ─────────────────────────────────────────────────
-- Stores the high-water mark bootstrap state.
CREATE TABLE IF NOT EXISTS ama_hwm_bootstrap (
  id INTEGER PRIMARY KEY DEFAULT 1,
  pair TEXT NOT NULL DEFAULT 'BTC/USD',
  hwm NUMERIC(18, 2),
  hwm_timestamp TIMESTAMPTZ,
  bootstrap_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (bootstrap_status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
  data_coverage_pct NUMERIC(5, 2) DEFAULT 0,
  candles_processed INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ama_hwm_singleton CHECK (id = 1)
);

INSERT INTO ama_hwm_bootstrap (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
