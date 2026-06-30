-- Migration 061: Audit system — trade snapshots and timeline events
-- Creates tables for accumulating MFE/MAE snapshots and key lifecycle events.
-- Idempotent: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS.

-- ── audit_trade_snapshots ─────────────────────────────────────────────────────
-- Snapshot of a trade/cycle at a point in time.
-- Filled progressively (not retroactively) once hooks are in place.
CREATE TABLE IF NOT EXISTS audit_trade_snapshots (
  id               BIGSERIAL PRIMARY KEY,
  entity_type      TEXT        NOT NULL,  -- 'dry_run_trade' | 'idca_cycle'
  entity_id        INTEGER     NOT NULL,
  pair             TEXT        NOT NULL,
  ts               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  price            NUMERIC(20, 8),
  pnl_usd          NUMERIC(20, 8),
  pnl_pct          NUMERIC(10, 4),
  max_pnl_usd_so_far NUMERIC(20, 8),
  min_pnl_usd_so_far NUMERIC(20, 8),
  be_active        BOOLEAN,
  trailing_active  BOOLEAN,
  grid_state       TEXT,
  regime           TEXT,
  raw_json         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_snapshots_entity
  ON audit_trade_snapshots (entity_type, entity_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_snapshots_pair_ts
  ON audit_trade_snapshots (pair, ts DESC);

-- ── audit_timeline_events ─────────────────────────────────────────────────────
-- Key lifecycle events for a trade or cycle.
-- entity_type: 'dry_run_trade' | 'idca_cycle'
-- event_type:  ENTRY | ADDITIONAL_BUY | MANUAL_BUY | BE_ARMED | TRAILING_ARMED |
--              MFE_UPDATED | CLOSED | GRID_CREATED | GRID_LEVEL_PLANNED |
--              REGIME_CHANGE | SMART_EXIT_SIGNAL | TIMESTOP | SCALE_OUT | EMERGENCY_SL
CREATE TABLE IF NOT EXISTS audit_timeline_events (
  id               SERIAL      PRIMARY KEY,
  entity_type      TEXT        NOT NULL,
  entity_id        INTEGER     NOT NULL,
  pair             TEXT        NOT NULL,
  ts               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type       TEXT        NOT NULL,
  description      TEXT,
  price            NUMERIC(20, 8),
  pnl_usd          NUMERIC(20, 8),
  is_critical      BOOLEAN     NOT NULL DEFAULT FALSE,
  raw_json         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_timeline_entity
  ON audit_timeline_events (entity_type, entity_id, ts ASC);
CREATE INDEX IF NOT EXISTS idx_audit_timeline_pair_ts
  ON audit_timeline_events (pair, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_timeline_event_type
  ON audit_timeline_events (event_type);

-- ── Retention function (safe, non-destructive of real data) ───────────────────
CREATE OR REPLACE FUNCTION cleanup_audit_tables(
  snapshot_retention_days INTEGER DEFAULT 365,
  timeline_noncritical_retention_days INTEGER DEFAULT 90
)
RETURNS TABLE(snapshots_deleted BIGINT, timeline_noncritical_deleted BIGINT) LANGUAGE plpgsql AS $$
DECLARE
  v_snapshots_del BIGINT := 0;
  v_timeline_del  BIGINT := 0;
BEGIN
  -- Delete old snapshots beyond retention
  DELETE FROM audit_trade_snapshots
  WHERE ts < NOW() - (snapshot_retention_days || ' days')::INTERVAL;
  GET DIAGNOSTICS v_snapshots_del = ROW_COUNT;

  -- Delete non-critical timeline events beyond retention
  DELETE FROM audit_timeline_events
  WHERE is_critical = FALSE
    AND ts < NOW() - (timeline_noncritical_retention_days || ' days')::INTERVAL;
  GET DIAGNOSTICS v_timeline_del = ROW_COUNT;

  RETURN QUERY SELECT v_snapshots_del, v_timeline_del;
END;
$$;
