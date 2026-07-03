-- Migration 064: Add execution and wallet columns to grid_isolated_configs
-- Idempotent: uses IF NOT EXISTS

-- Execution: Maker/Taker policy
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS maker_attempts_before_taker INTEGER NOT NULL DEFAULT 3;
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS taker_fallback_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS taker_fallback_attempt_number INTEGER NOT NULL DEFAULT 4;
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS max_taker_fallback_per_cycle INTEGER NOT NULL DEFAULT 1;
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS taker_fallback_requires_net_profit BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS taker_fallback_audit_required BOOLEAN NOT NULL DEFAULT true;

-- Wallet / Cartera
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS grid_wallet_mode TEXT NOT NULL DEFAULT 'automatic';
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS grid_wallet_initial_usd DECIMAL(12,2) NOT NULL DEFAULT '1000.00';
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS grid_wallet_max_usd DECIMAL(12,2) NOT NULL DEFAULT '5000.00';
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS grid_wallet_use_profits BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS grid_wallet_compound_profits BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS grid_max_capital_per_cycle_usd DECIMAL(12,2) NOT NULL DEFAULT '600.00';
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS grid_max_capital_per_cycle_pct DECIMAL(6,2) NOT NULL DEFAULT '60.00';
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS grid_reserve_pct DECIMAL(6,2) NOT NULL DEFAULT '20.00';
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS grid_min_free_capital_usd DECIMAL(12,2) NOT NULL DEFAULT '50.00';
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS grid_pause_cycle_when_capital_depleted BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE grid_isolated_configs ADD COLUMN IF NOT EXISTS grid_allow_new_cycle_when_capital_free BOOLEAN NOT NULL DEFAULT true;

-- Update default execution_policy
UPDATE grid_isolated_configs SET execution_policy = 'MAKER_3_ATTEMPTS_THEN_TAKER_FALLBACK' WHERE execution_policy = 'MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK';
