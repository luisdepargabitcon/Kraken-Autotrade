import { describe, it, expect } from "vitest";
import { evaluateActiveRangeLifecycle } from "../gridIsolated/gridRangeLifecycle";

const baseInput = {
  mode: "SHADOW",
  config: { gridRangeControlMode: "adaptive_smart" },
  activeRange: { lowerPrice: 90000, upperPrice: 95000, centerPrice: 92500 },
  marketContext: null,
  rangeIntelligence: null,
  professionalGenerator: null,
  openCyclesCount: 0,
  activeOpenCyclesCount: 0,
  globalOpenCyclesCount: 0,
  currentPrice: 92500,
  atrPct: 1.5,
  marketBollingerWidthPct: 5.5,
  operationalRangeWidthPct: 5.2,
  activeRangePriceWidthPct: 5.3,
  rangeGenerationSource: "adaptive_smart",
  rangeGenerationMethod: "bollinger_atr",
  activeRangeCreatedAt: new Date().toISOString(),
  adaptiveDecision: { rangeOk: true, regimeBucket: "normal" },
};

describe("evaluateActiveRangeLifecycle", () => {
  it("1. OFF mode => audit_only, canReuseForNewLevels=false", () => {
    const result = evaluateActiveRangeLifecycle({ ...baseInput, mode: "OFF" });
    expect(result.canReuseForAudit).toBe(true);
    expect(result.canReuseForNewLevels).toBe(false);
    expect(result.canRegenerateNow).toBe(false);
    expect(result.reasonCode).toBe("OFF_MODE");
  });

  it("2. pre_adaptive + adaptive_smart => stale_pre_adaptive", () => {
    const result = evaluateActiveRangeLifecycle({
      ...baseInput,
      rangeGenerationSource: "pre_adaptive",
    });
    expect(result.status).toBe("stale_pre_adaptive");
    expect(result.canReuseForNewLevels).toBe(false);
    expect(result.shouldSuggestValidation).toBe(true);
  });

  it("3. precio fuera de rango => invalid_price_outside", () => {
    const result = evaluateActiveRangeLifecycle({
      ...baseInput,
      currentPrice: 100000,
    });
    expect(result.status).toBe("invalid_price_outside");
    expect(result.canReuseForNewLevels).toBe(false);
    expect(result.shouldSuggestValidation).toBe(true);
  });

  it("4. rango viejo => stale_age", () => {
    const oldDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const result = evaluateActiveRangeLifecycle({
      ...baseInput,
      activeRangeCreatedAt: oldDate,
    });
    expect(result.status).toBe("stale_age");
    expect(result.canReuseForNewLevels).toBe(false);
    expect(result.shouldSuggestValidation).toBe(true);
  });

  it("5. régimen pump_dump => invalid_regime", () => {
    const result = evaluateActiveRangeLifecycle({
      ...baseInput,
      adaptiveDecision: { rangeOk: false, regimeBucket: "pump_dump" },
    });
    expect(result.status).toBe("invalid_regime");
    expect(result.canReuseForNewLevels).toBe(false);
    expect(result.canRegenerateNow).toBe(false);
  });

  it("6. ciclos abiertos => protected_by_open_cycles", () => {
    const result = evaluateActiveRangeLifecycle({
      ...baseInput,
      activeOpenCyclesCount: 2,
      globalOpenCyclesCount: 3,
      currentPrice: 100000,
    });
    expect(result.status).toBe("protected_by_open_cycles");
    expect(result.canRegenerateNow).toBe(false);
  });

  it("7. rango sano adaptive => reusable", () => {
    const result = evaluateActiveRangeLifecycle({ ...baseInput });
    expect(result.status).toBe("reusable");
    expect(result.canReuseForNewLevels).toBe(true);
    expect(result.canRegenerateNow).toBe(false);
    expect(result.reasonCode).toBe("RANGE_HEALTHY");
  });

  it("8. divergencia de anchura => warning check, no invalid", () => {
    const result = evaluateActiveRangeLifecycle({
      ...baseInput,
      activeRangePriceWidthPct: 12.0,
      marketBollingerWidthPct: 5.0,
    });
    expect(result.checks.widthDivergencePct).toBe(7.0);
    expect(result.status).toBe("reusable");
  });

  it("9. sin datos suficientes => unknown/audit_only seguro", () => {
    const result = evaluateActiveRangeLifecycle({
      mode: "SHADOW",
      config: {},
      activeRange: null,
      marketContext: null,
      rangeIntelligence: null,
      professionalGenerator: null,
      openCyclesCount: 0,
      activeOpenCyclesCount: 0,
      globalOpenCyclesCount: 0,
      currentPrice: null,
      atrPct: null,
      marketBollingerWidthPct: null,
      operationalRangeWidthPct: null,
      activeRangePriceWidthPct: null,
      rangeGenerationSource: null,
      rangeGenerationMethod: null,
      activeRangeCreatedAt: null,
      adaptiveDecision: null,
    });
    expect(result.status).toBe("unknown");
    expect(result.canReuseForAudit).toBe(true);
    expect(result.canReuseForNewLevels).toBe(false);
  });

  it("10. OFF + pre_adaptive => stale_pre_adaptive (not audit_only)", () => {
    const result = evaluateActiveRangeLifecycle({
      ...baseInput,
      mode: "OFF",
      rangeGenerationSource: "pre_adaptive",
    });
    expect(result.status).toBe("stale_pre_adaptive");
    expect(result.canReuseForNewLevels).toBe(false);
    expect(result.shouldSuggestValidation).toBe(true);
  });

  it("11. market shift with open cycles => protected_by_open_cycles", () => {
    const result = evaluateActiveRangeLifecycle({
      ...baseInput,
      currentPrice: 96000,
      activeOpenCyclesCount: 1,
    });
    expect(result.status).toBe("protected_by_open_cycles");
    expect(result.canRegenerateNow).toBe(false);
  });

  it("12. stale age with open cycles => protected_by_open_cycles", () => {
    const oldDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const result = evaluateActiveRangeLifecycle({
      ...baseInput,
      activeRangeCreatedAt: oldDate,
      activeOpenCyclesCount: 1,
    });
    expect(result.status).toBe("protected_by_open_cycles");
  });

  it("13. reusable with open cycles => protected_by_open_cycles, canReuseForNewLevels=true", () => {
    const result = evaluateActiveRangeLifecycle({
      ...baseInput,
      activeOpenCyclesCount: 2,
    });
    expect(result.status).toBe("protected_by_open_cycles");
    expect(result.canReuseForNewLevels).toBe(true);
  });

  it("14. center drift exceeded => stale_market_shift", () => {
    const result = evaluateActiveRangeLifecycle({
      ...baseInput,
      currentPrice: 94800,
    });
    expect(result.status).toBe("stale_market_shift");
    expect(result.canReuseForNewLevels).toBe(false);
  });

  it("15. checks populated correctly", () => {
    const result = evaluateActiveRangeLifecycle({ ...baseInput });
    expect(result.checks.isPreAdaptive).toBe(false);
    expect(result.checks.priceInsideRange).toBe(true);
    expect(result.checks.hasOpenCycles).toBe(false);
    expect(result.checks.adaptiveModeActive).toBe(true);
    expect(result.checks.adaptiveDecisionAvailable).toBe(true);
  });

  it("16. adaptiveRangeOk=false (field name adaptiveRangeOk) => needs_adaptive_validation", () => {
    const result = evaluateActiveRangeLifecycle({
      ...baseInput,
      adaptiveDecision: { adaptiveRangeOk: false, regimeBucket: "normal_lateral" },
    });
    expect(result.status).toBe("needs_adaptive_validation");
    expect(result.canReuseForNewLevels).toBe(false);
    expect(result.canReuseForAudit).toBe(true);
    expect(result.shouldSuggestValidation).toBe(true);
    expect(result.reasonCode).toBe("ADAPTIVE_RANGE_NOT_VIABLE");
  });

  it("17. rangeOk=false (legacy field name) => needs_adaptive_validation", () => {
    const result = evaluateActiveRangeLifecycle({
      ...baseInput,
      adaptiveDecision: { rangeOk: false, regimeBucket: "normal_lateral" },
    });
    expect(result.status).toBe("needs_adaptive_validation");
    expect(result.canReuseForNewLevels).toBe(false);
    expect(result.reasonCode).toBe("ADAPTIVE_RANGE_NOT_VIABLE");
  });

  it("18. adaptiveRangeOk=false with open cycles => protected_by_open_cycles", () => {
    const result = evaluateActiveRangeLifecycle({
      ...baseInput,
      adaptiveDecision: { adaptiveRangeOk: false, regimeBucket: "normal_lateral" },
      activeOpenCyclesCount: 1,
    });
    expect(result.status).toBe("protected_by_open_cycles");
    expect(result.canRegenerateNow).toBe(false);
  });

  it("19. adaptiveRangeOk=false + pump_dump regime => invalid_regime takes priority", () => {
    const result = evaluateActiveRangeLifecycle({
      ...baseInput,
      adaptiveDecision: { adaptiveRangeOk: false, regimeBucket: "pump_dump" },
    });
    expect(result.status).toBe("invalid_regime");
  });
});
