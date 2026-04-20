-- Migration 029: Persistent VWAP anchor memory for Institutional DCA
-- Survives server restarts; anchor only goes up, never down.

CREATE TABLE IF NOT EXISTS idca_vwap_anchors (
  pair              VARCHAR(20) PRIMARY KEY,
  anchor_price      DECIMAL(20, 8) NOT NULL,
  anchor_ts         BIGINT NOT NULL,
  set_at            BIGINT NOT NULL,
  drawdown_pct      DECIMAL(10, 4) NOT NULL DEFAULT 0,
  prev_price        DECIMAL(20, 8),
  prev_ts           BIGINT,
  prev_set_at       BIGINT,
  prev_replaced_at  BIGINT,
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
