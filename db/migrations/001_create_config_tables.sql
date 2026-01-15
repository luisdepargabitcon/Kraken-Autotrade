-- Migration: Create Trading Configuration Tables
-- Description: Add tables for dynamic trading configuration management
-- Date: 2025-01-15

-- Trading Configuration Table
CREATE TABLE IF NOT EXISTS trading_config (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  config JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Configuration Change History Table
CREATE TABLE IF NOT EXISTS config_change (
  id SERIAL PRIMARY KEY,
  config_id TEXT NOT NULL,
  user_id TEXT,
  change_type TEXT NOT NULL, -- CREATE, UPDATE, DELETE, ACTIVATE_PRESET, ROLLBACK
  description TEXT NOT NULL,
  previous_config JSONB,
  new_config JSONB NOT NULL,
  changed_fields TEXT[] NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT FALSE
);

-- Configuration Presets Table
CREATE TABLE IF NOT EXISTS config_preset (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  config JSONB NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_trading_config_is_active ON trading_config(is_active);
CREATE INDEX IF NOT EXISTS idx_trading_config_created_at ON trading_config(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_config_change_config_id ON config_change(config_id);
CREATE INDEX IF NOT EXISTS idx_config_change_created_at ON config_change(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_config_preset_is_default ON config_preset(is_default);
CREATE INDEX IF NOT EXISTS idx_config_preset_name ON config_preset(name);

-- Insert default presets
INSERT INTO config_preset (name, description, config, is_default) VALUES
(
  'conservative',
  'Conservative trading preset with strict signal requirements',
  '{
    "global": {
      "riskPerTradePct": 1.0,
      "maxTotalExposurePct": 30,
      "maxPairExposurePct": 10,
      "dryRunMode": false,
      "regimeDetectionEnabled": true,
      "regimeRouterEnabled": true
    },
    "signals": {
      "TREND": {
        "regime": "TREND",
        "minSignals": 6,
        "maxSignals": 10,
        "currentSignals": 6,
        "description": "Conservative trend following with high signal requirements"
      },
      "RANGE": {
        "regime": "RANGE",
        "minSignals": 7,
        "maxSignals": 10,
        "currentSignals": 7,
        "description": "Very strict range trading to avoid false breakouts"
      },
      "TRANSITION": {
        "regime": "TRANSITION",
        "minSignals": 5,
        "maxSignals": 10,
        "currentSignals": 5,
        "description": "Cautious during market transitions"
      }
    },
    "exchanges": {
      "kraken": {
        "exchangeType": "kraken",
        "enabled": true,
        "minOrderUsd": 10,
        "maxOrderUsd": 1000,
        "maxSpreadPct": 0.5,
        "tradingHoursEnabled": false,
        "tradingHoursStart": 0,
        "tradingHoursEnd": 23
      },
      "revolutx": {
        "exchangeType": "revolutx",
        "enabled": false,
        "minOrderUsd": 10,
        "maxOrderUsd": 1000,
        "maxSpreadPct": 0.5,
        "tradingHoursEnabled": false,
        "tradingHoursStart": 0,
        "tradingHoursEnd": 23
      }
    },
    "presets": {},
    "activePreset": "conservative"
  }'::jsonb,
  true
),
(
  'balanced',
  'Balanced trading preset with moderate signal requirements',
  '{
    "global": {
      "riskPerTradePct": 2.0,
      "maxTotalExposurePct": 50,
      "maxPairExposurePct": 20,
      "dryRunMode": false,
      "regimeDetectionEnabled": true,
      "regimeRouterEnabled": true
    },
    "signals": {
      "TREND": {
        "regime": "TREND",
        "minSignals": 5,
        "maxSignals": 10,
        "currentSignals": 5,
        "description": "Balanced trend following"
      },
      "RANGE": {
        "regime": "RANGE",
        "minSignals": 6,
        "maxSignals": 10,
        "currentSignals": 6,
        "description": "Moderate range trading"
      },
      "TRANSITION": {
        "regime": "TRANSITION",
        "minSignals": 4,
        "maxSignals": 10,
        "currentSignals": 4,
        "description": "Adaptive during transitions"
      }
    },
    "exchanges": {
      "kraken": {
        "exchangeType": "kraken",
        "enabled": true,
        "minOrderUsd": 10,
        "maxOrderUsd": 2000,
        "maxSpreadPct": 1.0,
        "tradingHoursEnabled": false,
        "tradingHoursStart": 0,
        "tradingHoursEnd": 23
      },
      "revolutx": {
        "exchangeType": "revolutx",
        "enabled": false,
        "minOrderUsd": 10,
        "maxOrderUsd": 2000,
        "maxSpreadPct": 1.0,
        "tradingHoursEnabled": false,
        "tradingHoursStart": 0,
        "tradingHoursEnd": 23
      }
    },
    "presets": {},
    "activePreset": "balanced"
  }'::jsonb,
  false
),
(
  'aggressive',
  'Aggressive trading preset with lower signal requirements',
  '{
    "global": {
      "riskPerTradePct": 3.0,
      "maxTotalExposurePct": 70,
      "maxPairExposurePct": 30,
      "dryRunMode": false,
      "regimeDetectionEnabled": true,
      "regimeRouterEnabled": true
    },
    "signals": {
      "TREND": {
        "regime": "TREND",
        "minSignals": 4,
        "maxSignals": 10,
        "currentSignals": 4,
        "description": "Aggressive trend following"
      },
      "RANGE": {
        "regime": "RANGE",
        "minSignals": 5,
        "maxSignals": 10,
        "currentSignals": 5,
        "description": "Active range trading"
      },
      "TRANSITION": {
        "regime": "TRANSITION",
        "minSignals": 3,
        "maxSignals": 10,
        "currentSignals": 3,
        "description": "Quick reactions during transitions"
      }
    },
    "exchanges": {
      "kraken": {
        "exchangeType": "kraken",
        "enabled": true,
        "minOrderUsd": 10,
        "maxOrderUsd": 5000,
        "maxSpreadPct": 2.0,
        "tradingHoursEnabled": false,
        "tradingHoursStart": 0,
        "tradingHoursEnd": 23
      },
      "revolutx": {
        "exchangeType": "revolutx",
        "enabled": false,
        "minOrderUsd": 10,
        "maxOrderUsd": 5000,
        "maxSpreadPct": 2.0,
        "tradingHoursEnabled": false,
        "tradingHoursStart": 0,
        "tradingHoursEnd": 23
      }
    },
    "presets": {},
    "activePreset": "aggressive"
  }'::jsonb,
  false
)
ON CONFLICT (name) DO NOTHING;

-- Create a trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_trading_config_updated_at ON trading_config;
CREATE TRIGGER update_trading_config_updated_at BEFORE UPDATE ON trading_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_config_preset_updated_at ON config_preset;
CREATE TRIGGER update_config_preset_updated_at BEFORE UPDATE ON config_preset
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE trading_config IS 'Stores trading configuration instances with versioning';
COMMENT ON TABLE config_change IS 'Audit trail for all configuration changes';
COMMENT ON TABLE config_preset IS 'Pre-defined configuration templates';
COMMENT ON COLUMN trading_config.config IS 'JSONB containing the full trading configuration';
COMMENT ON COLUMN config_change.change_type IS 'Type of change: CREATE, UPDATE, DELETE, ACTIVATE_PRESET, ROLLBACK';
COMMENT ON COLUMN config_preset.is_default IS 'Indicates if this is the default preset to use';
