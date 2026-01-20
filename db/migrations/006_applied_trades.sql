CREATE TABLE IF NOT EXISTS applied_trades (
  id SERIAL PRIMARY KEY,
  exchange TEXT NOT NULL,
  pair TEXT NOT NULL,
  trade_id TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS applied_trades_exchange_pair_trade_id_idx
  ON applied_trades (exchange, pair, trade_id);
