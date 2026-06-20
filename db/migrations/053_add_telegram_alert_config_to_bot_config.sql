-- Migration 051: Add telegram_alert_config column to bot_config
-- Fixes missing column from commit b2e4c1d which added telegramAlertConfig to schema.ts

ALTER TABLE bot_config
ADD COLUMN IF NOT EXISTS telegram_alert_config jsonb DEFAULT '{}'::jsonb;

-- Ensure existing rows have the column set
UPDATE bot_config
SET telegram_alert_config = '{}'::jsonb
WHERE telegram_alert_config IS NULL;
