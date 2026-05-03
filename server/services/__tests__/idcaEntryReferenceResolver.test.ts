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

  it("debe usar vwapContext.isReliable para determinar validez de anchor", () => {
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

    // vwapContext.isReliable = false debe invalidar el anchor
    const vwapContext = { isReliable: false } as any;

    const result = resolveEffectiveEntryReference({
      pair: "BTC/USD",
      currentPrice: 78500,
      basePriceResult,
      frozenAnchor,
      vwapContext,
      vwapEnabled: true,
    });

    // Si vwapContext.isReliable es false, debe usar fallback
    expect(result.effectiveReferenceSource).toBe("hybrid_v2_fallback");
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

  it("debe devolver reset threshold correcto para ETH/USD", () => {
    expect(getAnchorResetThreshold("ETH/USD")).toBe(0.0035); // 0.35%
  });

  it("debe devolver reset threshold default para otros pares", () => {
    expect(getAnchorResetThreshold("SOL/USD")).toBe(0.0075); // 0.75%
  });
});
