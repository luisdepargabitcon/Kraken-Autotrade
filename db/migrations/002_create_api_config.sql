-- Migration: Create API Configuration Table
-- Description: Create api_config table for storing exchange and telegram credentials
-- Date: 2026-01-17

CREATE TABLE IF NOT EXISTS api_config (
  id SERIAL PRIMARY KEY,
  -- Kraken configuration
  kraken_api_key TEXT,
  kraken_api_secret TEXT,
  kraken_connected BOOLEAN NOT NULL DEFAULT false,
  kraken_enabled BOOLEAN NOT NULL DEFAULT true,
  -- Revolut X configuration
  revolutx_api_key TEXT,
  revolutx_private_key TEXT,
  revolutx_connected BOOLEAN NOT NULL DEFAULT false,
  revolutx_enabled BOOLEAN NOT NULL DEFAULT false,
  -- Exchange mode: which exchange is used for what purpose
  trading_exchange TEXT NOT NULL DEFAULT 'kraken',
  data_exchange TEXT NOT NULL DEFAULT 'kraken',
  active_exchange TEXT NOT NULL DEFAULT 'kraken',
  -- Telegram configuration
  telegram_token TEXT,
  telegram_chat_id TEXT,
  telegram_connected BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create other required tables
CREATE TABLE IF NOT EXISTS bot_config (
  id SERIAL PRIMARY KEY,
  is_active BOOLEAN NOT NULL DEFAULT false,
  strategy TEXT NOT NULL DEFAULT 'momentum',
  risk_per_trade_pct NUMERIC NOT NULL DEFAULT 2.0,
  max_total_exposure_pct NUMERIC NOT NULL DEFAULT 50,
  max_pair_exposure_pct NUMERIC NOT NULL DEFAULT 20,
  min_order_usd NUMERIC NOT NULL DEFAULT 100,
  max_order_usd NUMERIC NOT NULL DEFAULT 1000,
  max_spread_pct NUMERIC NOT NULL DEFAULT 1.0,
  trading_hours_enabled BOOLEAN NOT NULL DEFAULT false,
  trading_hours_start INTEGER NOT NULL DEFAULT 0,
  trading_hours_end INTEGER NOT NULL DEFAULT 23,
  regime_detection_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  trade_id TEXT NOT NULL UNIQUE,
  pair TEXT NOT NULL,
  type TEXT NOT NULL,
  price TEXT NOT NULL,
  amount TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS open_positions (
  id SERIAL PRIMARY KEY,
  lot_id TEXT UNIQUE,
  pair TEXT NOT NULL,
  buy_txid TEXT,
  buy_price NUMERIC NOT NULL,
  buy_amount NUMERIC NOT NULL,
  buy_cost NUMERIC NOT NULL,
  buy_fee NUMERIC NOT NULL DEFAULT 0,
  opened_at TIMESTAMP NOT NULL,
  target_profit_pct NUMERIC,
  stop_loss_pct NUMERIC,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  sent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS market_data (
  id SERIAL PRIMARY KEY,
  pair TEXT NOT NULL,
  price NUMERIC NOT NULL,
  volume NUMERIC,
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_open_positions_pair ON open_positions(pair);
CREATE INDEX IF NOT EXISTS idx_notifications_sent ON notifications(sent);
CREATE INDEX IF NOT EXISTS idx_market_data_pair_timestamp ON market_data(pair, timestamp DESC);

COMMENT ON TABLE api_config IS 'Stores API credentials for exchanges and Telegram';
COMMENT ON TABLE bot_config IS 'Stores bot trading configuration';
COMMENT ON TABLE trades IS 'Stores trade history';
COMMENT ON TABLE open_positions IS 'Stores currently open trading positions';
