-- 080_ama_initial.sql — AMA Phase 1: Core domain tables
-- R8A: Aligned with AMA R7 contracts (AmaTranchePlan, ExecutedTrancheEvidence, HWM).
-- Idempotent: uses CREATE TABLE IF NOT EXISTS, FK guards with DO $$ BEGIN.
-- Safety: NOT_REGISTERED, NOT_AUTOAPPLY, NOT_APPLIED_STAGING, NOT_APPLIED_PRODUCTION
-- Asset-aware: accumulated_quantity / asset_quantity replace btc-specific names.
-- Asset domain: BTC (LAB_ONLY), ETH (RESEARCH_ONLY) — no execution venue connected.

-- ─── AMA User Mandates ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ama_user_mandates (
  id SERIAL PRIMARY KEY,
  mandate_id TEXT NOT NULL UNIQUE,
  asset TEXT NOT NULL DEFAULT 'BTC' CHECK (asset IN ('BTC', 'ETH')),
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
  asset TEXT NOT NULL DEFAULT 'BTC' CHECK (asset IN ('BTC', 'ETH')),
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
  asset TEXT NOT NULL DEFAULT 'BTC' CHECK (asset IN ('BTC', 'ETH')),
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
  accumulated_quantity NUMERIC(18, 8) NOT NULL DEFAULT 0 CHECK (accumulated_quantity >= 0),
  average_cost_basis NUMERIC(18, 8),
  active_policy_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  CONSTRAINT chk_ama_cycles_budget CHECK (deployed_usd + reserved_usd <= budget_usd)
);

CREATE INDEX IF NOT EXISTS idx_ama_cycles_state ON ama_cycles (state);
CREATE INDEX IF NOT EXISTS idx_ama_cycles_pair ON ama_cycles (pair);
CREATE INDEX IF NOT EXISTS idx_ama_cycles_asset ON ama_cycles (asset);

-- ─── AMA Tranche Plans (R8A: aligned with R7 AmaTranchePlan contract) ──────────
CREATE TABLE IF NOT EXISTS ama_tranche_plans (
  id SERIAL PRIMARY KEY,
  plan_id TEXT NOT NULL UNIQUE,
  cycle_id TEXT NOT NULL,
  asset TEXT NOT NULL DEFAULT 'BTC' CHECK (asset IN ('BTC', 'ETH')),
  policy_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  planned_purchase_count INTEGER NOT NULL DEFAULT 0 CHECK (planned_purchase_count >= 0),
  mandatory_reserve_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (mandatory_reserve_usd >= 0),
  deployable_cycle_capital_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (deployable_cycle_capital_usd >= 0),
  hwm_price NUMERIC(18, 8) NOT NULL CHECK (hwm_price > 0),
  hwm_timestamp TIMESTAMPTZ NOT NULL,
  as_of_confirmed_close_price NUMERIC(18, 8) NOT NULL CHECK (as_of_confirmed_close_price > 0),
  as_of_confirmed_close_timestamp TIMESTAMPTZ NOT NULL,
  effective_deployment_pct NUMERIC(10, 4) NOT NULL CHECK (effective_deployment_pct BETWEEN 0 AND 100),
  effective_reserve_pct NUMERIC(10, 4) NOT NULL CHECK (effective_reserve_pct BETWEEN 0 AND 100),
  effective_deployable_pct NUMERIC(10, 4) NOT NULL CHECK (effective_deployable_pct >= 0 AND effective_deployable_pct <= 100),
  risk_overlay_multiplier NUMERIC(10, 6) NOT NULL DEFAULT 1 CHECK (risk_overlay_multiplier > 0 AND risk_overlay_multiplier <= 1),
  plan_hash TEXT NOT NULL,
  candidate_tranches JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, version),
  CONSTRAINT chk_ama_plans_ts_order CHECK (as_of_confirmed_close_timestamp > hwm_timestamp),
  CONSTRAINT chk_ama_plans_deployable_le_deployment CHECK (effective_deployable_pct <= effective_deployment_pct),
  CONSTRAINT chk_ama_plans_deployable_le_100_minus_reserve CHECK (effective_deployable_pct <= 100 - effective_reserve_pct)
);

CREATE INDEX IF NOT EXISTS idx_ama_tranche_plans_asset ON ama_tranche_plans (asset);
CREATE INDEX IF NOT EXISTS idx_ama_tranche_plans_policy_id ON ama_tranche_plans (policy_id);
CREATE INDEX IF NOT EXISTS idx_ama_tranche_plans_as_of_ts ON ama_tranche_plans (as_of_confirmed_close_timestamp);

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
  asset_quantity NUMERIC(18, 8) NOT NULL DEFAULT 0 CHECK (asset_quantity >= 0),
  fill_price NUMERIC(18, 8),
  cost_basis NUMERIC(18, 8),
  sleeve_allocation TEXT NOT NULL DEFAULT 'RECOVER_PRINCIPAL',
  remaining_quantity NUMERIC(18, 8) NOT NULL DEFAULT 0 CHECK (remaining_quantity >= 0),
  realized_quantity NUMERIC(18, 8) NOT NULL DEFAULT 0 CHECK (realized_quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  filled_at TIMESTAMPTZ,
  CONSTRAINT chk_ama_tranches_executed_le_planned CHECK (executed_amount_usd <= planned_amount_usd)
);

CREATE INDEX IF NOT EXISTS idx_ama_tranches_cycle ON ama_tranches (cycle_id);
CREATE INDEX IF NOT EXISTS idx_ama_tranches_status ON ama_tranches (status);
CREATE INDEX IF NOT EXISTS idx_ama_tranches_type ON ama_tranches (type);

-- ─── AMA Tranche Fill Events (R8A: append-only evidence, maps to ExecutedTrancheEvidence) ──
CREATE TABLE IF NOT EXISTS ama_tranche_fill_events (
  id SERIAL PRIMARY KEY,
  fill_event_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  tranche_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  asset TEXT NOT NULL CHECK (asset IN ('BTC', 'ETH')),
  policy_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL CHECK (policy_version > 0),
  seed_tranche_index INTEGER NOT NULL CHECK (seed_tranche_index >= 0),
  executed_amount_usd NUMERIC(18, 2) NOT NULL CHECK (executed_amount_usd > 0),
  executed_quantity NUMERIC(18, 8) NOT NULL CHECK (executed_quantity > 0),
  executed_at TIMESTAMPTZ NOT NULL,
  fill_status TEXT NOT NULL CHECK (fill_status IN ('PARTIAL', 'FILLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ama_fill_events_tranche ON ama_tranche_fill_events (tranche_id);
CREATE INDEX IF NOT EXISTS idx_ama_fill_events_cycle ON ama_tranche_fill_events (cycle_id);
CREATE INDEX IF NOT EXISTS idx_ama_fill_events_idempotency ON ama_tranche_fill_events (idempotency_key);

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
  UNIQUE (mode, exchange, asset),
  CONSTRAINT chk_portfolio_budgets_total CHECK (deployed_usd + reserved_usd <= budgeted_usd)
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
-- All FK ON DELETE RESTRICT. No ON DELETE CASCADE on any financial, audit, or inventory table.
-- Nullable FK columns: ama_tranches.plan_id, ama_cycles.active_policy_id,
--   ama_state_transitions.cycle_id, ama_audit_events.{cycle,tranche,mandate,policy}_id,
--   portfolio_ledger_entries.{cycle,tranche}_id.

-- policy → mandate
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_policies_mandate'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_resolved_policies'
  ) THEN
    ALTER TABLE ama_resolved_policies
      ADD CONSTRAINT fk_ama_policies_mandate
      FOREIGN KEY (mandate_id) REFERENCES ama_user_mandates(mandate_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- cycle → active_policy (nullable)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_cycles_active_policy'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_cycles'
  ) THEN
    ALTER TABLE ama_cycles
      ADD CONSTRAINT fk_ama_cycles_active_policy
      FOREIGN KEY (active_policy_id) REFERENCES ama_resolved_policies(policy_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- plan → cycle
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_plans_cycle'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_tranche_plans'
  ) THEN
    ALTER TABLE ama_tranche_plans
      ADD CONSTRAINT fk_ama_plans_cycle
      FOREIGN KEY (cycle_id) REFERENCES ama_cycles(cycle_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- plan → policy
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_plans_policy'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_tranche_plans'
  ) THEN
    ALTER TABLE ama_tranche_plans
      ADD CONSTRAINT fk_ama_plans_policy
      FOREIGN KEY (policy_id) REFERENCES ama_resolved_policies(policy_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_tranches_cycle'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_tranches'
  ) THEN
    ALTER TABLE ama_tranches
      ADD CONSTRAINT fk_ama_tranches_cycle
      FOREIGN KEY (cycle_id) REFERENCES ama_cycles(cycle_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_tranches_plan'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_tranches'
  ) THEN
    ALTER TABLE ama_tranches
      ADD CONSTRAINT fk_ama_tranches_plan
      FOREIGN KEY (plan_id) REFERENCES ama_tranche_plans(plan_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_transitions_cycle'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_state_transitions'
  ) THEN
    ALTER TABLE ama_state_transitions
      ADD CONSTRAINT fk_ama_transitions_cycle
      FOREIGN KEY (cycle_id) REFERENCES ama_cycles(cycle_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_audit_cycle'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_audit_events'
  ) THEN
    ALTER TABLE ama_audit_events
      ADD CONSTRAINT fk_ama_audit_cycle
      FOREIGN KEY (cycle_id) REFERENCES ama_cycles(cycle_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_audit_tranche'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_audit_events'
  ) THEN
    ALTER TABLE ama_audit_events
      ADD CONSTRAINT fk_ama_audit_tranche
      FOREIGN KEY (tranche_id) REFERENCES ama_tranches(tranche_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_audit_mandate'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_audit_events'
  ) THEN
    ALTER TABLE ama_audit_events
      ADD CONSTRAINT fk_ama_audit_mandate
      FOREIGN KEY (mandate_id) REFERENCES ama_user_mandates(mandate_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_audit_policy'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_audit_events'
  ) THEN
    ALTER TABLE ama_audit_events
      ADD CONSTRAINT fk_ama_audit_policy
      FOREIGN KEY (policy_id) REFERENCES ama_resolved_policies(policy_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_portfolio_ledger_cycle'
      AND ns.nspname = 'public'
      AND rel.relname = 'portfolio_ledger_entries'
  ) THEN
    ALTER TABLE portfolio_ledger_entries
      ADD CONSTRAINT fk_portfolio_ledger_cycle
      FOREIGN KEY (cycle_id) REFERENCES ama_cycles(cycle_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_portfolio_ledger_tranche'
      AND ns.nspname = 'public'
      AND rel.relname = 'portfolio_ledger_entries'
  ) THEN
    ALTER TABLE portfolio_ledger_entries
      ADD CONSTRAINT fk_portfolio_ledger_tranche
      FOREIGN KEY (tranche_id) REFERENCES ama_tranches(tranche_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- fill_event → tranche
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_fill_events_tranche'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_tranche_fill_events'
  ) THEN
    ALTER TABLE ama_tranche_fill_events
      ADD CONSTRAINT fk_ama_fill_events_tranche
      FOREIGN KEY (tranche_id) REFERENCES ama_tranches(tranche_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- fill_event → cycle
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_fill_events_cycle'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_tranche_fill_events'
  ) THEN
    ALTER TABLE ama_tranche_fill_events
      ADD CONSTRAINT fk_ama_fill_events_cycle
      FOREIGN KEY (cycle_id) REFERENCES ama_cycles(cycle_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- fill_event → policy
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_fill_events_policy'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_tranche_fill_events'
  ) THEN
    ALTER TABLE ama_tranche_fill_events
      ADD CONSTRAINT fk_ama_fill_events_policy
      FOREIGN KEY (policy_id) REFERENCES ama_resolved_policies(policy_id)
      ON DELETE RESTRICT;
  END IF;
END $$;
