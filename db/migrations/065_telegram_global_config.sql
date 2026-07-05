-- Migration 065: Telegram Global Config & Alert Events Audit
-- Creates telegram_global_config (kill switch, dedupe, rate-limit, quiet hours)
-- Creates telegram_alert_events (audit of sent/blocked/failed messages)

-- ============================================================
-- telegram_global_config: single-row config table
-- ============================================================
CREATE TABLE IF NOT EXISTS telegram_global_config (
  id SERIAL PRIMARY KEY,
  -- Kill switch
  telegram_global_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  telegram_silent_mode BOOLEAN NOT NULL DEFAULT FALSE,
  telegram_min_severity TEXT NOT NULL DEFAULT 'LOW',
  -- Dedupe / rate-limit
  telegram_default_dedupe_minutes INTEGER NOT NULL DEFAULT 5,
  telegram_default_rate_limit_per_hour INTEGER NOT NULL DEFAULT 30,
  -- Quiet hours (JSONB: { enabled, start, end, timezone })
  telegram_quiet_hours_config JSONB NOT NULL DEFAULT '{"enabled": false, "start": "22:00", "end": "08:00", "timezone": "Europe/Madrid"}',
  -- Environment label
  telegram_environment_label TEXT NOT NULL DEFAULT 'staging',
  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Insert default row if not exists
INSERT INTO telegram_global_config (id, telegram_global_enabled)
SELECT 1, TRUE
WHERE NOT EXISTS (SELECT 1 FROM telegram_global_config WHERE id = 1);

-- ============================================================
-- telegram_alert_events: audit log for all Telegram messages
-- ============================================================
CREATE TABLE IF NOT EXISTS telegram_alert_events (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  environment TEXT,
  source_module TEXT,
  mode TEXT,
  alert_type TEXT,
  severity TEXT,
  pair TEXT,
  cycle_id TEXT,
  position_id TEXT,
  dry_run_id TEXT,
  chat_id TEXT,
  channel_id INTEGER,
  dedupe_key TEXT,
  payload_hash TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  block_reason TEXT,
  sent_at TIMESTAMP,
  failed_at TIMESTAMP,
  error_message TEXT,
  natural_message TEXT,
  technical_details_json JSONB,
  raw_payload_json JSONB
);

-- Index for querying recent events
CREATE INDEX IF NOT EXISTS idx_telegram_alert_events_timestamp ON telegram_alert_events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_alert_events_status ON telegram_alert_events (status);
CREATE INDEX IF NOT EXISTS idx_telegram_alert_events_dedupe_key ON telegram_alert_events (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_telegram_alert_events_chat_id ON telegram_alert_events (chat_id);
CREATE INDEX IF NOT EXISTS idx_telegram_alert_events_source_module ON telegram_alert_events (source_module);

-- ============================================================
-- telegram_command_log: audit log for Telegram commands
-- ============================================================
CREATE TABLE IF NOT EXISTS telegram_command_log (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  chat_id TEXT NOT NULL,
  command TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  -- received | authorized | unauthorized | executed | blocked | failed
  is_authorized BOOLEAN NOT NULL DEFAULT FALSE,
  permission_level TEXT,
  response_message TEXT,
  error_message TEXT,
  execution_time_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_telegram_command_log_timestamp ON telegram_command_log (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_command_log_chat_id ON telegram_command_log (chat_id);
CREATE INDEX IF NOT EXISTS idx_telegram_command_log_status ON telegram_command_log (status);
