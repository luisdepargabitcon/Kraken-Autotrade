-- 026_time_stop_soft_mode.sql
-- FASE 4 — Add soft_mode flag to time_stop_config so "soft mode" (only close if net gain)
-- becomes a first-class, per-row setting instead of a decorative global label.
--
-- Semantics: when soft_mode = true AND the TTL has expired, the engine will NOT close
-- the position unless the net P&L (priceChangePct − roundTripFeePct) is positive.
-- This restores the UI promise "soft = solo si hay ganancia" that until now was only
-- visible in the Telegram alert title.

ALTER TABLE time_stop_config
  ADD COLUMN IF NOT EXISTS soft_mode BOOLEAN NOT NULL DEFAULT false;

-- Optional: seed the wildcard default with soft_mode=true so the UI default matches
-- the previous bot_config.timeStopMode = 'soft' default.
UPDATE time_stop_config
   SET soft_mode = true
 WHERE pair = '*' AND market = 'spot' AND soft_mode IS DISTINCT FROM true;
