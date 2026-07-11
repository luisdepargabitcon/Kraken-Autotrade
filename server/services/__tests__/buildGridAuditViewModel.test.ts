import { describe, it, expect } from "vitest";
import { buildGridAuditViewModel } from "../gridIsolated/buildGridAuditViewModel";

function makeBaseStatus(activeRangeVersionId: string | null = null) {
  return {
    activeRangeVersionId,
    activeRangeVersionNumber: activeRangeVersionId ? 1 : null,
    isRunning: true,
    lastTickAt: new Date().toISOString(),
    lastTickReason: activeRangeVersionId ? "Tick completado — rango activo reutilizado." : "Rango propuesto y activado en este tick.",
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

describe("buildGridAuditViewModel", () => {
  it("no afirma rango activo cuando no hay activeRangeVersionId", () => {
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

    expect(vm.currentOperationalState.hasActiveRange).toBe(false);
    expect(vm.activeRange.exists).toBe(false);
    expect(vm.latestGridDiagnostic.hasActiveRange).toBe(false);
    expect(vm.latestGridDiagnostic.humanSummary).toContain("no activó ninguna banda");
    expect(vm.latestGridDiagnostic.humanProblem).not.toBeNull();
    expect(vm.latestGridDiagnostic.humanProblem).not.toBe("");
    expect(vm.currentOperationalState.plainSummary).not.toContain("rango activado");
  });

  it("state active y diagnostic limpio cuando hay rango activo y niveles generados", () => {
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

    expect(vm.currentOperationalState.hasActiveRange).toBe(true);
    expect(vm.currentOperationalState.status).toBe("shadow_has_range");
    expect(vm.activeRange.exists).toBe(true);
    expect(vm.latestGridDiagnostic.hasActiveRange).toBe(true);
    expect(vm.latestGridDiagnostic.humanProblem).toBeNull();
    expect(vm.counters.currentLevels).toBe(10);
    expect(vm.counters.currentPlannedLevels).toBe(10);
  });

  it("genera recomendaciones cuando el objetivo de beneficio es exigente", () => {
    const config = { ...baseConfig, netProfitTargetPct: 1.5 };
    const vm = buildGridAuditViewModel(
      "SHADOW",
      config,
      makeBaseStatus(null),
      [],
      [],
      [],
      emptyResolvedRange,
      baseMarketContext,
      emptyLastValidation,
      emptyLastValidation
    );

    expect(vm.recommendations.length).toBeGreaterThan(0);
    const rec = vm.recommendations.find((r: any) => r.targetField === "netProfitTargetPct");
    expect(rec).toBeDefined();
    expect(rec.recommendedValue).toContain("1.20%");
    expect(rec.currentValue).toContain("1.50%");
  });

  it("el contador de ciclos refleja activos y cancelados", () => {
    const cycles = [
      { id: "c1", status: "open", rangeVersionId: "rv-test-123" },
      { id: "c2", status: "completed", rangeVersionId: "rv-test-123" },
      { id: "c3", status: "cancelled", rangeVersionId: "old-rv" },
    ];
    const vm = buildGridAuditViewModel(
      "SHADOW",
      baseConfig,
      makeBaseStatus("rv-test-123"),
      [],
      cycles,
      [],
      activeResolvedRange,
      baseMarketContext,
      emptyLastValidation,
      emptyLastValidation
    );

    expect(vm.counters.currentPlannedLevels).toBe(0);
    expect(vm.counters.historicalCycles).toBe(1);
    expect(vm.counters.cancelledCycles).toBe(1);
    expect(vm.counters.completedCycles).toBe(1);
  });
});
