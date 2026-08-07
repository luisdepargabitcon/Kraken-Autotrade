-- 085_portfolio_global_runtime.sql — Portfolio Global PostgreSQL runtime tables
-- Depends on: no prior migration dependencies
-- Idempotent: uses CREATE TABLE IF NOT EXISTS
-- Purpose: Replace in-memory PortfolioGlobalService with PostgreSQL-backed persistence.
--   Portfolio Global is the single source of truth for capital attribution.

-- ─── Portfolio Budgets ─────────────────────────────────────────────────
-- Per-mode, per-exchange, per-asset budget tracking.
CREATE TABLE IF NOT EXISTS portfolio_budgets (
  id SERIAL PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('AMA', 'IDCA', 'GRID', 'SPOT_NORMAL', 'MANUAL')),
  exchange TEXT NOT NULL,
  asset TEXT NOT NULL,
  budgeted_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (budgeted_usd >= 0),
  deployed_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (deployed_usd >= 0),
  reserved_usd NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  free_usd NUMERIC(18, 2) GENERATED ALWAYS AS (GREATEST(0, budgeted_usd - deployed_usd - reserved_usd)) STORED,
  allocation_type TEXT NOT NULL DEFAULT 'MANUAL_FIXED_ALLOCATION'
    CHECK (allocation_type IN ('MANUAL_FIXED_ALLOCATION', 'PERCENTAGE', 'DYNAMIC')),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'DISABLED', 'EXHAUSTED', 'PAUSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mode, exchange, asset),
  CONSTRAINT chk_budget_invariant CHECK (deployed_usd + reserved_usd <= budgeted_usd)
);

-- ─── Portfolio Holdings ────────────────────────────────────────────────
-- Asset holdings per exchange with valuation.
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

-- ─── Portfolio Ledger ──────────────────────────────────────────────────
-- Immutable ledger entries for all capital movements.
CREATE TABLE IF NOT EXISTS portfolio_ledger (
  event_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'DEPOSIT', 'WITHDRAWAL', 'PURCHASE', 'SALE', 'TRANSFER', 'FEE', 'ADJUSTMENT', 'RESERVATION', 'RELEASE'
  )),
  exchange TEXT NOT NULL,
  asset TEXT NOT NULL,
  quantity NUMERIC(18, 8) NOT NULL DEFAULT 0,
  amount_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  from_bucket TEXT,
  to_bucket TEXT,
  mode TEXT CHECK (mode IN ('AMA', 'IDCA', 'GRID', 'SPOT_NORMAL', 'MANUAL')),
  cycle_id TEXT,
  tranche_id TEXT,
  source TEXT NOT NULL DEFAULT 'SYSTEM',
  metadata_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_ledger_mode ON portfolio_ledger(mode);
CREATE INDEX IF NOT EXISTS idx_portfolio_ledger_asset ON portfolio_ledger(asset);
CREATE INDEX IF NOT EXISTS idx_portfolio_ledger_created ON portfolio_ledger(created_at DESC);

-- ─── Portfolio Snapshots ───────────────────────────────────────────────
-- Periodic snapshots for audit and reconciliation.
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_value_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  cash_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  holdings_json JSONB NOT NULL DEFAULT '[]',
  mode_budgets_json JSONB NOT NULL DEFAULT '[]',
  total_deployed_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  total_reserved_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  total_free_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  total_unrealized_pnl_usd NUMERIC(18, 2),
  total_realized_pnl_usd NUMERIC(18, 2),
  reconciliation_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (reconciliation_status IN ('RECONCILED', 'PENDING', 'DISCREPANCY_DETECTED', 'FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_ts ON portfolio_snapshots(timestamp DESC);

-- ─── Portfolio Reconciliation ──────────────────────────────────────────
-- Tracks reconciliation runs between Portfolio Global and exchange balances.
CREATE TABLE IF NOT EXISTS portfolio_reconciliation (
  reconciliation_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('RECONCILED', 'PENDING', 'DISCREPANCY_DETECTED', 'FAILED')),
  exchange TEXT NOT NULL,
  expected_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  actual_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  discrepancy_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  discrepancy_pct NUMERIC(8, 2) NOT NULL DEFAULT 0,
  details_json JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_recon_status ON portfolio_reconciliation(status);
CREATE INDEX IF NOT EXISTS idx_portfolio_recon_exchange ON portfolio_reconciliation(exchange);
