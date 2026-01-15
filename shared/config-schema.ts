import { z } from "zod";

// Trading Configuration Schema
export const signalConfigSchema = z.object({
  regime: z.enum(['TREND', 'RANGE', 'TRANSITION']),
  minSignals: z.number().min(1).max(10),
  maxSignals: z.number().min(1).max(10),
  currentSignals: z.number().min(1).max(10),
  description: z.string().optional(),
});

export const exchangeConfigSchema = z.object({
  exchangeType: z.enum(['kraken', 'revolutx']),
  enabled: z.boolean(),
  minOrderUsd: z.number().min(1).max(10000),
  maxOrderUsd: z.number().min(1).max(50000),
  maxSpreadPct: z.number().min(0.1).max(5.0),
  tradingHoursEnabled: z.boolean(),
  tradingHoursStart: z.number().min(0).max(23),
  tradingHoursEnd: z.number().min(0).min(23),
  customParams: z.record(z.any()).optional(),
});

export const globalConfigSchema = z.object({
  riskPerTradePct: z.number().min(0.1).max(10.0),
  maxTotalExposurePct: z.number().min(10).max(100),
  maxPairExposurePct: z.number().min(5).max(50),
  dryRunMode: z.boolean(),
  regimeDetectionEnabled: z.boolean(),
  regimeRouterEnabled: z.boolean(),
});

export const tradingConfigSchema = z.object({
  global: globalConfigSchema,
  signals: z.record(signalConfigSchema),
  exchanges: z.record(exchangeConfigSchema),
  presets: z.record(z.object({
    name: z.string(),
    description: z.string(),
    signals: z.record(signalConfigSchema),
    exchanges: z.record(exchangeConfigSchema),
  })),
  activePreset: z.string().optional(),
  customOverrides: z.record(z.any()).optional(),
});

export type SignalConfig = z.infer<typeof signalConfigSchema>;
export type ExchangeConfig = z.infer<typeof exchangeConfigSchema>;
export type GlobalConfig = z.infer<typeof globalConfigSchema>;
export type TradingConfig = z.infer<typeof tradingConfigSchema>;

// Configuration Change History
export const configChangeSchema = z.object({
  id: z.string(),
  configId: z.string(),
  userId: z.string().optional(),
  changeType: z.enum(['CREATE', 'UPDATE', 'DELETE', 'ACTIVATE_PRESET', 'ROLLBACK']),
  description: z.string(),
  previousConfig: z.any().optional(),
  newConfig: z.any(),
  changedFields: z.array(z.string()),
  metadata: z.record(z.any()).optional(),
  createdAt: z.date(),
  appliedAt: z.date().optional(),
  isActive: z.boolean(),
});

export type ConfigChange = z.infer<typeof configChangeSchema>;

// Configuration Validation Rules
export const validationRules = {
  signals: {
    minSignals: { min: 1, max: 10, warning: 'Very low signal count may cause false positives' },
    maxSignals: { min: 1, max: 10, warning: 'Very high signal count may cause false positives' },
    currentSignals: { min: 1, max: 10, error: 'Signal count must be between 1 and 10' }
  },
  exchanges: {
    minOrderUsd: { min: 1, max: 10000, error: 'Minimum order too low' },
    maxOrderUsd: { min: 1, max: 50000, error: 'Maximum order too high' },
    maxSpreadPct: { min: 0.1, max: 5.0, error: 'Spread too wide' }
  },
  global: {
    riskPerTradePct: { min: 0.1, max: 10.0, error: 'Risk per trade too high' },
    maxTotalExposurePct: { min: 10, max: 100, error: 'Total exposure too high' },
    maxPairExposurePct: { min: 5, max: 50, error: 'Pair exposure too high' }
  }
};

export type ValidationRule = {
  min: number;
  max: number;
  warning?: string;
  error?: string;
};

export type ValidationRules = {
  signals: Partial<Record<keyof SignalConfig, ValidationRule>>;
  exchanges: Partial<Record<keyof ExchangeConfig, ValidationRule>>;
  global: Partial<Record<keyof GlobalConfig, ValidationRule>>;
};
