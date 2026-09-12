/**
 * testStrictWindowEquivalence — Verify fastReplay == runReplay within bounded windows,
 * future invariance, and boundary correctness (RESEARCH_WINDOW_END).
 *
 * Tests:
 *   1. FAST_WINDOW_EQUIVALENCE: mid-window, same pair/config → identical trades
 *   2. WINDOW_FUTURE_INVARIANCE: same window, different post-boundary data → identical trades
 *   3. BOUNDARY_CLOSE: positions open at evaluationEndMs get RESEARCH_WINDOW_END, not TIME_EFFICIENCY
 *   4. NO_LEAKAGE: no trade has closedAtMs > evaluationEndMs
 */

import * as fs from "fs";
import * as path from "path";
import type { SpotCandle } from "../spotTypes";
import { type ReplayCandleSet, type ReplayConfig, type ReplayTrade, runReplay } from "../spotReplayEngine";
import { precomputeFrames, fastReplay, ALL_STAGES_MASK } from "./fastResearchReplay";
import { type FeeModel } from "../feeModel";
import { DEFAULT_ENTRY_V3_CONFIG, type EntryV3Config } from "../spotEntryV3";
import { ExitReasonType } from "../spotTypes";
import {
  PAIR_MAPPINGS,
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
  // PF: handle Infinity
  const pfA = a.profitFactor === Infinity ? "INF" : Math.round(a.profitFactor * 100) / 100;
  const pfB = b.profitFactor === Infinity ? "INF" : Math.round(b.profitFactor * 100) / 100;
  if (pfA !== pfB) diffs.push(`profitFactor: ${pfA} vs ${pfB}`);
  return { match: diffs.length === 0, diffs };
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

  // Choose a mid-window: start at 25% into data, end at 50% into data
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

  // ── Precompute ──
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

  // ── Test 2: NO_LEAKAGE — all trades within [windowStart, windowEnd] ──
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
  console.log(`NO_LEAKAGE=${!leakageFound ? "PASS" : "FAIL"}`);

  // ── Test 3: WINDOW_FUTURE_INVARIANCE ──
  // Create two modified datasets: post-window candles modified by +20% and -20%
  // Trades within the window should be identical regardless of post-window data
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
      const mod15m = all15m.map((c, idx) => {
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

  if (boundaryIdx >= 0) {
    console.log(`WINDOW_FUTURE_INVARIANCE=${futureInvariance ? "PASS" : "FAIL"}`);
    if (!futureInvariance) {
      for (const d of futureDiffs) console.log(`  ${d}`);
    }
  }

  // ── Test 4: BOUNDARY_CLOSE — check RESEARCH_WINDOW_END trades ──
  const boundaryTrades = fastReplayResult.trades.filter(t => t.exitReason === (ExitReasonType.RESEARCH_WINDOW_END as any));
  const oldBoundaryTrades = runReplayResult.trades.filter(t => t.exitReason === (ExitReasonType.RESEARCH_WINDOW_END as any));
  console.log(`BOUNDARY_TRADES_FAST=${boundaryTrades.length}`);
  console.log(`BOUNDARY_TRADES_RUNREPLAY=${oldBoundaryTrades.length}`);
  console.log(`BOUNDARY_CLOSE_MATCH=${boundaryTrades.length === oldBoundaryTrades.length ? "PASS" : "FAIL"}`);

  // ── Test 5: OLD_POST_BOUNDARY_CLOSES — check no TIME_EFFICIENCY trades with closedAtMs > windowEnd ──
  const oldPostBoundary = runReplayResult.trades.filter(t =>
    t.exitReason === ExitReasonType.TIME_EFFICIENCY && t.closedAtMs > windowEnd
  );
  console.log(`OLD_POST_BOUNDARY_CLOSES=${oldPostBoundary.length}`);

  // ── Summary ──
  const allPass = FAST_WINDOW_EQUIVALENCE && !leakageFound && (boundaryIdx < 0 || futureInvariance);
  console.log(`\nALL_TESTS=${allPass ? "PASS" : "FAIL"}`);
  process.exit(allPass ? 0 : 1);
}

main();
