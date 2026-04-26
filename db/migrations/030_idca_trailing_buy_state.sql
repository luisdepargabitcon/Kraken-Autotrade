-- Migration 030: Persistent anti-spam state for Trailing Buy Telegram notifications
-- Survives server restarts so ARMED is not re-sent after restart without real state change.

CREATE TABLE IF NOT EXISTS idca_trailing_buy_telegram_state (
  pair                        VARCHAR(20)  NOT NULL,
  mode                        VARCHAR(20)  NOT NULL,
  state                       VARCHAR(20)  NOT NULL DEFAULT 'idle',
  last_notified_at            BIGINT,
  last_notified_best_price    DECIMAL(20, 8),
  last_notified_state         VARCHAR(20),
  armed_at                    BIGINT,
  trigger_price               DECIMAL(20, 8),
  local_low                   DECIMAL(20, 8),
  cancelled_at                BIGINT,
  rearm_allowed_after         BIGINT,
  updated_at                  TIMESTAMP    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pair, mode)
);

CREATE INDEX IF NOT EXISTS idx_idca_tb_state_pair_mode ON idca_trailing_buy_telegram_state (pair, mode);
