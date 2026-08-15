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

-- R10.3: Add spot_real_reserved_capital_usd to bot_config for REAL concurrency reservation
ALTER TABLE bot_config
  ADD COLUMN IF NOT EXISTS spot_real_reserved_capital_usd DECIMAL(18, 2) DEFAULT 0;

-- R10.3: Index for uncertain status lookups
CREATE INDEX IF NOT EXISTS idx_order_intents_uncertain_provenance
  ON order_intents(status, engine_owner, policy_version)
  WHERE status = 'uncertain' AND engine_owner IS NOT NULL;

-- R10.4: Durable per-intent reservation — stores the exact quote amount reserved
ALTER TABLE order_intents
  ADD COLUMN IF NOT EXISTS reserved_quote_usd DECIMAL(18, 8);

-- R10.4: Index for reconciliation — find pending/uncertain REAL intents by provenance
CREATE INDEX IF NOT EXISTS idx_order_intents_reconcile_provenance
  ON order_intents(status, execution_mode, engine_owner, policy_version)
  WHERE status IN ('pending', 'accepted', 'uncertain')
    AND engine_owner IS NOT NULL;

-- R10.4: Index for reservation lookup by internal_intent_id
CREATE INDEX IF NOT EXISTS idx_order_intents_reserved_quote
  ON order_intents(internal_intent_id, reserved_quote_usd)
  WHERE reserved_quote_usd IS NOT NULL;
