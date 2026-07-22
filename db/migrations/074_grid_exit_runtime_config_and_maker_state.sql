-- Migration 074: runtime Grid config toggles and per-side fee defaults
-- Phase: 3C.5-A-REV-C3
-- default_exit_policy_version defaults to FIRST_PROFITABLE_HIGHER_RUNG_V2.
-- Trailing/stop disabled by default; per-side fees default to 0.09 % (0.0009 decimal).

DO $$
BEGIN
    -- Add config columns idempotently
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'grid_isolated_configs'
          AND column_name = 'default_exit_policy_version'
    ) THEN
        ALTER TABLE grid_isolated_configs
        ADD COLUMN default_exit_policy_version TEXT DEFAULT 'FIRST_PROFITABLE_HIGHER_RUNG_V2';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'grid_isolated_configs'
          AND column_name = 'trailing_enabled'
    ) THEN
        ALTER TABLE grid_isolated_configs
        ADD COLUMN trailing_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'grid_isolated_configs'
          AND column_name = 'stop_loss_enabled'
    ) THEN
        ALTER TABLE grid_isolated_configs
        ADD COLUMN stop_loss_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'grid_isolated_configs'
          AND column_name = 'buy_fee_pct'
    ) THEN
        ALTER TABLE grid_isolated_configs
        ADD COLUMN buy_fee_pct DECIMAL(6,4) NOT NULL DEFAULT 0.09;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'grid_isolated_configs'
          AND column_name = 'sell_fee_pct'
    ) THEN
        ALTER TABLE grid_isolated_configs
        ADD COLUMN sell_fee_pct DECIMAL(6,4) NOT NULL DEFAULT 0.09;
    END IF;

    -- Add cycle JSONB columns for typed maker exit state idempotently
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'grid_isolated_cycles'
          AND column_name = 'maker_exit_state_json'
    ) THEN
        ALTER TABLE grid_isolated_cycles
        ADD COLUMN maker_exit_state_json JSONB DEFAULT NULL;
    END IF;
END
$$;

-- No backfill of existing cycles intentionally; legacy cycles remain legacy.
-- No index on maker_exit_state_json: not queried as a whole in hot paths.
