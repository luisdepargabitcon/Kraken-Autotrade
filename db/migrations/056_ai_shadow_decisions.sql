-- 056_ai_shadow_decisions.sql
-- Tabla de predicciones shadow del módulo de inteligencia artificial.
-- Registra cada evaluación BUY evaluada por la IA en modo observador.
-- Tracked by AutoMigrationRunner — idempotent via IF NOT EXISTS
--
-- Schema Drizzle base (shared/schema.ts):
--   id, trade_id, ts, score, threshold, would_block, final_pnl_net
-- Esta migración crea la tabla completa y añade columnas extendidas si faltan.

CREATE TABLE IF NOT EXISTS ai_shadow_decisions (
  id                  SERIAL        PRIMARY KEY,
  trade_id            TEXT          NOT NULL,
  ts                  TIMESTAMP     DEFAULT NOW(),
  score               DECIMAL(5,4)  NOT NULL DEFAULT 0,
  threshold           DECIMAL(5,4)  NOT NULL DEFAULT 0.6,
  would_block         BOOLEAN       NOT NULL DEFAULT FALSE,
  final_pnl_net       DECIMAL(18,8)
);

-- Extended columns (added idempotently)
ALTER TABLE ai_shadow_decisions ADD COLUMN IF NOT EXISTS pair               TEXT;
ALTER TABLE ai_shadow_decisions ADD COLUMN IF NOT EXISTS signal             TEXT;
ALTER TABLE ai_shadow_decisions ADD COLUMN IF NOT EXISTS action             TEXT;
ALTER TABLE ai_shadow_decisions ADD COLUMN IF NOT EXISTS confidence         DECIMAL(6,4);
ALTER TABLE ai_shadow_decisions ADD COLUMN IF NOT EXISTS would_allow        BOOLEAN    NOT NULL DEFAULT FALSE;
ALTER TABLE ai_shadow_decisions ADD COLUMN IF NOT EXISTS reason             TEXT;
ALTER TABLE ai_shadow_decisions ADD COLUMN IF NOT EXISTS model_version      TEXT;
ALTER TABLE ai_shadow_decisions ADD COLUMN IF NOT EXISTS features_json      JSONB;
ALTER TABLE ai_shadow_decisions ADD COLUMN IF NOT EXISTS source_context_id  TEXT;
ALTER TABLE ai_shadow_decisions ADD COLUMN IF NOT EXISTS outcome_status     TEXT;
ALTER TABLE ai_shadow_decisions ADD COLUMN IF NOT EXISTS linked_trade_id    TEXT;
ALTER TABLE ai_shadow_decisions ADD COLUMN IF NOT EXISTS realized_pnl_usd   DECIMAL(18,8);
ALTER TABLE ai_shadow_decisions ADD COLUMN IF NOT EXISTS evaluated_at       TIMESTAMPTZ;
ALTER TABLE ai_shadow_decisions ADD COLUMN IF NOT EXISTS metadata_json      JSONB;

CREATE INDEX IF NOT EXISTS ai_shadow_decisions_ts_idx            ON ai_shadow_decisions (ts DESC);
CREATE INDEX IF NOT EXISTS ai_shadow_decisions_pair_idx          ON ai_shadow_decisions (pair);
CREATE INDEX IF NOT EXISTS ai_shadow_decisions_would_block_idx   ON ai_shadow_decisions (would_block);
CREATE INDEX IF NOT EXISTS ai_shadow_decisions_model_version_idx ON ai_shadow_decisions (model_version);
