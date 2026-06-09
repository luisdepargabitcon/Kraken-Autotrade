-- FISCO Auto Sync Jobs
-- Table to track automatic daily FISCO synchronization jobs with retry logic

CREATE TABLE IF NOT EXISTS fisco_auto_sync_jobs (
  id SERIAL PRIMARY KEY,
  scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  timezone VARCHAR(50) NOT NULL DEFAULT 'Europe/Madrid',
  attempt_number INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, running, success, success_with_warnings, failed, skipped_no_changes
  exchanges_synced JSONB, -- Array of exchange names synced
  new_operations_count INTEGER DEFAULT 0,
  new_operations_by_exchange JSONB, -- { kraken: { total: 10, buys: 5, sells: 3, others: 2 }, revolutx: { ... } }
  dry_run_id INTEGER,
  commit_run_id INTEGER,
  finalization_status JSONB,
  portfolio_status JSONB,
  warnings JSONB, -- Array of warning objects
  error_message TEXT,
  telegram_sent BOOLEAN DEFAULT false,
  telegram_message_id BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_fisco_auto_sync_jobs_scheduled_for ON fisco_auto_sync_jobs(scheduled_for DESC);
CREATE INDEX idx_fisco_auto_sync_jobs_status ON fisco_auto_sync_jobs(status);
CREATE INDEX idx_fisco_auto_sync_jobs_attempt ON fisco_auto_sync_jobs(attempt_number);
CREATE INDEX idx_fisco_auto_sync_jobs_date ON fisco_auto_sync_jobs(DATE(scheduled_for AT TIME ZONE 'Europe/Madrid'));

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_fisco_auto_sync_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_fisco_auto_sync_jobs_updated_at
  BEFORE UPDATE ON fisco_auto_sync_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_fisco_auto_sync_jobs_updated_at();

-- Constraint: only one pending/running job per day
CREATE UNIQUE INDEX idx_fisco_auto_sync_jobs_unique_pending_day
  ON fisco_auto_sync_jobs(DATE(scheduled_for AT TIME ZONE 'Europe/Madrid'))
  WHERE status IN ('pending', 'running');
