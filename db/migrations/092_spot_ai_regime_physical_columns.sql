-- 092_spot_ai_regime_physical_columns.sql
-- R16: Add physical regime/direction columns to avoid TOAST decompression.
--
-- Purpose:
--   The regimes aggregation query (GET /api/spot/ai/dataset/regimes) takes ~42s
--   because it must decompress the JSONB `data` column (TOAST ~2GB) for every
--   SCAN row. Migration 091's expression index did NOT help because the planner
--   still needs heap fetches for the GROUP BY expressions.
--
--   This migration adds three nullable physical columns:
--     regime                       TEXT      — projected regime string
--     direction                    TEXT      — projected direction string
--     regime_projection_version    SMALLINT  — 1 = projected, NULL = pending/other
--
--   The columns are nullable and have NO default, so the existing R14 app
--   can continue inserting snapshots without knowing about them.
--
--   Backfill is performed by a SEPARATE dedicated runner (not in this migration)
--   to avoid running a ~42s JSONB scan inside a DDL transaction.
--
-- Compatibility:
--   - Additive only: no data modifications, no drops, no index creation.
--   - Old app remains compatible (columns default to NULL on old INSERTs).
--   - Can be applied via AutoMigrationRunner (no CREATE INDEX CONCURRENTLY).
--
-- This file contains exactly three ALTER TABLE statements (additive DDL).
-- No UPDATE, no DELETE, no DROP, no index, no VACUUM, no ANALYZE.

ALTER TABLE public.spot_forward_twin_snapshots
  ADD COLUMN regime TEXT;

ALTER TABLE public.spot_forward_twin_snapshots
  ADD COLUMN direction TEXT;

ALTER TABLE public.spot_forward_twin_snapshots
  ADD COLUMN regime_projection_version SMALLINT;
