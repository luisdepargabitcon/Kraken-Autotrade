-- Migration: Hybrid Re-Entry Watches
-- Purpose: Store temporary watches created when a BUY is rejected by Anti-Crest or MTF-Strict filters,
-- to allow a second chance (re-entry) when conditions improve (pullback to EMA20 or MTF confirmation).

CREATE TABLE IF NOT EXISTS hybrid_reentry_watches (
  id SERIAL PRIMARY KEY,
  exchange VARCHAR(32) NOT NULL,
  pair VARCHAR(24) NOT NULL,
  strategy VARCHAR(64) NOT NULL,

  reason VARCHAR(32) NOT NULL, -- 'ANTI_CREST' | 'MTF_STRICT'
  status VARCHAR(16) NOT NULL DEFAULT 'active', -- active|triggered|expired|cancelled

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,

  scan_id VARCHAR(64),
  regime VARCHAR(24),
  raw_signal VARCHAR(16),

  reject_price NUMERIC,
  ema20 NUMERIC,
  price_vs_ema20_pct NUMERIC,
  volume_ratio NUMERIC,
  mtf_alignment NUMERIC,
  signals_count INTEGER,
  min_signals_required INTEGER,

  meta JSONB DEFAULT '{}'::jsonb
);

-- Index for efficient active watch lookup during scans
CREATE INDEX IF NOT EXISTS idx_hybrid_watches_active
  ON hybrid_reentry_watches(exchange, pair, status, expires_at);

-- Index for cleanup of expired watches
CREATE INDEX IF NOT EXISTS idx_hybrid_watches_expires_at
  ON hybrid_reentry_watches(expires_at) WHERE status = 'active';

-- Optional: Index to avoid duplicate recent watches (cooldown)
CREATE INDEX IF NOT EXISTS idx_hybrid_watches_recent
  ON hybrid_reentry_watches(exchange, pair, created_at) WHERE status = 'active';
