-- Migration 075: persist circuit breaker state in grid_isolated_configs
-- Gate E: circuit breaker persistente + cooldown

ALTER TABLE grid_isolated_configs
  ADD COLUMN IF NOT EXISTS circuit_breaker_open BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS circuit_breaker_opened_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS circuit_breaker_reason TEXT,
  ADD COLUMN IF NOT EXISTS circuit_breaker_cooldown_until TIMESTAMP WITH TIME ZONE;
