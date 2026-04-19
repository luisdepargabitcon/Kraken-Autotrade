-- Migration 028: Add VWAP and rebound configuration columns to IDCA asset configs
-- These columns enable per-pair VWAP analysis and configurable rebound thresholds.

ALTER TABLE institutional_dca_asset_configs
  ADD COLUMN IF NOT EXISTS rebound_min_pct DECIMAL(5,2) NOT NULL DEFAULT 0.30,
  ADD COLUMN IF NOT EXISTS vwap_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS vwap_dynamic_safety_enabled BOOLEAN NOT NULL DEFAULT FALSE;
