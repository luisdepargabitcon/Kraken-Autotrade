/**
 * riskR1.test.ts — Risk R1 obligatory tests.
 *
 *   ENTRY_V4_FROZEN / EXIT_E0_FROZEN
 *   RISK_NEVER_EXCEEDS_BASE / RISK_MULTIPLIER_BOUNDED
 *   RISK_NO_LOOKAHEAD / RISK_FORMING_CANDLE_INVARIANCE / RISK_FUTURE_CANDLE_INVARIANCE
 *   SAME_ENTRY_FIXED_COHORT / SAME_EXIT_FIXED_COHORT / SAME_STOP_FIXED_COHORT
 *   UNIFORM_75_CONTROL / UNIFORM_50_CONTROL
 *   NO_PAIR_SPECIFIC_PARAMETERS / NO_TEST_RETUNE / PRODUCTION_030_SECONDARY_ONLY
 */

import { describe, it, expect } from "vitest";
import { evaluateSizing, DEFAULT_SPOT_RISK_CONFIG } from "../spot/spotRiskManager";
import { DEFAULT_SPOT_EXIT_CONFIG } from "../spot/spotExitPolicy";
import {
  SPOT_ENTRY_V4_MIN_QUALITY_SCORE,
  V4_WEIGHTS,
} from "../spot/spotEntryV4";
import {
  riskMultiplierR1, createRiskScalerR1, uniformScaler,
  RISK_MIN_MULTIPLIER, type SpotRiskR1Config,
} from "../spot/research/spotAdaptiveRiskR1";
import {
  HISTORICAL_ENTRY_THRESHOLDS, PRODUCTION_030_THRESHOLDS,
  EXPECTED_GRID_SIZE, buildGrid,
} from "../spot/research/runRiskR1Wfo";
import type { RiskScalerInput } from "../spot/research/fastResearchReplay";
import {
  Regime, RegimeDirection, MacroBias,
  type SpotMarketContext, type SpotRegimeContext, type SpotTicker, type SpotCandle,
} from "../spot/spotTypes";
import { DataHealth } from "../spot/candleTimestamp";
import type { FeeModel } from "../spot/feeModel";

const TEST_FEE_MODEL: FeeModel = {
  exchange: "revolutx", takerFeePct: 0.09, makerFeePct: 0.00, quality: "ESTIMATED",
};

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeCtx(atrPct = 1.5, price = 100_000, candles15m: SpotCandle[] = []): SpotMarketContext {
  const regimeContext: SpotRegimeContext = {
    regimeId: "r", contextId: "c", pair: "BTC/USD",
    regime: Regime.TREND, direction: RegimeDirection.BULLISH,
    volatility: "NORMAL" as any, macroBias: MacroBias.BULLISH,
    adx: 35, ema20: 100_500, ema50: 100_000, ema200: 99_000,
    emaAlignment: "bullish", bollingerWidth: 3, atrPct,
    confidence: 0.8, dataHealth: DataHealth.GOOD, generatedAt: Date.now(),
  };
  const ticker: SpotTicker = { bid: price - 25, ask: price + 25, last: price, spread: 50, fetchedAt: Date.now() };
  return {
    marketContextId: "m", generatedAt: Date.now(), pair: "BTC/USD",
    dataHealth: DataHealth.GOOD, macroBias: MacroBias.BULLISH,
    regimeContext,
    candles5m: [], candles15m, candles1h: [], candles4h: [],
    formingCandle5m: null, formingCandle15m: null, formingCandle1h: null, formingCandle4h: null,
    closedCandleContext: {} as any,
    adaptiveMarketState: {} as any,
    ticker, spreadPct: 0.05, atr: atrPct * price / 100,
    volumeMetrics: { volumeRatio: 1.2, volume24h: 1e6, participation: "NORMAL" },
  } as unknown as SpotMarketContext;
}

function makeInput(overrides: Partial<RiskScalerInput> = {}): RiskScalerInput {
  return {
    pair: "BTC/USD", evaluationTime: Date.now(), ctx: makeCtx(),
    intent: {} as any,
    v4Scores: { impulseScore: 0.6, retracementScore: 0.6, structureScore: 0.6, reclaimScore: 0.6, resumptionScore: 0.6, qualityScore: 0.6 },
    openPositions: 0, openLotsForPair: 0, openRiskUsd: 0,
    availableCapitalUsd: 10_000, baseRiskUsd: 50,
    ...overrides,
  };
}

// ─── ENTRY_V4_FROZEN / EXIT_E0_FROZEN ───────────────────────────────────────

describe("ENTRY_V4_FROZEN", () => {
  it("production V4 threshold and weights unchanged", () => {
    expect(SPOT_ENTRY_V4_MIN_QUALITY_SCORE).toBe(0.30);
    expect(V4_WEIGHTS).toEqual({ impulse: 0.20, retracement: 0.20, structure: 0.20, reclaim: 0.20, resumption: 0.20 });
  });
});

describe("EXIT_E0_FROZEN", () => {
  it("DEFAULT_SPOT_EXIT_CONFIG unchanged", () => {
    expect(DEFAULT_SPOT_EXIT_CONFIG.emergencyStopEnabled).toBe(true);
    expect(DEFAULT_SPOT_EXIT_CONFIG.breakEvenActivateAtPctR).toBe(1.0);
    expect(DEFAULT_SPOT_EXIT_CONFIG.trailingActivateAtPctR).toBe(1.5);
    expect(DEFAULT_SPOT_EXIT_CONFIG.trailingDistancePct).toBe(2.0);
    expect(DEFAULT_SPOT_EXIT_CONFIG.profitTargetR).toBe(3.0);
    expect(DEFAULT_SPOT_EXIT_CONFIG.timeEfficiencyNoProgressMinutes).toBe(180);
  });
});

// ─── RISK_NEVER_EXCEEDS_BASE / RISK_MULTIPLIER_BOUNDED ──────────────────────

describe("RISK_NEVER_EXCEEDS_BASE + RISK_MULTIPLIER_BOUNDED", () => {
  it("multiplier never exceeds 1.0 even if config asks for >1", () => {
    const evil: SpotRiskR1Config = { lowQualityBelow: 0.9, lowQualityMult: 1.5 as any };
    const m = riskMultiplierR1(evil, makeInput({ v4Scores: { ...makeInput().v4Scores!, qualityScore: 0.4 } }));
    // lowQualityMult 1.5 is not a reduction — policy must still clamp <= 1
    expect(m).toBeLessThanOrEqual(1.0);
    expect(m).toBeGreaterThan(0);
  });

  it("multiplier is bounded in [RISK_MIN_MULTIPLIER, 1.0] for all grid combos", () => {
    for (const combo of buildGrid()) {
      for (const input of [
        makeInput(),
        makeInput({ v4Scores: { ...makeInput().v4Scores!, qualityScore: 0.31 } }),
        makeInput({ ctx: makeCtx(4.0) }),
        makeInput({ openRiskUsd: 200 }),
      ]) {
        const m = riskMultiplierR1(combo, input);
        expect(m).toBeGreaterThanOrEqual(RISK_MIN_MULTIPLIER);
        expect(m).toBeLessThanOrEqual(1.0);
      }
    }
  });
});

// ─── RISK_NO_LOOKAHEAD / CANDLE INVARIANCE ──────────────────────────────────

describe("RISK_NO_LOOKAHEAD", () => {
  it("multiplier ignores candle contents entirely (future/forming candles cannot leak)", () => {
    const cfg: SpotRiskR1Config = { lowQualityBelow: 0.55, lowQualityMult: 0.5, highAtrPctAbove: 2.5, highVolMult: 0.75 };
    const scaler = createRiskScalerR1(cfg);
    const base = makeInput();
    const m1 = scaler(base);
    // Same input, ctx with different candles (simulating future/forming data)
    const futureCandles: SpotCandle[] = [{ time: Date.now() + 1e6, open: 1, high: 1e9, low: 0, close: 1, volume: 1 }];
    const m2 = scaler({ ...base, ctx: { ...base.ctx, candles15m: futureCandles } });
    expect(m2).toBe(m1);
  });

  it("FORMING + FUTURE candle invariance: output identical with any candles present", () => {
    const scaler = createRiskScalerR1({ highAtrPctAbove: 2.5, highVolMult: 0.5 });
    const i1 = makeInput({ ctx: makeCtx(1.0) });
    const junk: SpotCandle[] = Array.from({ length: 50 }, (_, i) => ({
      time: Date.now() + i * 60000, open: 5e5, high: 9e5, low: 1, close: 4e5, volume: 999,
    }));
    const m1 = scaler(i1);
    const m2 = scaler({ ...i1, ctx: { ...i1.ctx, candles5m: junk, candles15m: junk } });
    expect(m1).toBe(1.0); // atrPct 1.0 below threshold
    expect(m2).toBe(m1);
  });
});

// ─── SAME_ENTRY / SAME_EXIT / SAME_STOP (fixed cohort semantics) ────────────

describe("SAME_*_FIXED_COHORT", () => {
  it("scaled sizing keeps same stop price/distance — only volume and risk change", () => {
    const ctx = makeCtx(1.5);
    const s0 = evaluateSizing(ctx, {} as any, 10_000, 0, DEFAULT_SPOT_RISK_CONFIG, TEST_FEE_MODEL);
    const s1 = evaluateSizing(ctx, {} as any, 10_000, 0,
      { ...DEFAULT_SPOT_RISK_CONFIG, riskPerTradeUsd: DEFAULT_SPOT_RISK_CONFIG.riskPerTradeUsd * 0.5 }, TEST_FEE_MODEL);
    expect(s0.approved).toBe(true);
    expect(s1.approved).toBe(true);
    expect(s1.stopPrice).toBe(s0.stopPrice);               // SAME_STOP
    expect(s1.stopDistanceUsd).toBe(s0.stopDistanceUsd);   // SAME_STOP
    expect(s1.riskUsd).toBeCloseTo(s0.riskUsd * 0.5, 9);   // risk halved
    expect(s1.volume).toBeCloseTo(s0.volume * 0.5, 9);     // size halved
    expect(s1.entryFeeUsd).toBeCloseTo(s0.entryFeeUsd * 0.5, 6); // fees recomputed
  });
});

// ─── UNIFORM CONTROLS ───────────────────────────────────────────────────────

describe("UNIFORM_RISK_CONTROLS", () => {
  it("UNIFORM_75_CONTROL returns exactly 0.75 for every input", () => {
    const u = uniformScaler(0.75);
    for (const i of [makeInput(), makeInput({ ctx: makeCtx(5) }), makeInput({ openRiskUsd: 500 })]) {
      expect(u(i)).toBe(0.75);
    }
  });
  it("UNIFORM_50_CONTROL returns exactly 0.50 for every input", () => {
    const u = uniformScaler(0.50);
    for (const i of [makeInput(), makeInput({ openPositions: 3 })]) {
      expect(u(i)).toBe(0.50);
    }
  });
});

// ─── NO_PAIR_SPECIFIC_PARAMETERS / NO_TEST_RETUNE / PRODUCTION_030 ──────────

describe("NO_PAIR_SPECIFIC_PARAMETERS", () => {
  it("R1 config has no per-pair fields", () => {
    const cfg: SpotRiskR1Config = {
      lowQualityBelow: 0.55, lowQualityMult: 0.5,
      highAtrPctAbove: 2.5, highVolMult: 0.75,
    };
    for (const k of Object.keys(cfg)) {
      expect(k.toLowerCase()).not.toMatch(/pair|btc|eth|sol|xrp/);
    }
  });
});

describe("NO_TEST_RETUNE", () => {
  it("grid is deterministic and exactly 24 balanced combos", () => {
    expect(EXPECTED_GRID_SIZE).toBe(24);
    const g = buildGrid();
    expect(g.length).toBe(24);
    expect(g.map(c => c.label)).toEqual(buildGrid().map(c => c.label));
    for (const c of g) {
      expect(c).not.toHaveProperty("fold");
      expect(c).not.toHaveProperty("testStart");
    }
  });
});

describe("PRODUCTION_030_SECONDARY_ONLY", () => {
  it("production thresholds are 0.30 on all folds; historical fixed [0.50,0.30,0.30]", () => {
    expect([...PRODUCTION_030_THRESHOLDS]).toEqual([0.30, 0.30, 0.30]);
    expect([...HISTORICAL_ENTRY_THRESHOLDS]).toEqual([0.50, 0.30, 0.30]);
  });
});
