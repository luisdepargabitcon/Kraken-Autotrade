-- Migration 040: IDCA Entry Mode
-- Adds entry_mode column to institutional_dca_asset_configs.
-- Controls which distance resolver is active: assisted_entry (default) or dynamic_intelligent_entry.
--
-- Default: 'assisted_entry' — preserves existing behavior (slider-based distance, zero behavioral change).
-- 'dynamic_intelligent_entry' must be explicitly configured per pair to activate dynamic computation.

ALTER TABLE institutional_dca_asset_configs
ADD COLUMN IF NOT EXISTS entry_mode TEXT NOT NULL DEFAULT 'assisted_entry';

COMMENT ON COLUMN institutional_dca_asset_configs.entry_mode IS
  'Entry distance mode: assisted_entry (slider-based + optional smart adjustment) | dynamic_intelligent_entry (ATR/market-driven) | legacy (backward-compat fallback)';

-- Constraint: only valid values allowed
ALTER TABLE institutional_dca_asset_configs
DROP CONSTRAINT IF EXISTS idca_asset_configs_entry_mode_check;

ALTER TABLE institutional_dca_asset_configs
ADD CONSTRAINT idca_asset_configs_entry_mode_check
  CHECK (entry_mode IN ('assisted_entry', 'dynamic_intelligent_entry', 'legacy'));

-- Backfill all existing rows with 'assisted_entry' (zero behavioral change)
UPDATE institutional_dca_asset_configs
SET entry_mode = 'assisted_entry'
WHERE entry_mode IS NULL OR entry_mode NOT IN ('assisted_entry', 'dynamic_intelligent_entry', 'legacy');

DO $$
BEGIN
  RAISE NOTICE 'Migration 040 completed: Added entry_mode to institutional_dca_asset_configs';
  RAISE NOTICE 'All existing rows seeded with entry_mode=assisted_entry (zero behavioral change)';
  RAISE NOTICE 'To activate dynamic mode for a pair: UPDATE institutional_dca_asset_configs SET entry_mode = ''dynamic_intelligent_entry'' WHERE pair = ''BTC/USD'';';
END $$;
