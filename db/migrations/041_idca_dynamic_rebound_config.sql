-- Migration 041: IDCA Dynamic Rebound Config
-- Adds dynamic_rebound_config_json column to institutional_dca_asset_configs.
-- Controls intelligent rebound calculation for trailing buy in dynamic_intelligent_entry mode.
--
-- Default: BTC/USD and ETH/USD get pair-specific defaults. Other pairs get BTC defaults.
-- This is a JSONB column with safe defaults that preserve existing behavior when disabled.

ALTER TABLE institutional_dca_asset_configs
ADD COLUMN IF NOT EXISTS dynamic_rebound_config_json JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN institutional_dca_asset_configs.dynamic_rebound_config_json IS
  'Dynamic rebound config for intelligent trailing buy: minReboundPct, maxReboundPct, reboundAtrMultiplier, minRequiredDropRetentionRatio, minActualDrawdownRetentionRatio, antiOverextendedEnabled';

-- Backfill BTC/USD with BTC defaults
UPDATE institutional_dca_asset_configs
SET dynamic_rebound_config_json = '{
  "enabled": true,
  "minReboundPct": 0.10,
  "maxReboundPct": 0.80,
  "reboundAtrMultiplier": 0.40,
  "minRequiredDropRetentionRatio": 1.00,
  "minActualDrawdownRetentionRatio": 0.50,
  "antiOverextendedEnabled": true
}'::jsonb
WHERE pair = 'BTC/USD' AND dynamic_rebound_config_json = '{}'::jsonb;

-- Backfill ETH/USD with ETH defaults
UPDATE institutional_dca_asset_configs
SET dynamic_rebound_config_json = '{
  "enabled": true,
  "minReboundPct": 0.15,
  "maxReboundPct": 1.20,
  "reboundAtrMultiplier": 0.50,
  "minRequiredDropRetentionRatio": 1.00,
  "minActualDrawdownRetentionRatio": 0.50,
  "antiOverextendedEnabled": true
}'::jsonb
WHERE pair = 'ETH/USD' AND dynamic_rebound_config_json = '{}'::jsonb;

-- Backfill other pairs with BTC defaults (safe fallback)
UPDATE institutional_dca_asset_configs
SET dynamic_rebound_config_json = '{
  "enabled": true,
  "minReboundPct": 0.10,
  "maxReboundPct": 0.80,
  "reboundAtrMultiplier": 0.40,
  "minRequiredDropRetentionRatio": 1.00,
  "minActualDrawdownRetentionRatio": 0.50,
  "antiOverextendedEnabled": true
}'::jsonb
WHERE dynamic_rebound_config_json = '{}'::jsonb;

DO $$
BEGIN
  RAISE NOTICE 'Migration 041 completed: Added dynamic_rebound_config_json to institutional_dca_asset_configs';
  RAISE NOTICE 'BTC/USD: minReboundPct=0.10%, maxReboundPct=0.80%, reboundAtrMultiplier=0.40';
  RAISE NOTICE 'ETH/USD: minReboundPct=0.15%, maxReboundPct=1.20%, reboundAtrMultiplier=0.50';
  RAISE NOTICE 'Other pairs: BTC defaults applied';
  RAISE NOTICE 'To customize: UPDATE institutional_dca_asset_configs SET dynamic_rebound_config_json = ''{...}'' WHERE pair = ''...'';';
END $$;
