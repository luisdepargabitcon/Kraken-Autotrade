-- Migration 049: Add audit columns to dry_run_trades for SPOT DRY RUN cleanup
-- Date: 2026-06-17
-- Purpose: Enable marking legacy/erroneous dry-run trades as excluded from PnL calculations
--          without physically deleting them (audit trail preserved).

-- ============================================================
-- AUDIT COLUMNS
-- ============================================================

-- Column: excluded_from_pnl — marks trades that should not count toward PnL
ALTER TABLE dry_run_trades
  ADD COLUMN IF NOT EXISTS excluded_from_pnl BOOLEAN NOT NULL DEFAULT FALSE;

-- Column: exclusion_reason — human-readable reason for exclusion
ALTER TABLE dry_run_trades
  ADD COLUMN IF NOT EXISTS exclusion_reason TEXT;

-- Column: excluded_at — timestamp when exclusion was applied
ALTER TABLE dry_run_trades
  ADD COLUMN IF NOT EXISTS excluded_at TIMESTAMP;

-- Column: audit_batch_id — groups operations from a single cleanup batch
ALTER TABLE dry_run_trades
  ADD COLUMN IF NOT EXISTS audit_batch_id TEXT;

-- ============================================================
-- INDEXES for efficient filtering
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_dry_run_trades_excluded_from_pnl
  ON dry_run_trades(excluded_from_pnl)
  WHERE excluded_from_pnl = TRUE;

CREATE INDEX IF NOT EXISTS idx_dry_run_trades_audit_batch_id
  ON dry_run_trades(audit_batch_id);

-- ============================================================
-- BACKUP TABLE (empty schema — will be populated by cleanup script)
-- ============================================================

-- Archive table for exact duplicates removed during cleanup
CREATE TABLE IF NOT EXISTS dry_run_trades_archive (
  LIKE dry_run_trades INCLUDING ALL
);

-- Add archive-specific metadata columns
ALTER TABLE dry_run_trades_archive
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NOT NULL DEFAULT NOW();

ALTER TABLE dry_run_trades_archive
  ADD COLUMN IF NOT EXISTS archive_reason TEXT NOT NULL DEFAULT 'exact_duplicate';

ALTER TABLE dry_run_trades_archive
  ADD COLUMN IF NOT EXISTS original_id INTEGER; -- reference to canonical row kept

-- Index for archive lookups
CREATE INDEX IF NOT EXISTS idx_dry_run_trades_archive_batch_id
  ON dry_run_trades_archive(audit_batch_id);

-- ============================================================
-- VERIFICATION (idempotent — safe to re-run)
-- ============================================================

DO $$
DECLARE
  v_has_excluded BOOLEAN;
  v_has_archive BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dry_run_trades' AND column_name = 'excluded_from_pnl'
  ) INTO v_has_excluded;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'dry_run_trades_archive'
  ) INTO v_has_archive;

  IF v_has_excluded AND v_has_archive THEN
    RAISE NOTICE '[049] dry_run_trades audit columns and archive table OK';
  ELSE
    RAISE EXCEPTION '[049] Migration verification failed: missing audit columns or archive table';
  END IF;
END $$;
