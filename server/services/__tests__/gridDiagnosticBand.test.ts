import { describe, it, expect } from "vitest";
import { buildGridAuditViewModel } from "../gridIsolated/buildGridAuditViewModel";

function makeBaseStatus(activeRangeVersionId: string | null = null) {
  return {
    activeRangeVersionId,
    activeRangeVersionNumber: activeRangeVersionId ? 1 : null,
    isRunning: true,
    lastTickAt: new Date().toISOString(),
    lastTickReason: activeRangeVersionId ? "Tick completado — rango activo reutilizado." : "Sin rango activo.",
    openLevels: 0,
    openCycles: 0,
    totalNetPnlUsd: 0,
    totalCyclesCompleted: 0,
    circuitBreakerOpen: false,
    pumpDumpState: "normal",
  };
}

const baseConfig = {
  mode: "SHADOW",
  isActive: true,
  netProfitTargetPct: 0.8,
  gridStepMinPct: 0.3,
  gridStepMaxPct: 3.0,
  gridRangeControlMode: "adaptive_smart",
  adaptiveRangeEnabled: true,
  adaptiveRangeProfile: "balanced",
  adaptiveRangeMinPct: 1.5,
  adaptiveRangeMaxPct: 7.0,
  adaptiveRangeLowVolMaxPct: 3.0,
  adaptiveRangeNormalMaxPct: 5.0,
  adaptiveRangeHighVolMaxPct: 7.0,
  adaptiveRangeTargetFullLevels: false,
  adaptiveRangeMinViableLevels: 4,
};

const baseMarketContext = {
  currentPrice: 95000,
  bandSnapshot: null,
  pair: "BTC/USD",
};

const emptyLastValidation = { at: null as Date | null, result: null };

const emptyResolvedRange = {
  id: null,
  status: "sin_rango_activo",
  lowerPrice: null,
  upperPrice: null,
  centerPrice: null,
  createdAt: null,
  method: null,
};

const activeResolvedRange = {
  id: "rv-test-123",
  status: "active",
  lowerPrice: 90000,
  upperPrice: 100000,
  centerPrice: 95000,
  createdAt: new Date().toISOString(),
  method: "adaptive_smart",
};

describe("diagnosticBand", () => {
  it("status=active cuando hay rango activo con niveles", () => {
    const events = [
      { eventType: "GRID_RANGE_PROPOSED", message: "Rango propuesto", metadataJson: { levelsGenerated: 10, centerPrice: 95000, pair: "BTC/USD" } },
      { eventType: "GRID_RANGE_ACTIVATED", message: "Rango activado", metadataJson: { mode: "SHADOW" } },
    ];
    const levels = Array.from({ length: 10 }, (_, i) => ({
      id: `l-${i}`,
      rangeVersionId: "rv-test-123",
      status: "planned",
      side: i % 2 === 0 ? "BUY" : "SELL",
      price: 90000 + i * 1000,
      notionalUsd: 100,
    }));

    const vm = buildGridAuditViewModel(
      "SHADOW",
      baseConfig,
      makeBaseStatus("rv-test-123"),
      levels,
      [],
      events,
      activeResolvedRange,
      baseMarketContext,
      emptyLastValidation,
      emptyLastValidation
    );

    expect(vm.diagnosticBand).toBeDefined();
    expect(vm.diagnosticBand.status).toBe("active");
    expect(vm.diagnosticBand.exists).toBe(true);
    expect(vm.diagnosticBand.lowerPrice).toBe(90000);
    expect(vm.diagnosticBand.upperPrice).toBe(100000);
    expect(vm.diagnosticBand.centerPrice).toBe(95000);
    expect(vm.diagnosticBand.source).toBe("active_range");
    expect(vm.diagnosticBand.plainExplanation).toContain("rango activo");
  });

  it("status=not_enough_data cuando no hay rango, adaptiveDecision ni professionalGenerator", () => {
    const vm = buildGridAuditViewModel(
      "SHADOW",
      baseConfig,
      makeBaseStatus(null),
      [],
      [],
      [],
      emptyResolvedRange,
      baseMarketContext,
      emptyLastValidation,
      emptyLastValidation
    );

    expect(vm.diagnosticBand).toBeDefined();
    expect(vm.diagnosticBand.status).toBe("not_enough_data");
    expect(vm.diagnosticBand.exists).toBe(false);
    expect(vm.diagnosticBand.lowerPrice).toBeNull();
    expect(vm.diagnosticBand.upperPrice).toBeNull();
    expect(vm.diagnosticBand.source).toBe("none");
    expect(vm.diagnosticBand.plainExplanation).toContain("no ha evaluado");
  });

  it("status=calculated_not_active cuando adaptiveDecision es viable pero no hay rango activo", () => {
    const adaptiveResult = {
      adaptiveRangeOk: true,
      finalRangePct: 5.0,
      regimeMaxPct: 7.0,
      rangeNeededForMinViableLevelsPct: 3.0,
      buyLevelsWouldFit: 5,
      sellLevelsWouldFit: 5,
      requestedBuyLevels: 6,
      requestedSellLevels: 6,
      operationalLower: 93000,
      operationalUpper: 97000,
      centerPrice: 95000,
      reason: "Rango viable calculado.",
    };

    const vm = buildGridAuditViewModel(
      "SHADOW",
      baseConfig,
      makeBaseStatus(null),
      [],
      [],
      [],
      emptyResolvedRange,
      baseMarketContext,
      emptyLastValidation,
      { at: new Date(), result: { adaptiveRangeDecision: adaptiveResult } }
    );

    expect(vm.diagnosticBand).toBeDefined();
    expect(vm.diagnosticBand.status).toBe("calculated_not_active");
    expect(vm.diagnosticBand.exists).toBe(true);
    expect(vm.diagnosticBand.lowerPrice).toBe(93000);
    expect(vm.diagnosticBand.upperPrice).toBe(97000);
    expect(vm.diagnosticBand.source).toBe("last_adaptive_decision");
    expect(vm.diagnosticBand.plainExplanation).toContain("viable");
  });

  it("status=not_viable cuando adaptiveDecision no es viable y hay banda calculada", () => {
    const adaptiveResult = {
      adaptiveRangeOk: false,
      finalRangePct: 2.0,
      regimeMaxPct: 2.0,
      rangeNeededForMinViableLevelsPct: 5.0,
      buyLevelsWouldFit: 2,
      sellLevelsWouldFit: 2,
      requestedBuyLevels: 6,
      requestedSellLevels: 6,
      operationalLower: 94000,
      operationalUpper: 96000,
      centerPrice: 95000,
      minSpacingPctReal: 0.8,
      reason: "Rango insuficiente para niveles mínimos.",
    };

    const vm = buildGridAuditViewModel(
      "SHADOW",
      baseConfig,
      makeBaseStatus(null),
      [],
      [],
      [],
      emptyResolvedRange,
      baseMarketContext,
      emptyLastValidation,
      { at: new Date(), result: { adaptiveRangeDecision: adaptiveResult } }
    );

    expect(vm.diagnosticBand).toBeDefined();
    expect(vm.diagnosticBand.status).toBe("not_viable");
    expect(vm.diagnosticBand.exists).toBe(true);
    expect(vm.diagnosticBand.lowerPrice).toBe(94000);
    expect(vm.diagnosticBand.upperPrice).toBe(96000);
    expect(vm.diagnosticBand.source).toBe("last_adaptive_decision");
    expect(vm.diagnosticBand.plainExplanation).toContain("no puede crear");
    expect(vm.diagnosticBand.requiredRangePct).toBe(5.0);
    expect(vm.diagnosticBand.allowedRangePct).toBe(2.0);
  });

  it("status=not_viable cuando professionalGenerator tiene viability=compact", () => {
    const events = [
      {
        eventType: "GRID_PROFESSIONAL_GENERATOR_COMPACT",
        message: "Compact range",
        metadataJson: {
          professionalGenerator: {
            mode: "shadow_generation",
            viabilityStatus: "compact",
            operationalLower: 94000,
            operationalUpper: 96000,
            centerPrice: 95000,
            operationalBandWidthPct: 2.1,
            requestedBuyLevels: 6,
            requestedSellLevels: 6,
            generatedBuyLevels: 2,
            generatedSellLevels: 2,
            reason: "Solo 2 niveles caben en el rango.",
          },
        },
        rangeVersionId: null,
      },
    ];

    const vm = buildGridAuditViewModel(
      "SHADOW",
      baseConfig,
      makeBaseStatus(null),
      [],
      [],
      events,
      emptyResolvedRange,
      baseMarketContext,
      emptyLastValidation,
      emptyLastValidation
    );

    expect(vm.diagnosticBand).toBeDefined();
    expect(vm.diagnosticBand.status).toBe("not_viable");
    expect(vm.diagnosticBand.exists).toBe(true);
    expect(vm.diagnosticBand.lowerPrice).toBe(94000);
    expect(vm.diagnosticBand.upperPrice).toBe(96000);
    expect(vm.diagnosticBand.source).toBe("professional_generator");
  });

  it("calcula precios desde currentPrice cuando adaptiveDecision no tiene operationalLower/Upper", () => {
    const adaptiveResult = {
      adaptiveRangeOk: true,
      finalRangePct: 6.0,
      regimeMaxPct: 7.0,
      rangeNeededForMinViableLevelsPct: 3.0,
      buyLevelsWouldFit: 6,
      sellLevelsWouldFit: 6,
      requestedBuyLevels: 6,
      requestedSellLevels: 6,
      reason: "Viable.",
    };

    const vm = buildGridAuditViewModel(
      "SHADOW",
      baseConfig,
      makeBaseStatus(null),
      [],
      [],
      [],
      emptyResolvedRange,
      baseMarketContext,
      emptyLastValidation,
      { at: new Date(), result: { adaptiveRangeDecision: adaptiveResult } }
    );

    expect(vm.diagnosticBand.status).toBe("calculated_not_active");
    expect(vm.diagnosticBand.lowerPrice).toBeGreaterThan(0);
    expect(vm.diagnosticBand.upperPrice).toBeGreaterThan(vm.diagnosticBand.lowerPrice!);
    expect(vm.diagnosticBand.centerPrice).toBe(95000);
  });

  it("diagnosticBand siempre está presente en el view model", () => {
    const vm = buildGridAuditViewModel(
      "SHADOW",
      baseConfig,
      makeBaseStatus(null),
      [],
      [],
      [],
      emptyResolvedRange,
      null,
      emptyLastValidation,
      emptyLastValidation
    );

    expect(vm.diagnosticBand).toBeDefined();
    expect(vm.diagnosticBand).not.toBeNull();
    expect(typeof vm.diagnosticBand.status).toBe("string");
    expect(typeof vm.diagnosticBand.exists).toBe("boolean");
    expect(typeof vm.diagnosticBand.plainExplanation).toBe("string");
    expect(typeof vm.diagnosticBand.nextAction).toBe("string");
  });
});
