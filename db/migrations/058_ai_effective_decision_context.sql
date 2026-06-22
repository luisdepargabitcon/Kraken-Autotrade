-- 058_ai_effective_decision_context.sql
-- Adds effective_decision_context_json JSONB column to all AI/Shadow/DryRun/Training tables.
-- This column captures the FULL effective configuration context used at decision time:
-- signals, cooldowns, hybrid guard, smart guard, entry filters, regime, risk, market, exit policy.
-- Tracked by AutoMigrationRunner — idempotent via IF NOT EXISTS.

-- AI Shadow decisions (primary — populated on every shadow evaluation)
ALTER TABLE ai_shadow_decisions
  ADD COLUMN IF NOT EXISTS effective_decision_context_json JSONB;

-- Trade snapshots (populated at entry for REAL / DRY_RUN / SHADOW / IDCA_SIMULATION)
ALTER TABLE trade_snapshots
  ADD COLUMN IF NOT EXISTS effective_decision_context_json JSONB;

-- Dry run trades (populated when a simulated BUY/SELL is recorded)
ALTER TABLE dry_run_trades
  ADD COLUMN IF NOT EXISTS effective_decision_context_json JSONB;

-- Training trades (populated at backfill or real-time for labeled samples)
ALTER TABLE training_trades
  ADD COLUMN IF NOT EXISTS effective_decision_context_json JSONB;

-- Indexes for analytics queries filtering by context fields
CREATE INDEX IF NOT EXISTS ai_shadow_decisions_edc_idx
  ON ai_shadow_decisions USING gin (effective_decision_context_json jsonb_path_ops);

CREATE INDEX IF NOT EXISTS trade_snapshots_edc_idx
  ON trade_snapshots USING gin (effective_decision_context_json jsonb_path_ops);
