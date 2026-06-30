-- Migration 062: Capital efficiency gate config fields
-- Prevents dust/micro entries that waste Smart Guard slots

ALTER TABLE bot_config
  ADD COLUMN IF NOT EXISTS sg_absolute_dust_usd DECIMAL(10,2) NOT NULL DEFAULT 20.00,
  ADD COLUMN IF NOT EXISTS sg_min_expected_profit_usd DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS sg_slot_efficiency_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sg_exclude_micro_trades_from_score BOOLEAN NOT NULL DEFAULT true;
