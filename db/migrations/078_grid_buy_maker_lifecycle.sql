-- Migration 078: lifecycle maker BUY SHADOW — persistencia de pending tick, timestamp y precio.
-- Phase: 3C.5-A-REV-C9
--
-- Idempotente: solo añade columnas si no existen.
-- No backfill; niveles legacy no afectados.

ALTER TABLE grid_isolated_levels
  ADD COLUMN IF NOT EXISTS buy_maker_pending_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS buy_maker_pending_tick_id INTEGER,
  ADD COLUMN IF NOT EXISTS buy_maker_requested_price DECIMAL(18, 8);
