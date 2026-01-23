-- Migration: Backfill legacy positions with AEP and linking
-- Fixes positions created before instant positions system

-- Step 1: Create temporary mapping table for position->trades
CREATE TEMP TABLE legacy_position_trades AS
SELECT 
    op.id as position_id,
    op.pair,
    op.lot_id,
    op.created_at as position_created_at,
    t.id as trade_id,
    t.trade_id as venue_trade_id,
    t.price::numeric as trade_price,
    t.amount::numeric as trade_amount,
    (t.price::numeric * t.amount::numeric) as trade_cost,
    t.executed_at,
    t.order_intent_id
FROM open_positions op
LEFT JOIN trades t ON t.pair = op.pair 
    AND t.type = 'buy' 
    AND t.executed_at >= op.created_at - INTERVAL '24 hours'
    AND t.executed_at <= op.created_at + INTERVAL '2 hours'
WHERE op.status = 'OPEN' 
    AND op.total_amount_base = 0
    AND op.client_order_id IS NULL
ORDER BY op.id, t.executed_at;

-- Step 2: Update positions with aggregated trade data
UPDATE open_positions op
SET 
    total_cost_quote = agg.total_cost,
    total_amount_base = agg.total_amount,
    average_entry_price = CASE 
        WHEN agg.total_amount > 0 THEN ROUND((agg.total_cost / agg.total_amount)::numeric, 8)
        ELSE NULL 
    END,
    fill_count = agg.trade_count,
    first_fill_at = agg.first_fill_at,
    last_fill_at = agg.last_fill_at,
    entry_price = CASE 
        WHEN agg.total_amount > 0 THEN ROUND((agg.total_cost / agg.total_amount)::numeric, 8)
        ELSE op.entry_price 
    END
FROM (
    SELECT 
        position_id,
        SUM(trade_cost) as total_cost,
        SUM(trade_amount) as total_amount,
        COUNT(*) as trade_count,
        MIN(executed_at) as first_fill_at,
        MAX(executed_at) as last_fill_at
    FROM legacy_position_trades
    WHERE trade_id IS NOT NULL
    GROUP BY position_id
) agg
WHERE op.id = agg.position_id;

-- Step 3: Mark positions without matching trades as IMPORTED
UPDATE open_positions 
SET entry_mode = 'IMPORTED'
WHERE status = 'OPEN' 
    AND total_amount_base = 0 
    AND client_order_id IS NULL;

-- Step 4: Create order intents for positions with trades but missing intents
INSERT INTO order_intents (client_order_id, exchange, pair, side, volume, status, created_at, updated_at)
SELECT DISTINCT
    'legacy-backfill-' || op.lot_id || '-' || EXTRACT(EPOCH FROM NOW()) as client_order_id,
    'revolutx' as exchange,
    op.pair,
    'buy' as side,
    op.amount::text as volume,
    'filled' as status,
    op.created_at as created_at,
    NOW() as updated_at
FROM open_positions op
WHERE op.status = 'OPEN'
    AND op.total_amount_base > 0
    AND op.client_order_id IS NULL
    AND NOT EXISTS (
        SELECT 1 FROM order_intents oi 
        WHERE oi.client_order_id LIKE 'legacy-backfill-' || op.lot_id || '%'
    );

-- Step 5: Link trades to newly created intents
UPDATE trades t
SET order_intent_id = oi.id
FROM order_intents oi
WHERE t.pair = oi.pair
    AND t.type = 'buy'
    AND t.order_intent_id IS NULL
    AND oi.client_order_id LIKE 'legacy-backfill-%'
    AND t.executed_at >= oi.created_at - INTERVAL '1 hour'
    AND t.executed_at <= oi.created_at + INTERVAL '1 hour';

-- Step 6: Update positions with client_order_id from intents
UPDATE open_positions op
SET client_order_id = oi.client_order_id,
    order_intent_id = oi.id
FROM order_intents oi
WHERE op.pair = oi.pair
    AND op.client_order_id IS NULL
    AND oi.client_order_id LIKE 'legacy-backfill-%'
    AND op.created_at >= oi.created_at - INTERVAL '1 hour'
    AND op.created_at <= oi.created_at + INTERVAL '1 hour';

-- Cleanup
DROP TABLE IF EXISTS legacy_position_trades;

-- Results summary
SELECT 
    'BACKFILL SUMMARY' as report,
    (SELECT COUNT(*) FROM open_positions WHERE total_amount_base > 0) as positions_with_aep,
    (SELECT COUNT(*) FROM open_positions WHERE entry_mode = 'IMPORTED') as positions_marked_imported,
    (SELECT COUNT(*) FROM order_intents WHERE client_order_id LIKE 'legacy-backfill-%') as new_intents_created,
    (SELECT COUNT(*) FROM trades WHERE order_intent_id IS NOT NULL) as trades_with_intent_link;
