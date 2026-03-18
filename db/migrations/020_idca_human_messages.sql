-- Migration 020: Add human-readable message fields to IDCA events and orders
-- These columns store the formatted Spanish human messages alongside technical data

-- Events table: add reason_code, human_title, human_message, technical_summary
ALTER TABLE institutional_dca_events ADD COLUMN IF NOT EXISTS reason_code TEXT;
ALTER TABLE institutional_dca_events ADD COLUMN IF NOT EXISTS human_title TEXT;
ALTER TABLE institutional_dca_events ADD COLUMN IF NOT EXISTS human_message TEXT;
ALTER TABLE institutional_dca_events ADD COLUMN IF NOT EXISTS technical_summary TEXT;

-- Orders table: add human_reason
ALTER TABLE institutional_dca_orders ADD COLUMN IF NOT EXISTS human_reason TEXT;
