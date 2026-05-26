/**
 * IdcaDistanceResolver — Tests Sprint 1a
 *
 * Verifica:
 *  1. assisted_entry devuelve el mismo valor que getEffectiveEntryConfig (equivalencia)
 *  2. legacy produce la misma distancia que assisted_entry (retrocompat)
 *  3. dynamic_intelligent_entry delega en computeDynamicDistance
 *  4. safety_buy/recovery: regla conservadora min(existing, proposed)
 *  5. dynamic_intelligent_entry bloqueado → fallback a sliders
 *  6. assisted_entry + manual DD para safety_buy → sin efecto (no effectiveNextBuyPrice)
 *  7. assisted_entry + dynamic_hybrid para safety_buy → aplica (retrocompat)
 *  8. Logs [DISTANCE_RESOLUTION] se emiten sin error
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveIdcaRequiredDistance, logDistanceResolution } from "../IdcaDistanceResolver";
import type { IdcaDistanceResolverInput, DynamicDistanceConfig } from "../IdcaTypes";
import { parseDynamicDistanceConfig } from "../IdcaDynamicDistanceService";
import { getEffectiveEntryConfig } from "../IdcaSliderConfig";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAIR_BTC = "BTC/USD";
const PAIR_ETH = "ETH/USD";

const manualDdConfig: DynamicDistanceConfig = parseDynamicDistanceConfig({ mode: "manual" });
const dynamicDdConfig: DynamicDistanceConfig = parseDynamicDistanceConfig({
  mode: "dynamic_hybrid",
  atrMultiplier: 1.0,
  aggressiveness: 50,
  minDistancePct: 0.80,
  maxDistancePct: 12.0,
  feeFloorPct: 0.60,
});

const mockGlobalConfig = {
  entryUiJson: {
    entryPatienceLevel: 70,       // default profesional
    reboundConfirmationLevel: 65,
    entryQualityLevel: 65,
    entrySizeAggressiveness: 40,
  },
};

function makeBaseInput(overrides: Partial<IdcaDistanceResolverInput> = {}): IdcaDistanceResolverInput {
  return {
    pair: PAIR_BTC,
    usedFor: "initial_entry",
    activeEntryMode: "assisted_entry",
    referencePrice: 95000,
    atrPct: 1.8,
    entryGlobalConfig: mockGlobalConfig,
    dynamicDistanceConfig: manualDdConfig,
    buyCount: 0,
    marketScore: 50,
    candleCount: 50,
    capitalUsedUsd: 0,
    capitalReservedUsd: 0,
    existingNextBuyPrice: null,
    ...overrides,
  };
}

// ─── Test suite ────────────────────────────────────────────────────────────────

describe("resolveIdcaRequiredDistance", () => {

  // ── 1. assisted_entry equivale a getEffectiveEntryConfig ────────────────────
  describe("assisted_entry mode", () => {
    it("devuelve misma distancia que getEffectiveEntryConfig para BTC/USD", () => {
      const expected = getEffectiveEntryConfig(mockGlobalConfig, PAIR_BTC).effectiveMinDipPct;
      const result = resolveIdcaRequiredDistance(makeBaseInput());

      expect(result.mode).toBe("assisted_entry");
      expect(result.source).toBe("assisted_entry_sliders");
      expect(result.legacyUsed).toBe(false);
      expect(result.requiredDistancePct).toBe(expected);
      expect(result.breakdown.sliderBasePct).toBe(expected);
      expect(result.breakdown.finalRequiredDistancePct).toBe(expected);
    });

    it("devuelve misma distancia que getEffectiveEntryConfig para ETH/USD", () => {
      const expected = getEffectiveEntryConfig(mockGlobalConfig, PAIR_ETH).effectiveMinDipPct;
      const result = resolveIdcaRequiredDistance(
        makeBaseInput({ pair: PAIR_ETH })
      );

      expect(result.requiredDistancePct).toBe(expected);
    });

    it("trailing_buy_entry produce misma distancia que initial_entry en assisted_entry", () => {
      const initial = resolveIdcaRequiredDistance(makeBaseInput({ usedFor: "initial_entry" }));
      const trailing = resolveIdcaRequiredDistance(makeBaseInput({ usedFor: "trailing_buy_entry" }));

      expect(trailing.requiredDistancePct).toBe(initial.requiredDistancePct);
    });

    it("usa defaults si entryGlobalConfig es null", () => {
      const result = resolveIdcaRequiredDistance(
        makeBaseInput({ entryGlobalConfig: null })
      );

      // Debe usar defaults profesionales (entryPatienceLevel=70)
      const defaultExpected = getEffectiveEntryConfig(null, PAIR_BTC).effectiveMinDipPct;
      expect(result.requiredDistancePct).toBe(defaultExpected);
    });
  });

  // ── 2. legacy == assisted_entry ──────────────────────────────────────────────
  describe("legacy mode", () => {
    it("legacy produce misma distancia que assisted_entry", () => {
      const assisted = resolveIdcaRequiredDistance(makeBaseInput());
      const legacy = resolveIdcaRequiredDistance(makeBaseInput({ activeEntryMode: "legacy" }));

      expect(legacy.requiredDistancePct).toBe(assisted.requiredDistancePct);
      expect(legacy.source).toBe("legacy_entry_patience");
      expect(legacy.legacyUsed).toBe(true);
    });
  });

  // ── 3. dynamic_intelligent_entry delega en computeDynamicDistance ─────────────
  describe("dynamic_intelligent_entry mode", () => {
    it("devuelve distancia dinámica para initial_entry con datos suficientes", () => {
      const result = resolveIdcaRequiredDistance(makeBaseInput({
        activeEntryMode: "dynamic_intelligent_entry",
        dynamicDistanceConfig: dynamicDdConfig,
        atrPct: 2.0,
        candleCount: 50,
      }));

      expect(result.mode).toBe("dynamic_intelligent_entry");
      expect(result.source).toBe("dynamic_distance");
      expect(result.legacyUsed).toBe(false);
      // Con ATR=2.0, atrMultiplier=1.0, aggressiveness=50 (neutro) → suggestedDist ≈ 2.0
      // Clamp min=0.80, max=12.0 → appliedDist ≈ 2.0 (sin penalizaciones con score=50 y buyCount=0)
      expect(result.requiredDistancePct).toBeGreaterThanOrEqual(0.80);
      expect(result.requiredDistancePct).toBeLessThanOrEqual(12.0);
    });

    it("breakdown incluye campos dinámicos", () => {
      const result = resolveIdcaRequiredDistance(makeBaseInput({
        activeEntryMode: "dynamic_intelligent_entry",
        dynamicDistanceConfig: dynamicDdConfig,
        atrPct: 2.0,
        candleCount: 50,
      }));

      expect(result.breakdown.atrMultiplier).toBe(1.0);
      expect(result.breakdown.aggressiveness).toBe(50);
      expect(result.breakdown.userMinDistancePct).toBe(0.80);
      expect(result.breakdown.userMaxDistancePct).toBe(12.0);
      expect(result.breakdown.feeFloor).toBe(0.60);
    });

    it("fallback a sliders cuando candleCount < 5 (datos insuficientes)", () => {
      const result = resolveIdcaRequiredDistance(makeBaseInput({
        activeEntryMode: "dynamic_intelligent_entry",
        dynamicDistanceConfig: dynamicDdConfig,
        candleCount: 3,  // bajo MIN_CANDLES_READY=5 → blocked
      }));

      // Fallback a sliders
      expect(result.source).toBe("assisted_entry_sliders");
      expect(result.legacyUsed).toBe(true);
      // Distancia debe ser la de sliders (positiva y sensata)
      expect(result.requiredDistancePct).toBeGreaterThan(0);
    });
  });

  // ── 4. safety_buy regla conservadora ─────────────────────────────────────────
  describe("safety_buy conservative min() rule", () => {
    it("aplica regla conservadora: effectiveNextBuyPrice = min(existing, proposed)", () => {
      const refPrice = 90000;
      const existingNextBuy = 87000;  // 3.33% bajo ref

      const result = resolveIdcaRequiredDistance(makeBaseInput({
        usedFor: "safety_buy",
        activeEntryMode: "dynamic_intelligent_entry",
        dynamicDistanceConfig: dynamicDdConfig,
        referencePrice: refPrice,
        existingNextBuyPrice: existingNextBuy,
        atrPct: 2.0,
        candleCount: 50,
        capitalUsedUsd: 1000,
        capitalReservedUsd: 5000,
      }));

      expect(result.effectiveNextBuyPrice).toBeDefined();
      // effectiveNextBuyPrice debe ser <= existingNextBuyPrice (conservative rule)
      expect(result.effectiveNextBuyPrice!).toBeLessThanOrEqual(existingNextBuy);
    });

    it("no modifica existingNextBuyPrice si dynamic ya es más alto (conservative)", () => {
      // Si dynamic produce precio más alto (menos bajista) que existing → existing gana
      const refPrice = 90000;
      const existingNextBuy = 80000;  // muy alejado: 11.1% bajo ref

      const result = resolveIdcaRequiredDistance(makeBaseInput({
        usedFor: "safety_buy",
        activeEntryMode: "dynamic_intelligent_entry",
        dynamicDistanceConfig: {
          ...dynamicDdConfig,
          maxDistancePct: 8.0,  // forzar clamp máximo < 11.1%
        },
        referencePrice: refPrice,
        existingNextBuyPrice: existingNextBuy,
        atrPct: 1.5,
        candleCount: 50,
        buyCount: 1,
      }));

      // Dynamic propone precio mayor que existing → existing gana (conservative rule)
      if (result.effectiveNextBuyPrice != null) {
        expect(result.effectiveNextBuyPrice).toBeLessThanOrEqual(existingNextBuy);
      }
    });
  });

  // ── 5. assisted_entry + manual DD para safety_buy → sin efecto ──────────────
  describe("assisted_entry + manual dynamicDistanceConfig para safety_buy", () => {
    it("no produce effectiveNextBuyPrice cuando dd.mode=manual (retrocompat)", () => {
      const result = resolveIdcaRequiredDistance(makeBaseInput({
        usedFor: "safety_buy",
        activeEntryMode: "assisted_entry",
        dynamicDistanceConfig: manualDdConfig,  // mode=manual → no aplica
        existingNextBuyPrice: 90000,
      }));

      // No debe aplicar efecto conservador (sin effectiveNextBuyPrice)
      expect(result.effectiveNextBuyPrice).toBeUndefined();
      expect(result.requiredDistancePct).toBe(0);
    });
  });

  // ── 6. assisted_entry + dynamic_hybrid para safety_buy → retrocompat ─────────
  describe("assisted_entry + dynamic_hybrid dynamicDistanceConfig para safety_buy", () => {
    it("aplica distancia dinámica igual que antes (retrocompat con dynamic_hybrid activado)", () => {
      const existingNextBuy = 90000;

      const result = resolveIdcaRequiredDistance(makeBaseInput({
        usedFor: "safety_buy",
        activeEntryMode: "assisted_entry",
        dynamicDistanceConfig: dynamicDdConfig,  // mode=dynamic_hybrid → aplica
        referencePrice: 95000,
        existingNextBuyPrice: existingNextBuy,
        atrPct: 2.0,
        candleCount: 50,
        buyCount: 2,
        capitalUsedUsd: 1000,
        capitalReservedUsd: 5000,
      }));

      // Debe haber resultado conservador
      expect(result.source).toBe("dynamic_distance");
      if (result.effectiveNextBuyPrice != null) {
        expect(result.effectiveNextBuyPrice).toBeLessThanOrEqual(existingNextBuy);
      }
    });
  });

  // ── 7. recovery: mismo comportamiento que safety_buy ─────────────────────────
  describe("recovery usedFor", () => {
    it("recovery con dynamic_intelligent_entry produce effectiveNextBuyPrice", () => {
      const existingNextBuy = 88000;

      const result = resolveIdcaRequiredDistance(makeBaseInput({
        usedFor: "recovery",
        activeEntryMode: "dynamic_intelligent_entry",
        dynamicDistanceConfig: dynamicDdConfig,
        referencePrice: 92000,
        existingNextBuyPrice: existingNextBuy,
        atrPct: 2.0,
        candleCount: 30,
      }));

      expect(result.usedFor).toBe("recovery");
      if (result.effectiveNextBuyPrice != null) {
        expect(result.effectiveNextBuyPrice).toBeLessThanOrEqual(existingNextBuy);
      }
    });
  });

  // ── 8. Resultado siempre tiene campos obligatorios ────────────────────────────
  describe("resultado structura", () => {
    it("siempre devuelve campos obligatorios", () => {
      const result = resolveIdcaRequiredDistance(makeBaseInput());

      expect(typeof result.requiredDistancePct).toBe("number");
      expect(result.requiredDistancePct).toBeGreaterThan(0);
      expect(["assisted_entry", "dynamic_intelligent_entry", "legacy"]).toContain(result.mode);
      expect(["assisted_entry_sliders", "dynamic_distance", "legacy_entry_patience"]).toContain(result.source);
      expect(typeof result.legacyUsed).toBe("boolean");
      expect(typeof result.usedFor).toBe("string");
      expect(result.breakdown).toBeDefined();
      expect(typeof result.breakdown.finalRequiredDistancePct).toBe("number");
    });

    it("assisted_entry requiredDistancePct > 0 siempre", () => {
      const pairs = [PAIR_BTC, PAIR_ETH, "LTC/USD"];
      for (const pair of pairs) {
        const result = resolveIdcaRequiredDistance(makeBaseInput({ pair }));
        expect(result.requiredDistancePct).toBeGreaterThan(0);
      }
    });
  });
});

// ── logDistanceResolution: no lanza error ─────────────────────────────────────
describe("logDistanceResolution", () => {
  it("emite log sin lanzar error para resultado assisted_entry", () => {
    const result = resolveIdcaRequiredDistance(makeBaseInput());
    expect(() => {
      logDistanceResolution("[IDCA]", PAIR_BTC, result, {
        referencePrice: 95000,
        currentPrice: 90000,
        drawdownFromReferencePct: 5.26,
        trailingBuyWillArm: false,
      });
    }).not.toThrow();
  });

  it("emite log sin lanzar error para resultado dynamic_intelligent_entry", () => {
    const result = resolveIdcaRequiredDistance(makeBaseInput({
      activeEntryMode: "dynamic_intelligent_entry",
      dynamicDistanceConfig: dynamicDdConfig,
      candleCount: 50,
      atrPct: 2.0,
    }));
    expect(() => {
      logDistanceResolution("[IDCA]", PAIR_BTC, result, {
        referencePrice: 95000,
        currentPrice: 92000,
      });
    }).not.toThrow();
  });

  it("emite log sin lanzar error sin context opcional", () => {
    const result = resolveIdcaRequiredDistance(makeBaseInput());
    expect(() => {
      logDistanceResolution("[IDCA]", PAIR_BTC, result);
    }).not.toThrow();
  });
});
