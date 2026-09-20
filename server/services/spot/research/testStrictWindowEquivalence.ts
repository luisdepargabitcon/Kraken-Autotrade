/**
 * testStrictWindowEquivalence — Verify fastReplay == runReplay within bounded windows,
 * future invariance, boundary correctness (RESEARCH_WINDOW_END), and non-vacuous boundary.
 *
 * Tests:
 *   1. FAST_WINDOW_EQUIVALENCE: mid-window, same pair/config → identical trades
 *   2. NO_LEAKAGE: no trade has closedAtMs > evaluationEndMs
 *   3. WINDOW_FUTURE_INVARIANCE: same window, different post-boundary data → identical trades
 *   4. BOUNDARY_CLOSE_MATCH: same boundary trades in runReplay and fastReplay
 *   5. BOUNDARY_NONVACUOUS: at least 1 trade with RESEARCH_WINDOW_END in both engines
 *   6. BOUNDARY_FUTURE_INVARIANCE: with open position at boundary, future A (+20%) and B (-20%)
 *      produce identical boundary exit price, net PnL, fees, and trades
 *
 * ALL_TESTS only PASS if ALL of the above PASS.
 */

import type { SpotCandle } from "../spotTypes";
import { type ReplayCandleSet, type ReplayConfig, type ReplayTrade, runReplay } from "../spotReplayEngine";
import { precomputeFrames, fastReplay, ALL_STAGES_MASK } from "./fastResearchReplay";
import { type FeeModel } from "../feeModel";
import { DEFAULT_ENTRY_V3_CONFIG, type EntryV3Config } from "../spotEntryV3";
import { ExitReasonType } from "../spotTypes";
import {
  loadAllCached,
  type KrakenOHLCRow,
} from "./krakenHistoricalLoader";

const HISTORICAL_FEE_MODEL: FeeModel = {
  exchange: "revolutx",
  takerFeePct: 0.09,
  makerFeePct: 0.00,
  quality: "ESTIMATED",
};

const V3_ENABLED: EntryV3Config = { ...DEFAULT_ENTRY_V3_CONFIG, enabled: true };

function toSpotCandle(row: KrakenOHLCRow): SpotCandle {
  return { time: row.timestamp, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume };
}

function tradesEqual(a: ReplayTrade[], b: ReplayTrade[]): { match: boolean; diffs: string[] } {
  const diffs: string[] = [];
  if (a.length !== b.length) {
    diffs.push(`trade count: runReplay=${a.length} vs fastReplay=${b.length}`);
    return { match: false, diffs };
  }
  for (let i = 0; i < a.length; i++) {
    const ta = a[i], tb = b[i];
    if (ta.entryPrice !== tb.entryPrice) diffs.push(`trade[${i}].entryPrice: ${ta.entryPrice} vs ${tb.entryPrice}`);
    if (ta.exitPrice !== tb.exitPrice) diffs.push(`trade[${i}].exitPrice: ${ta.exitPrice} vs ${tb.exitPrice}`);
    if (ta.volume !== tb.volume) diffs.push(`trade[${i}].volume: ${ta.volume} vs ${tb.volume}`);
    if (ta.entryFeeUsd !== tb.entryFeeUsd) diffs.push(`trade[${i}].entryFeeUsd: ${ta.entryFeeUsd} vs ${tb.entryFeeUsd}`);
    if (ta.exitFeeUsd !== tb.exitFeeUsd) diffs.push(`trade[${i}].exitFeeUsd: ${ta.exitFeeUsd} vs ${tb.exitFeeUsd}`);
    if (Math.round(ta.netPnlUsd * 100) / 100 !== Math.round(tb.netPnlUsd * 100) / 100)
      diffs.push(`trade[${i}].netPnlUsd: ${ta.netPnlUsd} vs ${tb.netPnlUsd}`);
    if (ta.exitReason !== tb.exitReason) diffs.push(`trade[${i}].exitReason: ${ta.exitReason} vs ${tb.exitReason}`);
    if (ta.openedAtMs !== tb.openedAtMs) diffs.push(`trade[${i}].openedAtMs: ${ta.openedAtMs} vs ${tb.openedAtMs}`);
    if (ta.closedAtMs !== tb.closedAtMs) diffs.push(`trade[${i}].closedAtMs: ${ta.closedAtMs} vs ${tb.closedAtMs}`);
  }
  return { match: diffs.length === 0, diffs };
}

function statsEqual(a: { totalTrades: number; netPnlUsd: number; profitFactor: number; totalFeesUsd: number }, b: { totalTrades: number; netPnlUsd: number; profitFactor: number; totalFeesUsd: number }): { match: boolean; diffs: string[] } {
  const diffs: string[] = [];
  if (a.totalTrades !== b.totalTrades) diffs.push(`totalTrades: ${a.totalTrades} vs ${b.totalTrades}`);
  if (Math.round(a.netPnlUsd * 100) / 100 !== Math.round(b.netPnlUsd * 100) / 100) diffs.push(`netPnlUsd: ${a.netPnlUsd} vs ${b.netPnlUsd}`);
  if (Math.round(a.totalFeesUsd * 100) / 100 !== Math.round(b.totalFeesUsd * 100) / 100) diffs.push(`totalFeesUsd: ${a.totalFeesUsd} vs ${b.totalFeesUsd}`);
  const pfA = a.profitFactor === Infinity ? "INF" : Math.round(a.profitFactor * 100) / 100;
  const pfB = b.profitFactor === Infinity ? "INF" : Math.round(b.profitFactor * 100) / 100;
  if (pfA !== pfB) diffs.push(`profitFactor: ${pfA} vs ${pfB}`);
  return { match: diffs.length === 0, diffs };
}

function findBoundaryWindow(
  all5m: SpotCandle[],
  all15m: SpotCandle[],
  all1h: SpotCandle[],
  all4h: SpotCandle[],
  pair: string,
  precomputed: ReturnType<typeof precomputeFrames>,
): { windowStart: number; windowEnd: number; candleSet: ReplayCandleSet } | null {
  const dataStart = all5m[0].time;
  const dataEnd = all5m[all5m.length - 1].time + 5 * 60 * 1000;
  const dataSpan = dataEnd - dataStart;

  const candleSet: ReplayCandleSet = { pair, candles5m: all5m, candles15m: all15m, candles1h: all1h, candles4h: all4h };

  // Strategy: find a window with at least one V3 entry, then shrink the window end
  // to just 2 candles after the last entry to guarantee an open position at boundary.
  for (let pct = 10; pct <= 60; pct += 5) {
    const windowStart = dataStart + Math.floor(dataSpan * pct / 100);
    const windowEnd = dataStart + Math.floor(dataSpan * (pct + 30) / 100);

    const config: ReplayConfig = {
      pair,
      availableCapitalUsd: 10000,
      feeModel: HISTORICAL_FEE_MODEL,
      entryV3Config: V3_ENABLED,
      evaluationStartMs: windowStart,
      evaluationEndMs: windowEnd,
    };

    const result = fastReplay(precomputed, config, ALL_STAGES_MASK);

    // If we already have boundary trades, use this window
    const boundaryTrades = result.trades.filter(t => t.exitReason === (ExitReasonType.RESEARCH_WINDOW_END as any));
    if (boundaryTrades.length >= 1) {
      return { windowStart, windowEnd, candleSet };
    }

    // Find the last entry time among all trades
    if (result.trades.length === 0) continue;

    const lastEntry = result.trades.reduce((max, t) => t.openedAtMs > max ? t.openedAtMs : max, 0);
    if (lastEntry === 0) continue;

    // Find the 5m candle index just after the last entry
    const entryIdx = all5m.findIndex(c => c.time >= lastEntry);
    if (entryIdx < 0 || entryIdx + 3 >= all5m.length) continue;

    // Set window end to 2 candles after the last entry to guarantee position is still open
    const forcedEnd = all5m[entryIdx + 2].time + 5 * 60 * 1000; // close of 2nd candle after entry

    // Make sure forcedEnd is within data bounds and after windowStart
    if (forcedEnd <= windowStart || forcedEnd >= dataEnd) continue;

    const forcedConfig: ReplayConfig = {
      pair,
      availableCapitalUsd: 10000,
      feeModel: HISTORICAL_FEE_MODEL,
      entryV3Config: V3_ENABLED,
      evaluationStartMs: windowStart,
      evaluationEndMs: forcedEnd,
    };

    const forcedResult = fastReplay(precomputed, forcedConfig, ALL_STAGES_MASK);
    const forcedBoundary = forcedResult.trades.filter(t => t.exitReason === (ExitReasonType.RESEARCH_WINDOW_END as any));

    if (forcedBoundary.length >= 1) {
      return { windowStart, windowEnd: forcedEnd, candleSet };
    }
  }

  return null;
}

function main(): void {
  const datasets = loadAllCached();
  const pair = "BTC/USD";
  const c5 = datasets.get(`${pair}_5m`);
  const c15 = datasets.get(`${pair}_15m`);
  const c60 = datasets.get(`${pair}_60m`);
  const c240 = datasets.get(`${pair}_240m`);
  if (!c5 || !c15 || !c60 || !c240) {
    console.error(`Missing datasets for ${pair}`);
    process.exit(1);
  }

  const all5m = c5.rows.map(toSpotCandle);
  const all15m = c15.rows.map(toSpotCandle);
  const all1h = c60.rows.map(toSpotCandle);
  const all4h = c240.rows.map(toSpotCandle);

  const candleSet: ReplayCandleSet = { pair, candles5m: all5m, candles15m: all15m, candles1h: all1h, candles4h: all4h };

  const dataStart = c5.firstTimestamp;
  const dataEnd = c5.lastTimestamp;
  const dataSpan = dataEnd - dataStart;
  const windowStart = dataStart + Math.floor(dataSpan * 0.25);
  const windowEnd = dataStart + Math.floor(dataSpan * 0.50);

  console.log(`PAIR=${pair}`);
  console.log(`DATA_START=${new Date(dataStart).toISOString()}`);
  console.log(`DATA_END=${new Date(dataEnd).toISOString()}`);
  console.log(`WINDOW_START=${new Date(windowStart).toISOString()}`);
  console.log(`WINDOW_END=${new Date(windowEnd).toISOString()}`);

  const precomputeStart = Date.now();
  const precomputed = precomputeFrames(pair, candleSet, V3_ENABLED);
  const precomputeSec = (Date.now() - precomputeStart) / 1000;
  console.log(`PRECOMPUTE_SEC=${Math.round(precomputeSec * 10) / 10}`);

  // ── Test 1: FAST_WINDOW_EQUIVALENCE ──
  const replayConfig: ReplayConfig = {
    pair,
    availableCapitalUsd: 10000,
    feeModel: HISTORICAL_FEE_MODEL,
    entryV3Config: V3_ENABLED,
    evaluationStartMs: windowStart,
    evaluationEndMs: windowEnd,
  };

  const runReplayResult = runReplay(candleSet, replayConfig);
  const fastReplayResult = fastReplay(precomputed, replayConfig, ALL_STAGES_MASK);

  const tradeCmp = tradesEqual(runReplayResult.trades, fastReplayResult.trades);
  const statsCmp = statsEqual(runReplayResult.stats, fastReplayResult.stats);

  const FAST_WINDOW_EQUIVALENCE = tradeCmp.match && statsCmp.match;
  console.log(`FAST_WINDOW_EQUIVALENCE=${FAST_WINDOW_EQUIVALENCE ? "PASS" : "FAIL"}`);
  if (!FAST_WINDOW_EQUIVALENCE) {
    console.log("TRADE_DIFFS:");
    for (const d of tradeCmp.diffs) console.log(`  ${d}`);
    console.log("STATS_DIFFS:");
    for (const d of statsCmp.diffs) console.log(`  ${d}`);
  }

  // ── Test 2: NO_LEAKAGE ──
  let leakageFound = false;
  for (const t of fastReplayResult.trades) {
    if (t.openedAtMs < windowStart) {
      console.log(`LEAKAGE: trade ${t.lotId} openedAtMs ${new Date(t.openedAtMs).toISOString()} < windowStart`);
      leakageFound = true;
    }
    if (t.closedAtMs > windowEnd) {
      console.log(`LEAKAGE: trade ${t.lotId} closedAtMs ${new Date(t.closedAtMs).toISOString()} > windowEnd`);
      leakageFound = true;
    }
  }
  const NO_LEAKAGE = !leakageFound;
  console.log(`NO_LEAKAGE=${NO_LEAKAGE ? "PASS" : "FAIL"}`);

  // ── Test 3: WINDOW_FUTURE_INVARIANCE ──
  const boundaryIdx = all5m.findIndex(c => {
    const closeTime = c.time + 5 * 60 * 1000;
    return closeTime > windowEnd;
  });

  let futureInvariance = true;
  let futureDiffs: string[] = [];

  if (boundaryIdx >= 0 && boundaryIdx < all5m.length) {
    for (const modifier of [1.2, 0.8]) {
      const mod5m = all5m.map((c, idx) =>
        idx >= boundaryIdx
          ? { ...c, open: c.open * modifier, high: c.high * modifier, low: c.low * modifier, close: c.close * modifier }
          : c
      );
      const mod15m = all15m.map(c => {
        const closeTime = c.time + 15 * 60 * 1000;
        return closeTime > windowEnd
          ? { ...c, open: c.open * modifier, high: c.high * modifier, low: c.low * modifier, close: c.close * modifier }
          : c;
      });
      const mod1h = all1h.map(c => {
        const closeTime = c.time + 60 * 60 * 1000;
        return closeTime > windowEnd
          ? { ...c, open: c.open * modifier, high: c.high * modifier, low: c.low * modifier, close: c.close * modifier }
          : c;
      });
      const mod4h = all4h.map(c => {
        const closeTime = c.time + 4 * 60 * 60 * 1000;
        return closeTime > windowEnd
          ? { ...c, open: c.open * modifier, high: c.high * modifier, low: c.low * modifier, close: c.close * modifier }
          : c;
      });

      const modCandleSet: ReplayCandleSet = { pair, candles5m: mod5m, candles15m: mod15m, candles1h: mod1h, candles4h: mod4h };
      const modPrecomputed = precomputeFrames(pair, modCandleSet, V3_ENABLED);
      const modResult = fastReplay(modPrecomputed, replayConfig, ALL_STAGES_MASK);

      const cmp = tradesEqual(fastReplayResult.trades, modResult.trades);
      if (!cmp.match) {
        futureInvariance = false;
        futureDiffs.push(`modifier=${modifier}: ${cmp.diffs.join("; ")}`);
      }
    }
  } else {
    console.log("WINDOW_FUTURE_INVARIANCE=SKIP (no post-window candles found)");
  }

  const WINDOW_FUTURE_INVARIANCE = boundaryIdx < 0 || futureInvariance;
  if (boundaryIdx >= 0) {
    console.log(`WINDOW_FUTURE_INVARIANCE=${futureInvariance ? "PASS" : "FAIL"}`);
    if (!futureInvariance) {
      for (const d of futureDiffs) console.log(`  ${d}`);
    }
  }

  // ── Test 4: BOUNDARY_CLOSE_MATCH ──
  const boundaryTradesFast = fastReplayResult.trades.filter(t => t.exitReason === (ExitReasonType.RESEARCH_WINDOW_END as any));
  const boundaryTradesRunReplay = runReplayResult.trades.filter(t => t.exitReason === (ExitReasonType.RESEARCH_WINDOW_END as any));
  console.log(`BOUNDARY_TRADES_FAST=${boundaryTradesFast.length}`);
  console.log(`BOUNDARY_TRADES_RUNREPLAY=${boundaryTradesRunReplay.length}`);
  const BOUNDARY_CLOSE_MATCH = boundaryTradesFast.length === boundaryTradesRunReplay.length;
  console.log(`BOUNDARY_CLOSE_MATCH=${BOUNDARY_CLOSE_MATCH ? "PASS" : "FAIL"}`);

  // ── Test 5: BOUNDARY_NONVACUOUS ──
  console.log("Searching for non-vacuous boundary window...");
  const boundaryWindow = findBoundaryWindow(all5m, all15m, all1h, all4h, pair, precomputed);

  let BOUNDARY_NONVACUOUS = false;
  let nonVacuousWindowStart = 0;
  let nonVacuousWindowEnd = 0;
  let nonVacuousPrecomputed = precomputed;
  let nonVacuousCandleSet = candleSet;

  if (boundaryWindow) {
    nonVacuousWindowStart = boundaryWindow.windowStart;
    nonVacuousWindowEnd = boundaryWindow.windowEnd;
    nonVacuousCandleSet = boundaryWindow.candleSet;
    nonVacuousPrecomputed = precomputeFrames(pair, nonVacuousCandleSet, V3_ENABLED);

    const nvConfig: ReplayConfig = {
      pair,
      availableCapitalUsd: 10000,
      feeModel: HISTORICAL_FEE_MODEL,
      entryV3Config: V3_ENABLED,
      evaluationStartMs: nonVacuousWindowStart,
      evaluationEndMs: nonVacuousWindowEnd,
    };

    const nvFast = fastReplay(nonVacuousPrecomputed, nvConfig, ALL_STAGES_MASK);
    const nvRun = runReplay(nonVacuousCandleSet, nvConfig);

    const nvBoundaryFast = nvFast.trades.filter(t => t.exitReason === (ExitReasonType.RESEARCH_WINDOW_END as any));
    const nvBoundaryRun = nvRun.trades.filter(t => t.exitReason === (ExitReasonType.RESEARCH_WINDOW_END as any));

    console.log(`NON_VACUOUS_WINDOW=${new Date(nonVacuousWindowStart).toISOString()} to ${new Date(nonVacuousWindowEnd).toISOString()}`);
    console.log(`NON_VACUOUS_BOUNDARY_FAST=${nvBoundaryFast.length}`);
    console.log(`NON_VACUOUS_BOUNDARY_RUNREPLAY=${nvBoundaryRun.length}`);

    BOUNDARY_NONVACUOUS = nvBoundaryFast.length >= 1 && nvBoundaryRun.length >= 1;

    if (BOUNDARY_NONVACUOUS) {
      for (const t of nvBoundaryFast) {
        if (t.closedAtMs > nonVacuousWindowEnd) {
          console.log(`BOUNDARY_FAIL: closedAtMs ${new Date(t.closedAtMs).toISOString()} > windowEnd`);
          BOUNDARY_NONVACUOUS = false;
        }
        if (t.exitReason !== (ExitReasonType.RESEARCH_WINDOW_END as any)) {
          console.log(`BOUNDARY_FAIL: exitReason ${t.exitReason} !== RESEARCH_WINDOW_END`);
          BOUNDARY_NONVACUOUS = false;
        }
      }
      const nvCmp = tradesEqual(nvRun.trades, nvFast.trades);
      if (!nvCmp.match) {
        console.log("BOUNDARY_NONVACUOUS_EQUIVALENCE_FAIL:");
        for (const d of nvCmp.diffs) console.log(`  ${d}`);
        BOUNDARY_NONVACUOUS = false;
      }
    }
  } else {
    console.log("NON_VACUOUS_BOUNDARY=NONE_FOUND (no window produces boundary trades)");
  }
  console.log(`BOUNDARY_NONVACUOUS=${BOUNDARY_NONVACUOUS ? "PASS" : "FAIL"}`);

  // ── Test 6: BOUNDARY_FUTURE_INVARIANCE ──
  let BOUNDARY_FUTURE_INVARIANCE = false;

  if (BOUNDARY_NONVACUOUS && boundaryWindow) {
    const nvConfig: ReplayConfig = {
      pair,
      availableCapitalUsd: 10000,
      feeModel: HISTORICAL_FEE_MODEL,
      entryV3Config: V3_ENABLED,
      evaluationStartMs: nonVacuousWindowStart,
      evaluationEndMs: nonVacuousWindowEnd,
    };

    const baseResult = fastReplay(nonVacuousPrecomputed, nvConfig, ALL_STAGES_MASK);

    const nvBoundaryIdx = all5m.findIndex(c => {
      const closeTime = c.time + 5 * 60 * 1000;
      return closeTime > nonVacuousWindowEnd;
    });

    let bfiPass = true;
    let bfiDiffs: string[] = [];

    if (nvBoundaryIdx >= 0) {
      for (const modifier of [1.2, 0.8]) {
        const mod5m = all5m.map((c, idx) =>
          idx >= nvBoundaryIdx
            ? { ...c, open: c.open * modifier, high: c.high * modifier, low: c.low * modifier, close: c.close * modifier }
            : c
        );
        const mod15m = all15m.map(c => {
          const closeTime = c.time + 15 * 60 * 1000;
          return closeTime > nonVacuousWindowEnd
            ? { ...c, open: c.open * modifier, high: c.high * modifier, low: c.low * modifier, close: c.close * modifier }
            : c;
        });
        const mod1h = all1h.map(c => {
          const closeTime = c.time + 60 * 60 * 1000;
          return closeTime > nonVacuousWindowEnd
            ? { ...c, open: c.open * modifier, high: c.high * modifier, low: c.low * modifier, close: c.close * modifier }
            : c;
        });
        const mod4h = all4h.map(c => {
          const closeTime = c.time + 4 * 60 * 60 * 1000;
          return closeTime > nonVacuousWindowEnd
            ? { ...c, open: c.open * modifier, high: c.high * modifier, low: c.low * modifier, close: c.close * modifier }
            : c;
        });

        const modCandleSet: ReplayCandleSet = { pair, candles5m: mod5m, candles15m: mod15m, candles1h: mod1h, candles4h: mod4h };
        const modPrecomputed = precomputeFrames(pair, modCandleSet, V3_ENABLED);
        const modResult = fastReplay(modPrecomputed, nvConfig, ALL_STAGES_MASK);

        const cmp = tradesEqual(baseResult.trades, modResult.trades);
        if (!cmp.match) {
          bfiPass = false;
          bfiDiffs.push(`modifier=${modifier}: ${cmp.diffs.join("; ")}`);
        }

        const statsCmp = statsEqual(baseResult.stats, modResult.stats);
        if (!statsCmp.match) {
          bfiPass = false;
          bfiDiffs.push(`modifier=${modifier} stats: ${statsCmp.diffs.join("; ")}`);
        }
      }
    } else {
      bfiPass = false;
      bfiDiffs.push("no post-boundary candles found");
    }

    BOUNDARY_FUTURE_INVARIANCE = bfiPass;
    console.log(`BOUNDARY_FUTURE_INVARIANCE=${bfiPass ? "PASS" : "FAIL"}`);
    if (!bfiPass) {
      for (const d of bfiDiffs) console.log(`  ${d}`);
    }
  } else {
    console.log("BOUNDARY_FUTURE_INVARIANCE=SKIP (no non-vacuous window found)");
  }

  // ── Summary ──
  const allPass = FAST_WINDOW_EQUIVALENCE
    && NO_LEAKAGE
    && WINDOW_FUTURE_INVARIANCE
    && BOUNDARY_CLOSE_MATCH
    && BOUNDARY_NONVACUOUS
    && BOUNDARY_FUTURE_INVARIANCE;

  console.log(`\nALL_TESTS=${allPass ? "PASS" : "FAIL"}`);
  process.exit(allPass ? 0 : 1);
}

main();
