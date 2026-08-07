-- 083_ama_real_authorization.sql — AMA REAL_LIMITED: Authorization, pre-trade gates, audit
-- Depends on: 080_ama_initial.sql, 081_ama_runtime_integration.sql
-- Idempotent: uses CREATE TABLE IF NOT EXISTS
-- Safety: NOT_AUTOAPPLY — must be registered in MIGRATIONS array when authorized
-- CRITICAL: REAL_LIMITED requires explicit user authorization. REAL_FULL is LOCKED.

-- ─── AMA Real Authorization (persistent) ─────────────────────────────
-- Single-row table tracking explicit user authorization for REAL_LIMITED.
-- REAL_FULL is always LOCKED and cannot be authorized via this table.
CREATE TABLE IF NOT EXISTS ama_real_authorization (
  id INTEGER PRIMARY KEY DEFAULT 1,
  authorized_mode TEXT NOT NULL DEFAULT 'NONE' CHECK (authorized_mode IN ('NONE', 'REAL_LIMITED')),
  authorized_by TEXT NOT NULL,
  authorized_at TIMESTAMPTZ NOT NULL,
  revoked_by TEXT,
  revoked_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  max_capital_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (max_capital_usd >= 0),
  max_single_tranche_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (max_single_tranche_usd >= 0),
  max_tranches_per_cycle INTEGER NOT NULL DEFAULT 0 CHECK (max_tranches_per_cycle >= 0),
  expires_at TIMESTAMPTZ,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ama_real_auth_singleton CHECK (id = 1),
  CONSTRAINT chk_ama_real_auth_mode CHECK (authorized_mode != 'REAL_FULL')
);

INSERT INTO ama_real_authorization (id, authorized_by, authorized_at)
VALUES (1, 'SYSTEM', NOW())
ON CONFLICT (id) DO NOTHING;

-- ─── AMA Pre-Trade Gates ─────────────────────────────────────────────
-- Append-only log of pre-trade gate evaluations for REAL_LIMITED.
CREATE TABLE IF NOT EXISTS ama_pre_trade_gates (
  id SERIAL PRIMARY KEY,
  gate_id TEXT NOT NULL UNIQUE,
  cycle_id TEXT NOT NULL,
  tranche_id TEXT NOT NULL,
  gate_type TEXT NOT NULL CHECK (gate_type IN ('AUTHORIZATION', 'KILL_SWITCH', 'AUTO_BLOCK', 'BUDGET', 'COOLDOWN', 'SPREAD', 'DATA_QUALITY', 'RECONCILIATION')),
  passed BOOLEAN NOT NULL,
  reason TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ama_pre_trade_gates_cycle ON ama_pre_trade_gates (cycle_id);
CREATE INDEX IF NOT EXISTS idx_ama_pre_trade_gates_passed ON ama_pre_trade_gates (passed);
CREATE INDEX IF NOT EXISTS idx_ama_pre_trade_gates_type ON ama_pre_trade_gates (gate_type);

-- FK: pre_trade_gate → cycle
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_pre_trade_gates_cycle'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_pre_trade_gates'
  ) THEN
    ALTER TABLE ama_pre_trade_gates
      ADD CONSTRAINT fk_ama_pre_trade_gates_cycle
      FOREIGN KEY (cycle_id) REFERENCES ama_cycles(cycle_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- FK: pre_trade_gate → tranche
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_pre_trade_gates_tranche'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_pre_trade_gates'
  ) THEN
    ALTER TABLE ama_pre_trade_gates
      ADD CONSTRAINT fk_ama_pre_trade_gates_tranche
      FOREIGN KEY (tranche_id) REFERENCES ama_tranches(tranche_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ─── AMA Reconciliation Log ──────────────────────────────────────────
-- Tracks reconciliation checks between AMA internal state and exchange/DB.
CREATE TABLE IF NOT EXISTS ama_reconciliation_log (
  id SERIAL PRIMARY KEY,
  reconciliation_id TEXT NOT NULL UNIQUE,
  cycle_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('MATCH', 'MISMATCH', 'PENDING', 'FAILED')),
  expected_state JSONB NOT NULL,
  actual_state JSONB NOT NULL,
  discrepancies JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ama_reconciliation_status ON ama_reconciliation_log (status);
CREATE INDEX IF NOT EXISTS idx_ama_reconciliation_cycle ON ama_reconciliation_log (cycle_id);

-- ─── AMA Restart Recovery ────────────────────────────────────────────
-- Tracks restart recovery procedures. Append-only.
CREATE TABLE IF NOT EXISTS ama_restart_recovery (
  id SERIAL PRIMARY KEY,
  recovery_id TEXT NOT NULL UNIQUE,
  trigger TEXT NOT NULL CHECK (trigger IN ('PROCESS_RESTART', 'CRASH_RECOVERY', 'MANUAL_RECOVERY')),
  previous_mode TEXT,
  previous_state TEXT,
  previous_cycle_id TEXT,
  actions_taken JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ama_restart_recovery_status ON ama_restart_recovery (status);

-- ─── AMA Mode Change Log (append-only) ───────────────────────────────
-- Every mode transition is logged here. Cannot be deleted.
CREATE TABLE IF NOT EXISTS ama_mode_change_log (
  id SERIAL PRIMARY KEY,
  from_mode TEXT NOT NULL,
  to_mode TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  reason TEXT,
  previous_kill_switch BOOLEAN NOT NULL DEFAULT FALSE,
  new_kill_switch BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ama_mode_change_created ON ama_mode_change_log (created_at);
