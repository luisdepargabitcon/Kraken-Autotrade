-- Migration 087: SPOT Canonical Engine — order_intents provenance columns
--
-- Adds columns to order_intents for SPOT CANONICAL positive provenance:
--   internal_intent_id, engine_owner, policy_version, execution_mode,
--   lot_id, requested_price, order_type, reason, fill_price, fill_volume, fee_usd
--
-- Also adds a unique constraint on internal_intent_id for idempotency.
--
-- Properties: additive, idempotent, no DROP, no TRUNCATE, no DELETE.
-- Safe to re-run. Legacy rows remain NULL — filtered by positive provenance.

ALTER TABLE order_intents
  ADD COLUMN IF NOT EXISTS internal_intent_id TEXT;
ALTER TABLE order_intents
  ADD COLUMN IF NOT EXISTS engine_owner TEXT;
ALTER TABLE order_intents
  ADD COLUMN IF NOT EXISTS policy_version TEXT;
ALTER TABLE order_intents
  ADD COLUMN IF NOT EXISTS execution_mode TEXT;
ALTER TABLE order_intents
  ADD COLUMN IF NOT EXISTS lot_id TEXT;
ALTER TABLE order_intents
  ADD COLUMN IF NOT EXISTS requested_price DECIMAL(18, 8);
ALTER TABLE order_intents
  ADD COLUMN IF NOT EXISTS order_type TEXT;
ALTER TABLE order_intents
  ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE order_intents
  ADD COLUMN IF NOT EXISTS fill_price DECIMAL(18, 8);
ALTER TABLE order_intents
  ADD COLUMN IF NOT EXISTS fill_volume DECIMAL(18, 8);
ALTER TABLE order_intents
  ADD COLUMN IF NOT EXISTS fee_usd DECIMAL(18, 8);

-- Unique constraint on internal_intent_id for idempotency guard
-- Only enforces where internal_intent_id IS NOT NULL (partial index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_intents_internal_intent_id_unique
  ON order_intents(internal_intent_id)
  WHERE internal_intent_id IS NOT NULL;

-- Index for SPOT CANONICAL provenance filtering
CREATE INDEX IF NOT EXISTS idx_order_intents_engine_owner_policy
  ON order_intents(engine_owner, policy_version, execution_mode, status);

-- Index for pending status lookup by provenance
CREATE INDEX IF NOT EXISTS idx_order_intents_status_provenance
  ON order_intents(status, engine_owner, execution_mode)
  WHERE engine_owner IS NOT NULL;
