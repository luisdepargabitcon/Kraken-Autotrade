-- Add exchange column to trade_fills for cross-exchange safe FIFO lot matching

ALTER TABLE trade_fills
  ADD COLUMN IF NOT EXISTS exchange TEXT NOT NULL DEFAULT 'kraken';

UPDATE trade_fills
  SET exchange = COALESCE(exchange, 'kraken')
  WHERE exchange IS NULL;
