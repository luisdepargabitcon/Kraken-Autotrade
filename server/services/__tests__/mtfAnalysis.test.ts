/**
 * MTF Analysis Tests
 * Tests for multi-timeframe data validation and diagnostic
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { emitMTFDiagnostic, type OHLCCandle } from "../mtfAnalysis";

describe("MTF Analysis - Diagnostic", () => {
  beforeEach(() => {
    // Clear dedupe cache before each test
    // Note: mtfDedupeCache is not exported, so we can't clear it directly
    // Tests will rely on the 15-minute TTL
  });

  // Helper to create candles with specific step
  function createCandles(count: number, startTime: number, stepSeconds: number): OHLCCandle[] {
    const candles: OHLCCandle[] = [];
    for (let i = 0; i < count; i++) {
      candles.push({
        time: startTime + (i * stepSeconds),
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100.5 + i,
        volume: 1000,
      });
    }
    return candles;
  }

  describe("Test A: Valid series with different timeframes but same last candle (normal)", () => {
    it("should NOT be critical when exactLast=true but intervals are correct", () => {
      const now = Math.floor(Date.now() / 1000);
      
      // 5m candles: last candle at now
      const tf5m = createCandles(100, now - (100 * 300), 300);
      
      // 1h candles: last candle also at now (aligned close)
      const tf1h = createCandles(50, now - (50 * 3600), 3600);
      
      // 4h candles: last candle also at now (aligned close)
      const tf4h = createCandles(50, now - (50 * 14400), 14400);

      // Align last candles to same timestamp (normal market alignment)
      tf5m[tf5m.length - 1].time = now;
      tf1h[tf1h.length - 1].time = now;
      tf4h[tf4h.length - 1].time = now;

      const isCritical = emitMTFDiagnostic("BTC/USD", tf5m, tf1h, tf4h);

      // Should NOT be critical - exactLast alone is normal
      expect(isCritical).toBe(false);
    });
  });

  describe("Test B: Two timeframes with same array (critical)", () => {
    it("should be CRITICAL when timeframes share the same array reference", () => {
      const now = Math.floor(Date.now() / 1000);
      const candles = createCandles(100, now - (100 * 300), 300);

      // Same array reference for all timeframes (data corruption)
      const tf5m = candles;
      const tf1h = candles;
      const tf4h = candles;

      const isCritical = emitMTFDiagnostic("BTC/USD", tf5m, tf1h, tf4h);

      // Should be CRITICAL - same array reference
      expect(isCritical).toBe(true);
    });
  });

  describe("Test C: Identical spans (critical)", () => {
    it("should be CRITICAL when all timeframes have identical spans", () => {
      const now = Math.floor(Date.now() / 1000);
      
      // All timeframes have the same span (data corruption)
      const tf5m = createCandles(100, now - (100 * 300), 300);
      const tf1h = createCandles(100, now - (100 * 300), 300); // Wrong: should be 3600 step
      const tf4h = createCandles(100, now - (100 * 300), 300); // Wrong: should be 14400 step

      const isCritical = emitMTFDiagnostic("BTC/USD", tf5m, tf1h, tf4h);

      // Should be CRITICAL - identical spans
      expect(isCritical).toBe(true);
    });
  });

  describe("Test D: Wrong step for timeframe (critical)", () => {
    it("should be CRITICAL when 1h candles have 5m step", () => {
      const now = Math.floor(Date.now() / 1000);
      
      const tf5m = createCandles(100, now - (100 * 300), 300);
      const tf1h = createCandles(50, now - (50 * 300), 300); // Wrong: 5m step instead of 1h
      const tf4h = createCandles(50, now - (50 * 14400), 14400);

      const isCritical = emitMTFDiagnostic("BTC/USD", tf5m, tf1h, tf4h);

      // Should be CRITICAL - wrong step for 1h
      expect(isCritical).toBe(true);
    });

    it("should be CRITICAL when 4h candles have 1h step", () => {
      const now = Math.floor(Date.now() / 1000);
      
      const tf5m = createCandles(100, now - (100 * 300), 300);
      const tf1h = createCandles(50, now - (50 * 3600), 3600);
      const tf4h = createCandles(50, now - (50 * 3600), 3600); // Wrong: 1h step instead of 4h

      const isCritical = emitMTFDiagnostic("BTC/USD", tf5m, tf1h, tf4h);

      // Should be CRITICAL - wrong step for 4h
      expect(isCritical).toBe(true);
    });
  });

  describe("Test E: Exact first match (critical)", () => {
    it("should be CRITICAL when all timeframes start at same timestamp", () => {
      const now = Math.floor(Date.now() / 1000);
      const startTime = now - (100 * 3600);
      
      const tf5m = createCandles(100, startTime, 300);
      const tf1h = createCandles(50, startTime, 3600);
      const tf4h = createCandles(50, startTime, 14400);

      const isCritical = emitMTFDiagnostic("BTC/USD", tf5m, tf1h, tf4h);

      // Should be CRITICAL - exact first match
      expect(isCritical).toBe(true);
    });
  });

  describe("Test F: Valid multi-timeframe data (not critical)", () => {
    it("should NOT be critical when all timeframes have correct steps and different spans", () => {
      const now = Math.floor(Date.now() / 1000);
      
      const tf5m = createCandles(100, now - (100 * 300), 300);
      const tf1h = createCandles(50, now - (50 * 3600), 3600);
      const tf4h = createCandles(50, now - (50 * 14400), 14400);

      const isCritical = emitMTFDiagnostic("BTC/USD", tf5m, tf1h, tf4h);

      // Should NOT be critical - valid data
      expect(isCritical).toBe(false);
    });
  });

  describe("Test G: Empty or minimal data (not critical)", () => {
    it("should NOT be critical when timeframes have minimal data", () => {
      const tf5m: OHLCCandle[] = [];
      const tf1h: OHLCCandle[] = [];
      const tf4h: OHLCCandle[] = [];

      const isCritical = emitMTFDiagnostic("BTC/USD", tf5m, tf1h, tf4h);

      // Should NOT be critical - no data to validate
      expect(isCritical).toBe(false);
    });

    it("should NOT be critical when timeframes have only 1 candle", () => {
      const now = Math.floor(Date.now() / 1000);

      const tf5m = createCandles(1, now, 300);
      const tf1h = createCandles(1, now, 3600);
      const tf4h = createCandles(1, now, 14400);

      const isCritical = emitMTFDiagnostic("BTC/USD", tf5m, tf1h, tf4h);

      // Should NOT be critical - insufficient data for step validation
      // Note: With 1 candle, exactLast will be true (all same timestamp), but this is acceptable
      // The step validation will return 0, which is not > 0, so sameStepWrongTimeframe will be false
      expect(isCritical).toBe(false);
    });
  });
});
