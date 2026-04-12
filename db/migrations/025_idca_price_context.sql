-- Migration 025: Fix legacy dipReference values + IDCA price context tables
-- Date: 2026-04-12
-- Idempotent and safe for STG / PROD

-- ── 1. Migrate all legacy dip_reference values to 'hybrid' ─────────────
-- Covers: 'local_high', 'ema', or any other unknown value
UPDATE institutional_dca_asset_configs
  SET dip_reference = 'hybrid'
  WHERE dip_reference NOT IN ('hybrid', 'swing_high', 'window_high');

-- ── 2. Correct DEFAULT (was 'local_high', now 'hybrid') ────────────────
ALTER TABLE institutional_dca_asset_configs
  ALTER COLUMN dip_reference SET DEFAULT 'hybrid';

-- ── 3. Add CHECK constraint (idempotent) ───────────────────────────────
ALTER TABLE institutional_dca_asset_configs
  DROP CONSTRAINT IF EXISTS chk_dip_reference_valid;

ALTER TABLE institutional_dca_asset_configs
  ADD CONSTRAINT chk_dip_reference_valid
  CHECK (dip_reference IN ('hybrid', 'swing_high', 'window_high'));

-- ── 4. idca_price_context_snapshots ────────────────────────────────────
-- Daily context snapshots per pair and time bucket.
-- Retention policy: 365 days max, purged by LogRetentionScheduler.
-- Expected size: 4 buckets × 2 pairs × 365 days = 2,920 rows maximum.
CREATE TABLE IF NOT EXISTS idca_price_context_snapshots (
  id                      SERIAL PRIMARY KEY,
  pair                    TEXT NOT NULL,
  bucket                  TEXT NOT NULL,                   -- '7d', '30d', '90d', '180d'
  snapshot_date           DATE NOT NULL,                   -- 1 row per pair+bucket+day
  high_max                DECIMAL(18,8),                   -- max high in bucket window
  low_min                 DECIMAL(18,8),                   -- min low in bucket window
  p95_high                DECIMAL(18,8),                   -- P95 of highs
  avg_close               DECIMAL(18,8),                   -- mean of closes
  drawdown_from_high_pct  DECIMAL(8,4),                    -- % from high_max to last close
  range_position          DECIMAL(8,4),                    -- (close-low)/(high-low) in [0,1]
  source                  TEXT NOT NULL DEFAULT 'scheduled',
  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (pair, bucket, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_idca_ctx_snap_pair_bucket_date
  ON idca_price_context_snapshots (pair, bucket, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_idca_ctx_snap_created_at
  ON idca_price_context_snapshots (created_at);

-- ── 5. idca_price_context_static ───────────────────────────────────────
-- One permanent row per pair. Structural reference data.
-- 'high_2y' = honest label: max from ~720 daily candles (~2 years).
-- Not true ATH — Kraken OHLC is capped at 720 candles per request.
CREATE TABLE IF NOT EXISTS idca_price_context_static (
  id                        SERIAL PRIMARY KEY,
  pair                      TEXT NOT NULL UNIQUE,
  high_2y                   DECIMAL(18,8),                 -- max high ~2 years of daily data
  high_2y_time              TIMESTAMP,                     -- timestamp of high_2y
  low_2y                    DECIMAL(18,8),                 -- min low ~2 years
  low_2y_time               TIMESTAMP,                     -- timestamp of low_2y
  year_high                 DECIMAL(18,8),                 -- max high last 365 days
  year_low                  DECIMAL(18,8),                 -- min low last 365 days
  last_p95_90d              DECIMAL(18,8),
  last_p95_180d             DECIMAL(18,8),
  last_drawdown_90d_pct     DECIMAL(8,4),
  last_drawdown_180d_pct    DECIMAL(8,4),
  last_range_position_90d   DECIMAL(8,4),
  last_range_position_180d  DECIMAL(8,4),
  updated_at                TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idca_ctx_static_pair
  ON idca_price_context_static (pair);
