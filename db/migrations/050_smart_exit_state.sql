-- Migration 050: Smart Exit State Machine
-- Persists state per pair + positionId to prevent spam
-- Only triggers Telegram on state transitions

CREATE TABLE IF NOT EXISTS smart_exit_state (
  id SERIAL PRIMARY KEY,
  pair TEXT NOT NULL,
  position_id TEXT NOT NULL,
  current_state TEXT NOT NULL,
  previous_state TEXT,
  state_changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_evaluation_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_score INTEGER,
  last_regime TEXT,
  last_pnl_pct NUMERIC(10, 4),
  last_suppression_reason TEXT,
  last_signals JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(pair, position_id)
);

-- Index for fast lookup by pair + position_id
CREATE INDEX IF NOT EXISTS idx_smart_exit_state_pair_position ON smart_exit_state(pair, position_id);

-- Index for cleanup of old entries (after position closed)
CREATE INDEX IF NOT EXISTS idx_smart_exit_state_updated ON smart_exit_state(updated_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_smart_exit_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_smart_exit_state_updated_at ON smart_exit_state;
CREATE TRIGGER trigger_update_smart_exit_state_updated_at
  BEFORE UPDATE ON smart_exit_state
  FOR EACH ROW
  EXECUTE FUNCTION update_smart_exit_state_updated_at();

-- Cleanup function for old entries (older than 30 days after last update)
CREATE OR REPLACE FUNCTION cleanup_old_smart_exit_state()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM smart_exit_state
  WHERE updated_at < NOW() - INTERVAL '30 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
