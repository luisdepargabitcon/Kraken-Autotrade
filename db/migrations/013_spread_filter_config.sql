-- Migration: Add spread filter configuration columns to bot_config
-- Date: 2026-02-06

ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS spread_filter_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS spread_dynamic_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS spread_max_pct DECIMAL(5,2) NOT NULL DEFAULT 2.00;
ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS spread_threshold_trend DECIMAL(5,2) NOT NULL DEFAULT 1.50;
ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS spread_threshold_range DECIMAL(5,2) NOT NULL DEFAULT 2.00;
ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS spread_threshold_transition DECIMAL(5,2) NOT NULL DEFAULT 2.50;
ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS spread_cap_pct DECIMAL(5,2) NOT NULL DEFAULT 3.50;
ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS spread_floor_pct DECIMAL(5,2) NOT NULL DEFAULT 0.30;
ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS spread_revolutx_markup_pct DECIMAL(5,2) NOT NULL DEFAULT 0.80;
ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS spread_telegram_alert_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS spread_telegram_cooldown_ms INTEGER NOT NULL DEFAULT 600000;
