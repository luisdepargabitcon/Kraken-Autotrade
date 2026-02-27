-- 016_time_stop_smart_config.sql
-- Smart TimeStop: TTL per asset/market with regime multipliers and close policy

CREATE TABLE IF NOT EXISTS time_stop_config (
  id SERIAL PRIMARY KEY,
  pair TEXT NOT NULL,                          -- e.g. 'BTC/USD', 'ETH/USD', or '*' for default
  market TEXT NOT NULL DEFAULT 'spot',         -- 'spot', 'futures', etc.

  -- Base TTL in hours
  ttl_base_hours NUMERIC(8,2) NOT NULL DEFAULT 36.00,

  -- Regime multipliers (applied to ttl_base_hours)
  factor_trend NUMERIC(5,3) NOT NULL DEFAULT 1.200,      -- TREND: hold longer
  factor_range NUMERIC(5,3) NOT NULL DEFAULT 0.800,       -- RANGE: shorter
  factor_transition NUMERIC(5,3) NOT NULL DEFAULT 1.000,  -- TRANSITION: neutral

  -- TTL clamp limits (in hours)
  min_ttl_hours NUMERIC(8,2) NOT NULL DEFAULT 4.00,
  max_ttl_hours NUMERIC(8,2) NOT NULL DEFAULT 168.00,     -- 7 days

  -- Close policy on expiry
  close_order_type TEXT NOT NULL DEFAULT 'market',         -- 'market' or 'limit'
  limit_fallback_seconds INTEGER NOT NULL DEFAULT 30,      -- fallback to market after N seconds if limit not filled
  
  -- Logging & alerts
  telegram_alert_enabled BOOLEAN NOT NULL DEFAULT true,
  log_expiry_even_if_disabled BOOLEAN NOT NULL DEFAULT true,  -- log event even when toggle is off

  -- Priority (lower = higher priority, for pair-specific vs default matching)
  priority INTEGER NOT NULL DEFAULT 100,

  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE(pair, market)
);

-- Insert default row (wildcard) so there's always a fallback
INSERT INTO time_stop_config (pair, market, ttl_base_hours, factor_trend, factor_range, factor_transition, min_ttl_hours, max_ttl_hours, close_order_type, limit_fallback_seconds, priority)
VALUES ('*', 'spot', 36.00, 1.200, 0.800, 1.000, 4.00, 168.00, 'market', 30, 999)
ON CONFLICT (pair, market) DO NOTHING;

-- Seed typical crypto pairs with sensible defaults
INSERT INTO time_stop_config (pair, market, ttl_base_hours, factor_trend, factor_range, factor_transition, min_ttl_hours, max_ttl_hours, close_order_type, limit_fallback_seconds, priority)
VALUES
  ('BTC/USD', 'spot', 48.00, 1.500, 0.700, 1.000, 6.00, 240.00, 'market', 30, 10),
  ('ETH/USD', 'spot', 36.00, 1.300, 0.750, 1.000, 4.00, 168.00, 'market', 30, 10),
  ('SOL/USD', 'spot', 24.00, 1.200, 0.800, 0.900, 3.00, 120.00, 'market', 30, 10),
  ('XRP/USD', 'spot', 24.00, 1.200, 0.800, 0.900, 3.00, 120.00, 'market', 30, 10)
ON CONFLICT (pair, market) DO NOTHING;
