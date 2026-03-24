-- Migration: Add IDCA exit slider fields
-- Date: 2026-03-24
-- Description: New exit logic for IDCA: protection → trailing activation → trailing margin

-- 1) Asset config: 3 new slider fields
ALTER TABLE institutional_dca_asset_configs
  ADD COLUMN IF NOT EXISTS protection_activation_pct DECIMAL(5,2) NOT NULL DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS trailing_activation_pct DECIMAL(5,2) NOT NULL DEFAULT 3.50,
  ADD COLUMN IF NOT EXISTS trailing_margin_pct DECIMAL(5,2) NOT NULL DEFAULT 1.50;

-- 2) Cycles: 2 new state fields
ALTER TABLE institutional_dca_cycles
  ADD COLUMN IF NOT EXISTS protection_armed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS protection_stop_price DECIMAL(18,8);
