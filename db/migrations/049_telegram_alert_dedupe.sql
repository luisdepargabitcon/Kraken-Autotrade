-- Migration 049: Telegram Alert Deduplication Table
-- Prevents spam of repetitive alerts (especially SMART EXIT suppressed)
-- Uses logical fingerprint instead of exact message hash

CREATE TABLE IF NOT EXISTS telegram_alert_dedupe (
  id SERIAL PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  module TEXT NOT NULL,
  pair TEXT,
  position_id TEXT,
  last_sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
  suppressed_count INTEGER DEFAULT 0,
  first_suppressed_at TIMESTAMP WITH TIME ZONE,
  last_payload_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookup by fingerprint
CREATE INDEX IF NOT EXISTS idx_telegram_alert_dedupe_fingerprint ON telegram_alert_dedupe(fingerprint);

-- Index for cleanup of old entries
CREATE INDEX IF NOT EXISTS idx_telegram_alert_dedupe_last_sent ON telegram_alert_dedupe(last_sent_at);

-- Index for queries by module/pair
CREATE INDEX IF NOT EXISTS idx_telegram_alert_dedupe_module_pair ON telegram_alert_dedupe(module, pair);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_telegram_alert_dedupe_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_telegram_alert_dedupe_updated_at ON telegram_alert_dedupe;
CREATE TRIGGER trigger_update_telegram_alert_dedupe_updated_at
  BEFORE UPDATE ON telegram_alert_dedupe
  FOR EACH ROW
  EXECUTE FUNCTION update_telegram_alert_dedupe_updated_at();

-- Cleanup function for old entries (older than 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_telegram_alert_dedupe()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM telegram_alert_dedupe
  WHERE last_sent_at < NOW() - INTERVAL '7 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
