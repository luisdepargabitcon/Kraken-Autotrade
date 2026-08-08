-- 084_ama_functional_closure.sql — AMA functional closure: mandate versioning, real state machine, scheduler, HWM bootstrap
-- Depends on: 080_ama_initial.sql, 081_ama_runtime_integration.sql, 082_ama_replay_shadow.sql, 083_ama_real_authorization.sql
-- Idempotent: uses ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS
--
-- ARCHITECTURE: Reuses existing tables from 080. Does NOT create duplicate mandate/policy tables.
-- - ama_user_mandates (from 080) is extended with versioning columns
-- - ama_resolved_policies (from 080) is extended with supersede columns
-- - ama_real_state is NEW (no equivalent in prior migrations)
-- - ama_scheduler_state is NEW (no equivalent in prior migrations)
-- - ama_hwm_bootstrap is NEW (complements ama_hwm_records — tracks bootstrap process, not per-cycle HWM evidence)

-- ─── Extend ama_user_mandates with versioning ──────────────────────────
-- 080 created this table with status defaulting to 'DRAFT' but no CHECK constraint
-- on allowed values. We add the CHECK and versioning columns.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ama_user_mandates' AND column_name = 'version'
  ) THEN
    ALTER TABLE ama_user_mandates ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ama_user_mandates' AND column_name = 'approved_by'
  ) THEN
    ALTER TABLE ama_user_mandates ADD COLUMN approved_by TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ama_user_mandates' AND column_name = 'approved_at'
  ) THEN
    ALTER TABLE ama_user_mandates ADD COLUMN approved_at TIMESTAMPTZ;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ama_user_mandates' AND column_name = 'activated_at'
  ) THEN
    ALTER TABLE ama_user_mandates ADD COLUMN activated_at TIMESTAMPTZ;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ama_user_mandates' AND column_name = 'superseded_at'
  ) THEN
    ALTER TABLE ama_user_mandates ADD COLUMN superseded_at TIMESTAMPTZ;
  END IF;
END $$;

-- Expand status CHECK to support full lifecycle: DRAFT → APPROVED → ACTIVE → SUPERSEDED → RETIRED
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE con.conname = 'chk_ama_mandates_status' AND rel.relname = 'ama_user_mandates'
  ) THEN
    ALTER TABLE ama_user_mandates
      ADD CONSTRAINT chk_ama_mandates_status
      CHECK (status IN ('DRAFT', 'APPROVED', 'ACTIVE', 'SUPERSEDED', 'RETIRED'));
  END IF;
END $$;

-- ─── Extend ama_resolved_policies with supersede tracking ──────────────
-- 080 created this table with status defaulting to 'DRAFT'.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ama_resolved_policies' AND column_name = 'superseded_at'
  ) THEN
    ALTER TABLE ama_resolved_policies ADD COLUMN superseded_at TIMESTAMPTZ;
  END IF;
END $$;

-- Expand status CHECK to support full lifecycle
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE con.conname = 'chk_ama_policies_status' AND rel.relname = 'ama_resolved_policies'
  ) THEN
    ALTER TABLE ama_resolved_policies
      ADD CONSTRAINT chk_ama_policies_status
      CHECK (status IN ('DRAFT', 'RESOLVED', 'ACTIVE', 'SUPERSEDED', 'RETIRED'));
  END IF;
END $$;

-- ─── AMA Real State Machine (persistent, singleton) ────────────────────
-- Tracks the operational state of REAL_LIMITED mode persistently.
-- No equivalent table exists in prior migrations.
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
  transitioned_by TEXT,
  requires_manual_resume BOOLEAN NOT NULL DEFAULT FALSE,
  auto_block_reason TEXT,
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

-- ─── AMA Scheduler State (persistent, singleton) ───────────────────────
-- Tracks the AMA scheduler tick state for restart recovery.
-- No equivalent table exists in prior migrations.
CREATE TABLE IF NOT EXISTS ama_scheduler_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  current_mode TEXT NOT NULL DEFAULT 'OFF',
  last_tick_at TIMESTAMPTZ,
  last_cycle_id TEXT,
  tick_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  advisory_lock_held BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ama_scheduler_singleton CHECK (id = 1)
);

INSERT INTO ama_scheduler_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ─── AMA HWM Bootstrap (persistent, singleton) ─────────────────────────
-- Tracks the HWM bootstrap PROCESS state (fetching historical candles, coverage).
-- Complements ama_hwm_records (from 081) which stores per-cycle HWM evidence.
-- ama_hwm_records = evidence per cycle; ama_hwm_bootstrap = bootstrap process state.
CREATE TABLE IF NOT EXISTS ama_hwm_bootstrap (
  id INTEGER PRIMARY KEY DEFAULT 1,
  pair TEXT NOT NULL DEFAULT 'BTC/USD',
  hwm NUMERIC(18, 8),
  hwm_timestamp TIMESTAMPTZ,
  bootstrap_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (bootstrap_status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
  data_coverage_pct NUMERIC(5, 2) DEFAULT 0,
  candles_processed INTEGER DEFAULT 0,
  candles_total INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ama_hwm_singleton CHECK (id = 1)
);

INSERT INTO ama_hwm_bootstrap (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
