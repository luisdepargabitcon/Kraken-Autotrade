-- Migration 029: Add ladder ATRP and trailing buy level 1 config to IDCA
-- Adds support for intelligent ladder based on ATRP and trailing buy per level

-- Add ladder ATRP config columns to institutional_dca_asset_configs
ALTER TABLE institutional_dca_asset_configs 
ADD COLUMN ladder_atrp_config_json jsonb,
ADD COLUMN ladder_atrp_enabled boolean NOT NULL DEFAULT false,
ADD COLUMN trailing_buy_level_1_config_json jsonb;

-- Create index for faster queries on ladder enabled assets
CREATE INDEX idx_institutional_dca_asset_configs_ladder_enabled 
ON institutional_dca_asset_configs(ladder_atrp_enabled) 
WHERE ladder_atrp_enabled = true;

-- Add comments for documentation
COMMENT ON COLUMN institutional_dca_asset_configs.ladder_atrp_config_json IS 'Ladder ATRP configuration: profile, intensity, multipliers, size distribution, clamps, adaptive scaling';
COMMENT ON COLUMN institutional_dca_asset_configs.ladder_atrp_enabled IS 'Enable/disable ladder ATRP system for this asset';
COMMENT ON COLUMN institutional_dca_asset_configs.trailing_buy_level_1_config_json IS 'Trailing buy level 1 configuration: trigger level, mode, value, time limits, advanced settings';

-- Insert default ladder ATRP configs for existing assets (disabled by default)
UPDATE institutional_dca_asset_configs 
SET ladder_atrp_config_json = '{
  "enabled": false,
  "profile": "balanced",
  "sliderIntensity": 50,
  "baseMultiplier": 0.8,
  "stepMultiplier": 0.4,
  "maxMultiplier": 4.0,
  "effectiveMultipliers": [0.8, 1.2, 1.6, 2.0, 2.4],
  "sizeDistribution": [25, 25, 20, 15, 15],
  "minDipPct": 0.8,
  "maxDipPct": 20,
  "maxLevels": 5,
  "adaptiveScaling": true,
  "volatilityScaling": 1.0,
  "rebalanceOnVwap": true
}'::jsonb,
trailing_buy_level_1_config_json = '{
  "enabled": false,
  "triggerLevel": 0,
  "triggerMode": "dip_pct",
  "trailingMode": "rebound_pct",
  "trailingValue": 0.3,
  "maxWaitMinutes": 60,
  "cancelOnRecovery": true,
  "minVolumeCheck": false,
  "confirmWithVwap": false
}'::jsonb
WHERE ladder_atrp_config_json IS NULL;

-- Log migration completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 029 completed: Added ladder ATRP and trailing buy level 1 config to IDCA';
  RAISE NOTICE 'Existing assets have default configs but ladder ATRP is disabled by default';
  RAISE NOTICE 'Use ladder_atrp_enabled = true to activate the new system per asset';
END $$;
