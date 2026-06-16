-- Migration 050: add UUID rebuild references and failed_commit status to fisco_auto_sync_jobs
-- Also adds watchdog: marks stale running rebuild runs as failed_stale

-- 1. Add UUID columns to fisco_auto_sync_jobs (keep old integer columns for compatibility)
ALTER TABLE fisco_auto_sync_jobs
  ADD COLUMN IF NOT EXISTS dry_run_rebuild_id UUID,
  ADD COLUMN IF NOT EXISTS commit_rebuild_id  UUID;

-- 2. Add failed_commit to the status check constraint if one exists (safe: no existing constraint)
-- (status is VARCHAR, no enum constraint to modify)

-- 3. Watchdog function: mark stale rebuild runs
CREATE OR REPLACE FUNCTION fisco_mark_stale_rebuilds()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE fisco_rebuild_runs
  SET
    status       = 'failed_stale',
    completed_at = NOW(),
    errors_json  = jsonb_build_array(
      jsonb_build_object(
        'code',    'STALE_REBUILD_TIMEOUT',
        'phase',   'unknown',
        'message', 'Rebuild run exceeded 15-minute timeout without completing',
        'detail',  'started_at=' || started_at::text
      )
    )
  WHERE status = 'running'
    AND started_at < NOW() - INTERVAL '15 minutes';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Run immediately to clean up any existing stale runs
SELECT fisco_mark_stale_rebuilds();
