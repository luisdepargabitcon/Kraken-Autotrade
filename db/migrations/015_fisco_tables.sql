-- Migration: FISCO (Fiscal Control) Tables
-- Description: Tables for normalized fiscal operations, FIFO lots, and disposals
-- Date: 2026-02-20
-- Source: Exchange APIs only (Kraken + RevolutX), NOT bot DB

-- Normalized operations from ALL exchanges
CREATE TABLE IF NOT EXISTS fisco_operations (
  id SERIAL PRIMARY KEY,
  exchange TEXT NOT NULL,             -- 'kraken' | 'revolutx'
  external_id TEXT NOT NULL,          -- Unique ID from exchange
  op_type TEXT NOT NULL,              -- 'trade_buy' | 'trade_sell' | 'deposit' | 'withdrawal' | 'conversion' | 'staking'
  asset TEXT NOT NULL,                -- Normalized: BTC, ETH, SOL, XRP, TON, USD, EUR, USDC
  amount DECIMAL(18,8) NOT NULL,      -- Always positive
  price_eur DECIMAL(18,8),            -- Price per unit in EUR (null for deposits/withdrawals)
  total_eur DECIMAL(18,8),            -- Total value in EUR
  fee_eur DECIMAL(18,8) DEFAULT 0,    -- Fee in EUR
  counter_asset TEXT,                 -- Other side of pair (USD, EUR, etc.)
  pair TEXT,                          -- Original pair string
  executed_at TIMESTAMP NOT NULL,
  raw_data JSONB,                     -- Original data from exchange for audit
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(exchange, external_id)
);

-- FIFO lots: one row per acquisition (buy / deposit)
CREATE TABLE IF NOT EXISTS fisco_lots (
  id SERIAL PRIMARY KEY,
  operation_id INTEGER NOT NULL REFERENCES fisco_operations(id),
  asset TEXT NOT NULL,
  quantity DECIMAL(18,8) NOT NULL,
  remaining_qty DECIMAL(18,8) NOT NULL,
  cost_eur DECIMAL(18,8) NOT NULL,        -- Total acquisition cost in EUR
  unit_cost_eur DECIMAL(18,8) NOT NULL,   -- Cost per unit in EUR
  fee_eur DECIMAL(18,8) DEFAULT 0,
  acquired_at TIMESTAMP NOT NULL,
  is_closed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Disposals: when selling, which lots were consumed (FIFO)
CREATE TABLE IF NOT EXISTS fisco_disposals (
  id SERIAL PRIMARY KEY,
  sell_operation_id INTEGER NOT NULL REFERENCES fisco_operations(id),
  lot_id INTEGER NOT NULL REFERENCES fisco_lots(id),
  quantity DECIMAL(18,8) NOT NULL,
  proceeds_eur DECIMAL(18,8) NOT NULL,
  cost_basis_eur DECIMAL(18,8) NOT NULL,
  gain_loss_eur DECIMAL(18,8) NOT NULL,
  disposed_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Fiscal year summary cache
CREATE TABLE IF NOT EXISTS fisco_summary (
  id SERIAL PRIMARY KEY,
  fiscal_year INTEGER NOT NULL,
  asset TEXT NOT NULL,
  total_acquisitions DECIMAL(18,8) DEFAULT 0,
  total_disposals DECIMAL(18,8) DEFAULT 0,
  total_cost_basis_eur DECIMAL(18,8) DEFAULT 0,
  total_proceeds_eur DECIMAL(18,8) DEFAULT 0,
  total_gain_loss_eur DECIMAL(18,8) DEFAULT 0,
  total_fees_eur DECIMAL(18,8) DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(fiscal_year, asset)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_fisco_ops_exchange ON fisco_operations(exchange);
CREATE INDEX IF NOT EXISTS idx_fisco_ops_asset ON fisco_operations(asset);
CREATE INDEX IF NOT EXISTS idx_fisco_ops_type ON fisco_operations(op_type);
CREATE INDEX IF NOT EXISTS idx_fisco_ops_executed ON fisco_operations(executed_at);
CREATE INDEX IF NOT EXISTS idx_fisco_lots_asset ON fisco_lots(asset);
CREATE INDEX IF NOT EXISTS idx_fisco_lots_open ON fisco_lots(asset, is_closed) WHERE NOT is_closed;
CREATE INDEX IF NOT EXISTS idx_fisco_disposals_sell ON fisco_disposals(sell_operation_id);
