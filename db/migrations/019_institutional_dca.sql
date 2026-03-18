-- Migration 019: Institutional DCA Module
-- Creates all tables for the new Institutional DCA module, completely isolated from main bot

-- 1. Trading Engine Controls — independent toggles
CREATE TABLE IF NOT EXISTS trading_engine_controls (
  id SERIAL PRIMARY KEY,
  normal_bot_enabled BOOLEAN NOT NULL DEFAULT true,
  institutional_dca_enabled BOOLEAN NOT NULL DEFAULT false,
  global_trading_pause BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed single row
INSERT INTO trading_engine_controls (normal_bot_enabled, institutional_dca_enabled, global_trading_pause)
SELECT true, false, false
WHERE NOT EXISTS (SELECT 1 FROM trading_engine_controls LIMIT 1);

-- 2. Institutional DCA Config — global module configuration
CREATE TABLE IF NOT EXISTS institutional_dca_config (
  id SERIAL PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  mode TEXT NOT NULL DEFAULT 'disabled',
  allocated_capital_usd DECIMAL(18,2) NOT NULL DEFAULT 1000.00,
  protect_principal BOOLEAN NOT NULL DEFAULT true,
  reinvest_mode TEXT NOT NULL DEFAULT 'none',
  max_module_exposure_pct DECIMAL(5,2) NOT NULL DEFAULT 80.00,
  max_asset_exposure_pct DECIMAL(5,2) NOT NULL DEFAULT 50.00,
  max_module_drawdown_pct DECIMAL(5,2) NOT NULL DEFAULT 15.00,
  max_combined_btc_exposure_pct DECIMAL(5,2) NOT NULL DEFAULT 40.00,
  max_combined_eth_exposure_pct DECIMAL(5,2) NOT NULL DEFAULT 30.00,
  block_on_breakdown BOOLEAN NOT NULL DEFAULT true,
  block_on_high_spread BOOLEAN NOT NULL DEFAULT true,
  block_on_sell_pressure BOOLEAN NOT NULL DEFAULT true,
  scheduler_interval_seconds INTEGER NOT NULL DEFAULT 60,
  local_high_lookback_minutes INTEGER NOT NULL DEFAULT 1440,
  -- Smart Mode
  smart_mode_enabled BOOLEAN NOT NULL DEFAULT true,
  volatility_trailing_enabled BOOLEAN NOT NULL DEFAULT true,
  adaptive_tp_enabled BOOLEAN NOT NULL DEFAULT true,
  adaptive_position_sizing_enabled BOOLEAN NOT NULL DEFAULT true,
  btc_market_gate_for_eth_enabled BOOLEAN NOT NULL DEFAULT true,
  learning_window_cycles INTEGER NOT NULL DEFAULT 20,
  learning_auto_apply BOOLEAN NOT NULL DEFAULT false,
  -- Smart Mode guardrails
  min_trailing_pct_btc DECIMAL(5,2) NOT NULL DEFAULT 0.50,
  max_trailing_pct_btc DECIMAL(5,2) NOT NULL DEFAULT 2.50,
  min_trailing_pct_eth DECIMAL(5,2) NOT NULL DEFAULT 0.80,
  max_trailing_pct_eth DECIMAL(5,2) NOT NULL DEFAULT 3.50,
  min_tp_pct_btc DECIMAL(5,2) NOT NULL DEFAULT 2.00,
  max_tp_pct_btc DECIMAL(5,2) NOT NULL DEFAULT 6.00,
  min_tp_pct_eth DECIMAL(5,2) NOT NULL DEFAULT 2.50,
  max_tp_pct_eth DECIMAL(5,2) NOT NULL DEFAULT 8.00,
  market_score_weights_json JSONB NOT NULL DEFAULT '{"ema20_distance":15,"ema50_distance":10,"ema20_slope":10,"ema50_slope":10,"rsi":15,"relative_volume":10,"drawdown_from_high":15,"btc_condition":15}',
  -- Partial TP range
  partial_tp_min_pct DECIMAL(5,2) NOT NULL DEFAULT 20.00,
  partial_tp_max_pct DECIMAL(5,2) NOT NULL DEFAULT 50.00,
  -- Simulation
  simulation_initial_balance_usd DECIMAL(18,2) NOT NULL DEFAULT 10000.00,
  simulation_fee_pct DECIMAL(5,3) NOT NULL DEFAULT 0.400,
  simulation_slippage_pct DECIMAL(5,3) NOT NULL DEFAULT 0.100,
  simulation_telegram_enabled BOOLEAN NOT NULL DEFAULT false,
  -- Data retention
  event_retention_days INTEGER NOT NULL DEFAULT 90,
  order_archive_days INTEGER NOT NULL DEFAULT 180,
  -- Telegram config for IDCA
  telegram_enabled BOOLEAN NOT NULL DEFAULT false,
  telegram_chat_id TEXT,
  telegram_thread_id TEXT,
  telegram_summary_mode TEXT NOT NULL DEFAULT 'compact',
  telegram_cooldown_seconds INTEGER NOT NULL DEFAULT 30,
  telegram_alert_toggles_json JSONB NOT NULL DEFAULT '{"cycle_started":true,"base_buy_executed":true,"safety_buy_executed":true,"buy_blocked":true,"tp_armed":true,"partial_sell_executed":true,"trailing_updated":false,"trailing_exit":true,"breakeven_exit":true,"cycle_closed":true,"daily_summary":true,"critical_error":true,"smart_adjustment_applied":true,"simulation_alerts_enabled":true}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed single row
INSERT INTO institutional_dca_config (enabled, mode)
SELECT false, 'disabled'
WHERE NOT EXISTS (SELECT 1 FROM institutional_dca_config LIMIT 1);

-- 3. Asset-level configs (one row per pair)
CREATE TABLE IF NOT EXISTS institutional_dca_asset_configs (
  id SERIAL PRIMARY KEY,
  pair TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  min_dip_pct DECIMAL(5,2) NOT NULL DEFAULT 2.00,
  dip_reference TEXT NOT NULL DEFAULT 'local_high',
  require_rebound_confirmation BOOLEAN NOT NULL DEFAULT true,
  trailing_buy_enabled BOOLEAN NOT NULL DEFAULT true,
  safety_orders_json JSONB NOT NULL DEFAULT '[{"dipPct":2.0,"sizePctOfAssetBudget":25},{"dipPct":4.0,"sizePctOfAssetBudget":25},{"dipPct":6.0,"sizePctOfAssetBudget":25},{"dipPct":8.0,"sizePctOfAssetBudget":25}]',
  max_safety_orders INTEGER NOT NULL DEFAULT 4,
  take_profit_pct DECIMAL(5,2) NOT NULL DEFAULT 4.00,
  dynamic_take_profit BOOLEAN NOT NULL DEFAULT true,
  trailing_pct DECIMAL(5,2) NOT NULL DEFAULT 1.20,
  partial_take_profit_pct DECIMAL(5,2) NOT NULL DEFAULT 30.00,
  breakeven_enabled BOOLEAN NOT NULL DEFAULT true,
  cooldown_minutes_between_buys INTEGER NOT NULL DEFAULT 180,
  max_cycle_duration_hours INTEGER NOT NULL DEFAULT 720,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed BTC/USD config
INSERT INTO institutional_dca_asset_configs (pair, enabled, min_dip_pct, safety_orders_json, take_profit_pct, trailing_pct)
SELECT 'BTC/USD', true, 2.00,
  '[{"dipPct":2.0,"sizePctOfAssetBudget":25},{"dipPct":4.0,"sizePctOfAssetBudget":25},{"dipPct":6.0,"sizePctOfAssetBudget":25},{"dipPct":8.0,"sizePctOfAssetBudget":25}]',
  4.00, 1.20
WHERE NOT EXISTS (SELECT 1 FROM institutional_dca_asset_configs WHERE pair = 'BTC/USD');

-- Seed ETH/USD config
INSERT INTO institutional_dca_asset_configs (pair, enabled, min_dip_pct, safety_orders_json, take_profit_pct, trailing_pct)
SELECT 'ETH/USD', true, 3.00,
  '[{"dipPct":3.0,"sizePctOfAssetBudget":25},{"dipPct":5.5,"sizePctOfAssetBudget":25},{"dipPct":8.0,"sizePctOfAssetBudget":25},{"dipPct":10.5,"sizePctOfAssetBudget":25}]',
  5.00, 1.80
WHERE NOT EXISTS (SELECT 1 FROM institutional_dca_asset_configs WHERE pair = 'ETH/USD');

-- 4. Cycles
CREATE TABLE IF NOT EXISTS institutional_dca_cycles (
  id SERIAL PRIMARY KEY,
  pair TEXT NOT NULL,
  strategy TEXT NOT NULL DEFAULT 'institutional_dca_v1',
  mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  capital_reserved_usd DECIMAL(18,2) NOT NULL DEFAULT 0,
  capital_used_usd DECIMAL(18,2) NOT NULL DEFAULT 0,
  total_quantity DECIMAL(18,8) NOT NULL DEFAULT 0,
  avg_entry_price DECIMAL(18,8),
  current_price DECIMAL(18,8),
  unrealized_pnl_usd DECIMAL(18,2) DEFAULT 0,
  unrealized_pnl_pct DECIMAL(10,4) DEFAULT 0,
  realized_pnl_usd DECIMAL(18,2) DEFAULT 0,
  buy_count INTEGER NOT NULL DEFAULT 0,
  highest_price_after_tp DECIMAL(18,8),
  tp_target_pct DECIMAL(5,2),
  tp_target_price DECIMAL(18,8),
  tp_armed_at TIMESTAMP,
  trailing_pct DECIMAL(5,2),
  trailing_active_at TIMESTAMP,
  next_buy_level_pct DECIMAL(5,2),
  next_buy_price DECIMAL(18,8),
  market_score DECIMAL(5,2),
  volatility_score DECIMAL(5,2),
  adaptive_size_profile TEXT,
  last_buy_at TIMESTAMP,
  close_reason TEXT,
  max_drawdown_pct DECIMAL(5,2) DEFAULT 0,
  notes_json JSONB,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idca_cycles_pair_mode_status ON institutional_dca_cycles (pair, mode, status);

-- 5. Orders
CREATE TABLE IF NOT EXISTS institutional_dca_orders (
  id SERIAL PRIMARY KEY,
  cycle_id INTEGER NOT NULL,
  pair TEXT NOT NULL,
  mode TEXT NOT NULL,
  order_type TEXT NOT NULL,
  buy_index INTEGER,
  side TEXT NOT NULL,
  price DECIMAL(18,8) NOT NULL,
  quantity DECIMAL(18,8) NOT NULL,
  gross_value_usd DECIMAL(18,2) NOT NULL,
  fees_usd DECIMAL(18,2) NOT NULL DEFAULT 0,
  slippage_usd DECIMAL(18,2) NOT NULL DEFAULT 0,
  net_value_usd DECIMAL(18,2) NOT NULL,
  trigger_reason TEXT,
  exchange_order_id TEXT,
  executed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idca_orders_cycle_id ON institutional_dca_orders (cycle_id);
CREATE INDEX IF NOT EXISTS idx_idca_orders_pair_mode ON institutional_dca_orders (pair, mode);

-- 6. Events
CREATE TABLE IF NOT EXISTS institutional_dca_events (
  id SERIAL PRIMARY KEY,
  cycle_id INTEGER,
  pair TEXT,
  mode TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  payload_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idca_events_type ON institutional_dca_events (event_type);
CREATE INDEX IF NOT EXISTS idx_idca_events_created ON institutional_dca_events (created_at);

-- 7. Backtests
CREATE TABLE IF NOT EXISTS institutional_dca_backtests (
  id SERIAL PRIMARY KEY,
  pair TEXT NOT NULL,
  from_date TIMESTAMP NOT NULL,
  to_date TIMESTAMP NOT NULL,
  config_snapshot_json JSONB NOT NULL,
  total_return_pct DECIMAL(10,4),
  total_return_usd DECIMAL(18,2),
  max_drawdown_pct DECIMAL(10,4),
  win_rate_pct DECIMAL(10,4),
  profit_factor DECIMAL(10,4),
  cycles_count INTEGER,
  avg_cycle_duration_hours DECIMAL(10,2),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 8. Simulation Wallet
CREATE TABLE IF NOT EXISTS institutional_dca_simulation_wallet (
  id SERIAL PRIMARY KEY,
  initial_balance_usd DECIMAL(18,2) NOT NULL DEFAULT 10000.00,
  available_balance_usd DECIMAL(18,2) NOT NULL DEFAULT 10000.00,
  used_balance_usd DECIMAL(18,2) NOT NULL DEFAULT 0,
  realized_pnl_usd DECIMAL(18,2) NOT NULL DEFAULT 0,
  unrealized_pnl_usd DECIMAL(18,2) NOT NULL DEFAULT 0,
  total_equity_usd DECIMAL(18,2) NOT NULL DEFAULT 10000.00,
  total_cycles_simulated INTEGER NOT NULL DEFAULT 0,
  total_orders_simulated INTEGER NOT NULL DEFAULT 0,
  last_reset_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed single row
INSERT INTO institutional_dca_simulation_wallet (initial_balance_usd, available_balance_usd, total_equity_usd)
SELECT 10000.00, 10000.00, 10000.00
WHERE NOT EXISTS (SELECT 1 FROM institutional_dca_simulation_wallet LIMIT 1);

-- 9. OHLCV Cache
CREATE TABLE IF NOT EXISTS institutional_dca_ohlcv_cache (
  id SERIAL PRIMARY KEY,
  pair TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  ts TIMESTAMP NOT NULL,
  open DECIMAL(18,8) NOT NULL,
  high DECIMAL(18,8) NOT NULL,
  low DECIMAL(18,8) NOT NULL,
  close DECIMAL(18,8) NOT NULL,
  volume DECIMAL(18,8) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(pair, timeframe, ts)
);

CREATE INDEX IF NOT EXISTS idx_idca_ohlcv_pair_tf_ts ON institutional_dca_ohlcv_cache (pair, timeframe, ts);
