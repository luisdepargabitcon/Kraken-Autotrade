-- Migration: Create dry_run_trades table for paper trading visibility
-- Date: 2026-03-29

CREATE TABLE IF NOT EXISTS dry_run_trades (
  id SERIAL PRIMARY KEY,
  sim_txid TEXT NOT NULL UNIQUE,
  pair TEXT NOT NULL,
  type TEXT NOT NULL, -- buy | sell
  price DECIMAL(18,8) NOT NULL,
  amount DECIMAL(18,8) NOT NULL,
  total_usd DECIMAL(18,2) NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open | closed
  entry_sim_txid TEXT, -- For sells: link to original buy
  entry_price DECIMAL(18,8),
  realized_pnl_usd DECIMAL(18,2),
  realized_pnl_pct DECIMAL(10,4),
  closed_at TIMESTAMP,
  strategy_id TEXT,
  regime TEXT,
  confidence DECIMAL(5,2),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dry_run_trades_status ON dry_run_trades(status);
CREATE INDEX IF NOT EXISTS idx_dry_run_trades_pair ON dry_run_trades(pair);
CREATE INDEX IF NOT EXISTS idx_dry_run_trades_created_at ON dry_run_trades(created_at DESC);
