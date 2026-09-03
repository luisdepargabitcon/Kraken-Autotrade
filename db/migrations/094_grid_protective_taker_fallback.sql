-- 093_grid_protective_taker_fallback.sql
-- V3.2: Protective Maker→Taker Fallback configuration columns.
-- Additive, idempotent, no DROP, safe defaults.
-- Defaults: protectiveTakerFallbackEnabled=false, protectiveMakerMaxAttempts=3, protectiveMakerMaxWaitSeconds=30.
-- V3.2 CANONICAL FEE: Taker fee is resolved at runtime from getTradingFeeModel()
-- (ExchangeFactory → Revolut X). No DB column for taker fee — it is NOT a config parameter.
-- protectiveTakerMaxSlippagePct is nullable/reserved (not yet enforced).

ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS protective_taker_fallback_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS protective_maker_max_attempts INTEGER NOT NULL DEFAULT 3;
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS protective_maker_max_wait_seconds INTEGER NOT NULL DEFAULT 30;
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS protective_taker_max_slippage_pct DECIMAL(5,2);
