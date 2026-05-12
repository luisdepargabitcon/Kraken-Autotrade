-- Migration 036: IDCA Net Break-Even Buffer
-- Adds be_net_buffer_pct to institutional_dca_asset_configs for fee-aware BE protection stops.
-- Default: 0.30% to cover typical exchange fees + spread.

ALTER TABLE institutional_dca_asset_configs
ADD COLUMN IF NOT EXISTS be_net_buffer_pct DECIMAL(5, 3) NOT NULL DEFAULT 0.30;

COMMENT ON COLUMN institutional_dca_asset_configs.be_net_buffer_pct IS
  'Buffer above avgEntryPrice for net break-even protection stops (covers fees+spread). Default 0.30%%';
