-- Migration 076: composite index for active-range + status queries used by the
-- lifecycle engine (maxOpenCycles, open cycle scans, range-aware close checks).
-- Phase: 3C.5-A-REV-C3 follow-up
--
-- Idempotent: no data migration, only adds the index if missing.

CREATE INDEX IF NOT EXISTS idx_grid_cycles_range_status
  ON grid_isolated_cycles(range_version_id, status);
