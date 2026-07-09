-- Migration 069: Grid Compact Range Control (3C.3-A)
-- Adds enforceCompactRange, gridRangeMaxPct, maxDistanceFromCenterPct, maxSellDistanceFromNearestBuyPct
-- to grid_isolated_configs table.
-- Idempotent: uses IF NOT EXISTS for all columns.

-- enforce_compact_range: boolean, default true
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'grid_isolated_configs' AND column_name = 'enforce_compact_range'
  ) THEN
    ALTER TABLE grid_isolated_configs
      ADD COLUMN enforce_compact_range boolean NOT NULL DEFAULT true;
  END IF;
END $$;

-- grid_range_max_pct: decimal(6,2), default 2.50
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'grid_isolated_configs' AND column_name = 'grid_range_max_pct'
  ) THEN
    ALTER TABLE grid_isolated_configs
      ADD COLUMN grid_range_max_pct decimal(6,2) NOT NULL DEFAULT '2.50';
  END IF;
END $$;

-- max_distance_from_center_pct: decimal(6,2), default 1.25
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'grid_isolated_configs' AND column_name = 'max_distance_from_center_pct'
  ) THEN
    ALTER TABLE grid_isolated_configs
      ADD COLUMN max_distance_from_center_pct decimal(6,2) NOT NULL DEFAULT '1.25';
  END IF;
END $$;

-- max_sell_distance_from_nearest_buy_pct: decimal(6,2), default 1.50
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'grid_isolated_configs' AND column_name = 'max_sell_distance_from_nearest_buy_pct'
  ) THEN
    ALTER TABLE grid_isolated_configs
      ADD COLUMN max_sell_distance_from_nearest_buy_pct decimal(6,2) NOT NULL DEFAULT '1.50';
  END IF;
END $$;
