-- FISCO Auto Sync Retry Fields
-- Add fields to support automatic retry scheduling with cron checks

ALTER TABLE fisco_auto_sync_jobs
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS retry_group_id UUID,
  ADD COLUMN IF NOT EXISTS parent_job_id INTEGER REFERENCES fisco_auto_sync_jobs(id);

-- Index for retry scheduling queries
CREATE INDEX IF NOT EXISTS idx_fisco_auto_sync_jobs_next_retry_at
  ON fisco_auto_sync_jobs(next_retry_at)
  WHERE next_retry_at IS NOT NULL;

-- Index for retry group queries
CREATE INDEX IF NOT EXISTS idx_fisco_auto_sync_jobs_retry_group_id
  ON fisco_auto_sync_jobs(retry_group_id)
  WHERE retry_group_id IS NOT NULL;
