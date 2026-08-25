/**
 * Forward Twin Latency Benchmark — 100k iterations.
 *
 * Measures p50/p95/p99 for:
 *   A. collector push (isolated)
 *   B. buildScanSnapshot (full)
 *   C. buildSupervisorSnapshot (full)
 *   D. buildFillSnapshot (full)
 */
import { describe, it, expect } from "vitest";
import {
  SPOT_FORWARD_TWIN_BUFFER_MAX,
  type ForwardTwinSnapshot,
} from "../spot/spotForwardTwinTypes";
import {
  _resetForTest,
  _enableForTest,
  captureScan,
  getCollectorStats,
} from "../spot/spotForwardTwinCollector";
import {
  buildScanSnapshot,
  buildSupervisorSnapshot,
  buildFillSnapshot,
} from "../spot/spotForwardTwinBuilder";
import { ExecutionMode, Regime, RegimeDirection, MacroBias, VolatilityLevel,
  type SpotMarketContext, type SpotPosition, type SpotExitState, type SpotExitDecision,
  type SpotExecutionResult, type SpotExecutionIntent, SetupTag } from "../spot/spotTypes";
import type { SpotSignalResult } from "../spot/spotCanonicalStrategy";
import type { SizingResult } from "../spot/spotRiskManager";
import type { IntentEvaluationResult } from "../spot/spotEntryIntent";
import { DataHealth } from "../spot/candleTimestamp";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCandles(count: number, intervalMs: number, startPrice: number, startVol: number, trend: number = 0) {
  const candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
  let price = startPrice;
  const baseTime = 1700000000000 - count * intervalMs;
  for (let i = 0; i < count; i++) {
    const open = price;
    const drift = trend + (Math.sin(i / 7) * 50);
    const close = open + drift;
    const high = Math.max(open, close) + 30;
    const low = Math.min(open, close) - 30;
    const volume = startVol + (i % 5) * 2;
    candles.push({ time: baseTime + i * intervalMs, open, high, low, close, volume });
    price = close;
  }
  return candles;
}

function makeCtx(): SpotMarketContext {
  const candles5m = makeCandles(25, 5 * 60 * 1000, 49980, 10, 5);
  const candles15m = makeCandles(60, 15 * 60 * 1000, 49800, 50, 3);
  const candles1h = makeCandles(50, 60 * 60 * 1000, 49500, 200, 10);
  const candles4h = makeCandles(30, 4 * 60 * 60 * 1000, 49000, 1000, 20);
  const last15m = candles15m[candles15m.length - 1];
  return {
    marketContextId: "ctx-bench-1",
    generatedAt: last15m.time,
    pair: "BTC/USD",
    dataHealth: DataHealth.GOOD,
    macroBias: MacroBias.BULLISH,
    regimeContext: {
      regimeId: "regime-1", contextId: "ctx-bench-1", pair: "BTC/USD",
      regime: Regime.TREND, direction: RegimeDirection.BULLISH, volatility: VolatilityLevel.NORMAL,
      macroBias: MacroBias.BULLISH, adx: 28, ema20: last15m.close - 20, ema50: 49500, ema200: 48000,
      emaAlignment: "bullish", bollingerWidth: 0.03, atrPct: 1.5, confidence: 0.75,
      dataHealth: DataHealth.GOOD, generatedAt: last15m.time,
    },
    candles5m, candles15m, candles1h, candles4h,
    ticker: { bid: last15m.close - 5, ask: last15m.close + 5, last: last15m.close, spread: 10, fetchedAt: last15m.time },
    spreadPct: 0.02, atr: 750,
    volumeMetrics: { volumeRatio: 1.2, volume24h: 5000000, participation: "NORMAL" },
  };
}

function makeSignal(): SpotSignalResult {
  return { signal: "BUY", setupTag: SetupTag.PULLBACK_CONTINUATION, reason: "test", confidence: 0.8,
    originPrice: 50000, origin15mCloseAt: 1700000000000, originAtrPct: 1.5, originVolume: 50,
    contextId: "ctx-bench-1", blockReason: null };
}

function makeSizing(): SizingResult {
  return { approved: true, reason: "ok", volume: 0.01, notionalUsd: 500, stopPrice: 49250,
    stopDistanceUsd: 750, stopDistancePct: 1.5, riskUsd: 7.5, entryFeeUsd: 1.3, roundTripFeeUsd: 2.6,
    expectedProfitUsd: 15, blockReason: null, blockCode: null };
}

function makeIntent() {
  return { signalId: "sig-1", pair: "BTC/USD", setupTag: SetupTag.PULLBACK_CONTINUATION,
    createdAt: 1700000000000, expiresAt: 1700000600000, state: "APPROVED" as any,
    origin15mOpenAt: 1700000000000, origin15mCloseAt: 1700000000000, originPrice: 50000,
    originClose: 50050, originAtrPct: 1.5, originRegime: Regime.TREND, originDirection: RegimeDirection.BULLISH,
    originMacro: MacroBias.BULLISH, originVolume: 50, originContextId: "ctx-bench-1",
    retryCount: 0, initialBlockReason: null, lastBlockReason: null, lastEvaluatedAt: 1700000000000 };
}

function makeIntentEvaluation(): IntentEvaluationResult {
  return { newState: "APPROVED" as any, shouldExecute: true, reason: "ok", updatedIntent: makeIntent() as any };
}

function makePosition(): SpotPosition {
  return { lotId: "spot-BTC-001", pair: "BTC/USD", amount: 0.01, qtyRemaining: 0.01,
    entryPrice: 50005, entryFee: 1.3, entryFeeQuality: "ESTIMATED", highestPrice: 50500,
    openedAt: 1700000000000, entryStrategyId: "SPOT_CANONICAL", entrySignalTf: "15m",
    signalConfidence: 0.8, signalReason: "test", setupTag: SetupTag.PULLBACK_CONTINUATION,
    signalId: "sig-1", marketContextId: "ctx-1", regimeAtEntry: Regime.TREND,
    directionAtEntry: RegimeDirection.BULLISH, macroAtEntry: MacroBias.BULLISH, atrPctAtEntry: 1.5,
    initialStopPrice: 49250, initialStopDistancePct: 1.5, initialStopDistanceUsd: 750, riskUsd: 7.5,
    notionalUsd: 500, executionMode: ExecutionMode.SHADOW, policyVersion: "SPOT-1.0.0-20260812",
    sgBreakEvenActivated: false, sgTrailingActivated: false, sgScaleOutDone: false,
    sgCurrentStopPrice: 49250, mfe: 5, mae: -2, mfeR: 0.67, maeR: -0.27 };
}

function makeExitState(): SpotExitState {
  return { positionLotId: "spot-BTC-001", emergencyStopPrice: 49250, structureInvalidationPrice: null,
    breakEvenStopPrice: null, trailingStopPrice: null, trailingHighestPrice: 50500,
    profitExitTarget: 51000, timeEfficiencyArmed: false, lastExitEvaluation: null, currentExitReason: null };
}

function makeExitDecision(): SpotExitDecision {
  return { shouldExit: true, reasonType: "PROFIT", reason: "target", price: 51000, priority: 1, evaluatedAt: 1700000600000 };
}

function makeExecIntent(side: "BUY" | "SELL" = "BUY"): SpotExecutionIntent {
  return { intentId: "exec-1", pair: "BTC/USD", side, volume: 0.01, notionalUsd: 500,
    orderType: "market", positionLotId: side === "BUY" ? null : "spot-BTC-001",
    signalId: "sig-1", retryCount: 0 } as any;
}

function makeExecResult(): SpotExecutionResult {
  return { orderId: "order-1", fillPrice: 50010, fillVolume: 0.01, feeUsd: 1.3,
    slippageUsd: 5, fillQuality: "GOOD", executedAt: 1700000100000 } as any;
}

// ─── Percentile helper ────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function formatMs(ms: number): string {
  return ms.toFixed(4);
}

// ─── Benchmark ────────────────────────────────────────────────────────────────

const ITERATIONS = 100_000;

describe("Forward Twin Benchmark", () => {
  it("COLLECTOR_PUSH — 100k iterations p50/p95/p99", () => {
    _resetForTest();
    _enableForTest();

    // Pre-build snapshots to isolate collector push cost
    const ctx = makeCtx();
    const snap = buildScanSnapshot({
      scanId: "snap-bench", mode: "SHADOW", ctx, signal: makeSignal(),
      intent: makeIntent(), intentEvaluation: makeIntentEvaluation(), sizing: makeSizing(),
      availableCapital: 10000, openLots: 0, maxLotsPerPair: 3, reservedCapital: 0,
      realizedPnl: 0, totalFees: 0, pipelineStopStage: "EXECUTED",
    });

    // Warm up
    for (let i = 0; i < 1000; i++) {
      captureScan(snap);
    }
    _resetForTest();
    _enableForTest();

    const times: number[] = [];
    // Use a large buffer to avoid shift() cost skewing — reset periodically
    const RESET_EVERY = 400; // Keep buffer under 500

    for (let i = 0; i < ITERATIONS; i++) {
      if (i % RESET_EVERY === 0 && i > 0) {
        _resetForTest();
        _enableForTest();
      }
      const start = performance.now();
      captureScan(snap);
      const end = performance.now();
      times.push(end - start);
    }

    times.sort((a, b) => a - b);
    const p50 = percentile(times, 50);
    const p95 = percentile(times, 95);
    const p99 = percentile(times, 99);

    console.log(`COLLECTOR_PUSH_P50_MS=${formatMs(p50)}`);
    console.log(`COLLECTOR_PUSH_P95_MS=${formatMs(p95)}`);
    console.log(`COLLECTOR_PUSH_P99_MS=${formatMs(p99)}`);

    // Sanity: collector push should be sub-millisecond
    expect(p50).toBeLessThan(1);
    expect(times.length).toBe(ITERATIONS);
  });

  it("SCAN_SNAPSHOT_BUILD — 100k iterations p50/p95/p99", () => {
    const ctx = makeCtx();
    const signal = makeSignal();
    const intent = makeIntent();
    const intentEval = makeIntentEvaluation();
    const sizing = makeSizing();

    // Warm up
    for (let i = 0; i < 1000; i++) {
      buildScanSnapshot({ scanId: `warm-${i}`, mode: "SHADOW", ctx, signal, intent, intentEvaluation: intentEval, sizing,
        availableCapital: 10000, openLots: 0, maxLotsPerPair: 3, reservedCapital: 0, realizedPnl: 0, totalFees: 0 });
    }

    const times: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      buildScanSnapshot({ scanId: `bench-${i}`, mode: "SHADOW", ctx, signal, intent, intentEvaluation: intentEval, sizing,
        availableCapital: 10000, openLots: 0, maxLotsPerPair: 3, reservedCapital: 0, realizedPnl: 0, totalFees: 0 });
      const end = performance.now();
      times.push(end - start);
    }

    times.sort((a, b) => a - b);
    const p50 = percentile(times, 50);
    const p95 = percentile(times, 95);
    const p99 = percentile(times, 99);

    console.log(`SCAN_SNAPSHOT_BUILD_P50_MS=${formatMs(p50)}`);
    console.log(`SCAN_SNAPSHOT_BUILD_P95_MS=${formatMs(p95)}`);
    console.log(`SCAN_SNAPSHOT_BUILD_P99_MS=${formatMs(p99)}`);

    expect(times.length).toBe(ITERATIONS);
  });

  it("SUPERVISOR_SNAPSHOT_BUILD — 100k iterations p50/p95/p99", () => {
    const ctx = makeCtx();
    const position = makePosition();
    const exitState = makeExitState();
    const exitDecision = makeExitDecision();
    const audit = { mfeUsd: 5, maeUsd: -2, mfeR: 0.67, maeR: -0.27 };

    // Warm up
    for (let i = 0; i < 1000; i++) {
      buildSupervisorSnapshot({ scanId: `warm-${i}`, mode: "SHADOW", ctx, position, exitState, exitDecision, auditMetrics: audit });
    }

    const times: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      buildSupervisorSnapshot({ scanId: `bench-${i}`, mode: "SHADOW", ctx, position, exitState, exitDecision, auditMetrics: audit });
      const end = performance.now();
      times.push(end - start);
    }

    times.sort((a, b) => a - b);
    const p50 = percentile(times, 50);
    const p95 = percentile(times, 95);
    const p99 = percentile(times, 99);

    console.log(`SUPERVISOR_SNAPSHOT_BUILD_P50_MS=${formatMs(p50)}`);
    console.log(`SUPERVISOR_SNAPSHOT_BUILD_P95_MS=${formatMs(p95)}`);
    console.log(`SUPERVISOR_SNAPSHOT_BUILD_P99_MS=${formatMs(p99)}`);

    expect(times.length).toBe(ITERATIONS);
  });

  it("FILL_SNAPSHOT_BUILD — 100k iterations p50/p95/p99", () => {
    const ctx = makeCtx();
    const execIntent = makeExecIntent("BUY");
    const result = makeExecResult();

    // Warm up
    for (let i = 0; i < 1000; i++) {
      buildFillSnapshot({ scanId: `warm-${i}`, mode: "SHADOW", pair: "BTC/USD", ctx, execIntent, result, slippagePct: 0.0002 });
    }

    const times: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      buildFillSnapshot({ scanId: `bench-${i}`, mode: "SHADOW", pair: "BTC/USD", ctx, execIntent, result, slippagePct: 0.0002 });
      const end = performance.now();
      times.push(end - start);
    }

    times.sort((a, b) => a - b);
    const p50 = percentile(times, 50);
    const p95 = percentile(times, 95);
    const p99 = percentile(times, 99);

    console.log(`FILL_SNAPSHOT_BUILD_P50_MS=${formatMs(p50)}`);
    console.log(`FILL_SNAPSHOT_BUILD_P95_MS=${formatMs(p95)}`);
    console.log(`FILL_SNAPSHOT_BUILD_P99_MS=${formatMs(p99)}`);

    expect(times.length).toBe(ITERATIONS);
  });
});
