BEGIN;

CREATE TABLE IF NOT EXISTS exchange_sync_state (
  exchange TEXT NOT NULL,
  scope TEXT NOT NULL,
  cursor_type TEXT NOT NULL,
  cursor_value TIMESTAMPTZ NULL,
  last_run_at TIMESTAMPTZ NULL,
  last_ok_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  PRIMARY KEY (exchange, scope)
);

COMMIT;
