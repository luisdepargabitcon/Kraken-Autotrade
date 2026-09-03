-- 088_grid_v31_adaptive_trailing.sql
-- V3.1 GRID Adaptive ATR Trailing — additive columns for grid_isolated_configs.
-- Idempotent: uses IF NOT EXISTS. No DROP, no data loss.
-- Default: trailingEnabled=false (preserved), trailingMode='adaptive_atr' (conceptual default only,
-- does NOT activate trailing).

-- Trailing mode: adaptive_atr | manual
ALTER TABLE grid_isolated_configs
  ADD COLUMN IF NOT EXISTS trailing_mode TEXT NOT NULL DEFAULT 'adaptive_atr';

-- ATR multiplier for adaptive trailing stop distance
ALTER TABLE grid_isolated_configs
  ADD COLUMN IF NOT EXISTS trailing_atr_multiplier NUMERIC(6,4) NOT NULL DEFAULT 0.7500;

-- Minimum stop pct clamp
ALTER TABLE grid_isolated_configs
  ADD COLUMN IF NOT EXISTS trailing_min_pct NUMERIC(6,4) NOT NULL DEFAULT 0.2500;

-- Maximum stop pct clamp
ALTER TABLE grid_isolated_configs
  ADD COLUMN IF NOT EXISTS trailing_max_pct NUMERIC(6,4) NOT NULL DEFAULT 1.2000;

-- EMA smoothing alpha for ATR
ALTER TABLE grid_isolated_configs
  ADD COLUMN IF NOT EXISTS trailing_atr_smoothing_alpha NUMERIC(6,4) NOT NULL DEFAULT 0.2500;
