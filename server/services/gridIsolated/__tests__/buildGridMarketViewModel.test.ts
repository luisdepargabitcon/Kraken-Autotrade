import { describe, it, expect } from "vitest";
import { buildGridMarketViewModel } from "../buildGridMarketViewModel";

function makeInput(overrides?: any) {
  return {
    pair: "BTC/USD",
    mode: "SHADOW",
    config: {
      pair: "BTC/USD",
      netProfitTargetPct: "0.80",
      buyFeePct: "0.09",
      sellFeePct: "0.09",
      gridRangeMaxPct: "2.5",
      enforceCompactRange: true,
      buyLevels: 4,
      sellLevels: 4,
    },
    status: {
      currentPrice: 64733,
      currentBid: 64732,
      currentAsk: 64734,
      bandLower: 63680,
      bandUpper: 65786,
      bandMiddle: 64733,
      activeRangeVersionId: "rv-001",
      priceFresh: true,
    },
    marketContext: {
      currentPrice: 64733,
      currentBid: 64732,
      currentAsk: 64734,
      spreadPct: 0.03,
      band: {
        lower: 63680,
        center: 64733,
        upper: 65786,
        widthPct: 3.24,
      },
      regime: "RANGING",
      priceFresh: true,
      priceAgeMs: 1000,
      priceMaxAgeMs: 5000,
    },
    resolvedRange: {
      activeRangeVersionId: "rv-001",
      status: "active",
      lowerPrice: 63900,
      upperPrice: 65566,
      centerPrice: 64733,
      widthPct: 2.5,
    },
    adaptiveDecision: null,
    professionalGenerator: null,
    currentOperationalState: null,
    recommendations: [],
    openCycles: [],
    levels: [
      { rangeVersionId: "rv-001", price: 63900, status: "active", side: "BUY" },
      { rangeVersionId: "rv-001", price: 64200, status: "active", side: "BUY" },
      { rangeVersionId: "rv-001", price: 65200, status: "active", side: "SELL" },
      { rangeVersionId: "rv-001", price: 65566, status: "active", side: "SELL" },
    ],
    lastProfessionalValidationAt: null,
    lastShadowValidationAt: null,
    ...overrides,
  };
}

describe("buildGridMarketViewModel", () => {
  it("separates price, bid, ask, spread", () => {
    const vm = buildGridMarketViewModel(makeInput());
    const c = vm.current;
    expect(c.price).toBe(64733);
    expect(c.bid).toBe(64732);
    expect(c.ask).toBe(64734);
    expect(c.spreadPct).toBe(0.03);
  });

  it("translates RANGING regime to RANGE", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.current.regime.code).toBe("RANGE");
  });

  it("populates band data with lower, center, upper, widthPct", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.current.band.lower).toBe(63680);
    expect(vm.current.band.upper).toBe(65786);
    expect(vm.current.band.center).toBe(64733);
    expect(vm.current.band.widthPct).toBe(3.24);
  });

  it("calculates actualLevels from input levels", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.entryRange.actualLevels).toBe(4);
  });

  it("calculates requestedLevels from config", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.entryRange.requestedLevels).toBe(8);
  });

  it("detects levels mismatch (4 < 8)", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.entryRange.actualLevels).toBeLessThan(vm.entryRange.requestedLevels!);
  });

  it("calculates minimumProfitableSpacingPct from config fees", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.entryRange.minimumProfitableSpacingPct).not.toBeNull();
    expect(vm.entryRange.minimumProfitableSpacingPct).toBeGreaterThan(0.8);
  });

  it("minimumProfitableSpacingPct = 0.8 + 0.09 + 0.09 + (0.8 * 20/100) = 1.14", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.entryRange.minimumProfitableSpacingPct).toBeCloseTo(1.14, 2);
  });

  it("calculates gridRangeMaxPct from config", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.entryRange.gridRangeMaxPct).toBe(2.5);
  });

  it("populates enforceCompactRange from config", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.entryRange.enforceCompactRange).toBe(true);
  });

  it("calculates effectiveRangePct as min(bandWidth, gridRangeMax) when compact", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.entryRange.levelDiagnostic).not.toBeNull();
    expect(vm.entryRange.levelDiagnostic!.effectiveRangePct).toBe(2.5);
  });

  it("calculates maxLevelsPerSide = floor(2.5 / 1.14) = 2", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.entryRange.levelDiagnostic!.maxLevelsPerSide).toBe(2);
  });

  it("calculates maxTotalLevels = 4", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.entryRange.levelDiagnostic!.maxTotalLevels).toBe(4);
  });

  it("generates levelCountExplanation string", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.entryRange.levelCountExplanation).not.toBeNull();
    expect(vm.entryRange.levelCountExplanation).toContain("Bollinger");
    expect(vm.entryRange.levelCountExplanation).toContain("2.50%");
    expect(vm.entryRange.levelCountExplanation).toContain("2 niveles");
  });

  it("populates buyFeePct and sellFeePct from config", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.entryRange.buyFeePct).toBe(0.09);
    expect(vm.entryRange.sellFeePct).toBe(0.09);
  });

  it("populates taxReservePct", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.entryRange.taxReservePct).toBe(20);
  });

  it("populates netProfitTargetPct from config", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.entryRange.netProfitTargetPct).toBe(0.8);
  });

  it("marks entry range as ACTIVE when rangeVersionId exists", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.entryRange.viability).toBe("ACTIVE");
    expect(vm.entryRange.active).toBe(true);
  });

  it("handles null levels gracefully", () => {
    const vm = buildGridMarketViewModel(makeInput({ levels: null }));
    expect(vm.entryRange.actualLevels).toBeNull();
  });

  it("handles missing band data gracefully", () => {
    const vm = buildGridMarketViewModel(makeInput({
      marketContext: { currentPrice: 64733, regime: "RANGING", priceFresh: true },
      status: { currentPrice: 64733, activeRangeVersionId: "rv-001" },
      resolvedRange: { activeRangeVersionId: "rv-001", status: "active" },
    }));
    expect(vm.current.band.lower).toBeNull();
    expect(vm.current.band.upper).toBeNull();
    expect(vm.current.price).toBe(64733);
  });

  it("calculates spacingPct from effective range and max levels", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.entryRange.spacingPct).not.toBeNull();
    expect(vm.entryRange.spacingPct).toBeCloseTo(1.25, 1);
  });

  it("levelDiagnostic.reason explains mismatch when levels don't fit", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.entryRange.levelDiagnostic!.reason).toContain("solo permite");
    expect(vm.entryRange.levelDiagnostic!.reason).toContain("solicitaron");
  });

  it("regime label is in Spanish", () => {
    const vm = buildGridMarketViewModel(makeInput());
    expect(vm.current.regime.label).toBe("Mercado lateral");
  });
});
