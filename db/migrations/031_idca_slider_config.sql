-- 031_idca_slider_config.sql
-- Adds entry_ui_json and telegram_ui_json columns to institutional_dca_config.
-- These are the single source of truth for slider-based entry and Telegram alert configuration.
-- When present, they override individual technical params (min_dip_pct, trailing_value, etc.)
-- Application defaults are applied in IdcaSliderConfig.ts (entryPatienceLevel:70, etc.)

ALTER TABLE institutional_dca_config
  ADD COLUMN IF NOT EXISTS entry_ui_json JSONB,
  ADD COLUMN IF NOT EXISTS telegram_ui_json JSONB;
