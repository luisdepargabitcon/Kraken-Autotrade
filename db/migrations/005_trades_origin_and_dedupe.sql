ALTER TABLE trades ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'sync';

DO $$
BEGIN
  ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_trade_id_key;
EXCEPTION
  WHEN undefined_table THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE trades ADD CONSTRAINT trades_exchange_pair_trade_id_key UNIQUE (exchange, pair, trade_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_trades_exchange_origin_executed_at ON trades(exchange, origin, executed_at);
CREATE INDEX IF NOT EXISTS idx_trades_origin_executed_at ON trades(origin, executed_at);
