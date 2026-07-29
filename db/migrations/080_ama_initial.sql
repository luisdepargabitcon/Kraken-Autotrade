-- 080_ama_initial.sql — AMA Phase 1: Core domain tables
-- Idempotent: uses CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS

-- ─── AMA User Mandates ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ama_user_mandates (
  id SERIAL PRIMARY KEY,
  mandate_id TEXT NOT NULL UNIQUE,
  max_capital_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (max_capital_usd >= 0),
  risk_mandate TEXT NOT NULL DEFAULT 'PRUDENTE',
  accumulation_style TEXT NOT NULL DEFAULT 'ADAPTATIVO',
  exit_objective TEXT NOT NULL DEFAULT 'RECUPERAR_CAPITAL',
  autonomy_level TEXT NOT NULL DEFAULT 'SOLO_ANALISIS',
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── AMA Resolved Policies ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ama_resolved_policies (
  id SERIAL PRIMARY KEY,
  policy_id TEXT NOT NULL UNIQUE,
  mandate_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  user_inputs JSONB NOT NULL,
  resolved_parameters JSONB NOT NULL,
  resolver_version TEXT NOT NULL DEFAULT '1.0.0',
  strategy_version TEXT NOT NULL DEFAULT '1.0.0',
  policy_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  effective_from TIMESTAMPTZ,
  UNIQUE (mandate_id, policy_version)
);

-- ─── AMA Cycles ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ama_cycles (
  id SERIAL PRIMARY KEY,
  cycle_id TEXT NOT NULL UNIQUE,
  pair TEXT NOT NULL DEFAULT 'BTC/USD',
  mode TEXT NOT NULL DEFAULT 'OFF',
  state TEXT NOT NULL DEFAULT 'OBSERVING',
  high_water_mark NUMERIC(18, 8),
  ceiling_confirmed_at TIMESTAMPTZ,
  cycle_low NUMERIC(18, 8),
  cycle_low_at TIMESTAMPTZ,
  max_drop_pct NUMERIC(10, 4),
  current_drop_pct NUMERIC(10, 4),
  rebound_from_low_pct NUMERIC(10, 4),
  budget_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (budget_usd >= 0),
  deployed_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (deployed_usd >= 0),
  reserved_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  btc_accumulated NUMERIC(18, 8) NOT NULL DEFAULT 0 CHECK (btc_accumulated >= 0),
  average_cost_basis NUMERIC(18, 8),
  active_policy_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ama_cycles_state ON ama_cycles (state);
CREATE INDEX IF NOT EXISTS idx_ama_cycles_pair ON ama_cycles (pair);

-- ─── AMA Tranche Plans ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ama_tranche_plans (
  id SERIAL PRIMARY KEY,
  plan_id TEXT NOT NULL UNIQUE,
  cycle_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  planned_purchase_count INTEGER NOT NULL DEFAULT 0 CHECK (planned_purchase_count >= 0),
  mandatory_reserve_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (mandatory_reserve_usd >= 0),
  deployable_cycle_capital_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (deployable_cycle_capital_usd >= 0),
  candidate_tranches JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, version)
);

-- ─── AMA Tranches ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ama_tranches (
  id SERIAL PRIMARY KEY,
  tranche_id TEXT NOT NULL UNIQUE,
  cycle_id TEXT NOT NULL,
  plan_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CREATED',
  planned_amount_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (planned_amount_usd >= 0),
  executed_amount_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (executed_amount_usd >= 0),
  btc_quantity NUMERIC(18, 8) NOT NULL DEFAULT 0 CHECK (btc_quantity >= 0),
  fill_price NUMERIC(18, 8),
  cost_basis NUMERIC(18, 8),
  sleeve_allocation TEXT NOT NULL DEFAULT 'RECOVER_PRINCIPAL',
  remaining_quantity NUMERIC(18, 8) NOT NULL DEFAULT 0 CHECK (remaining_quantity >= 0),
  realized_quantity NUMERIC(18, 8) NOT NULL DEFAULT 0 CHECK (realized_quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  filled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ama_tranches_cycle ON ama_tranches (cycle_id);
CREATE INDEX IF NOT EXISTS idx_ama_tranches_status ON ama_tranches (status);

-- ─── AMA State Transitions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ama_state_transitions (
  id SERIAL PRIMARY KEY,
  cycle_id TEXT,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ama_state_transitions_cycle ON ama_state_transitions (cycle_id);

-- ─── AMA Audit Events ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ama_audit_events (
  id SERIAL PRIMARY KEY,
  event_name TEXT NOT NULL,
  cycle_id TEXT,
  tranche_id TEXT,
  mandate_id TEXT,
  policy_id TEXT,
  severity TEXT NOT NULL DEFAULT 'INFO',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ama_audit_events_name ON ama_audit_events (event_name);
CREATE INDEX IF NOT EXISTS idx_ama_audit_events_cycle ON ama_audit_events (cycle_id);
CREATE INDEX IF NOT EXISTS idx_ama_audit_events_created ON ama_audit_events (created_at);

-- ─── Portfolio Mode Budgets ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolio_mode_budgets (
  id SERIAL PRIMARY KEY,
  mode TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT 'revolutx',
  asset TEXT NOT NULL DEFAULT 'BTC',
  budgeted_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (budgeted_usd >= 0),
  deployed_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (deployed_usd >= 0),
  reserved_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  allocation_type TEXT NOT NULL DEFAULT 'MANUAL_FIXED_ALLOCATION',
  status TEXT NOT NULL DEFAULT 'DISABLED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mode, exchange, asset)
);

-- ─── Portfolio Ledger Entries ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolio_ledger_entries (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  entry_type TEXT NOT NULL,
  exchange TEXT NOT NULL,
  asset TEXT NOT NULL,
  quantity NUMERIC(18, 8) NOT NULL,
  from_bucket TEXT,
  to_bucket TEXT,
  mode TEXT,
  cycle_id TEXT,
  tranche_id TEXT,
  logical_intent_id TEXT,
  fill_id TEXT,
  source TEXT NOT NULL DEFAULT 'SYSTEM',
  metadata_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_ledger_mode ON portfolio_ledger_entries (mode);
CREATE INDEX IF NOT EXISTS idx_portfolio_ledger_asset ON portfolio_ledger_entries (asset);
CREATE INDEX IF NOT EXISTS idx_portfolio_ledger_created ON portfolio_ledger_entries (created_at);

-- ─── Foreign Keys ────────────────────────────────────────────────────
-- Mandatory relationships (NOT NULL columns): ON DELETE RESTRICT
-- Optional relationships (nullable columns): FK allows NULL, ON DELETE RESTRICT
--   - ama_tranches.plan_id: nullable because a tranche may be created before plan assignment
--   - ama_state_transitions.cycle_id: nullable for global state transitions not tied to a cycle
--   - ama_audit_events.cycle_id: nullable for global audit events not tied to a cycle
--   - ama_audit_events.tranche_id: nullable for events not tied to a specific tranche
--   - ama_audit_events.mandate_id: nullable for events not tied to a specific mandate
--   - ama_audit_events.policy_id: nullable for events not tied to a specific policy
--   - portfolio_ledger_entries.cycle_id: nullable for entries not tied to an AMA cycle
--   - portfolio_ledger_entries.tranche_id: nullable for entries not tied to a specific tranche
-- No ON DELETE CASCADE on any financial, audit, or inventory table.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ama_policies_mandate') THEN
    ALTER TABLE ama_resolved_policies
      ADD CONSTRAINT fk_ama_policies_mandate
      FOREIGN KEY (mandate_id) REFERENCES ama_user_mandates(mandate_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ama_plans_cycle') THEN
    ALTER TABLE ama_tranche_plans
      ADD CONSTRAINT fk_ama_plans_cycle
      FOREIGN KEY (cycle_id) REFERENCES ama_cycles(cycle_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ama_tranches_cycle') THEN
    ALTER TABLE ama_tranches
      ADD CONSTRAINT fk_ama_tranches_cycle
      FOREIGN KEY (cycle_id) REFERENCES ama_cycles(cycle_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ama_tranches_plan') THEN
    ALTER TABLE ama_tranches
      ADD CONSTRAINT fk_ama_tranches_plan
      FOREIGN KEY (plan_id) REFERENCES ama_tranche_plans(plan_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ama_transitions_cycle') THEN
    ALTER TABLE ama_state_transitions
      ADD CONSTRAINT fk_ama_transitions_cycle
      FOREIGN KEY (cycle_id) REFERENCES ama_cycles(cycle_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ama_audit_cycle') THEN
    ALTER TABLE ama_audit_events
      ADD CONSTRAINT fk_ama_audit_cycle
      FOREIGN KEY (cycle_id) REFERENCES ama_cycles(cycle_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ama_audit_tranche') THEN
    ALTER TABLE ama_audit_events
      ADD CONSTRAINT fk_ama_audit_tranche
      FOREIGN KEY (tranche_id) REFERENCES ama_tranches(tranche_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ama_audit_mandate') THEN
    ALTER TABLE ama_audit_events
      ADD CONSTRAINT fk_ama_audit_mandate
      FOREIGN KEY (mandate_id) REFERENCES ama_user_mandates(mandate_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ama_audit_policy') THEN
    ALTER TABLE ama_audit_events
      ADD CONSTRAINT fk_ama_audit_policy
      FOREIGN KEY (policy_id) REFERENCES ama_resolved_policies(policy_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_portfolio_ledger_cycle') THEN
    ALTER TABLE portfolio_ledger_entries
      ADD CONSTRAINT fk_portfolio_ledger_cycle
      FOREIGN KEY (cycle_id) REFERENCES ama_cycles(cycle_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_portfolio_ledger_tranche') THEN
    ALTER TABLE portfolio_ledger_entries
      ADD CONSTRAINT fk_portfolio_ledger_tranche
      FOREIGN KEY (tranche_id) REFERENCES ama_tranches(tranche_id)
      ON DELETE RESTRICT;
  END IF;
END $$;
