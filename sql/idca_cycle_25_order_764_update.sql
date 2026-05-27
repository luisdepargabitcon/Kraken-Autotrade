-- ============================================================
-- IDCA PnL Discrepancy Hotfix - Update Script
-- Cycle #25 (BTC/USD) - Order #764
-- ============================================================
-- Purpose: Apply fee tracking corrections to cycle #25 and order #764
--          Based on known PnL discrepancy:
--          - DB totalQuantity: 0.01389551 BTC
--          - Revolut X available BTC: 0.013883 BTC
--          - Fee difference: 0.00001251 BTC (0.09%)
-- ============================================================

-- ============================================================
-- STEP 1: BACKUP (Run this FIRST)
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
SELECT '=== CYCLE #25 BACKUP ===' as info;
SELECT id, pair, status, total_quantity, capital_used_usd, total_cost_basis_usd, avg_entry_price, current_price
FROM cycle_25_backup;

SELECT '=== ORDER #764 BACKUP ===' as info;
SELECT id, cycle_id, order_type, quantity, gross_base_qty, net_base_qty, fee_asset, fee_amount, fee_source
FROM order_764_backup;

-- ============================================================
-- STEP 2: UPDATE (Run AFTER backup verification)
-- ============================================================

-- Update order #764 with fee tracking fields
UPDATE institutional_dca_orders
SET 
  gross_base_qty = '0.01389551',  -- Original gross quantity (DB value)
  net_base_qty = '0.01388300',     -- Net quantity after fee (Revolut X available)
  fee_asset = 'BTC',               -- Fee charged in base asset (Revolut X)
  fee_amount = '0.00001251',       -- Fee amount in BTC (0.09% of gross)
  fee_source = 'inferred_from_default_pct'  -- Inferred from default 0.09% Revolut X fee
WHERE id = 764;

-- Update cycle #25 to use net quantity for totalQuantity
UPDATE institutional_dca_cycles
SET 
  total_quantity = '0.01388300'   -- Use net quantity (post-fee) for accurate PnL
WHERE id = 25;

-- ============================================================
-- STEP 3: VERIFICATION (Run AFTER update)
-- ============================================================

-- Verify cycle #25 after update
SELECT '=== CYCLE #25 AFTER UPDATE ===' as info;
SELECT id, pair, status, total_quantity, capital_used_usd, total_cost_basis_usd, avg_entry_price, current_price
FROM institutional_dca_cycles
WHERE id = 25;

-- Verify order #764 after update
SELECT '=== ORDER #764 AFTER UPDATE ===' as info;
SELECT id, cycle_id, order_type, quantity, gross_base_qty, net_base_qty, fee_asset, fee_amount, fee_source
FROM institutional_dca_orders
WHERE id = 764;

-- Verify PnL calculation with new values
SELECT '=== PnL VERIFICATION ===' as info;
SELECT 
  c.id as cycle_id,
  c.pair,
  c.total_quantity,
  c.current_price,
  (c.total_quantity::numeric * c.current_price::numeric) as current_value_usd,
  c.capital_used_usd,
  (c.total_quantity::numeric * c.current_price::numeric - c.capital_used_usd::numeric) as unrealized_pnl_usd
FROM institutional_dca_cycles c
WHERE c.id = 25;

-- ============================================================
-- STEP 4: ROLLBACK (Run ONLY if update needs to be reverted)
-- ============================================================

-- Restore cycle #25 from backup
UPDATE institutional_dca_cycles c
SET 
  total_quantity = b.total_quantity,
  capital_used_usd = b.capital_used_usd,
  total_cost_basis_usd = b.total_cost_basis_usd,
  avg_entry_price = b.avg_entry_price,
  current_price = b.current_price
FROM cycle_25_backup b
WHERE c.id = 25;

-- Restore order #764 from backup
UPDATE institutional_dca_orders o
SET 
  gross_base_qty = b.gross_base_qty,
  net_base_qty = b.net_base_qty,
  fee_asset = b.fee_asset,
  fee_amount = b.fee_amount,
  fee_source = b.fee_source
FROM order_764_backup b
WHERE o.id = 764;

-- ============================================================
-- STEP 5: CLEANUP (Run after successful update and verification)
-- ============================================================

-- Drop temp tables
DROP TABLE IF EXISTS cycle_25_backup;
DROP TABLE IF EXISTS order_764_backup;
