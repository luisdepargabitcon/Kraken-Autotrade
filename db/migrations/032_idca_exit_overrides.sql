-- Migration 032: Per-cycle exit overrides (TimeStop disable per cycle)
-- Adds exitOverridesJson JSONB column to institutional_dca_cycles
-- Shape: { timeStopDisabled: bool, timeStopDisabledAt: ISO, timeStopDisabledBy: "manual" }
-- Safe: idempotent via IF NOT EXISTS

ALTER TABLE institutional_dca_cycles
  ADD COLUMN IF NOT EXISTS exit_overrides_json jsonb;

COMMENT ON COLUMN institutional_dca_cycles.exit_overrides_json IS
  'Per-cycle exit override toggles set via UI. Shape: { timeStopDisabled: bool, timeStopDisabledAt: string, timeStopDisabledBy: "manual" }';
