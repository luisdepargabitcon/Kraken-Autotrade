-- Migration 049: Add current_phase field to fisco_auto_sync_jobs for tracking job progress
-- This allows detecting where a job gets stuck

-- Add current_phase column
ALTER TABLE fisco_auto_sync_jobs
ADD COLUMN IF NOT EXISTS current_phase VARCHAR(80);

-- Add index for watchdog queries
CREATE INDEX IF NOT EXISTS idx_fisco_auto_sync_current_phase
ON fisco_auto_sync_jobs(current_phase);

-- Add index for running jobs watchdog
CREATE INDEX IF NOT EXISTS idx_fisco_auto_sync_running_started
ON fisco_auto_sync_jobs(status, started_at)
WHERE status = 'running';
