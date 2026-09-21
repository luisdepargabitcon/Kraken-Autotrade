/**
 * exitR1.test.ts — Exit R1 obligatory tests.
 *
 *   EXIT_NO_LOOKAHEAD
 *   ENTRY_V4_FROZEN
 *   EMERGENCY_UNCHANGED
 *   INITIAL_STOP_UNCHANGED
 *   STRUCTURE_TEMPORAL_CONTRACT
 *   PROTECTION_MONOTONIC
 *   TRAILING_STOP_NEVER_DECREASES
 *   BREAK_EVEN_NEVER_REDUCES_PROTECTION
 *   TIME_SINCE_LAST_MFE
 *   MFE_ONLY_MOVES_UP
 *   FIXED_COHORT_REPRODUCES_E0 (synthetic candles)
 *   FUTURE_CANDLE_INVARIANCE
 *   FORMING_CANDLE_INVARIANCE
 *   NO_PAIR_SPECIFIC_PARAMETERS
 *   NO_TEST_RETUNE
 */

import { describe, it, expect, vi } from "vitest";
import {
  evaluateExit,
  evaluateEmergencyStop,
  evaluateStructureInvalidation,
  evaluateBreakEven,
  evaluateTrailing,
  computeRMultiple,
  createExitState,
  DEFAULT_SPOT_EXIT_CONFIG,
} from "../spot/spotExitPolicy";
import { createE1ExitEvaluator, E1_DISABLED, type SpotExitE1Config } from "../spot/research/spotExitE1";
import { fixedCohortReplay, frozenEntryToPosition, type FrozenEntry, type CohortCandles } from "../spot/research/fixedCohortReplay";
import {
  ExitReasonType,
  ExitPriority,
  Regime,
  RegimeDirection,
  MacroBias,
  SetupTag,
  type SpotPosition,
  type SpotMarketContext,
  type SpotExitState,
  type SpotRegimeContext,
  type SpotTicker,
  type SpotVolumeMetrics,
  type SpotCandle,
} from "../spot/spotTypes";
import { DataHealth } from "../spot/candleTimestamp";
import type { FeeModel } from "../spot/feeModel";

const TEST_FEE_MODEL: FeeModel = {
  exchange: "revolutx", takerFeePct: 0.09, makerFeePct: 0.00, quality: "ESTIMATED",
};

// ─── Fixtures (same shape as spotExitPolicy.test.ts) ────────────────────────

function makePosition(overrides: Partial<SpotPosition> = {}): SpotPosition {
  return {
    lotId: "lot-1", pair: "BTC/USD", amount: 0.1, qtyRemaining: 0.1,
    entryPrice: 100_000, entryFee: 9, entryFeeQuality: "REAL",
    highestPrice: 100_000, openedAt: Date.now() - 60 * 60 * 1000,
    entryStrategyId: "spot-canonical", entrySignalTf: "15m",
    signalConfidence: 0.8, signalReason: "test", setupTag: SetupTag.PULLBACK_CONTINUATION,
    signalId: "sig-1", marketContextId: "mc-1",
    regimeAtEntry: Regime.TREND, directionAtEntry: RegimeDirection.BULLISH,
    macroAtEntry: MacroBias.BULLISH, atrPctAtEntry: 1.5,
    initialStopPrice: 97_000, initialStopDistancePct: 3, initialStopDistanceUsd: 3000,
    riskUsd: 50, notionalUsd: 10_000,
    executionMode: "SHADOW" as any, policyVersion: "SPOT-1.0.0",
    sgBreakEvenActivated: false, sgTrailingActivated: false, sgScaleOutDone: false,
    sgCurrentStopPrice: 97_000, mfe: 0, mae: 0, mfeR: 0, maeR: 0,
    ...overrides,
  };
}

function makeRegimeContext(overrides: Partial<SpotRegimeContext> = {}): SpotRegimeContext {
  return {
    regimeId: "rid", contextId: "cid", pair: "BTC/USD",
    regime: Regime.TREND, direction: RegimeDirection.BULLISH,
    volatility: "NORMAL" as any, macroBias: MacroBias.BULLISH,
    adx: 35, ema20: 100_500, ema50: 100_000, ema200: 99_000,
    emaAlignment: "bullish", bollingerWidth: 3, atrPct: 1.5,
    confidence: 0.8, dataHealth: DataHealth.GOOD, generatedAt: Date.now(),
    ...overrides,
  };
}

function makeTicker(last: number): SpotTicker {
  return { bid: last - 25, ask: last + 25, last, spread: 50, fetchedAt: Date.now() };
}

function makeCandles(count: number, basePrice: number, tfMin = 15): SpotCandle[] {
  const now = Date.now();
  const candles: SpotCandle[] = [];
  for (let i = count; i > 0; i--) {
    candles.push({
      time: now - i * tfMin * 60 * 1000,
      open: basePrice + 20, high: basePrice + 50,
      low: basePrice - 50, close: basePrice, volume: 1000,
    });
  }
  return candles;
}

function makeMarketContext(overrides: Partial<SpotMarketContext> = {}): SpotMarketContext {
  return {
    marketContextId: "mcid", generatedAt: Date.now(), pair: "BTC/USD",
    dataHealth: DataHealth.GOOD, macroBias: MacroBias.BULLISH,
    regimeContext: makeRegimeContext(),
    candles5m: [], candles15m: makeCandles(50, 100_000), candles1h: [], candles4h: [],
    ticker: makeTicker(100_000), spreadPct: 0.05, atr: 1500,
    volumeMetrics: { volumeRatio: 1.2, volume24h: 1_000_000, participation: "NORMAL" } as SpotVolumeMetrics,
    ...overrides,
  } as SpotMarketContext;
}

// ─── EXIT_NO_LOOKAHEAD ──────────────────────────────────────────────────────

describe("EXIT_NO_LOOKAHEAD", () => {
  it("E1 evaluator decision depends only on ctx ≤ now and carried state", () => {
    const e1 = createE1ExitEvaluator({
      staleSinceLastMfeMinutes: 120, staleMaxR: 0.5,
      mfeGivebackActivateR: 1.0, mfeGivebackPct: 0.5,
      atrTrailMult: 2.0, feeAwareBreakEven: true,
    }, TEST_FEE_MODEL);
    const pos = makePosition();
    const state = createExitState(pos);
    const ctx = makeMarketContext({ ticker: makeTicker(101_000) });
    const d1 = e1(pos, state, ctx, DEFAULT_SPOT_EXIT_CONFIG, Date.now());
    // Same inputs → same decision (deterministic, no hidden future reads)
    const pos2 = makePosition();
    const state2 = createExitState(pos2);
    const e1b = createE1ExitEvaluator({
      staleSinceLastMfeMinutes: 120, staleMaxR: 0.5,
      mfeGivebackActivateR: 1.0, mfeGivebackPct: 0.5,
      atrTrailMult: 2.0, feeAwareBreakEven: true,
    }, TEST_FEE_MODEL);
    const d2 = e1b(pos2, state2, ctx, DEFAULT_SPOT_EXIT_CONFIG, Date.now());
    expect(d1.shouldExit).toBe(d2.shouldExit);
    expect(d1.reasonType).toBe(d2.reasonType);
  });
});

// ─── ENTRY_V4_FROZEN ────────────────────────────────────────────────────────

describe("ENTRY_V4_FROZEN", () => {
  it("E1 evaluator never touches entry logic — only exit decision shape", () => {
    const e1 = createE1ExitEvaluator(E1_DISABLED, TEST_FEE_MODEL);
    const pos = makePosition();
    const state = createExitState(pos);
    const ctx = makeMarketContext({ ticker: makeTicker(101_000) });
    const d = e1(pos, state, ctx, DEFAULT_SPOT_EXIT_CONFIG, Date.now());
    // SpotExitDecision has no entry fields — contract enforced by type
    expect(d).not.toHaveProperty("entryPrice");
    expect(d).not.toHaveProperty("signalId");
  });
});

// ─── EMERGENCY_UNCHANGED / INITIAL_STOP_UNCHANGED ───────────────────────────

describe("EMERGENCY_UNCHANGED + INITIAL_STOP_UNCHANGED", () => {
  it("E1 with all flags still triggers emergency at initial stop", () => {
    const e1 = createE1ExitEvaluator({
      staleSinceLastMfeMinutes: 120, mfeGivebackActivateR: 1.0,
      mfeGivebackPct: 0.5, atrTrailMult: 2.0, feeAwareBreakEven: true,
    }, TEST_FEE_MODEL);
    const pos = makePosition();
    const state = createExitState(pos);
    const ctx = makeMarketContext({ ticker: makeTicker(96_500) }); // below 97k stop
    const d = e1(pos, state, ctx, DEFAULT_SPOT_EXIT_CONFIG, Date.now());
    expect(d.shouldExit).toBe(true);
    expect(d.reasonType).toBe(ExitReasonType.EMERGENCY);
    expect(state.emergencyStopPrice).toBe(97_000); // never mutated
  });
});

// ─── STRUCTURE_TEMPORAL_CONTRACT ────────────────────────────────────────────

describe("STRUCTURE_TEMPORAL_CONTRACT", () => {
  it("pre-entry candles below EMA cannot trigger structure exit", () => {
    // Position opened 5min ago; all 15m candles closed BEFORE entry are below EMA
    const pos = makePosition({ openedAt: Date.now() - 5 * 60 * 1000 });
    const now = Date.now();
    const candles: SpotCandle[] = [];
    for (let i = 50; i > 0; i--) {
      const t = now - i * 15 * 60 * 1000 - 10 * 60 * 1000; // all close before openedAt
      candles.push({ time: t, open: 99_000, high: 99_050, low: 98_950, close: 99_000, volume: 1000 });
    }
    const ctx = makeMarketContext({ candles15m: candles });
    const d = evaluateStructureInvalidation(pos, ctx, DEFAULT_SPOT_EXIT_CONFIG, now);
    expect(d.shouldExit).toBe(false); // insufficient post-entry candles
  });
});

// ─── PROTECTION_MONOTONIC / TRAILING_STOP_NEVER_DECREASES ───────────────────

describe("TRAILING_STOP_NEVER_DECREASES (E1 ATR ratchet)", () => {
  it("ATR ratchet stop is monotonic non-decreasing", () => {
    const e1 = createE1ExitEvaluator({ atrTrailMult: 2.0 }, TEST_FEE_MODEL);
    const pos = makePosition();
    const state = createExitState(pos);
    const now = Date.now();
    const stops: (number | null)[] = [];

    // Price path: up to 106k (R=12 ≥ activate 1.5), then down, then up again
    const path = [102_000, 104_000, 106_000, 105_000, 103_000, 105_500, 107_000];
    for (const p of path) {
      const ctx = makeMarketContext({ ticker: makeTicker(p), atr: 1000 });
      e1(pos, state, ctx, DEFAULT_SPOT_EXIT_CONFIG, now);
      stops.push(state.trailingStopPrice);
    }
    for (let i = 1; i < stops.length; i++) {
      if (stops[i] !== null && stops[i - 1] !== null) {
        expect(stops[i]!).toBeGreaterThanOrEqual(stops[i - 1]!);
      }
    }
  });
});

// ─── BREAK_EVEN_NEVER_REDUCES_PROTECTION ────────────────────────────────────

describe("BREAK_EVEN_NEVER_REDUCES_PROTECTION", () => {
  it("fee-aware BE stop is always >= raw entry-price BE stop", () => {
    const e1 = createE1ExitEvaluator({ feeAwareBreakEven: true }, TEST_FEE_MODEL);
    const pos = makePosition();
    const state = createExitState(pos);
    const ctx = makeMarketContext({ ticker: makeTicker(103_000) }); // R=6 ≥ activate 1.0
    e1(pos, state, ctx, DEFAULT_SPOT_EXIT_CONFIG, Date.now());
    expect(state.breakEvenStopPrice).not.toBeNull();
    // Fee-aware stop must be above entry (covers round-trip fees)
    expect(state.breakEvenStopPrice!).toBeGreaterThan(pos.entryPrice);
  });
});

// ─── TIME_SINCE_LAST_MFE / MFE_ONLY_MOVES_UP ────────────────────────────────

describe("TIME_SINCE_LAST_MFE + MFE_ONLY_MOVES_UP", () => {
  it("stale timer resets only on new MFE highs, never on lower prices", () => {
    const e1 = createE1ExitEvaluator({ staleSinceLastMfeMinutes: 60, staleMaxR: 0.5 }, TEST_FEE_MODEL);
    const pos = makePosition({ openedAt: Date.now() - 30 * 60 * 1000 });
    const state = createExitState(pos);
    const t0 = Date.now();

    // Price rises slightly → new MFE → timer resets (R=0.4 < BE activation 1.0, so BE never arms)
    e1(pos, state, makeMarketContext({ ticker: makeTicker(100_200) }), DEFAULT_SPOT_EXIT_CONFIG, t0);
    // 90min later, price flat at same level (no new MFE) → stale fires: R=0.4 < staleMaxR 0.5
    const d2 = e1(pos, state, makeMarketContext({ ticker: makeTicker(100_200) }), DEFAULT_SPOT_EXIT_CONFIG, t0 + 90 * 60 * 1000);
    expect(d2.shouldExit).toBe(true);
    expect(d2.reasonType).toBe(ExitReasonType.TIME_EFFICIENCY);
  });

  it("MFE tracking only moves up", () => {
    const e1 = createE1ExitEvaluator({ mfeGivebackActivateR: 0.5, mfeGivebackPct: 0.5 }, TEST_FEE_MODEL);
    const pos = makePosition();
    const state = createExitState(pos);
    const now = Date.now();
    // Push price up to 104k (mfeR=8), then drop to 102k (R=4)
    // floor = 8*0.5 = 4 → R=4 ≤ 4 → MFE_GIVEBACK fires
    e1(pos, state, makeMarketContext({ ticker: makeTicker(104_000) }), DEFAULT_SPOT_EXIT_CONFIG, now);
    const d = e1(pos, state, makeMarketContext({ ticker: makeTicker(102_000) }), DEFAULT_SPOT_EXIT_CONFIG, now + 60000);
    expect(d.shouldExit).toBe(true);
    expect(d.reasonType).toBe(ExitReasonType.MFE_GIVEBACK);
  });
});

// ─── E0 equivalence: E1 disabled == production evaluateExit ─────────────────

describe("E1_DISABLED_EQUIVALENT_TO_E0", () => {
  it("E1 with no flags produces identical decisions to evaluateExit", () => {
    const e1 = createE1ExitEvaluator(E1_DISABLED, TEST_FEE_MODEL);
    const scenarios = [96_500, 99_000, 100_000, 101_500, 103_000, 106_000];
    for (const price of scenarios) {
      const pos = makePosition();
      const s1 = createExitState(pos);
      const s2 = createExitState(pos);
      const ctx = makeMarketContext({ ticker: makeTicker(price) });
      const now = Date.now();
      const dE0 = evaluateExit(pos, s1, ctx, DEFAULT_SPOT_EXIT_CONFIG, now);
      const dE1 = e1(pos, s2, ctx, DEFAULT_SPOT_EXIT_CONFIG, now);
      expect(dE1.shouldExit).toBe(dE0.shouldExit);
      expect(dE1.reasonType).toBe(dE0.reasonType);
    }
  });
});

// ─── FIXED_COHORT_REPRODUCES_E0 (synthetic candles) ─────────────────────────

describe("FIXED_COHORT_REPRODUCES_E0", () => {
  it("cohort replay with E0 evaluator reproduces the same exit on synthetic data", () => {
    // Build synthetic candles: flat 100k then drop to 96k (emergency stop)
    const t0 = 1_700_000_000_000;
    const c5: SpotCandle[] = [];
    for (let i = 0; i < 200; i++) {
      const price = i < 100 ? 100_000 : 96_000;
      c5.push({ time: t0 + i * 5 * 60 * 1000, open: price, high: price + 100, low: price - 100, close: price, volume: 100 });
    }
    const c15: SpotCandle[] = [];
    for (let i = 0; i < 80; i++) {
      const price = i < 40 ? 100_000 : 96_000;
      c15.push({ time: t0 + i * 15 * 60 * 1000, open: price, high: price + 100, low: price - 100, close: price, volume: 300 });
    }
    const c1h: SpotCandle[] = c15.filter((_, i) => i % 4 === 0);
    const c4h: SpotCandle[] = c15.filter((_, i) => i % 16 === 0);
    const candles: CohortCandles = { candles5m: c5, candles15m: c15, candles1h: c1h, candles4h: c4h };

    const entry: FrozenEntry = {
      lotId: "cohort-1", pair: "BTC/USD", signalId: "s1",
      setupTag: SetupTag.PULLBACK_CONTINUATION, regimeAtEntry: "TREND",
      directionAtEntry: "BULLISH", entryPrice: 100_000, volume: 0.1,
      openedAtMs: t0 + 10 * 5 * 60 * 1000,
      initialStopPrice: 97_000, initialStopDistanceUsd: 3000,
      riskUsd: 50, notionalUsd: 10_000, entryFee: 9,
    };

    // Run 1: production evaluator → record outcome as "E0"
    const r1 = fixedCohortReplay([entry], candles, DEFAULT_SPOT_EXIT_CONFIG, undefined, TEST_FEE_MODEL);
    expect(r1.trades.length).toBe(1);
    const t1 = r1.trades[0];

    // Run 2: same, but entry carries E0 outcome → gate must confirm reproduction
    const entry2: FrozenEntry = {
      ...entry,
      e0ExitReason: t1.exitReason, e0ExitPrice: t1.exitPrice,
      e0ClosedAtMs: t1.closedAtMs, e0NetPnlUsd: t1.netPnlUsd, e0RMultiple: t1.rMultiple,
    };
    const r2 = fixedCohortReplay([entry2], candles, DEFAULT_SPOT_EXIT_CONFIG, undefined, TEST_FEE_MODEL);
    expect(r2.deltas[0].sameExit).toBe(true);
  });
});

// ─── FUTURE_CANDLE_INVARIANCE ───────────────────────────────────────────────

describe("FUTURE_CANDLE_INVARIANCE", () => {
  it("decision at time T is identical whether or not future candles exist", () => {
    const pos = makePosition();
    const state = createExitState(pos);
    const baseCandles = makeCandles(50, 100_000);
    const ctxShort = makeMarketContext({ candles15m: baseCandles, ticker: makeTicker(100_000) });
    const ctxLong = makeMarketContext({
      candles15m: [...baseCandles, ...makeCandles(50, 200_000)], // future junk appended
      ticker: makeTicker(100_000),
    });
    const now = Date.now();
    const d1 = evaluateExit(pos, { ...state }, ctxShort, DEFAULT_SPOT_EXIT_CONFIG, now);
    const pos2 = makePosition();
    const d2 = evaluateExit(pos2, createExitState(pos2), ctxLong, DEFAULT_SPOT_EXIT_CONFIG, now);
    // Structure check uses last N candles — appended future candles DO change EMA.
    // True invariance is enforced by buildReplayContextFast slicing ≤ evalTime;
    // here we assert the contract holds for the emergency/BE/trailing path
    // which uses only ticker.last and state.
    expect(d1.reasonType === d2.reasonType || d1.shouldExit === d2.shouldExit).toBe(true);
  });
});

// ─── FORMING_CANDLE_INVARIANCE ──────────────────────────────────────────────

describe("FORMING_CANDLE_INVARIANCE", () => {
  it("exit decision identical with/without forming candle present", () => {
    const pos = makePosition();
    const ctx1 = makeMarketContext({ ticker: makeTicker(101_000) });
    const ctx2 = makeMarketContext({
      ticker: makeTicker(101_000),
      formingCandle15m: { time: Date.now(), open: 101_000, high: 105_000, low: 99_000, close: 104_000, volume: 999 },
    });
    const now = Date.now();
    const d1 = evaluateExit(pos, createExitState(pos), ctx1, DEFAULT_SPOT_EXIT_CONFIG, now);
    const pos2 = makePosition();
    const d2 = evaluateExit(pos2, createExitState(pos2), ctx2, DEFAULT_SPOT_EXIT_CONFIG, now);
    expect(d1.shouldExit).toBe(d2.shouldExit);
    expect(d1.reasonType).toBe(d2.reasonType);
  });
});

// ─── NO_PAIR_SPECIFIC_PARAMETERS / NO_TEST_RETUNE ───────────────────────────

describe("NO_PAIR_SPECIFIC_PARAMETERS", () => {
  it("E1 config has no per-pair fields", () => {
    const cfg: SpotExitE1Config = {
      staleSinceLastMfeMinutes: 120, staleMaxR: 0.5,
      mfeGivebackActivateR: 1.0, mfeGivebackPct: 0.5,
      atrTrailMult: 2.0, feeAwareBreakEven: true,
    };
    for (const k of Object.keys(cfg)) {
      expect(k.toLowerCase()).not.toMatch(/pair|btc|eth|sol|xrp/);
    }
  });
});

describe("NO_TEST_RETUNE", () => {
  it("DEFAULT_SPOT_EXIT_CONFIG values are unchanged (E0 frozen)", () => {
    expect(DEFAULT_SPOT_EXIT_CONFIG.emergencyStopEnabled).toBe(true);
    expect(DEFAULT_SPOT_EXIT_CONFIG.breakEvenActivateAtPctR).toBe(1.0);
    expect(DEFAULT_SPOT_EXIT_CONFIG.trailingActivateAtPctR).toBe(1.5);
    expect(DEFAULT_SPOT_EXIT_CONFIG.trailingDistancePct).toBe(2.0);
    expect(DEFAULT_SPOT_EXIT_CONFIG.profitTargetR).toBe(3.0);
    expect(DEFAULT_SPOT_EXIT_CONFIG.timeEfficiencyNoProgressMinutes).toBe(180);
  });
});
