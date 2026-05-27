-- Migration 042: Add fee tracking fields to institutional_dca_orders
-- Purpose: Track gross vs net quantities, fee asset, and fee source for accurate PnL calculation
-- Context: Revolut X charges fees in base asset (BTC), not USD. This migration adds fields to:
--   - Distinguish gross quantity (filled) from net quantity (after base-asset fee)
--   - Track fee asset (BTC vs USD)
--   - Track fee source (exchange_api vs inferred_from_default_pct)
--   - Maintain backward compatibility with existing records

-- Add new columns to institutional_dca_orders
ALTER TABLE institutional_dca_orders
  ADD COLUMN IF NOT EXISTS gross_base_qty NUMERIC(18, 8),
  ADD COLUMN IF NOT EXISTS net_base_qty NUMERIC(18, 8),
  ADD COLUMN IF NOT EXISTS fee_asset TEXT,
  ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(18, 8),
  ADD COLUMN IF NOT EXISTS fee_source TEXT;

-- Add comments for documentation
COMMENT ON COLUMN institutional_dca_orders.gross_base_qty IS 'Gross quantity filled by exchange (before base-asset fee deduction)';
COMMENT ON COLUMN institutional_dca_orders.net_base_qty IS 'Net quantity available after base-asset fee deduction (used for cycle.totalQuantity)';
COMMENT ON COLUMN institutional_dca_orders.fee_asset IS 'Asset in which fee was charged (e.g., BTC, USD, null if unknown)';
COMMENT ON COLUMN institutional_dca_orders.fee_amount IS 'Fee amount in the fee_asset currency';
COMMENT ON COLUMN institutional_dca_orders.fee_source IS 'Source of fee data: exchange_api, inferred_from_default_pct, manual, null';

-- For backward compatibility: populate net_base_qty from quantity for existing records
-- This ensures existing orders continue to work while new orders use the new fields
UPDATE institutional_dca_orders
SET net_base_qty = quantity
WHERE net_base_qty IS NULL AND quantity IS NOT NULL;

-- Populate gross_base_qty from quantity for existing records (assumes no base-asset fee was tracked)
UPDATE institutional_dca_orders
SET gross_base_qty = quantity
WHERE gross_base_qty IS NULL AND quantity IS NOT NULL;

-- Set fee_source to 'legacy' for existing records to indicate these were created before fee tracking
UPDATE institutional_dca_orders
SET fee_source = 'legacy'
WHERE fee_source IS NULL;

-- Add index on fee_asset for faster queries
CREATE INDEX IF NOT EXISTS idx_institutional_dca_orders_fee_asset ON institutional_dca_orders(fee_asset);
