-- ============================================================
-- IDCA Fee Tracking Bug Fix - Order #765 / Cycle #25
-- Safety buy fee tracking reconciliation (Revolut X)
-- ============================================================
-- Purpose: Apply fee tracking corrections to order #765 and cycle #25
-- Bug: Safety buy did not apply fee tracking due to fallback timeout path
-- Expected values for order #765:
--   - grossBaseQty = 0.00428042
--   - netBaseQty = 0.00427657 (0.00428042 - 0.00000385)
--   - feeAsset = BTC
--   - feeAmount = 0.00000385 (0.09% of grossBaseQty)
--   - feeSource = inferred_from_default_pct
--   - feesUsd = 0.28 (0.09% of executedUsd)
--   - netValueUsd = 312.68 (312.96 - 0.28)
-- Expected values for cycle #25:
--   - totalQuantity = 0.01815957 (0.01388300 + 0.00427657)
--   - avgEntryPrice = 74670.82095006
--   - unrealizedPnlUsd = -21.50 (with currentPrice 73432.10)
--   - unrealizedPnlPct = -1.5873
-- ============================================================

-- ============================================================
-- STEP 1: BACKUP (Run this FIRST)
-- ============================================================

-- Backup order #765
SELECT * INTO TEMP order_765_backup
FROM institutional_dca_orders
WHERE id = 765;

-- Backup cycle #25
SELECT * INTO TEMP cycle_25_backup
FROM institutional_dca_cycles
WHERE id = 25;

-- Display backup data for verification
SELECT '=== ORDER #765 BACKUP ===' as info;
SELECT id, cycle_id, order_type, buy_index, side, price, quantity, gross_value_usd, net_value_usd, fees_usd, executed_quantity, executed_usd, avg_fill_price, gross_base_qty, net_base_qty, fee_asset, fee_amount, fee_source, execution_status, exchange_order_id, executed_at
FROM order_765_backup;

SELECT '=== CYCLE #25 BACKUP ===' as info;
SELECT id, pair, status, buy_count, total_quantity, capital_used_usd, total_cost_basis_usd, avg_entry_price, current_price, unrealized_pnl_usd, unrealized_pnl_pct
FROM cycle_25_backup;

-- ============================================================
-- STEP 2: UPDATE (Run AFTER backup verification)
-- ============================================================

-- Update order #765 with fee tracking fields
UPDATE institutional_dca_orders
SET 
  quantity = '0.00427657',           -- Net quantity (post-fee)
  gross_value_usd = '312.96',        -- Gross value (executedUsd)
  net_value_usd = '312.68',          -- Net value (executedUsd - feeUsd)
  fees_usd = '0.28',                 -- Fee in USD (0.09% of executedUsd)
  executed_quantity = '0.00428042',  -- Executed quantity (gross)
  executed_usd = '312.96',           -- Executed USD (gross)
  avg_fill_price = '73115.40',      -- Average fill price
  gross_base_qty = '0.00428042',     -- Gross base quantity
  net_base_qty = '0.00427657',       -- Net base quantity (post-fee)
  fee_asset = 'BTC',                -- Fee charged in base asset
  fee_amount = '0.00000385',        -- Fee amount in BTC (0.09% of grossBaseQty)
  fee_source = 'inferred_from_default_pct'  -- Inferred from default 0.09% Revolut X fee
WHERE id = 765;

-- Update cycle #25 to use net quantity for totalQuantity and recalculate avgEntryPrice
UPDATE institutional_dca_cycles
SET 
  total_quantity = '0.01815957',              -- Net total quantity (0.01388300 + 0.00427657)
  avg_entry_price = '74670.82095006',         -- Recalculated average entry price
  unrealized_pnl_usd = '-21.50',              -- Recalculated with currentPrice 73432.10
  unrealized_pnl_pct = '-1.5873'              -- Recalculated with currentPrice 73432.10
WHERE id = 25;

-- ============================================================
-- STEP 3: VERIFICATION (Run AFTER update)
-- ============================================================

-- Verify order #765 after update
SELECT '=== ORDER #765 AFTER UPDATE ===' as info;
SELECT id, cycle_id, order_type, buy_index, side, price, quantity, gross_value_usd, net_value_usd, fees_usd, executed_quantity, executed_usd, avg_fill_price, gross_base_qty, net_base_qty, fee_asset, fee_amount, fee_source, execution_status, exchange_order_id, executed_at
FROM institutional_dca_orders
WHERE id = 765;

-- Verify cycle #25 after update
SELECT '=== CYCLE #25 AFTER UPDATE ===' as info;
SELECT id, pair, status, buy_count, total_quantity, capital_used_usd, total_cost_basis_usd, avg_entry_price, current_price, unrealized_pnl_usd, unrealized_pnl_pct
FROM institutional_dca_cycles
WHERE id = 25;

-- Verify PnL calculation with new values
SELECT '=== PnL VERIFICATION ===' as info;
SELECT 
  c.id as cycle_id,
  c.pair,
  c.total_quantity,
  c.current_price,
  (c.total_quantity::numeric * c.current_price::numeric) as current_value_usd,
  c.capital_used_usd,
  (c.total_quantity::numeric * c.current_price::numeric - c.capital_used_usd::numeric) as unrealized_pnl_usd,
  ((c.total_quantity::numeric * c.current_price::numeric - c.capital_used_usd::numeric) / c.capital_used_usd::numeric * 100) as unrealized_pnl_pct
FROM institutional_dca_cycles c
WHERE c.id = 25;

-- Verify fee tracking fields are populated
SELECT '=== FEE TRACKING VERIFICATION ===' as info;
SELECT 
  o.id as order_id,
  o.order_type,
  o.gross_base_qty,
  o.net_base_qty,
  o.fee_asset,
  o.fee_amount,
  o.fee_source,
  (o.gross_base_qty::numeric - o.net_base_qty::numeric) as fee_diff,
  (o.gross_value_usd::numeric - o.net_value_usd::numeric) as fee_usd_diff
FROM institutional_dca_orders o
WHERE o.id = 765;

-- ============================================================
-- STEP 4: ROLLBACK (Run ONLY if update needs to be reverted)
-- ============================================================

-- Restore order #765 from backup
UPDATE institutional_dca_orders o
SET 
  quantity = b.quantity,
  gross_value_usd = b.gross_value_usd,
  net_value_usd = b.net_value_usd,
  fees_usd = b.fees_usd,
  executed_quantity = b.executed_quantity,
  executed_usd = b.executed_usd,
  avg_fill_price = b.avg_fill_price,
  gross_base_qty = b.gross_base_qty,
  net_base_qty = b.net_base_qty,
  fee_asset = b.fee_asset,
  fee_amount = b.fee_amount,
  fee_source = b.fee_source
FROM order_765_backup b
WHERE o.id = 765;

-- Restore cycle #25 from backup
UPDATE institutional_dca_cycles c
SET 
  total_quantity = b.total_quantity,
  avg_entry_price = b.avg_entry_price,
  unrealized_pnl_usd = b.unrealized_pnl_usd,
  unrealized_pnl_pct = b.unrealized_pnl_pct
FROM cycle_25_backup b
WHERE c.id = 25;

-- ============================================================
-- STEP 5: CLEANUP (Run after successful update and verification)
-- ============================================================

-- Drop temp tables
DROP TABLE IF EXISTS order_765_backup;
DROP TABLE IF EXISTS cycle_25_backup;
