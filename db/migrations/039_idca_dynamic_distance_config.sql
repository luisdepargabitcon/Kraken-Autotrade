-- Migration 039: IDCA Dynamic Distance Config
-- Adds dynamic_distance_config_json JSONB column to institutional_dca_asset_configs
-- for the new "Distancia Dinámica" feature (manual | dynamic_hybrid mode).
-- Default mode="manual" guarantees zero behavioral change for existing configs.

ALTER TABLE institutional_dca_asset_configs
ADD COLUMN IF NOT EXISTS dynamic_distance_config_json JSONB;

COMMENT ON COLUMN institutional_dca_asset_configs.dynamic_distance_config_json IS
  'Dynamic Distance configuration: mode (manual/dynamic_hybrid), atrMultiplier, aggressiveness, clamps, feeFloor, feature toggles';

-- Backfill BTC/USD — conservative defaults, mode=manual (unchanged behavior)
UPDATE institutional_dca_asset_configs
SET dynamic_distance_config_json = '{
  "mode": "manual",
  "atrMultiplier": 1.0,
  "aggressiveness": 50,
  "minDistancePct": 0.80,
  "maxDistancePct": 12.0,
  "feeFloorPct": 0.60,
  "useMarketRegime": true,
  "useCyclePressure": true,
  "useExposurePenalty": true,
  "useDataHealthPenalty": true
}'::jsonb
WHERE dynamic_distance_config_json IS NULL AND pair = 'BTC/USD';

-- Backfill ETH/USD — slightly wider defaults due to higher volatility
UPDATE institutional_dca_asset_configs
SET dynamic_distance_config_json = '{
  "mode": "manual",
  "atrMultiplier": 1.0,
  "aggressiveness": 50,
  "minDistancePct": 1.00,
  "maxDistancePct": 15.0,
  "feeFloorPct": 0.70,
  "useMarketRegime": true,
  "useCyclePressure": true,
  "useExposurePenalty": true,
  "useDataHealthPenalty": true
}'::jsonb
WHERE dynamic_distance_config_json IS NULL AND pair = 'ETH/USD';

-- Generic fallback for any future pairs
UPDATE institutional_dca_asset_configs
SET dynamic_distance_config_json = '{
  "mode": "manual",
  "atrMultiplier": 1.0,
  "aggressiveness": 50,
  "minDistancePct": 0.80,
  "maxDistancePct": 12.0,
  "feeFloorPct": 0.60,
  "useMarketRegime": true,
  "useCyclePressure": true,
  "useExposurePenalty": true,
  "useDataHealthPenalty": true
}'::jsonb
WHERE dynamic_distance_config_json IS NULL;

DO $$
BEGIN
  RAISE NOTICE 'Migration 039 completed: Added dynamic_distance_config_json to institutional_dca_asset_configs';
  RAISE NOTICE 'All existing rows seeded with mode=manual (zero behavioral change)';
END $$;
