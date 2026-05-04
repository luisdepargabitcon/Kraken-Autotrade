/**
 * idcaEffectiveConfig.test.ts
 * Tests: Sliders como fuente única para minDip (FASE 4)
 * - BTC: mínimo 3.00% (patience=0) → 5.20% (patience=100)
 * - ETH: mínimo 3.30% (patience=0) → 6.00% (patience=100)
 * - Legacy assetConfig.minDipPct NO debe usarse si sliders presentes
 */
import { describe, it, expect } from "vitest";
import {
  getEffectiveEntryConfig,
  deriveEntryConfigFromSliders,
  ENTRY_SLIDER_DEFAULTS,
} from "../institutionalDca/IdcaSliderConfig";

describe("Effective Config — sliders como fuente única (FASE 4)", () => {
  describe("BTC/USD — mínimos de dip", () => {
    it("patience=0 => effectiveMinDipPct=3.00 (floor BTC)", () => {
      const result = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: 0 }, "BTC/USD");
      expect(result.effectiveMinDipPct).toBeCloseTo(3.00, 2);
    });

    it("patience=50 => effectiveMinDipPct=3.70 (mid BTC)", () => {
      const result = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: 50 }, "BTC/USD");
      expect(result.effectiveMinDipPct).toBeCloseTo(3.70, 2);
    });

    it("patience=70 => effectiveMinDipPct=4.20 (default BTC)", () => {
      const result = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: 70 }, "BTC/USD");
      expect(result.effectiveMinDipPct).toBeCloseTo(4.20, 2);
    });

    it("patience=100 => effectiveMinDipPct=5.20 (max BTC)", () => {
      const result = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: 100 }, "BTC/USD");
      expect(result.effectiveMinDipPct).toBeCloseTo(5.20, 2);
    });

    it("BTC floor es siempre >= 3.00%", () => {
      for (const p of [0, 10, 25, 50, 70, 90, 100]) {
        const result = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: p }, "BTC/USD");
        expect(result.effectiveMinDipPct).toBeGreaterThanOrEqual(3.00);
      }
    });
  });

  describe("ETH/USD — mínimos de dip", () => {
    it("patience=0 => effectiveMinDipPct=3.30 (floor ETH)", () => {
      const result = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: 0 }, "ETH/USD");
      expect(result.effectiveMinDipPct).toBeCloseTo(3.30, 2);
    });

    it("patience=50 => effectiveMinDipPct=4.00 (mid ETH)", () => {
      const result = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: 50 }, "ETH/USD");
      expect(result.effectiveMinDipPct).toBeCloseTo(4.00, 2);
    });

    it("patience=70 => effectiveMinDipPct=4.60 (default ETH)", () => {
      const result = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: 70 }, "ETH/USD");
      expect(result.effectiveMinDipPct).toBeCloseTo(4.60, 2);
    });

    it("ETH floor es siempre >= 3.30% (NUNCA 1.50%)", () => {
      for (const p of [0, 10, 25, 50, 70, 90, 100]) {
        const result = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: p }, "ETH/USD");
        expect(result.effectiveMinDipPct).toBeGreaterThanOrEqual(3.30);
        expect(result.effectiveMinDipPct).not.toBeCloseTo(1.50, 1);
      }
    });
  });

  describe("getEffectiveEntryConfig — defaults aplicados si entryUiJson vacío", () => {
    it("config null => usa ENTRY_SLIDER_DEFAULTS (BTC)", () => {
      const result = getEffectiveEntryConfig(null, "BTC/USD");
      expect(result.effectiveMinDipPct).toBeCloseTo(4.20, 2);
    });

    it("config vacío => usa ENTRY_SLIDER_DEFAULTS (ETH)", () => {
      const result = getEffectiveEntryConfig({}, "ETH/USD");
      expect(result.effectiveMinDipPct).toBeCloseTo(4.60, 2);
    });

    it("entryUiJson con patience=50 overrides default", () => {
      const result = getEffectiveEntryConfig({ entryUiJson: { entryPatienceLevel: 50 } }, "BTC/USD");
      expect(result.effectiveMinDipPct).toBeCloseTo(3.70, 2);
    });

    it("legacy minDipPct=1.50 NO se usa cuando sliders presentes", () => {
      const result = getEffectiveEntryConfig({ entryUiJson: { entryPatienceLevel: 70 } }, "ETH/USD");
      expect(result.effectiveMinDipPct).toBeGreaterThan(1.50);
      expect(result.effectiveMinDipPct).toBeCloseTo(4.60, 2);
    });
  });

  describe("buyThreshold = effectiveRef * (1 - minDipPct/100)", () => {
    it("BTC efectiveRef=80000, patience=70 => buyThreshold≈76640", () => {
      const derived = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: 70 }, "BTC/USD");
      const buyThreshold = 80000 * (1 - derived.effectiveMinDipPct / 100);
      expect(buyThreshold).toBeCloseTo(80000 * 0.958, 0);
    });

    it("ETH efectiveRef=2500, patience=70 => buyThreshold≈2385 (nunca 2463 con 1.50%)", () => {
      const derived = deriveEntryConfigFromSliders({ ...ENTRY_SLIDER_DEFAULTS, entryPatienceLevel: 70 }, "ETH/USD");
      const buyThreshold = 2500 * (1 - derived.effectiveMinDipPct / 100);
      expect(buyThreshold).toBeLessThan(2500 * 0.98);  // al menos 2% caída
      const legacyThreshold = 2500 * (1 - 1.50 / 100);
      expect(buyThreshold).toBeLessThan(legacyThreshold);
    });
  });
});
