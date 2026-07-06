-- Migration 068: Disable alert rules for legacy imported channels
-- Legacy channels with importedFromLegacy=true or needsUserReview=true should have alert rules disabled
-- This migration fixes the data from 067 which incorrectly enabled rules for legacy channels

UPDATE telegram_alert_rules
SET enabled = false,
    updated_at = NOW()
WHERE chat_id IN (
  SELECT id
  FROM telegram_chats
  WHERE alert_preferences->>'importedFromLegacy' = 'true'
     OR alert_preferences->>'needsUserReview' = 'true'
);
