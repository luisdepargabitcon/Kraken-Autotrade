import { describe, it, expect } from "vitest";
import { buildGridMarketViewModel } from "../gridIsolated/buildGridMarketViewModel";

function makeInput(overrides: any = {}) {
  return {
    pair: "BTC/USD",
    mode: "SHADOW",
    config: {
      netProfitTargetPct: 0.8,
      buyFeePct: 0.09,
      sellFeePct: 0.09,
      taxReservePct: 20,
      gridRangeMaxPct: 5.0,
      enforceCompactRange: true,
      buyLevels: 4,
      sellLevels: 4,
      gridStepAtrMultiplier: 1.5,
      gridStepMaxPct: 3.0,
    },
    status: { activeRangeVersionId: "range-v1" },
    marketContext: {
      currentPrice: 95000,
      bid: 94990,
      ask: 95010,
      spreadUsd: 20,
      spreadPct: 0.02,
      source: "kraken",
      updatedAt: new Date().toISOString(),
      band: {
        lower: 93000,
        center: 95000,
        upper: 97000,
        widthPct: 4.0,
        atrPct: 0.5,
        period: 20,
        stdDevMultiplier: 2,
        timeframe: "1h",
        source: "kraken",
        calculatedAt: new Date().toISOString(),
      },
      atrPct: 0.5,
      regime: "normal",
    },
    resolvedRange: {
      activeRangeVersionId: "range-v1",
      lowerPrice: 93000,
      centerPrice: 95000,
      upperPrice: 97000,
      widthPct: 4.0,
      configSnapshot: { netProfitTargetPct: 0.8 },
    },
    adaptiveDecision: null,
    professionalGenerator: null,
    currentOperationalState: null,
    recommendations: [],
    openCycles: [],
    levels: [
      { id: "l1", rangeVersionId: "range-v1", side: "buy", status: "planned" },
      { id: "l2", rangeVersionId: "range-v1", side: "sell", status: "planned" },
    ],
    ...overrides,
  };
}

describe("buildGridMarketViewModel", () => {
  it("incluye activeRangeSnapshot con generatedBuyLevels/generatedSellLevels", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.current.activeRangeSnapshot).toBeDefined();
    expect(vm.current.activeRangeSnapshot.rangeVersionId).toBe("range-v1");
    expect(vm.current.activeRangeSnapshot.generatedBuyLevels).toBe(1);
    expect(vm.current.activeRangeSnapshot.generatedSellLevels).toBe(1);
  });

  it("operationalRange refleja el rango resuelto", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.current.operationalRange).toBeDefined();
    expect(vm.current.operationalRange.lower).toBe(93000);
    expect(vm.current.operationalRange.upper).toBe(97000);
    expect(vm.current.operationalRange.center).toBe(95000);
    expect(vm.current.operationalRange.sourceRangeVersionId).toBe("range-v1");
  });

  it("operationalRange marca inconsistencia si los límites no coinciden", () => {
    const vm = buildGridMarketViewModel(makeInput({
      resolvedRange: {
        activeRangeVersionId: "range-v1",
        lowerPrice: 93000,
        centerPrice: 95000,
        upperPrice: 98000,
        widthPct: 4.0,
      },
    }));
    expect(vm.current.operationalRange.internallyConsistent).toBe(false);
    expect(vm.current.operationalRange.inconsistencyReason).not.toBeNull();
  });

  it("activeRangeSnapshot no usa config actual para contar niveles", () => {
    const vm = buildGridMarketViewModel(makeInput({
      config: { buyLevels: 999, sellLevels: 999 },
    }));
    expect(vm.current.activeRangeSnapshot.generatedBuyLevels).toBeLessThan(10);
    expect(vm.current.activeRangeSnapshot.generatedSellLevels).toBeLessThan(10);
  });

  it("regime incluye humanReason y technicalReason", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.current.regime.humanReason).toBeDefined();
    expect(vm.current.regime.technicalReason).toBeDefined();
  });
});
