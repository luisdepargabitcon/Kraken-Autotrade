-- Migration 034: IDCA BTC/USD #22 — Fee/Dust Reset Hotfix
-- Context: BTC #22 was left in trailing_active after a sell failed due to
-- cycle.totalQuantity (0.00782637) slightly exceeding exchange available
-- balance (0.00781932) by fee/dust. Position is still open on exchange.
-- This migration reconciles totalQuantity and resets BE/trailing state.
-- Safe: idempotent via pre-conditions — only applies to the exact known case.

DO $$
DECLARE
  v_cycle record;
  v_old_qty numeric;
  v_new_qty numeric := 0.00781932;
  v_diff numeric;
BEGIN
  SELECT *
  INTO v_cycle
  FROM institutional_dca_cycles
  WHERE id = 22
    AND pair = 'BTC/USD';

  IF NOT FOUND THEN
    RAISE NOTICE '[034] BTC/USD #22 no existe. No se aplica corrección.';
    RETURN;
  END IF;

  v_old_qty := v_cycle.total_quantity::numeric;
  v_diff := ABS(v_old_qty - v_new_qty);

  -- If already corrected, no-op
  IF v_cycle.status = 'active'
     AND ABS(v_old_qty - v_new_qty) <= 0.00000002
     AND v_cycle.protection_armed_at IS NULL
     AND v_cycle.protection_stop_price IS NULL
     AND v_cycle.tp_armed_at IS NULL
     AND v_cycle.trailing_active_at IS NULL
     AND v_cycle.highest_price_after_tp IS NULL THEN

    RAISE NOTICE '[034] BTC/USD #22 ya está corregido. No-op.';
    RETURN;
  END IF;

  -- Precondition: only correct if status is active or trailing_active
  IF v_cycle.status NOT IN ('active', 'trailing_active') THEN
    RAISE NOTICE '[034] BTC/USD #22 status=% no es corregible automáticamente. No-op.', v_cycle.status;
    RETURN;
  END IF;

  IF v_old_qty <= 0 THEN
    RAISE NOTICE '[034] BTC/USD #22 total_quantity <= 0. No-op.';
    RETURN;
  END IF;

  -- Only apply if old qty matches the known problematic value (±0.00000020 tolerance)
  IF ABS(v_old_qty - 0.00782637) > 0.00000020 THEN
    RAISE NOTICE '[034] BTC/USD #22 total_quantity=% no coincide con el caso fee/dust esperado. No-op.', v_old_qty;
    RETURN;
  END IF;

  -- Only apply if the diff between old and new is small (fee/dust, not a real shortage)
  IF v_diff > 0.00001000 THEN
    RAISE NOTICE '[034] BTC/USD #22 diferencia demasiado grande: old=%, new=%, diff=%. No-op.', v_old_qty, v_new_qty, v_diff;
    RETURN;
  END IF;

  UPDATE institutional_dca_cycles
  SET
    status                  = 'active',
    total_quantity          = v_new_qty,
    protection_armed_at     = NULL,
    protection_stop_price   = NULL,
    tp_armed_at             = NULL,
    trailing_active_at      = NULL,
    highest_price_after_tp  = NULL,
    close_reason            = NULL,
    updated_at              = NOW(),
    last_manual_edit_at     = NOW(),
    last_manual_edit_reason = 'Auto-fix 034: reset BE/trailing y reconciliación totalQuantity BTC #22 por fee/dust tras venta fallida'
  WHERE id = 22
    AND pair = 'BTC/USD';

  RAISE NOTICE '[034] BTC/USD #22 corregido: qty % -> %, status trailing_active/BE reset a active.', v_old_qty, v_new_qty;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 2: Phantom sell cleanup — BTC/USD #22
-- ─────────────────────────────────────────────────────────────────────────────
-- Context: Before the createOrder-after-sell fix (FASE E), the bot wrote order
-- records BEFORE the live sell. When the sell failed (insufficient balance),
-- the order record persisted as a "phantom sell" with no exchange_order_id.
-- institutional_dca_orders is the executed-orders ledger. A sell that never
-- happened on exchange must NOT remain there as an executed sale.
--
-- Strategy: backup → DELETE (not UPDATE — no status column; UPDATE is invisible
--   to any code that counts by side/order_type/quantity).
--
-- Idempotency:
--   Step 1 (CREATE TABLE IF NOT EXISTS): safe to re-run.
--   Step 2 (INSERT … ON CONFLICT DO NOTHING): re-run inserts nothing new.
--   Step 3 (DELETE USING audit): re-run deletes nothing (rows already gone).
--   Step 4 (VERIFY): re-run confirms 0 remaining phantom rows.
--
-- Detection criteria:
--   cycle_id   = 22 AND pair = 'BTC/USD'
--   side       = 'sell' AND order_type = 'final_sell'
--   trigger_reason IN ('trailing_exit', 'trailing_exit_dust_adj')
--   exchange_order_id IS NULL        -- no real exchange confirmation
--   executed_at >= '2026-05-11 09:00:00'  -- day of incident

-- Step 1 — Audit table (backup of removed rows)
CREATE TABLE IF NOT EXISTS idca_phantom_order_audit_034 (
  audit_id          SERIAL          PRIMARY KEY,
  original_order_id INTEGER         UNIQUE NOT NULL,
  cycle_id          INTEGER         NOT NULL,
  pair              TEXT            NOT NULL,
  order_snapshot    JSONB           NOT NULL,
  audit_reason      TEXT            NOT NULL,
  audited_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Step 2 — Back up phantom rows (idempotent: ON CONFLICT DO NOTHING)
INSERT INTO idca_phantom_order_audit_034
  (original_order_id, cycle_id, pair, order_snapshot, audit_reason)
SELECT
  o.id,
  o.cycle_id,
  o.pair,
  to_jsonb(o),
  'phantom_sell_removed_after_live_sell_failed_insufficient_balance'
FROM institutional_dca_orders o
WHERE o.cycle_id = 22
  AND o.pair = 'BTC/USD'
  AND o.side = 'sell'
  AND o.order_type = 'final_sell'
  AND o.trigger_reason IN ('trailing_exit', 'trailing_exit_dust_adj')
  AND o.exchange_order_id IS NULL
  AND o.executed_at >= '2026-05-11 09:00:00'
ON CONFLICT (original_order_id) DO NOTHING;

-- Step 3 — Delete phantom rows using audit table as source of truth
DELETE FROM institutional_dca_orders o
USING idca_phantom_order_audit_034 a
WHERE o.id = a.original_order_id
  AND a.audit_reason = 'phantom_sell_removed_after_live_sell_failed_insufficient_balance';

-- Step 4 — Verification
DO $$
DECLARE
  v_remaining integer;
  v_audited   integer;
BEGIN
  SELECT COUNT(*) INTO v_remaining
  FROM institutional_dca_orders
  WHERE cycle_id = 22
    AND pair = 'BTC/USD'
    AND side = 'sell'
    AND order_type = 'final_sell'
    AND trigger_reason IN ('trailing_exit', 'trailing_exit_dust_adj')
    AND exchange_order_id IS NULL
    AND executed_at >= '2026-05-11 09:00:00';

  SELECT COUNT(*) INTO v_audited
  FROM idca_phantom_order_audit_034
  WHERE cycle_id = 22
    AND pair = 'BTC/USD'
    AND audit_reason = 'phantom_sell_removed_after_live_sell_failed_insufficient_balance';

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION '[034] Phantom sell cleanup FAILED: % rows still in institutional_dca_orders', v_remaining;
  END IF;

  RAISE NOTICE '[034] Phantom sell cleanup OK. Rows removed and audited: %', v_audited;
END $$;
