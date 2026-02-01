-- Migration 012: Hybrid Guard metadata in order_intents
-- Purpose: Persist Hybrid Guard watch attribution for BUY re-entries.

ALTER TABLE order_intents ADD COLUMN IF NOT EXISTS hybrid_guard_watch_id INTEGER;
ALTER TABLE order_intents ADD COLUMN IF NOT EXISTS hybrid_guard_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_order_intents_hybrid_guard_watch_id ON order_intents(hybrid_guard_watch_id);
