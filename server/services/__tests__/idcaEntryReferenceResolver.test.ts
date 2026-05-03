/**
 * Tests para IdcaEntryReferenceResolver
 * Verifican: resolución de referencia efectiva, thresholds, cooldowns
 */

import { describe, it, expect } from "vitest";
import {
  resolveEffectiveEntryReference,
  getAnchorUpdateThreshold,
  getAnchorUpdateCooldown,
  getAnchorResetThreshold,
  shouldUpdateAnchor,
  shouldResetAnchor,
  type VwapAnchorState,
} from "../institutionalDca/IdcaEntryReferenceResolver";
import type { BasePriceResult } from "../institutionalDca/IdcaTypes";

describe("IdcaEntryReferenceResolver", () => {
  it("debe usar frozenAnchorPrice como referencia efectiva cuando está disponible", () => {
    const basePriceResult: BasePriceResult = {
      price: 79000,
      type: "hybrid_v2",
      windowMinutes: 1440,
      timestamp: new Date(),
      isReliable: true,
      reason: "Hybrid V2.1 calculated",
    };

    const frozenAnchor = {
      anchorPrice: 79500,
      anchorTimestamp: Date.now() - 3600000,
      setAt: Date.now() - 3600000,
      drawdownPct: 0.5,
    };

    const result = resolveEffectiveEntryReference({
      pair: "BTC/USD",
      currentPrice: 78500,
      basePriceResult,
      frozenAnchor,
      vwapContext: undefined,
      vwapEnabled: true,
    });

    expect(result.effectiveEntryReference).toBe(79500);
    expect(result.effectiveReferenceSource).toBe("vwap_anchor");
    expect(result.effectiveReferenceLabel).toBe("VWAP Anclado");
    expect(result.technicalBasePrice).toBe(79000);
    expect(result.technicalBaseType).toBe("hybrid_v2");
  });

  it("debe usar basePrice como fallback cuando no hay frozenAnchor", () => {
    const basePriceResult: BasePriceResult = {
      price: 79000,
      type: "hybrid_v2",
      windowMinutes: 1440,
      timestamp: new Date(),
      isReliable: true,
      reason: "Hybrid V2.1 calculated",
    };

    const result = resolveEffectiveEntryReference({
      pair: "BTC/USD",
      currentPrice: 78500,
      basePriceResult,
      frozenAnchor: undefined,
      vwapContext: undefined,
      vwapEnabled: false,
    });

    expect(result.effectiveEntryReference).toBe(79000);
    expect(result.effectiveReferenceSource).toBe("hybrid_v2_fallback");
    expect(result.effectiveReferenceLabel).toBe("Hybrid V2.1");
    expect(result.technicalBasePrice).toBe(79000);
  });

  it("debe marcar referenceChangedRecently como true si cambió hace <24h", () => {
    const basePriceResult: BasePriceResult = {
      price: 79000,
      type: "hybrid_v2",
      windowMinutes: 1440,
      timestamp: new Date(Date.now() - 3600000), // hace 1h
      isReliable: true,
      reason: "Hybrid V2.1 calculated",
    };

    const result = resolveEffectiveEntryReference({
      pair: "BTC/USD",
      currentPrice: 78500,
      basePriceResult,
      frozenAnchor: undefined,
      vwapContext: undefined,
      vwapEnabled: false,
    });

    expect(result.referenceChangedRecently).toBe(true);
  });

  it("debe marcar referenceChangedRecently como false si cambió hace >24h", () => {
    const basePriceResult: BasePriceResult = {
      price: 79000,
      type: "hybrid_v2",
      windowMinutes: 1440,
      timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000), // hace 48h
      isReliable: true,
      reason: "Hybrid V2.1 calculated",
    };

    const result = resolveEffectiveEntryReference({
      pair: "BTC/USD",
      currentPrice: 78500,
      basePriceResult,
      frozenAnchor: undefined,
      vwapContext: undefined,
      vwapEnabled: false,
    });

    expect(result.referenceChangedRecently).toBe(false);
  });

  it("debe incluir previousAnchor cuando existe", () => {
    const basePriceResult: BasePriceResult = {
      price: 79000,
      type: "hybrid_v2",
      windowMinutes: 1440,
      timestamp: new Date(),
      isReliable: true,
      reason: "Hybrid V2.1 calculated",
    };

    const frozenAnchor = {
      anchorPrice: 79500,
      anchorTimestamp: Date.now() - 3600000,
      setAt: Date.now() - 3600000,
      drawdownPct: 0.5,
      previous: {
        anchorPrice: 79000,
        anchorTimestamp: Date.now() - 7200000,
        setAt: Date.now() - 7200000,
        replacedAt: Date.now() - 3600000,
      },
    };

    const result = resolveEffectiveEntryReference({
      pair: "BTC/USD",
      currentPrice: 78500,
      basePriceResult,
      frozenAnchor,
      vwapContext: undefined,
      vwapEnabled: true,
    });

    expect(result.previousAnchor).toBeDefined();
    expect(result.previousAnchor?.anchorPrice).toBe(79000);
  });

  it("debe incluir frozenAnchorCandleAgeHours cuando existe frozenAnchor", () => {
    const basePriceResult: BasePriceResult = {
      price: 79000,
      type: "hybrid_v2",
      windowMinutes: 1440,
      timestamp: new Date(),
      isReliable: true,
      reason: "Hybrid V2.1 calculated",
    };

    const frozenAnchor = {
      anchorPrice: 79500,
      anchorTimestamp: Date.now() - 7200000, // hace 2h
      setAt: Date.now() - 3600000, // hace 1h
      drawdownPct: 0.5,
    };

    const result = resolveEffectiveEntryReference({
      pair: "BTC/USD",
      currentPrice: 78500,
      basePriceResult,
      frozenAnchor,
      vwapContext: undefined,
      vwapEnabled: true,
    });

    expect(result.frozenAnchorCandleAgeHours).toBeDefined();
    expect(result.frozenAnchorCandleAgeHours).toBeGreaterThan(1); // vela de hace 2h
    expect(result.frozenAnchorAgeHours).toBeDefined();
    expect(result.frozenAnchorAgeHours).toBeGreaterThan(0); // fijada hace 1h
  });

  it("debe mantener frozenAnchor efectivo aunque vwapContext.isReliable=false", () => {
    const basePriceResult: BasePriceResult = {
      price: 79000,
      type: "hybrid_v2",
      windowMinutes: 1440,
      timestamp: new Date(),
      isReliable: true,
      reason: "Hybrid V2.1 calculated",
    };

    const frozenAnchor = {
      anchorPrice: 79500,
      anchorTimestamp: Date.now() - 3600000,
      setAt: Date.now() - 3600000,
      drawdownPct: 0.5,
    };

    // vwapContext.isReliable = false NO debe invalidar el anchor persistido
    const vwapContext = { isReliable: false } as any;

    const result = resolveEffectiveEntryReference({
      pair: "BTC/USD",
      currentPrice: 78500,
      basePriceResult,
      frozenAnchor,
      vwapContext,
      vwapEnabled: true,
    });

    // Frozen anchor debe seguir siendo la referencia efectiva
    expect(result.effectiveReferenceSource).toBe("vwap_anchor");
    expect(result.effectiveEntryReference).toBe(79500);
    expect(result.technicalBasePrice).toBe(79000);
  });

  it("debe usar anchor si vwapContext no está disponible", () => {
    const basePriceResult: BasePriceResult = {
      price: 79000,
      type: "hybrid_v2",
      windowMinutes: 1440,
      timestamp: new Date(),
      isReliable: true,
      reason: "Hybrid V2.1 calculated",
    };

    const frozenAnchor = {
      anchorPrice: 79500,
      anchorTimestamp: Date.now() - 3600000,
      setAt: Date.now() - 3600000,
      drawdownPct: 0.5,
    };

    const result = resolveEffectiveEntryReference({
      pair: "BTC/USD",
      currentPrice: 78500,
      basePriceResult,
      frozenAnchor,
      vwapContext: undefined, // no disponible
      vwapEnabled: true,
    });

    // Sin vwapContext, debe usar anchor si está disponible
    expect(result.effectiveReferenceSource).toBe("vwap_anchor");
  });

  it("caso específico ETH: frozenAnchor=2424.05, basePrice=2341.44, vwapContext.isReliable=false -> debe usar vwap_anchor", () => {
    const basePriceResult: BasePriceResult = {
      price: 2341.44,
      type: "hybrid_v2",
      windowMinutes: 1440,
      timestamp: new Date(),
      isReliable: true,
      reason: "Hybrid V2.1 calculated",
    };

    const frozenAnchor = {
      anchorPrice: 2424.05,
      anchorTimestamp: Date.now() - 3600000,
      setAt: Date.now() - 3600000,
      drawdownPct: 3.4,
    };

    const vwapContext = { isReliable: false } as any;

    const result = resolveEffectiveEntryReference({
      pair: "ETH/USD",
      currentPrice: 2345.00,
      basePriceResult,
      frozenAnchor,
      vwapContext,
      vwapEnabled: true,
    });

    // Frozen anchor debe seguir siendo la referencia efectiva aunque VWAP actual no sea fiable
    expect(result.effectiveReferenceSource).toBe("vwap_anchor");
    expect(result.effectiveEntryReference).toBe(2424.05);
    expect(result.technicalBasePrice).toBe(2341.44);
    expect(result.effectiveReferenceLabel).toBe("VWAP Anclado");
  });

  it("vwapEnabled=false + frozenAnchor existente -> fallback a Hybrid V2.1", () => {
    const basePriceResult: BasePriceResult = {
      price: 79000,
      type: "hybrid_v2",
      windowMinutes: 1440,
      timestamp: new Date(),
      isReliable: true,
      reason: "Hybrid V2.1 calculated",
    };

    const frozenAnchor = {
      anchorPrice: 79500,
      anchorTimestamp: Date.now() - 3600000,
      setAt: Date.now() - 3600000,
      drawdownPct: 0.5,
    };

    const result = resolveEffectiveEntryReference({
      pair: "BTC/USD",
      currentPrice: 78500,
      basePriceResult,
      frozenAnchor,
      vwapContext: undefined,
      vwapEnabled: false, // VWAP deshabilitado
    });

    // Si vwapEnabled=false, debe usar fallback a Hybrid V2.1
    expect(result.effectiveReferenceSource).toBe("hybrid_v2_fallback");
    expect(result.effectiveEntryReference).toBe(79000);
    expect(result.effectiveReferenceLabel).toBe("Hybrid V2.1");
  });

  it("vwapEnabled=true + sin frozenAnchor -> fallback a Hybrid V2.1", () => {
    const basePriceResult: BasePriceResult = {
      price: 79000,
      type: "hybrid_v2",
      windowMinutes: 1440,
      timestamp: new Date(),
      isReliable: true,
      reason: "Hybrid V2.1 calculated",
    };

    const result = resolveEffectiveEntryReference({
      pair: "BTC/USD",
      currentPrice: 78500,
      basePriceResult,
      frozenAnchor: undefined, // no hay anchor
      vwapContext: undefined,
      vwapEnabled: true,
    });

    // Si no hay frozenAnchor, debe usar fallback a Hybrid V2.1
    expect(result.effectiveReferenceSource).toBe("hybrid_v2_fallback");
    expect(result.effectiveEntryReference).toBe(79000);
    expect(result.effectiveReferenceLabel).toBe("Hybrid V2.1");
  });
});

describe("Anchor thresholds y cooldowns", () => {
  it("debe devolver threshold correcto para BTC/USD", () => {
    expect(getAnchorUpdateThreshold("BTC/USD")).toBe(0.0035); // 0.35%
  });

  it("debe devolver threshold correcto para ETH/USD", () => {
    expect(getAnchorUpdateThreshold("ETH/USD")).toBe(0.0050); // 0.50%
  });

  it("debe devolver threshold default para otros pares", () => {
    expect(getAnchorUpdateThreshold("SOL/USD")).toBe(0.0100); // 1.00%
  });

  it("debe devolver cooldown correcto para BTC/USD", () => {
    expect(getAnchorUpdateCooldown("BTC/USD")).toBe(6 * 60 * 60 * 1000); // 6h
  });

  it("debe devolver cooldown correcto para ETH/USD", () => {
    expect(getAnchorUpdateCooldown("ETH/USD")).toBe(6 * 60 * 60 * 1000); // 6h
  });

  it("debe devolver cooldown default para otros pares", () => {
    expect(getAnchorUpdateCooldown("SOL/USD")).toBe(12 * 60 * 60 * 1000); // 12h
  });

  it("debe devolver reset threshold correcto para BTC/USD", () => {
    expect(getAnchorResetThreshold("BTC/USD")).toBe(0.0025); // 0.25%
  });

  it("debe devolver threshold correcto para ETH/USD", () => {
    expect(getAnchorResetThreshold("ETH/USD")).toBe(0.0035); // 0.35%
  });

  it("debe devolver threshold default para par desconocido", () => {
    expect(getAnchorResetThreshold("SOL/USD")).toBe(0.0075); // 0.75%
  });
});

describe("shouldUpdateAnchor", () => {
  it("debe bloquear update por cooldown", () => {
    const result = shouldUpdateAnchor({
      pair: "BTC/USD",
      currentPrice: 80000,
      newSwingPrice: 80050,
      anchorPrice: 79000,
      anchorSetAt: Date.now() - 3600000, // hace 1h
      now: Date.now(),
    });
    expect(result.shouldUpdate).toBe(false);
    expect(result.reason).toContain("cooldown");
  });

  it("debe bloquear update por threshold insuficiente", () => {
    const result = shouldUpdateAnchor({
      pair: "BTC/USD",
      currentPrice: 80000,
      newSwingPrice: 79050, // +0.06% (threshold es 0.35%)
      anchorPrice: 79000,
      anchorSetAt: Date.now() - 7 * 3600000, // hace 7h
      now: Date.now(),
    });
    expect(result.shouldUpdate).toBe(false);
    expect(result.reason).toContain("threshold");
  });

  it("debe permitir update cuando threshold y cooldown cumplidos", () => {
    const result = shouldUpdateAnchor({
      pair: "BTC/USD",
      currentPrice: 80000,
      newSwingPrice: 79300, // +0.38% (threshold es 0.35%)
      anchorPrice: 79000,
      anchorSetAt: Date.now() - 7 * 3600000, // hace 7h
      now: Date.now(),
    });
    expect(result.shouldUpdate).toBe(true);
    expect(result.reason).toBe("threshold and cooldown satisfied");
  });
});

describe("shouldResetAnchor", () => {
  it("debe bloquear reset por threshold insuficiente", () => {
    const result = shouldResetAnchor({
      pair: "BTC/USD",
      currentPrice: 79050, // +0.06% (reset threshold es 0.25%)
      anchorPrice: 79000,
    });
    expect(result.shouldReset).toBe(false);
    expect(result.reason).toContain("reset threshold");
  });

  it("debe permitir reset cuando threshold cumplido", () => {
    const result = shouldResetAnchor({
      pair: "BTC/USD",
      currentPrice: 79200, // +0.25% (reset threshold es 0.25%)
      anchorPrice: 79000,
    });
    expect(result.shouldReset).toBe(true);
    expect(result.reason).toContain("above reset threshold");
  });
});
