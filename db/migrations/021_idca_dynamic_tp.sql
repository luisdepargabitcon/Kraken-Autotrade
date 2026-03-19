-- 021: IDCA Dynamic Take Profit + Cycle Plus preparation
-- Adds dynamic_tp_config_json to config table
-- Adds tp_breakdown_json to cycles table
-- Adds cycle_type and parent_cycle_id to cycles table (for Phase 3)
-- Adds plus_config_json to config table (for Phase 3)

-- Config: dynamic TP configuration as JSONB
ALTER TABLE institutional_dca_config
  ADD COLUMN IF NOT EXISTS dynamic_tp_config_json JSONB NOT NULL DEFAULT '{
    "baseTpPctBtc": 4.0,
    "baseTpPctEth": 5.0,
    "reductionPerExtraBuyMain": 0.3,
    "reductionPerExtraBuyPlus": 0.2,
    "weakReboundReductionMain": 0.5,
    "weakReboundReductionPlus": 0.3,
    "strongReboundBonusMain": 0.3,
    "strongReboundBonusPlus": 0.2,
    "highVolatilityAdjustMain": 0.3,
    "highVolatilityAdjustPlus": 0.2,
    "lowVolatilityAdjustMain": -0.2,
    "lowVolatilityAdjustPlus": -0.1,
    "mainMinTpPctBtc": 2.0,
    "mainMaxTpPctBtc": 6.0,
    "mainMinTpPctEth": 2.5,
    "mainMaxTpPctEth": 8.0,
    "plusMinTpPctBtc": 2.5,
    "plusMaxTpPctBtc": 5.0,
    "plusMinTpPctEth": 3.0,
    "plusMaxTpPctEth": 6.0
  }'::jsonb;

-- Config: plus cycle configuration as JSONB (Phase 3 ready)
ALTER TABLE institutional_dca_config
  ADD COLUMN IF NOT EXISTS plus_config_json JSONB NOT NULL DEFAULT '{
    "enabled": false,
    "maxPlusCyclesPerMain": 2,
    "maxPlusEntries": 3,
    "capitalAllocationPct": 15,
    "activationExtraDipPct": 4.0,
    "requireMainExhausted": true,
    "requireReboundConfirmation": true,
    "cooldownMinutesBetweenBuys": 60,
    "autoCloseIfMainClosed": true,
    "maxExposurePctPerAsset": 20,
    "entryDipSteps": [2.0, 3.5, 5.0],
    "entrySizingMode": "fixed",
    "baseTpPctBtc": 4.0,
    "baseTpPctEth": 4.5,
    "trailingPctBtc": 1.0,
    "trailingPctEth": 1.2
  }'::jsonb;

-- Cycles: TP breakdown for traceability
ALTER TABLE institutional_dca_cycles
  ADD COLUMN IF NOT EXISTS tp_breakdown_json JSONB;

-- Cycles: cycle type (main | plus)
ALTER TABLE institutional_dca_cycles
  ADD COLUMN IF NOT EXISTS cycle_type TEXT NOT NULL DEFAULT 'main';

-- Cycles: parent cycle link for plus cycles
ALTER TABLE institutional_dca_cycles
  ADD COLUMN IF NOT EXISTS parent_cycle_id INTEGER;

-- Cycles: track completed plus cycles count
ALTER TABLE institutional_dca_cycles
  ADD COLUMN IF NOT EXISTS plus_cycles_completed INTEGER NOT NULL DEFAULT 0;
