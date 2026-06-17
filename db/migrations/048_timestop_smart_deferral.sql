-- 048_timestop_smart_deferral.sql
-- SMART_GUARD / TIME_STOP audit & intelligent deferral
--
-- Changes:
--   1. Enable soft_mode=true for ALL time_stop_config rows (pair-specific rows were overriding
--      the wildcard's soft_mode=true with their own default soft_mode=false, causing TimeStop
--      to sell in loss for every configured pair).
--   2. Add min_profit_pct_to_exit: require net PnL >= threshold (after round-trip fees) before
--      TimeStop is allowed to close. Default 0.25% (covers slippage + some profit).
--   3. Add normalized_reason to dry_run_trades for exit-audit grouping and statistics.
--   4. Backfill normalized_reason from existing reason text.

-- ─── (1) Enable soft_mode for ALL existing rows ───────────────────────────────
UPDATE time_stop_config
   SET soft_mode = true
 WHERE soft_mode IS DISTINCT FROM true;

-- ─── (2) Add min_profit_pct_to_exit ──────────────────────────────────────────
ALTER TABLE time_stop_config
  ADD COLUMN IF NOT EXISTS min_profit_pct_to_exit DECIMAL(6,3) NOT NULL DEFAULT 0.25;

-- Seed sensible defaults: 0.25% net PnL required after fees before TimeStop closes
UPDATE time_stop_config
   SET min_profit_pct_to_exit = 0.25
 WHERE min_profit_pct_to_exit IS NOT DISTINCT FROM 0.25;

-- ─── (3) Add normalized_reason to dry_run_trades ─────────────────────────────
ALTER TABLE dry_run_trades
  ADD COLUMN IF NOT EXISTS normalized_reason TEXT;

-- ─── (4) Backfill normalized_reason from reason text ─────────────────────────
UPDATE dry_run_trades
SET normalized_reason = CASE
  WHEN reason ILIKE '%timestop%'
    OR reason ILIKE '%time-stop%'
    OR reason ILIKE '%time stop%'                         THEN 'TIME_STOP'
  WHEN reason ILIKE '%break-even%'
    OR reason ILIKE '%breakeven%'
    OR reason ILIKE '%break even%'                        THEN 'BREAK_EVEN'
  WHEN reason ILIKE '%trailing%'                          THEN 'TRAILING_STOP'
  WHEN reason ILIKE '%scale-out%'
    OR reason ILIKE '%scale out%'
    OR reason ILIKE '%scaleout%'                          THEN 'SCALE_OUT'
  WHEN reason ILIKE '%smart exit%'
    OR reason ILIKE '%smart_exit%'                        THEN 'SMART_EXIT'
  WHEN reason ILIKE '%stop-loss emergencia%'
    OR reason ILIKE '%sl_emergency%'
    OR reason ILIKE '%emergencia%'                        THEN 'EMERGENCY_SL'
  WHEN reason ILIKE '%stop-loss%'
    OR reason ILIKE '%stoploss%'
    OR reason ILIKE '%stop loss%'                         THEN 'STOP_LOSS'
  WHEN reason ILIKE '%take-profit%'
    OR reason ILIKE '%take profit%'
    OR reason ILIKE '%tp fijo%'                           THEN 'TAKE_PROFIT'
  ELSE 'UNKNOWN'
END
WHERE type = 'sell'
  AND normalized_reason IS NULL;
