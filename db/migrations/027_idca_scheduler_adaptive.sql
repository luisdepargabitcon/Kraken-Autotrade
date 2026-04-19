-- 027_idca_scheduler_adaptive.sql
-- FASE 8 — Adaptive scheduler for IDCA module. The engine used to tick every
-- schedulerIntervalSeconds (default 60s) regardless of whether any cycle was
-- active. This migration introduces 3 state-aware intervals so the module can
-- sleep longer when idle and wake up faster when protecting an exit.
--
-- Semantics:
--   idle       → no active cycles for any allowed pair
--   active     → at least one active cycle (any subtype/status)
--   protected  → at least one cycle with status IN ('tp_armed','trailing_active')
--                 or protection_armed_at IS NOT NULL (close to sell event)

ALTER TABLE institutional_dca_config
  ADD COLUMN IF NOT EXISTS scheduler_idle_seconds       INTEGER NOT NULL DEFAULT 900,   -- 15 min
  ADD COLUMN IF NOT EXISTS scheduler_active_seconds     INTEGER NOT NULL DEFAULT 300,   --  5 min
  ADD COLUMN IF NOT EXISTS scheduler_protected_seconds  INTEGER NOT NULL DEFAULT 120;   --  2 min

-- Keep the legacy schedulerIntervalSeconds column as a fallback (used only if
-- the 3 new columns are somehow not set).
