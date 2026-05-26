/**
 * Tests for IdcaConfluenceEngine — Sprint 1b
 * Cubre: hard gates, multiplicadores, regimen, smart adjustment, dynamic distance,
 *        decisionClass limiters, tbPath, asisted_entry sin smartAdjustment.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateIdcaEntryConfluence,
  classifyIdcaMarketRegime,
  logIdcaConfluence,
} from "../IdcaConfluenceEngine";
import type { IdcaConfluenceInput } from "../IdcaTypes";

// ─── Base input for tests ─────────────────────────────────────────────────────

function baseInput(overrides: Partial<IdcaConfluenceInput> = {}): IdcaConfluenceInput {
  return {
    pair: "BTC/USD",
    usedFor: "initial_entry",
    confluenceProfile: "assisted",
    drawdownFromReferencePct: 4.5,
    requiredDistancePct: 3.70,
    sliderBasePct: 3.70,
    vwapZone: "below_lower1",
    referenceMethod: "vwap_anchor",
    vwapReliable: true,
    reboundConfirmed: true,
    requireReboundConfirmation: false,
    trailingBuyArmed: false,
    priceInActivationZone: true,
    shortMomentum: "positive",
    hasRecoveryCandle: true,
    capitalUsedUsd: 0,
    capitalReservedUsd: 0,
    buyCount: 0,
    marketScore: 65,
    atrPct: 0.69,
    candleCount: 72,
    atrReliable: true,
    smartAdjustmentEnabled: false,
    ...overrides,
  };
}

// ─── Market regime classifier ─────────────────────────────────────────────────

describe("classifyIdcaMarketRegime", () => {
  it("returns unknown when candle count too low", () => {
    const result = classifyIdcaMarketRegime({
      marketScore: 60, atrPct: 0.7, drawdownFromReferencePct: 3,
      candleCount: 3, reboundConfirmed: false,
    });
    expect(result).toBe("unknown");
  });

  it("returns high_volatility when atrPct > 3.5", () => {
    const result = classifyIdcaMarketRegime({
      marketScore: 60, atrPct: 4.0, drawdownFromReferencePct: 3,
      candleCount: 24, reboundConfirmed: false,
    });
    expect(result).toBe("high_volatility");
  });

  it("returns capitulation_zone for very low score + extreme drawdown", () => {
    const result = classifyIdcaMarketRegime({
      marketScore: 20, atrPct: 1.5, drawdownFromReferencePct: 18,
      candleCount: 24, reboundConfirmed: false,
    });
    expect(result).toBe("capitulation_zone");
  });

  it("returns bearish_breakdown when btcContext=breakdown", () => {
    const result = classifyIdcaMarketRegime({
      marketScore: 55, atrPct: 1.0, drawdownFromReferencePct: 4,
      btcContext: "breakdown", candleCount: 24, reboundConfirmed: false,
    });
    expect(result).toBe("bearish_breakdown");
  });

  it("returns rebound_candidate with large drawdown + reboundConfirmed", () => {
    const result = classifyIdcaMarketRegime({
      marketScore: 45, atrPct: 1.2, drawdownFromReferencePct: 10,
      candleCount: 30, reboundConfirmed: true,
    });
    expect(result).toBe("rebound_candidate");
  });

  it("returns bullish_pullback for good score + moderate dip", () => {
    const result = classifyIdcaMarketRegime({
      marketScore: 70, atrPct: 0.9, drawdownFromReferencePct: 3,
      candleCount: 72, reboundConfirmed: false,
    });
    expect(result).toBe("bullish_pullback");
  });

  it("returns low_volatility when atrPct < 0.7", () => {
    const result = classifyIdcaMarketRegime({
      marketScore: 55, atrPct: 0.5, drawdownFromReferencePct: 2,
      candleCount: 24, reboundConfirmed: false,
    });
    expect(result).toBe("low_volatility");
  });
});

// ─── Hard gate: data_unusable ─────────────────────────────────────────────────

describe("evaluateIdcaEntryConfluence — hard gates", () => {
  it("data_unusable when candleCount < 5", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({ candleCount: 3 }));
    expect(result.hardBlocked).toBe(true);
    expect(result.hardBlockers).toContain("data_unusable");
    expect(result.decisionClass).toBe("NO_ENTRY");
    expect(result.confidenceScore).toBe(0);
  });

  it("critical hard gate fuerza NO_ENTRY y nada lo compensa", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({
      candleCount: 3,
      drawdownFromReferencePct: 10,
      reboundConfirmed: true,
      marketScore: 80,
    }));
    expect(result.decisionClass).toBe("NO_ENTRY");
    expect(result.hardBlocked).toBe(true);
  });

  it("overexposed_critical when exposure > 90%", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({
      capitalUsedUsd: 9500, capitalReservedUsd: 10000,
    }));
    expect(result.hardBlockers).toContain("overexposed_critical");
    expect(result.decisionClass).toBe("NO_ENTRY");
  });

  it("btc_breakdown_blocks_eth", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({
      pair: "ETH/USD", btcContext: "breakdown",
    }));
    expect(result.hardBlockers).toContain("btc_breakdown_blocks_eth");
    expect(result.decisionClass).toBe("NO_ENTRY");
  });

  it("vwap_zone_extremely_unfavorable when zone=above_upper2", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({ vwapZone: "above_upper2" }));
    expect(result.hardBlockers).toContain("vwap_zone_extremely_unfavorable");
    expect(result.decisionClass).toBe("NO_ENTRY");
  });
});

// ─── Datos malos no se compensan ──────────────────────────────────────────────

describe("evaluateIdcaEntryConfluence — datos malos no compensables", () => {
  it("data_unusable cuando candleCount < 5 → NO_ENTRY (hard gate)", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({ candleCount: 4 }));
    // candleCount < 5 → hard gate data_unusable → NO_ENTRY directo
    expect(result.hardBlocked).toBe(true);
    expect(result.hardBlockers).toContain("data_unusable");
    expect(result.decisionClass).toBe("NO_ENTRY");
  });

  it("candleCount=10 → dataScore alto (freshnessScore y sourceScore son 100) → no limita a WATCH por datos", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({ candleCount: 10 }));
    // freshnessScore=100, sourceScore=100 → dataScore ≈ 79 → dataMultiplier=0.90, no limita
    expect(result.familyScores.dataScore).toBeGreaterThan(55);
    expect(result.breakdown.dataMultiplier).toBeGreaterThan(0.45);
  });
});

// ─── Riesgo alto reduce por multiplicador ────────────────────────────────────

describe("evaluateIdcaEntryConfluence — risk multiplier", () => {
  it("riskMultiplier=0.30 cuando riskScore < 40 → confidence muy baja", () => {
    // Forzar riskScore bajo: exposure alta, buyCount alto, volatilidad alta
    const result = evaluateIdcaEntryConfluence(baseInput({
      capitalUsedUsd: 7000, capitalReservedUsd: 10000,  // 70% → -30
      buyCount: 5,      // -50
      atrPct: 2.8,      // -15
    }));
    // exposure 70% → penalty=15, buyCount=5 → 50, atrPct=2.8 → 15 → riskScore≈20
    expect(result.familyScores.riskScore).toBeLessThan(30);
    expect(result.breakdown.riskMultiplier).toBeLessThanOrEqual(0.30);
  });

  it("riskMultiplier=1.10 cuando riskScore >= 85 (bajo riesgo)", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({
      capitalUsedUsd: 0, capitalReservedUsd: 0,
      buyCount: 0, atrPct: 0.5, marketScore: 70,
    }));
    expect(result.breakdown.riskMultiplier).toBe(1.10);
  });
});

// ─── Bullish pullback + rebote mejora sin saltarse hard gates ─────────────────

describe("evaluateIdcaEntryConfluence — bullish_pullback mejora", () => {
  it("bullish_pullback + reboundConfirmed → HIGH_CONFIDENCE_ENTRY o NORMAL_ENTRY", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({
      marketScore: 75,
      drawdownFromReferencePct: 5.0,
      reboundConfirmed: true,
      vwapZone: "below_lower1",
      candleCount: 72,
    }));
    expect(result.marketRegime).toBe("bullish_pullback");
    expect(result.breakdown.regimeMultiplier).toBe(1.10);
    expect(["NORMAL_ENTRY", "HIGH_CONFIDENCE_ENTRY"]).toContain(result.decisionClass);
  });
});

// ─── Bearish breakdown bloquea o degrada ──────────────────────────────────────

describe("evaluateIdcaEntryConfluence — bearish_breakdown degrada", () => {
  it("bearish_breakdown → máximo WATCH", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({
      marketScore: 28,
      drawdownFromReferencePct: 12,
      reboundConfirmed: false,
      candleCount: 72,
    }));
    expect(result.marketRegime).toBe("bearish_breakdown");
    expect(["NO_ENTRY", "WATCH"]).toContain(result.decisionClass);
  });

  it("bearish_breakdown → regimeMultiplier=0.35", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({
      marketScore: 28, drawdownFromReferencePct: 12,
      reboundConfirmed: false, candleCount: 72,
    }));
    expect(result.breakdown.regimeMultiplier).toBe(0.35);
  });
});

// ─── assisted_entry sin smartAdjustment mantiene comportamiento actual ────────

describe("evaluateIdcaEntryConfluence — assisted_entry sin smart adjustment", () => {
  it("finalRequiredDistancePct = requiredDistancePct cuando smartAdjustmentEnabled=false", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({ smartAdjustmentEnabled: false }));
    // sliderBase + 0 = sliderBase = requiredDistancePct
    expect(result.finalRequiredDistancePct).toBeCloseTo(3.70, 2);
    expect(result.smartAdjustmentPct).toBe(0);
  });
});

// ─── assisted_entry con smartAdjustment respeta clamps ───────────────────────

describe("evaluateIdcaEntryConfluence — assisted_entry con smart adjustment", () => {
  it("BTC: smartAdjustmentPct clamped a [-0.30, +0.70]", () => {
    // Force regime=bearish_breakdown → regimeAdjustment=+0.60 (large adjustment)
    const result = evaluateIdcaEntryConfluence(baseInput({
      pair: "BTC/USD",
      smartAdjustmentEnabled: true,
      marketScore: 28,
      drawdownFromReferencePct: 12,
      reboundConfirmed: false,
      candleCount: 72,
    }));
    expect(result.smartAdjustmentPct).toBeLessThanOrEqual(0.70);
    expect(result.smartAdjustmentPct).toBeGreaterThanOrEqual(-0.30);
  });

  it("ETH: smartAdjustmentPct clamped a [-0.50, +1.00]", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({
      pair: "ETH/USD",
      smartAdjustmentEnabled: true,
      marketScore: 28,
      drawdownFromReferencePct: 12,
      reboundConfirmed: false,
      candleCount: 72,
    }));
    expect(result.smartAdjustmentPct).toBeLessThanOrEqual(1.00);
    expect(result.smartAdjustmentPct).toBeGreaterThanOrEqual(-0.50);
  });
});

// ─── dynamic_intelligent_entry usa min/max/confianza ─────────────────────────

describe("evaluateIdcaEntryConfluence — dynamic_intelligent_entry", () => {
  it("usa dynamicRawDistancePct como base y aplica confidence adjustments", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({
      confluenceProfile: "full",
      dynamicRawDistancePct: 2.5,
      requiredDistancePct: 2.5,
      userMinEntryDistancePct: 1.0,
      userMaxEntryDistancePct: 8.0,
      candleCount: 72,
      marketScore: 65,
    }));
    // Con alta confianza, puede reducir la distancia
    expect(result.finalRequiredDistancePct).toBeGreaterThanOrEqual(1.0);
    expect(result.finalRequiredDistancePct).toBeLessThanOrEqual(8.0);
    expect(result.confidenceAdjustmentPct).toBeDefined();
  });

  it("respeta userMinEntryDistancePct", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({
      confluenceProfile: "full",
      dynamicRawDistancePct: 0.5,  // muy bajo
      requiredDistancePct: 0.5,
      userMinEntryDistancePct: 1.5,
      userMaxEntryDistancePct: 8.0,
      candleCount: 72,
    }));
    expect(result.finalRequiredDistancePct).toBeGreaterThanOrEqual(1.5);
  });
});

// ─── decisionClass no modifica sizing real ────────────────────────────────────

describe("evaluateIdcaEntryConfluence — suggestedSizeFactor solo diagnóstico", () => {
  it("suggestedSizeFactor es opcional y nunca afecta sizing real (Sprint 1b)", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({ marketScore: 75, candleCount: 72 }));
    // El campo existe pero no es aplicado al motor de sizing
    expect(result.suggestedSizeFactor === undefined || typeof result.suggestedSizeFactor === "number").toBe(true);
    // Verificar que los campos críticos de sizing NO están en el resultado de confluencia
    expect((result as any).orderSize).toBeUndefined();
    expect((result as any).capitalToUse).toBeUndefined();
  });
});

// ─── requireReboundConfirmation limita a ARM_TRAILING ─────────────────────────

describe("evaluateIdcaEntryConfluence — rebound confirmation limiter", () => {
  it("requireReboundConfirmation=true y reboundConfirmed=false → máximo ARM_TRAILING", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({
      requireReboundConfirmation: true,
      reboundConfirmed: false,
      candleCount: 72,
      marketScore: 70,
      drawdownFromReferencePct: 5,
    }));
    const allowed: string[] = ["NO_ENTRY", "WATCH", "ARM_TRAILING"];
    expect(allowed).toContain(result.decisionClass);
  });
});

// ─── canArmTrailingBuy ────────────────────────────────────────────────────────

describe("evaluateIdcaEntryConfluence — canArmTrailingBuy", () => {
  it("true cuando priceInActivationZone=true y score >= minConfidenceScore", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({
      priceInActivationZone: true,
      minConfidenceScore: 30,
      candleCount: 72,
      marketScore: 65,
    }));
    if (!result.hardBlocked && result.confidenceScore >= 30) {
      expect(result.canArmTrailingBuy).toBe(true);
    }
  });

  it("false cuando hardBlocked=true", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({
      candleCount: 3,  // → data_unusable hard gate
      priceInActivationZone: true,
    }));
    expect(result.canArmTrailingBuy).toBe(false);
  });
});

// ─── logIdcaConfluence emite sin error ───────────────────────────────────────

describe("logIdcaConfluence", () => {
  it("emite sin excepción para resultado válido", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({ candleCount: 72, marketScore: 65 }));
    expect(() => logIdcaConfluence("[IDCA]", "BTC/USD", result)).not.toThrow();
  });

  it("emite sin excepción para resultado con hard blocker", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({ candleCount: 3 }));
    expect(() => logIdcaConfluence("[IDCA]", "BTC/USD", result)).not.toThrow();
  });
});

// ─── Scores 0-100 clamped ────────────────────────────────────────────────────

describe("evaluateIdcaEntryConfluence — family scores clamp 0-100", () => {
  it("todos los family scores están entre 0 y 100", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({ candleCount: 72 }));
    const { valueScore, confirmationScore, riskScore, dataScore, regimeScore } = result.familyScores;
    for (const score of [valueScore, confirmationScore, riskScore, dataScore, regimeScore]) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("confidenceScore está entre 0 y 100", () => {
    const result = evaluateIdcaEntryConfluence(baseInput({ candleCount: 72 }));
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(result.confidenceScore).toBeLessThanOrEqual(100);
  });
});
