-- 081_ama_runtime_integration.sql — AMA Runtime: Runtime state, shadow orders, HWM persistence
-- Depends on: 080_ama_initial.sql (tables: ama_cycles, ama_tranches, ama_tranche_plans, etc.)
-- Idempotent: uses CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS
-- Safety: NOT_AUTOAPPLY — must be registered in MIGRATIONS array when authorized

-- ─── AMA Runtime State (singleton) ───────────────────────────────────
-- Persists the current operational mode, kill switch, and runtime metadata.
-- Single row enforced by constraint.
CREATE TABLE IF NOT EXISTS ama_runtime_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  mode TEXT NOT NULL DEFAULT 'OFF' CHECK (mode IN ('OFF', 'LAB', 'REPLAY', 'SHADOW_SCENARIO', 'SHADOW_LIVE', 'REAL_LIMITED', 'REAL_FULL')),
  state TEXT NOT NULL DEFAULT 'OBSERVING',
  protection_state TEXT,
  kill_switch_active BOOLEAN NOT NULL DEFAULT FALSE,
  auto_block_active BOOLEAN NOT NULL DEFAULT FALSE,
  auto_block_reason TEXT,
  active_cycle_id TEXT,
  active_mandate_id TEXT,
  active_policy_id TEXT,
  last_tick_at TIMESTAMPTZ,
  last_reconciliation_at TIMESTAMPTZ,
  restart_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ama_runtime_singleton CHECK (id = 1)
);

INSERT INTO ama_runtime_state (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

-- ─── AMA HWM Records (persistent) ────────────────────────────────────
-- Replaces in-memory HWM tracking. Append-only with state transitions.
CREATE TABLE IF NOT EXISTS ama_hwm_records (
  id SERIAL PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  authoritative_cycle_hwm NUMERIC(18, 8) NOT NULL CHECK (authoritative_cycle_hwm > 0),
  rolling_high NUMERIC(18, 8) NOT NULL CHECK (rolling_high > 0),
  state TEXT NOT NULL DEFAULT 'CANDIDATE' CHECK (state IN ('CANDIDATE', 'CONFIRMING', 'CONFIRMED', 'FROZEN', 'SUPERSEDED', 'INVALIDATED')),
  confirmed_at TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ama_hwm_cycle ON ama_hwm_records (cycle_id);
CREATE INDEX IF NOT EXISTS idx_ama_hwm_state ON ama_hwm_records (state);

-- FK: hwm → cycle
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_hwm_cycle'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_hwm_records'
  ) THEN
    ALTER TABLE ama_hwm_records
      ADD CONSTRAINT fk_ama_hwm_cycle
      FOREIGN KEY (cycle_id) REFERENCES ama_cycles(cycle_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ─── AMA Shadow Orders (simulated execution) ─────────────────────────
-- Append-only table for shadow mode simulated orders.
CREATE TABLE IF NOT EXISTS ama_shadow_orders (
  id SERIAL PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  cycle_id TEXT NOT NULL,
  tranche_id TEXT NOT NULL,
  pair TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  order_type TEXT NOT NULL CHECK (order_type IN ('LIMIT_MAKER', 'LIMIT_TAKER')),
  price NUMERIC(18, 8) NOT NULL CHECK (price > 0),
  quantity NUMERIC(18, 8) NOT NULL CHECK (quantity > 0),
  amount_usd NUMERIC(18, 2) NOT NULL CHECK (amount_usd > 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SIMULATED_EXECUTED', 'SIMULATED_FILLED', 'SIMULATED_REJECTED', 'EXPIRED')),
  simulated_fill_price NUMERIC(18, 8),
  simulated_fill_timestamp TIMESTAMPTZ,
  rejection_reason TEXT,
  shadow_mode TEXT NOT NULL CHECK (shadow_mode IN ('SHADOW_SCENARIO', 'SHADOW_LIVE')),
  scenario_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ama_shadow_orders_cycle ON ama_shadow_orders (cycle_id);
CREATE INDEX IF NOT EXISTS idx_ama_shadow_orders_status ON ama_shadow_orders (status);
CREATE INDEX IF NOT EXISTS idx_ama_shadow_orders_scenario ON ama_shadow_orders (scenario_id);

-- FK: shadow_order → cycle
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_shadow_orders_cycle'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_shadow_orders'
  ) THEN
    ALTER TABLE ama_shadow_orders
      ADD CONSTRAINT fk_ama_shadow_orders_cycle
      FOREIGN KEY (cycle_id) REFERENCES ama_cycles(cycle_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- FK: shadow_order → tranche
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_shadow_orders_tranche'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_shadow_orders'
  ) THEN
    ALTER TABLE ama_shadow_orders
      ADD CONSTRAINT fk_ama_shadow_orders_tranche
      FOREIGN KEY (tranche_id) REFERENCES ama_tranches(tranche_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ─── AMA Cooldown State (persistent) ─────────────────────────────────
-- Tracks cooldown between tranches per cycle.
CREATE TABLE IF NOT EXISTS ama_cooldown_state (
  id SERIAL PRIMARY KEY,
  cycle_id TEXT NOT NULL UNIQUE,
  last_tranche_at TIMESTAMPTZ,
  cooldown_ends_at TIMESTAMPTZ,
  cooldown_policy TEXT NOT NULL DEFAULT '1_daily',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FK: cooldown → cycle
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE con.conname = 'fk_ama_cooldown_cycle'
      AND ns.nspname = 'public'
      AND rel.relname = 'ama_cooldown_state'
  ) THEN
    ALTER TABLE ama_cooldown_state
      ADD CONSTRAINT fk_ama_cooldown_cycle
      FOREIGN KEY (cycle_id) REFERENCES ama_cycles(cycle_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ─── AMA Cycle Free USD Column ───────────────────────────────────────
-- Add free_usd to cycles for persistent budget tracking.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ama_cycles' AND column_name = 'free_usd'
  ) THEN
    ALTER TABLE ama_cycles
      ADD COLUMN free_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (free_usd >= 0);
  END IF;
END $$;

-- Update constraint: deployed + reserved + free = budget
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE con.conname = 'chk_ama_cycles_budget'
      AND rel.relname = 'ama_cycles'
  ) THEN
    ALTER TABLE ama_cycles DROP CONSTRAINT chk_ama_cycles_budget;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE con.conname = 'chk_ama_cycles_budget'
      AND rel.relname = 'ama_cycles'
  ) THEN
    ALTER TABLE ama_cycles
      ADD CONSTRAINT chk_ama_cycles_budget
      CHECK (deployed_usd + reserved_usd <= budget_usd AND free_usd >= 0 AND deployed_usd + reserved_usd + free_usd <= budget_usd);
  END IF;
END $$;
