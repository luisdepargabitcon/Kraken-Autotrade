-- 085_portfolio_global_runtime.sql — Portfolio Global PostgreSQL runtime tables
-- Depends on: 080_ama_initial.sql (portfolio_mode_budgets, portfolio_ledger_entries)
-- Idempotent: uses ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS
--
-- ARCHITECTURE: Reuses existing tables from 080. Does NOT create duplicate budget/ledger tables.
-- - portfolio_mode_budgets (from 080) is extended with free_usd, updated_by, version, last_reconciled_at
-- - portfolio_ledger_entries (from 080) is extended with amount_usd, price_usd, fee_usd, etc.
-- - portfolio_holdings is NEW (no equivalent in prior migrations)
-- - portfolio_snapshots is NEW (no equivalent in prior migrations)
-- - portfolio_inventory_attribution is NEW
-- - portfolio_reservations is NEW
-- - portfolio_order_locks is NEW
-- - portfolio_reconciliation_runs is NEW

-- ─── Extend portfolio_mode_budgets (from 080) ──────────────────────────
-- 080 created: mode, exchange, asset, budgeted_usd, deployed_usd, reserved_usd,
-- allocation_type, status, created_at, updated_at, UNIQUE(mode, exchange, asset)

-- free_usd as GENERATED column
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_mode_budgets' AND column_name = 'free_usd'
  ) THEN
    ALTER TABLE portfolio_mode_budgets
      ADD COLUMN free_usd NUMERIC(18, 2) GENERATED ALWAYS AS (GREATEST(0, budgeted_usd - deployed_usd - reserved_usd)) STORED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_mode_budgets' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE portfolio_mode_budgets ADD COLUMN updated_by TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_mode_budgets' AND column_name = 'version'
  ) THEN
    ALTER TABLE portfolio_mode_budgets ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_mode_budgets' AND column_name = 'last_reconciled_at'
  ) THEN
    ALTER TABLE portfolio_mode_budgets ADD COLUMN last_reconciled_at TIMESTAMPTZ;
  END IF;
END $$;

-- ─── Extend portfolio_ledger_entries (from 080) ────────────────────────
-- 080 created: event_id, idempotency_key, entry_type, exchange, asset, quantity,
-- from_bucket, to_bucket, mode, cycle_id, tranche_id, logical_intent_id, fill_id,
-- source, metadata_hash, created_at

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_ledger_entries' AND column_name = 'amount_usd'
  ) THEN
    ALTER TABLE portfolio_ledger_entries ADD COLUMN amount_usd NUMERIC(18, 2) NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_ledger_entries' AND column_name = 'price_usd'
  ) THEN
    ALTER TABLE portfolio_ledger_entries ADD COLUMN price_usd NUMERIC(18, 8);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_ledger_entries' AND column_name = 'fee_usd'
  ) THEN
    ALTER TABLE portfolio_ledger_entries ADD COLUMN fee_usd NUMERIC(18, 2) NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_ledger_entries' AND column_name = 'reservation_id'
  ) THEN
    ALTER TABLE portfolio_ledger_entries ADD COLUMN reservation_id TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_ledger_entries' AND column_name = 'order_id'
  ) THEN
    ALTER TABLE portfolio_ledger_entries ADD COLUMN order_id TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_ledger_entries' AND column_name = 'realized_pnl_usd'
  ) THEN
    ALTER TABLE portfolio_ledger_entries ADD COLUMN realized_pnl_usd NUMERIC(18, 2);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_ledger_entries' AND column_name = 'environment'
  ) THEN
    ALTER TABLE portfolio_ledger_entries ADD COLUMN environment TEXT NOT NULL DEFAULT 'LIVE' CHECK (environment IN ('LIVE', 'SHADOW', 'LAB', 'REPLAY'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_ledger_entries' AND column_name = 'simulation_source'
  ) THEN
    ALTER TABLE portfolio_ledger_entries ADD COLUMN simulation_source TEXT;
  END IF;
END $$;

-- ─── Portfolio Holdings (NEW) ──────────────────────────────────────────
-- Asset holdings per exchange with valuation. No equivalent in prior migrations.
CREATE TABLE IF NOT EXISTS portfolio_holdings (
  id SERIAL PRIMARY KEY,
  asset TEXT NOT NULL,
  exchange TEXT NOT NULL,
  quantity NUMERIC(18, 8) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  cost_basis_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  current_price_usd NUMERIC(18, 2),
  current_value_usd NUMERIC(18, 2),
  unrealized_pnl_usd NUMERIC(18, 2),
  unrealized_pnl_pct NUMERIC(8, 2),
  last_valuation_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (asset, exchange)
);

-- ─── Portfolio Inventory Attribution (NEW) ─────────────────────────────
-- Tracks which mode owns which portion of a physical holding.
-- Invariant: SUM(quantity attributed by exchange/asset) <= physical exchange balance
CREATE TABLE IF NOT EXISTS portfolio_inventory_attribution (
  id SERIAL PRIMARY KEY,
  attribution_id TEXT NOT NULL UNIQUE,
  exchange TEXT NOT NULL,
  asset TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('AMA', 'GRID', 'IDCA', 'SPOT_NORMAL', 'MANUAL')),
  quantity NUMERIC(18, 8) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  cost_basis_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source_type IN ('GRID_FILL', 'IDCA_LOT', 'AMA_TRANCHE', 'TRADING_POSITION', 'MANUAL', 'BOOTSTRAP')),
  source_id TEXT,
  cycle_id TEXT,
  tranche_id TEXT,
  lot_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REDUCED', 'CLOSED', 'TRANSFERRED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_attr_exchange_asset ON portfolio_inventory_attribution (exchange, asset);
CREATE INDEX IF NOT EXISTS idx_portfolio_attr_mode ON portfolio_inventory_attribution (mode);
CREATE INDEX IF NOT EXISTS idx_portfolio_attr_status ON portfolio_inventory_attribution (status);

-- ─── Portfolio Reservations (NEW) ──────────────────────────────────────
-- Persistent capital reservations before order execution.
-- States: PENDING → CONFIRMED → CONVERTED → RELEASED | EXPIRED
CREATE TABLE IF NOT EXISTS portfolio_reservations (
  id SERIAL PRIMARY KEY,
  reservation_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('AMA', 'GRID', 'IDCA', 'SPOT_NORMAL', 'MANUAL')),
  exchange TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (amount_usd >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'CONVERTED', 'RELEASED', 'EXPIRED')),
  logical_intent_id TEXT,
  order_id TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  release_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_portfolio_resv_status ON portfolio_reservations (status);
CREATE INDEX IF NOT EXISTS idx_portfolio_resv_mode ON portfolio_reservations (mode);
CREATE INDEX IF NOT EXISTS idx_portfolio_resv_expires ON portfolio_reservations (expires_at);

-- ─── Portfolio Order Locks (NEW) ───────────────────────────────────────
-- Prevents concurrent order execution on same capital.
CREATE TABLE IF NOT EXISTS portfolio_order_locks (
  id SERIAL PRIMARY KEY,
  lock_id TEXT NOT NULL UNIQUE,
  lock_key TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('AMA', 'GRID', 'IDCA', 'SPOT_NORMAL', 'MANUAL')),
  exchange TEXT NOT NULL,
  asset TEXT NOT NULL,
  logical_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACQUIRED' CHECK (status IN ('ACQUIRED', 'RELEASED', 'EXPIRED')),
  owner_instance TEXT,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_portfolio_locks_status ON portfolio_order_locks (status);
CREATE INDEX IF NOT EXISTS idx_portfolio_locks_key ON portfolio_order_locks (lock_key);

-- ─── Portfolio Snapshots (NEW) ─────────────────────────────────────────
-- Periodic snapshots for audit and reconciliation. Data sourced from PostgreSQL.
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_value_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  cash_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  holdings_json JSONB NOT NULL DEFAULT '[]',
  mode_budgets_json JSONB NOT NULL DEFAULT '[]',
  attribution_json JSONB NOT NULL DEFAULT '[]',
  total_deployed_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  total_reserved_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  total_free_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  total_unrealized_pnl_usd NUMERIC(18, 2),
  total_realized_pnl_usd NUMERIC(18, 2),
  reconciliation_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (reconciliation_status IN ('RECONCILED', 'PENDING', 'DISCREPANCY_DETECTED', 'FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_ts ON portfolio_snapshots (timestamp DESC);

-- ─── Portfolio Reconciliation Runs (NEW) ───────────────────────────────
-- Compares physical exchange balance vs attribution vs budgets vs reservations vs ledger.
-- Per exchange/asset, not just USD aggregate.
CREATE TABLE IF NOT EXISTS portfolio_reconciliation_runs (
  reconciliation_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('RECONCILED', 'PENDING', 'DISCREPANCY_DETECTED', 'FAILED')),
  exchange TEXT NOT NULL,
  asset TEXT NOT NULL,
  physical_balance NUMERIC(18, 8) NOT NULL DEFAULT 0,
  attributed_balance NUMERIC(18, 8) NOT NULL DEFAULT 0,
  budgeted_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  deployed_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  reserved_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  discrepancy_qty NUMERIC(18, 8) NOT NULL DEFAULT 0,
  discrepancy_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  discrepancy_pct NUMERIC(8, 2) NOT NULL DEFAULT 0,
  details_json JSONB NOT NULL DEFAULT '{}',
  blockers_json JSONB NOT NULL DEFAULT '[]',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_recon_status ON portfolio_reconciliation_runs (status);
CREATE INDEX IF NOT EXISTS idx_portfolio_recon_exchange ON portfolio_reconciliation_runs (exchange);
CREATE INDEX IF NOT EXISTS idx_portfolio_recon_asset ON portfolio_reconciliation_runs (asset);
