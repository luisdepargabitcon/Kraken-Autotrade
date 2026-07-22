-- Migration 079: add independent forensic review columns to grid_isolated_cycles.
-- These columns hold the audit state when JSONB fields (risk/maker/target) are
-- invalid, preserving the original raw JSON for manual inspection and blocking
-- automatic transitions.

ALTER TABLE grid_isolated_cycles
  ADD COLUMN IF NOT EXISTS requires_review BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS review_reason TEXT,
  ADD COLUMN IF NOT EXISTS review_code TEXT,
  ADD COLUMN IF NOT EXISTS review_detected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_source TEXT;

-- Index to quickly locate cycles that need manual forensic review.
CREATE INDEX IF NOT EXISTS idx_grid_cycles_requires_review
  ON grid_isolated_cycles (requires_review)
  WHERE requires_review = TRUE;
