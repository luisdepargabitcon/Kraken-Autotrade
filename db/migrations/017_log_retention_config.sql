-- 017_log_retention_config.sql
-- Adds log retention configuration columns to bot_config
-- Enables auto-managed daily purge of server_logs and bot_events from the UI
ALTER TABLE bot_config
  ADD COLUMN IF NOT EXISTS log_retention_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS log_retention_days INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS events_retention_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS events_retention_days INTEGER NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS last_log_purge_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_log_purge_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_events_purge_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_events_purge_count INTEGER DEFAULT 0;
