-- 049_spot_forward_twin.sql — Forward Twin telemetry table.
-- Append-only storage for scan/supervisor/fill snapshots.
-- NOT applied automatically — create manually or on deploy.

CREATE TABLE IF NOT EXISTS spot_forward_twin_snapshots (
  id              SERIAL PRIMARY KEY,
  schema_version  INTEGER     NOT NULL DEFAULT 1,
  snapshot_type   TEXT        NOT NULL CHECK (snapshot_type IN ('SCAN', 'SUPERVISOR', 'FILL')),
  scan_id         TEXT        NOT NULL,
  timestamp       BIGINT      NOT NULL,
  pair            TEXT        NOT NULL,
  policy_version  TEXT        NOT NULL,
  execution_mode  TEXT        NOT NULL,
  engine_owner    TEXT        NOT NULL,
  data            JSONB       NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for replay queries
CREATE INDEX IF NOT EXISTS idx_ft_timestamp_pair ON spot_forward_twin_snapshots (timestamp, pair);
CREATE INDEX IF NOT EXISTS idx_ft_pair_type      ON spot_forward_twin_snapshots (pair, snapshot_type);
CREATE INDEX IF NOT EXISTS idx_ft_scan_id         ON spot_forward_twin_snapshots (scan_id);

-- Retention: entries older than 7 days are auto-deleted by the collector flush.
-- This migration does NOT backfill or transform existing data.
