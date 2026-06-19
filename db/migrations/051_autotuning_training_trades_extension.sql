-- 051_autotuning_training_trades_extension.sql
-- Extends training_trades with sourceMode, evidenceWeight, exitReason, MFE/MAE, regime
-- Tracked by AutoMigrationRunner — idempotent via IF NOT EXISTS

ALTER TABLE training_trades ADD COLUMN IF NOT EXISTS source_mode       TEXT         NOT NULL DEFAULT 'REAL';
ALTER TABLE training_trades ADD COLUMN IF NOT EXISTS source_trade_id   TEXT;
ALTER TABLE training_trades ADD COLUMN IF NOT EXISTS source_table      TEXT         NOT NULL DEFAULT 'trades';
ALTER TABLE training_trades ADD COLUMN IF NOT EXISTS evidence_weight   DECIMAL(4,3) NOT NULL DEFAULT 1.000;
ALTER TABLE training_trades ADD COLUMN IF NOT EXISTS exit_reason       TEXT;
ALTER TABLE training_trades ADD COLUMN IF NOT EXISTS exit_category     TEXT;
ALTER TABLE training_trades ADD COLUMN IF NOT EXISTS was_time_stop     BOOLEAN      NOT NULL DEFAULT FALSE;
ALTER TABLE training_trades ADD COLUMN IF NOT EXISTS regime            TEXT;
ALTER TABLE training_trades ADD COLUMN IF NOT EXISTS config_snapshot_json JSONB;
ALTER TABLE training_trades ADD COLUMN IF NOT EXISTS mfe_pct           DECIMAL(8,4);
ALTER TABLE training_trades ADD COLUMN IF NOT EXISTS mae_pct           DECIMAL(8,4);
ALTER TABLE training_trades ADD COLUMN IF NOT EXISTS max_drawdown_pct  DECIMAL(8,4);
ALTER TABLE training_trades ADD COLUMN IF NOT EXISTS session_label     TEXT;
ALTER TABLE training_trades ADD COLUMN IF NOT EXISTS entry_score       DECIMAL(6,3);
ALTER TABLE training_trades ADD COLUMN IF NOT EXISTS trade_quality_score INTEGER;

CREATE INDEX IF NOT EXISTS idx_tt_source_mode      ON training_trades(source_mode);
CREATE INDEX IF NOT EXISTS idx_tt_was_time_stop    ON training_trades(was_time_stop) WHERE was_time_stop = TRUE;
CREATE INDEX IF NOT EXISTS idx_tt_exit_reason      ON training_trades(exit_reason)   WHERE exit_reason IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tt_regime           ON training_trades(regime)         WHERE regime IS NOT NULL;

-- Backfill existing rows as REAL source
UPDATE training_trades
SET
  source_mode    = 'REAL',
  source_table   = 'trades',
  evidence_weight = 1.000
WHERE source_mode = 'REAL'
  AND source_table = 'trades';
