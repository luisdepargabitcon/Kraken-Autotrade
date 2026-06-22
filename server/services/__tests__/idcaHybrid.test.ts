/**
 * Tests — IDCA Hybrid Intelligent Layers
 *
 * Tests are pure unit tests (no DB, no network) using mocked context.
 * Focus: MeanReversionOverlay, GridOverlay, IdcaRegimeAdapter classification logic.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateMeanReversion,
  type MeanReversionConfig,
} from "../institutionalDca/IdcaMeanReversionOverlay";
import {
  evaluateGridOverlay,
  type GridConfig,
} from "../institutionalDca/IdcaGridOverlay";
import type { IdcaRegimeSnapshot } from "../institutionalDca/IdcaRegimeAdapter";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRegime(
  overrides: Partial<IdcaRegimeSnapshot> = {}
): IdcaRegimeSnapshot {
  return {
    pair: "BTC/USD",
    regime: "lateral",
    confidence: 70,
    price: 50000,
    vwap: 50500,
    ema20: 50400,
    ema50: 50300,
    atrPct: 1.5,
    zScore: -1.0,
    spreadPct: null,
    trendSlope: 0.01,
    dataQuality: "good",
    reason: "test",
    naturalReason: "Test regime",
    computedAt: new Date(),
    ...overrides,
  };
}

const defaultMrConfig: MeanReversionConfig = {
  meanReversionEnabled: true,
  bearTrendBlockEnabled: true,
  dynamicVolatilityEnabled: true,
  dataQualityBlockEnabled: true,
  profile: "conservative",
};

const defaultGridConfig: GridConfig = {
  gridEnabled: true,
  maxGridCapitalPctOfCycle: 10,
  maxGridLevels: 3,
  gridCapitalPolicy: "dynamic_low",
  gridLevelPolicy: "dynamic_atr",
  gridProfitPolicy: "fees_aware",
  doNotRewriteAnchor: true,
  allowGridWithoutActiveCycle: false,
  executionScope: "observer",
};

// ── MeanReversionOverlay Tests ─────────────────────────────────────────────

describe("MeanReversionOverlay", () => {

  it("returns neutral when disabled", () => {
    const decision = evaluateMeanReversion(makeRegime(), {
      ...defaultMrConfig,
      meanReversionEnabled: false,
    });
    expect(decision.action).toBe("neutral");
    expect(decision.allowed).toBe(true);
  });

  it("blocks on bearish regime when bearTrendBlock enabled", () => {
    const decision = evaluateMeanReversion(
      makeRegime({ regime: "bearish" }),
      defaultMrConfig
    );
    expect(decision.action).toBe("block_buy");
    expect(decision.state).toBe("blocked_by_bear_trend");
    expect(decision.allowed).toBe(false);
  });

  it("does NOT block bearish when bearTrendBlock disabled", () => {
    const decision = evaluateMeanReversion(
      makeRegime({ regime: "bearish" }),
      { ...defaultMrConfig, bearTrendBlockEnabled: false }
    );
    expect(decision.action).not.toBe("block_buy");
  });

  it("blocks on high_volatility regime", () => {
    const decision = evaluateMeanReversion(
      makeRegime({ regime: "high_volatility", atrPct: 5.0 }),
      defaultMrConfig
    );
    expect(decision.action).toBe("block_buy");
    expect(decision.state).toBe("blocked_by_high_volatility");
  });

  it("blocks on insufficient_data regime", () => {
    const decision = evaluateMeanReversion(
      makeRegime({ regime: "insufficient_data", dataQuality: "insufficient" }),
      defaultMrConfig
    );
    expect(decision.action).toBe("block_buy");
    expect(decision.state).toBe("blocked_by_data_quality");
  });

  it("returns allow_buy for strong z-score below conservative threshold", () => {
    const decision = evaluateMeanReversion(
      makeRegime({ zScore: -2.5, regime: "lateral" }),
      defaultMrConfig
    );
    expect(decision.action).toBe("allow_buy");
    expect(decision.state).toBe("confirmed");
    expect(decision.allowed).toBe(true);
  });

  it("returns reduce_size for mild z-score between thresholds", () => {
    const decision = evaluateMeanReversion(
      makeRegime({ zScore: -1.0, regime: "lateral" }),
      defaultMrConfig
    );
    expect(decision.action).toBe("reduce_size");
    expect(decision.allowed).toBe(true);
  });

  it("returns hold for z-score above reduce threshold (insufficient deviation)", () => {
    const decision = evaluateMeanReversion(
      makeRegime({ zScore: 0.2, regime: "lateral" }),
      defaultMrConfig
    );
    expect(decision.action).toBe("hold");
  });

  it("aggressive profile has lower confirmation threshold", () => {
    const conservative = evaluateMeanReversion(
      makeRegime({ zScore: -1.0, regime: "lateral" }),
      { ...defaultMrConfig, profile: "conservative" }
    );
    const aggressive = evaluateMeanReversion(
      makeRegime({ zScore: -1.0, regime: "lateral" }),
      { ...defaultMrConfig, profile: "aggressive" }
    );
    // Aggressive should confirm (score > conservative action)
    expect(aggressive.action).toBe("allow_buy");
    expect(conservative.action).toBe("reduce_size");
  });

  it("score is between 0 and 100", () => {
    const decision = evaluateMeanReversion(makeRegime({ zScore: -3.0 }), defaultMrConfig);
    expect(decision.score).toBeGreaterThanOrEqual(0);
    expect(decision.score).toBeLessThanOrEqual(100);
  });
});

// ── GridOverlay Tests ──────────────────────────────────────────────────────

describe("GridOverlay", () => {
  const noOpMr = evaluateMeanReversion(makeRegime(), defaultMrConfig);

  it("returns inactive when grid disabled", () => {
    const decision = evaluateGridOverlay(
      makeRegime(), noOpMr,
      { ...defaultGridConfig, gridEnabled: false },
      1000, 1, "observer"
    );
    expect(decision.gridState).toBe("inactive");
    expect(decision.gridAllowed).toBe(false);
  });

  it("returns inactive when mode=off", () => {
    const decision = evaluateGridOverlay(
      makeRegime(), noOpMr, defaultGridConfig,
      1000, 1, "off"
    );
    expect(decision.gridState).toBe("inactive");
  });

  it("returns inactive when no active cycle and not allowed without cycle", () => {
    const decision = evaluateGridOverlay(
      makeRegime(), noOpMr,
      { ...defaultGridConfig, allowGridWithoutActiveCycle: false },
      1000, null, "observer"
    );
    expect(decision.gridState).toBe("inactive");
    expect(decision.reason).toContain("no_active_cycle");
  });

  it("returns paused_bear_trend when regime is bearish", () => {
    const mr = evaluateMeanReversion(makeRegime({ regime: "bearish" }), defaultMrConfig);
    const decision = evaluateGridOverlay(
      makeRegime({ regime: "bearish" }), mr, defaultGridConfig,
      1000, 1, "observer"
    );
    expect(decision.gridState).toBe("paused_bear_trend");
    expect(decision.gridAllowed).toBe(false);
  });

  it("arms grid when regime is lateral with active cycle", () => {
    const decision = evaluateGridOverlay(
      makeRegime({ regime: "lateral", atrPct: 1.5 }), noOpMr, defaultGridConfig,
      1000, 42, "observer"
    );
    expect(decision.gridAllowed).toBe(true);
    expect(decision.gridState).toBe("armed");
    expect(decision.levels.length).toBeGreaterThan(0);
  });

  it("grid legs are observer_only when executionScope=observer", () => {
    const decision = evaluateGridOverlay(
      makeRegime({ regime: "lateral" }), noOpMr,
      { ...defaultGridConfig, executionScope: "observer" },
      1000, 42, "observer"
    );
    expect(decision.levels.every(l => l.observerOnly)).toBe(true);
  });

  it("grid legs count respects maxGridLevels", () => {
    const decision = evaluateGridOverlay(
      makeRegime({ regime: "lateral" }), noOpMr,
      { ...defaultGridConfig, maxGridLevels: 2 },
      1000, 42, "observer"
    );
    const buyLegs = decision.levels.filter(l => l.side === "buy");
    expect(buyLegs.length).toBeLessThanOrEqual(2);
  });

  it("capital budget does not exceed maxGridCapitalPctOfCycle", () => {
    const cycleCapital = 500;
    const maxPct = 10;
    const decision = evaluateGridOverlay(
      makeRegime({ regime: "lateral" }), noOpMr,
      { ...defaultGridConfig, maxGridCapitalPctOfCycle: maxPct },
      cycleCapital, 42, "observer"
    );
    const expected = (cycleCapital * maxPct) / 100;
    expect(decision.capitalBudget).toBeLessThanOrEqual(expected + 0.01);
  });

  it("pauses grid when spread too small (high_volatility)", () => {
    const decision = evaluateGridOverlay(
      makeRegime({ regime: "high_volatility", atrPct: 5.0 }), noOpMr, defaultGridConfig,
      1000, 42, "observer"
    );
    expect(decision.gridAllowed).toBe(false);
  });
});
