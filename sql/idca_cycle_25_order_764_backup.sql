-- ============================================================
-- IDCA PnL Discrepancy Hotfix - Backup & Rollback Scripts
-- Cycle #25 (BTC/USD) - Order #764
-- ============================================================
-- Purpose: Backup cycle #25 and order #764 before applying fee tracking corrections
--          Provides rollback script to restore original values if needed
-- ============================================================

-- ============================================================
-- BACKUP SCRIPT (Run BEFORE applying corrections)
-- ============================================================

-- Backup cycle #25
SELECT * INTO TEMP cycle_25_backup
FROM institutional_dca_cycles
WHERE id = 25;

-- Backup order #764
SELECT * INTO TEMP order_764_backup
FROM institutional_dca_orders
WHERE id = 764;

-- Display backup data for verification
SELECT 'CYCLE #25 BACKUP' as info;
SELECT * FROM cycle_25_backup;

SELECT 'ORDER #764 BACKUP' as info;
SELECT * FROM order_764_backup;

-- ============================================================
-- UPDATE SCRIPT (Run AFTER backup, apply corrections)
-- ============================================================

-- NOTE: This is a placeholder for the actual update script
-- The actual values will be calculated based on:
-- - grossBaseQty: executedQty (gross quantity before fee)
-- - netBaseQty: executedQty - feeAmount (net quantity after fee)
-- - feeAsset: 'BTC' (base asset for Revolut X)
-- - feeAmount: calculated from exchange API or inferred (0.09% default)
-- - feeSource: 'exchange_api' or 'inferred_from_default_pct'

-- Example update (values to be calculated based on actual data):
-- UPDATE institutional_dca_orders
-- SET 
--   gross_base_qty = <grossBaseQty>,
--   net_base_qty = <netBaseQty>,
--   fee_asset = 'BTC',
--   fee_amount = <feeAmount>,
--   fee_source = '<feeSource>'
-- WHERE id = 764;

-- UPDATE institutional_dca_cycles
-- SET 
--   total_quantity = <netBaseQty>
-- WHERE id = 25;

-- ============================================================
-- ROLLBACK SCRIPT (Run ONLY if update needs to be reverted)
-- ============================================================

-- Restore cycle #25 from backup
UPDATE institutional_dca_cycles c
SET 
  total_quantity = b.total_quantity,
  capital_used_usd = b.capital_used_usd,
  total_cost_basis_usd = b.total_cost_basis_usd,
  avg_entry_price = b.avg_entry_price,
  -- Add other fields if needed
FROM cycle_25_backup b
WHERE c.id = 25;

-- Restore order #764 from backup
UPDATE institutional_dca_orders o
SET 
  gross_base_qty = b.gross_base_qty,
  net_base_qty = b.net_base_qty,
  fee_asset = b.fee_asset,
  fee_amount = b.fee_amount,
  fee_source = b.fee_source,
  -- Add other fields if needed
FROM order_764_backup b
WHERE o.id = 764;

-- Clean up temp tables after rollback
DROP TABLE IF EXISTS cycle_25_backup;
DROP TABLE IF EXISTS order_764_backup;

-- ============================================================
-- VERIFICATION QUERIES (Run after update to verify changes)
-- ============================================================

-- Verify cycle #25 after update
SELECT 'CYCLE #25 AFTER UPDATE' as info;
SELECT id, pair, status, total_quantity, capital_used_usd, avg_entry_price, current_price
FROM institutional_dca_cycles
WHERE id = 25;

-- Verify order #764 after update
SELECT 'ORDER #764 AFTER UPDATE' as info;
SELECT id, cycle_id, order_type, quantity, gross_base_qty, net_base_qty, fee_asset, fee_amount, fee_source
FROM institutional_dca_orders
WHERE id = 764;

-- ============================================================
-- CLEANUP (Run after successful update and verification)
-- ============================================================

-- Drop temp tables
DROP TABLE IF EXISTS cycle_25_backup;
DROP TABLE IF EXISTS order_764_backup;
