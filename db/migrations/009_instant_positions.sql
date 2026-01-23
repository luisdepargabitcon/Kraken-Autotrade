-- Migration 009: Instant Position Creation with Average Entry Price
-- Adds fields for PENDING_FILL state, order tracking, and cost aggregation

-- 1. Add status column for position lifecycle (PENDING_FILL → OPEN → CLOSED)
ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'OPEN';

-- 2. Add client_order_id for linking position to specific order (UNIQUE constraint)
ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS client_order_id VARCHAR(255);

-- 3. Add order_intent_id foreign key
ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS order_intent_id INTEGER;

-- 4. Add expected_amount (what we requested, before fills confirm)
ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS expected_amount DECIMAL(18, 8);

-- 5. Add cost aggregation fields for average entry price calculation
-- total_cost_quote = Σ (fill.amount * fill.price) in quote currency (e.g., USD)
ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS total_cost_quote DECIMAL(18, 8) DEFAULT 0;

-- total_amount_base = Σ fill.amount in base currency (e.g., TON)
ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS total_amount_base DECIMAL(18, 8) DEFAULT 0;

-- average_entry_price = total_cost_quote / total_amount_base (coste medio)
ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS average_entry_price DECIMAL(18, 8);

-- 6. Add fill tracking
ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS fill_count INTEGER DEFAULT 0;
ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS last_fill_id TEXT;
ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS first_fill_at TIMESTAMP;
ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS last_fill_at TIMESTAMP;

-- 7. Create unique index on client_order_id (for upsert)
CREATE UNIQUE INDEX IF NOT EXISTS idx_open_positions_client_order_id 
ON open_positions(client_order_id) WHERE client_order_id IS NOT NULL;

-- 8. Create index on status for filtering
CREATE INDEX IF NOT EXISTS idx_open_positions_status ON open_positions(status);

-- 9. Create index on order_intent_id
CREATE INDEX IF NOT EXISTS idx_open_positions_order_intent_id 
ON open_positions(order_intent_id) WHERE order_intent_id IS NOT NULL;

-- 10. Ensure trades table has unique constraint on trade_id per exchange
-- (may already exist, but ensure it)
CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_trade_id_exchange 
ON trades(exchange, "tradeId") WHERE "tradeId" IS NOT NULL;

-- 11. Add position_id to trades for linking fills to positions
ALTER TABLE trades ADD COLUMN IF NOT EXISTS position_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_trades_position_id ON trades(position_id) WHERE position_id IS NOT NULL;

-- 12. Update existing positions to have status = 'OPEN' and calculate aggregates
UPDATE open_positions 
SET status = 'OPEN',
    total_cost_quote = COALESCE(entry_price * amount, 0),
    total_amount_base = COALESCE(amount, 0),
    average_entry_price = entry_price
WHERE status IS NULL OR status = '';

-- Comments
COMMENT ON COLUMN open_positions.status IS 'Position lifecycle: PENDING_FILL, OPEN, FAILED, CANCELLED';
COMMENT ON COLUMN open_positions.client_order_id IS 'UUID linking position to order_intent for idempotent upsert';
COMMENT ON COLUMN open_positions.total_cost_quote IS 'Sum of (fill.amount * fill.price) in quote currency';
COMMENT ON COLUMN open_positions.total_amount_base IS 'Sum of fill.amount in base currency';
COMMENT ON COLUMN open_positions.average_entry_price IS 'Coste medio = total_cost_quote / total_amount_base';
