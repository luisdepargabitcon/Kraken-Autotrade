-- 093_grid_protective_taker_fallback.sql
-- V3.2: Protective Maker→Taker Fallback configuration columns.
-- Additive, idempotent, no DROP, safe defaults.
-- Defaults: protectiveTakerFallbackEnabled=false, protectiveMakerMaxAttempts=3, protectiveMakerMaxWaitSeconds=30.
-- V3.2 HARDENING: protectiveTakerFeePct=0.09 (Revolut X taker fee), protectiveTakerFeeSource='REVOLUTX_TAKER_DEFAULT'.

ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS protective_taker_fallback_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS protective_maker_max_attempts INTEGER NOT NULL DEFAULT 3;
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS protective_maker_max_wait_seconds INTEGER NOT NULL DEFAULT 30;
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS protective_taker_max_slippage_pct DECIMAL(5,2);
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS protective_taker_fee_pct DECIMAL(6,4) NOT NULL DEFAULT 0.0900;
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS protective_taker_fee_source TEXT NOT NULL DEFAULT 'REVOLUTX_TAKER_DEFAULT';
