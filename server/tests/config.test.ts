import { describe, it, expect, beforeEach } from 'vitest';
import { configService } from '../services/ConfigService';
import type { TradingConfig } from '@shared/config-schema';

describe('ConfigService', () => {
  describe('Configuration Validation', () => {
    it('should validate a valid configuration', () => {
      const validConfig: TradingConfig = {
        global: {
          riskPerTradePct: 2.0,
          maxTotalExposurePct: 50,
          maxPairExposurePct: 20,
          dryRunMode: false,
          regimeDetectionEnabled: true,
          regimeRouterEnabled: true,
        },
        signals: {
          TREND: {
            regime: 'TREND',
            minSignals: 5,
            maxSignals: 10,
            currentSignals: 5,
            description: 'Trend following',
          },
          RANGE: {
            regime: 'RANGE',
            minSignals: 6,
            maxSignals: 10,
            currentSignals: 6,
            description: 'Range trading',
          },
          TRANSITION: {
            regime: 'TRANSITION',
            minSignals: 4,
            maxSignals: 10,
            currentSignals: 4,
            description: 'Transition phase',
          },
        },
        exchanges: {
          kraken: {
            exchangeType: 'kraken',
            enabled: true,
            minOrderUsd: 10,
            maxOrderUsd: 2000,
            maxSpreadPct: 1.0,
            tradingHoursEnabled: false,
            tradingHoursStart: 0,
            tradingHoursEnd: 23,
          },
          revolutx: {
            exchangeType: 'revolutx',
            enabled: false,
            minOrderUsd: 10,
            maxOrderUsd: 2000,
            maxSpreadPct: 1.0,
            tradingHoursEnabled: false,
            tradingHoursStart: 0,
            tradingHoursEnd: 23,
          },
        },
        presets: {},
      };

      const result = configService.validateConfig(validConfig);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject configuration with invalid signal counts', () => {
      const invalidConfig: TradingConfig = {
        global: {
          riskPerTradePct: 2.0,
          maxTotalExposurePct: 50,
          maxPairExposurePct: 20,
          dryRunMode: false,
          regimeDetectionEnabled: true,
          regimeRouterEnabled: true,
        },
        signals: {
          TREND: {
            regime: 'TREND',
            minSignals: 8,
            maxSignals: 5, // Invalid: min > max
            currentSignals: 6,
            description: 'Trend following',
          },
          RANGE: {
            regime: 'RANGE',
            minSignals: 6,
            maxSignals: 10,
            currentSignals: 6,
            description: 'Range trading',
          },
          TRANSITION: {
            regime: 'TRANSITION',
            minSignals: 4,
            maxSignals: 10,
            currentSignals: 4,
            description: 'Transition phase',
          },
        },
        exchanges: {
          kraken: {
            exchangeType: 'kraken',
            enabled: true,
            minOrderUsd: 10,
            maxOrderUsd: 2000,
            maxSpreadPct: 1.0,
            tradingHoursEnabled: false,
            tradingHoursStart: 0,
            tradingHoursEnd: 23,
          },
          revolutx: {
            exchangeType: 'revolutx',
            enabled: false,
            minOrderUsd: 10,
            maxOrderUsd: 2000,
            maxSpreadPct: 1.0,
            tradingHoursEnabled: false,
            tradingHoursStart: 0,
            tradingHoursEnd: 23,
          },
        },
        presets: {},
      };

      const result = configService.validateConfig(invalidConfig);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('Minimum signals cannot exceed maximum signals'))).toBe(true);
    });

    it('should reject configuration with invalid exposure percentages', () => {
      const invalidConfig: TradingConfig = {
        global: {
          riskPerTradePct: 2.0,
          maxTotalExposurePct: 20, // Invalid: total < pair
          maxPairExposurePct: 30,
          dryRunMode: false,
          regimeDetectionEnabled: true,
          regimeRouterEnabled: true,
        },
        signals: {
          TREND: {
            regime: 'TREND',
            minSignals: 5,
            maxSignals: 10,
            currentSignals: 5,
            description: 'Trend following',
          },
          RANGE: {
            regime: 'RANGE',
            minSignals: 6,
            maxSignals: 10,
            currentSignals: 6,
            description: 'Range trading',
          },
          TRANSITION: {
            regime: 'TRANSITION',
            minSignals: 4,
            maxSignals: 10,
            currentSignals: 4,
            description: 'Transition phase',
          },
        },
        exchanges: {
          kraken: {
            exchangeType: 'kraken',
            enabled: true,
            minOrderUsd: 10,
            maxOrderUsd: 2000,
            maxSpreadPct: 1.0,
            tradingHoursEnabled: false,
            tradingHoursStart: 0,
            tradingHoursEnd: 23,
          },
          revolutx: {
            exchangeType: 'revolutx',
            enabled: false,
            minOrderUsd: 10,
            maxOrderUsd: 2000,
            maxSpreadPct: 1.0,
            tradingHoursEnabled: false,
            tradingHoursStart: 0,
            tradingHoursEnd: 23,
          },
        },
        presets: {},
      };

      const result = configService.validateConfig(invalidConfig);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('Total exposure must be greater than or equal to pair exposure'))).toBe(true);
    });

    it('should reject configuration with current signals out of range', () => {
      const invalidConfig: TradingConfig = {
        global: {
          riskPerTradePct: 2.0,
          maxTotalExposurePct: 50,
          maxPairExposurePct: 20,
          dryRunMode: false,
          regimeDetectionEnabled: true,
          regimeRouterEnabled: true,
        },
        signals: {
          TREND: {
            regime: 'TREND',
            minSignals: 5,
            maxSignals: 10,
            currentSignals: 12, // Invalid: current > max
            description: 'Trend following',
          },
          RANGE: {
            regime: 'RANGE',
            minSignals: 6,
            maxSignals: 10,
            currentSignals: 6,
            description: 'Range trading',
          },
          TRANSITION: {
            regime: 'TRANSITION',
            minSignals: 4,
            maxSignals: 10,
            currentSignals: 4,
            description: 'Transition phase',
          },
        },
        exchanges: {
          kraken: {
            exchangeType: 'kraken',
            enabled: true,
            minOrderUsd: 10,
            maxOrderUsd: 2000,
            maxSpreadPct: 1.0,
            tradingHoursEnabled: false,
            tradingHoursStart: 0,
            tradingHoursEnd: 23,
          },
          revolutx: {
            exchangeType: 'revolutx',
            enabled: false,
            minOrderUsd: 10,
            maxOrderUsd: 2000,
            maxSpreadPct: 1.0,
            tradingHoursEnabled: false,
            tradingHoursStart: 0,
            tradingHoursEnd: 23,
          },
        },
        presets: {},
      };

      const result = configService.validateConfig(invalidConfig);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('Current signals must be within min/max range'))).toBe(true);
    });

    it('should generate warnings for edge case values', () => {
      const edgeCaseConfig: TradingConfig = {
        global: {
          riskPerTradePct: 9.0, // High risk
          maxTotalExposurePct: 50,
          maxPairExposurePct: 15,
          dryRunMode: false,
          regimeDetectionEnabled: true,
          regimeRouterEnabled: true,
        },
        signals: {
          TREND: {
            regime: 'TREND',
            minSignals: 5,
            maxSignals: 10,
            currentSignals: 5,
            description: 'Trend following',
          },
          RANGE: {
            regime: 'RANGE',
            minSignals: 6,
            maxSignals: 10,
            currentSignals: 6,
            description: 'Range trading',
          },
          TRANSITION: {
            regime: 'TRANSITION',
            minSignals: 4,
            maxSignals: 10,
            currentSignals: 4,
            description: 'Transition phase',
          },
        },
        exchanges: {
          kraken: {
            exchangeType: 'kraken',
            enabled: true,
            minOrderUsd: 10,
            maxOrderUsd: 2000,
            maxSpreadPct: 1.0,
            tradingHoursEnabled: false,
            tradingHoursStart: 0,
            tradingHoursEnd: 23,
          },
          revolutx: {
            exchangeType: 'revolutx',
            enabled: false,
            minOrderUsd: 10,
            maxOrderUsd: 2000,
            maxSpreadPct: 1.0,
            tradingHoursEnabled: false,
            tradingHoursStart: 0,
            tradingHoursEnd: 23,
          },
        },
        presets: {},
      };

      const result = configService.validateConfig(edgeCaseConfig);
      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.includes('Risk per trade is high relative to pair exposure'))).toBe(true);
    });
  });

  describe('Configuration Export/Import', () => {
    it('should export configuration as valid JSON', async () => {
      const validConfig: TradingConfig = {
        global: {
          riskPerTradePct: 2.0,
          maxTotalExposurePct: 50,
          maxPairExposurePct: 20,
          dryRunMode: false,
          regimeDetectionEnabled: true,
          regimeRouterEnabled: true,
        },
        signals: {
          TREND: {
            regime: 'TREND',
            minSignals: 5,
            maxSignals: 10,
            currentSignals: 5,
            description: 'Trend following',
          },
          RANGE: {
            regime: 'RANGE',
            minSignals: 6,
            maxSignals: 10,
            currentSignals: 6,
            description: 'Range trading',
          },
          TRANSITION: {
            regime: 'TRANSITION',
            minSignals: 4,
            maxSignals: 10,
            currentSignals: 4,
            description: 'Transition phase',
          },
        },
        exchanges: {
          kraken: {
            exchangeType: 'kraken',
            enabled: true,
            minOrderUsd: 10,
            maxOrderUsd: 2000,
            maxSpreadPct: 1.0,
            tradingHoursEnabled: false,
            tradingHoursStart: 0,
            tradingHoursEnd: 23,
          },
          revolutx: {
            exchangeType: 'revolutx',
            enabled: false,
            minOrderUsd: 10,
            maxOrderUsd: 2000,
            maxSpreadPct: 1.0,
            tradingHoursEnabled: false,
            tradingHoursStart: 0,
            tradingHoursEnd: 23,
          },
        },
        presets: {},
      };

      const exported = JSON.stringify(validConfig, null, 2);
      expect(() => JSON.parse(exported)).not.toThrow();
      
      const parsed = JSON.parse(exported);
      expect(parsed.global).toBeDefined();
      expect(parsed.signals).toBeDefined();
      expect(parsed.exchanges).toBeDefined();
    });

    it('should import and validate JSON configuration', async () => {
      const validConfigJson = JSON.stringify({
        global: {
          riskPerTradePct: 2.0,
          maxTotalExposurePct: 50,
          maxPairExposurePct: 20,
          dryRunMode: false,
          regimeDetectionEnabled: true,
          regimeRouterEnabled: true,
        },
        signals: {
          TREND: {
            regime: 'TREND',
            minSignals: 5,
            maxSignals: 10,
            currentSignals: 5,
            description: 'Trend following',
          },
          RANGE: {
            regime: 'RANGE',
            minSignals: 6,
            maxSignals: 10,
            currentSignals: 6,
            description: 'Range trading',
          },
          TRANSITION: {
            regime: 'TRANSITION',
            minSignals: 4,
            maxSignals: 10,
            currentSignals: 4,
            description: 'Transition phase',
          },
        },
        exchanges: {
          kraken: {
            exchangeType: 'kraken',
            enabled: true,
            minOrderUsd: 10,
            maxOrderUsd: 2000,
            maxSpreadPct: 1.0,
            tradingHoursEnabled: false,
            tradingHoursStart: 0,
            tradingHoursEnd: 23,
          },
          revolutx: {
            exchangeType: 'revolutx',
            enabled: false,
            minOrderUsd: 10,
            maxOrderUsd: 2000,
            maxSpreadPct: 1.0,
            tradingHoursEnabled: false,
            tradingHoursStart: 0,
            tradingHoursEnd: 23,
          },
        },
        presets: {},
      });

      const parsed = JSON.parse(validConfigJson) as TradingConfig;
      const result = configService.validateConfig(parsed);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
