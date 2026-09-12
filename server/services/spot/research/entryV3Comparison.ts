/**
 * EntryV3Comparison — B0 vs V3 comparison on same datasets.
 *
 * Runs both baseline (B0) and V3-enabled replay on the same cached datasets,
 * produces side-by-side metrics for comparison.
 */

import * as fs from "fs";
import * as path from "path";
import type { SpotCandle } from "../spotTypes";
import { runReplay, type ReplayCandleSet, type ReplayConfig, V3InstrumentationLog } from "../spotReplayEngine";
import { type FeeModel } from "../feeModel";
import { DEFAULT_ENTRY_V3_CONFIG, type EntryV3Config } from "../spotEntryV3";
import { PAIR_MAPPINGS, TIMEFRAMES, loadAllCached, type KrakenDataset, type KrakenOHLCRow } from "./krakenHistoricalLoader";

const HISTORICAL_FEE_MODEL: FeeModel = {
  exchange: "revolutx",
  takerFeePct: 0.09,
  makerFeePct: 0.00,
  quality: "ESTIMATED",
};

const V3_ENABLED: EntryV3Config = { ...DEFAULT_ENTRY_V3_CONFIG, enabled: true };

export interface ComparisonRow {
  pair: string;
  b0Trades: number;
  v3Trades: number;
  b0NetPnl: number;
  v3NetPnl: number;
  b0ProfitFactor: number;
  v3ProfitFactor: number;
  b0WinRate: number;
  v3WinRate: number;
  b0MaxDD: number;
  v3MaxDD: number;
  b0Expectancy: number;
  v3Expectancy: number;
  b0Signals: number;
  v3Signals: number;
  v3Accepted: number;
  v3Rejected: number;
  v3TopRejectReason: string;
}

export interface ComparisonReport {
  rows: ComparisonRow[];
  generatedAt: string;
  b0Totals: { trades: number; netPnl: number; profitFactor: number; };
  v3Totals: { trades: number; netPnl: number; profitFactor: number; };
}

function toSpotCandle(row: KrakenOHLCRow): SpotCandle {
  return { time: row.timestamp, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume };
}

export function runComparison(): ComparisonReport {
  const datasets = loadAllCached();
  const rows: ComparisonRow[] = [];

  let b0TotalTrades = 0, v3TotalTrades = 0;
  let b0TotalPnl = 0, v3TotalPnl = 0;
  let b0GrossWin = 0, b0GrossLoss = 0;
  let v3GrossWin = 0, v3GrossLoss = 0;

  for (const mapping of PAIR_MAPPINGS) {
    const pair = mapping.requested;
    const c5 = datasets.get(`${pair}_5m`);
    const c15 = datasets.get(`${pair}_15m`);
    const c60 = datasets.get(`${pair}_60m`);
    const c240 = datasets.get(`${pair}_240m`);
    if (!c5 || !c15 || !c60 || !c240) continue;

    const candleSet: ReplayCandleSet = {
      pair,
      candles5m: c5.rows.map(toSpotCandle),
      candles15m: c15.rows.map(toSpotCandle),
      candles1h: c60.rows.map(toSpotCandle),
      candles4h: c240.rows.map(toSpotCandle),
    };

    // B0 baseline
    const b0Config: ReplayConfig = { pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL };
    const b0Result = runReplay(candleSet, b0Config);

    // V3 enabled
    const v3Log = new V3InstrumentationLog();
    const v3Config: ReplayConfig = { pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL, entryV3Config: V3_ENABLED, v3Instrumentation: v3Log };
    const v3Result = runReplay(candleSet, v3Config);

    // Aggregate V3 instrumentation
    const v3Accepted = v3Log.entries.filter(e => e.accepted).length;
    const v3Rejected = v3Log.entries.filter(e => !e.accepted).length;
    const rejectReasons: Record<string, number> = {};
    for (const e of v3Log.entries) {
      if (!e.accepted) rejectReasons[e.reasonCode] = (rejectReasons[e.reasonCode] ?? 0) + 1;
    }
    const topRejectReason = Object.entries(rejectReasons).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "N/A";

    b0TotalTrades += b0Result.stats.totalTrades;
    v3TotalTrades += v3Result.stats.totalTrades;
    b0TotalPnl += b0Result.stats.netPnlUsd;
    v3TotalPnl += v3Result.stats.netPnlUsd;

    const b0Wins = b0Result.trades.filter(t => t.netPnlUsd > 0).reduce((s, t) => s + t.grossPnlUsd, 0);
    const b0Losses = Math.abs(b0Result.trades.filter(t => t.netPnlUsd <= 0).reduce((s, t) => s + t.grossPnlUsd, 0));
    b0GrossWin += b0Wins; b0GrossLoss += b0Losses;
    const v3Wins = v3Result.trades.filter(t => t.netPnlUsd > 0).reduce((s, t) => s + t.grossPnlUsd, 0);
    const v3Losses = Math.abs(v3Result.trades.filter(t => t.netPnlUsd <= 0).reduce((s, t) => s + t.grossPnlUsd, 0));
    v3GrossWin += v3Wins; v3GrossLoss += v3Losses;

    rows.push({
      pair,
      b0Trades: b0Result.stats.totalTrades,
      v3Trades: v3Result.stats.totalTrades,
      b0NetPnl: Math.round(b0Result.stats.netPnlUsd * 100) / 100,
      v3NetPnl: Math.round(v3Result.stats.netPnlUsd * 100) / 100,
      b0ProfitFactor: b0Result.stats.profitFactor,
      v3ProfitFactor: v3Result.stats.profitFactor,
      b0WinRate: b0Result.stats.winRate,
      v3WinRate: v3Result.stats.winRate,
      b0MaxDD: Math.round(b0Result.stats.maxDrawdownUsd * 100) / 100,
      v3MaxDD: Math.round(v3Result.stats.maxDrawdownUsd * 100) / 100,
      b0Expectancy: b0Result.stats.totalTrades > 0 ? b0Result.stats.netPnlUsd / b0Result.stats.totalTrades : 0,
      v3Expectancy: v3Result.stats.totalTrades > 0 ? v3Result.stats.netPnlUsd / v3Result.stats.totalTrades : 0,
      b0Signals: b0Result.stats.signalsBuy,
      v3Signals: v3Result.stats.signalsBuy,
      v3Accepted,
      v3Rejected,
      v3TopRejectReason: topRejectReason,
    });
  }

  return {
    rows,
    generatedAt: new Date().toISOString(),
    b0Totals: {
      trades: b0TotalTrades,
      netPnl: Math.round(b0TotalPnl * 100) / 100,
      profitFactor: b0GrossLoss > 0 ? b0GrossWin / b0GrossLoss : b0GrossWin > 0 ? Infinity : 0,
    },
    v3Totals: {
      trades: v3TotalTrades,
      netPnl: Math.round(v3TotalPnl * 100) / 100,
      profitFactor: v3GrossLoss > 0 ? v3GrossWin / v3GrossLoss : v3GrossWin > 0 ? Infinity : 0,
    },
  };
}

// ─── Walk-Forward Optimization ──────────────────────────────────────────────

export interface WFOFold {
  foldIndex: number;
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
  bestParams: EntryV3Config;
  trainNetPnl: number;
  trainPF: number;
  testNetPnl: number;
  testPF: number;
  testTrades: number;
  testMaxDD: number;
}

export interface WFOReport {
  folds: WFOFold[];
  aggregatedOos: {
    totalTrades: number;
    netPnl: number;
    profitFactor: number;
    avgMaxDD: number;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

const PARAM_GRID: Partial<EntryV3Config>[] = [
  { impulseMinAtr: 0.8, retracementMinAtr: 0.2, maxEntryDistanceAtr: 1.0, resumptionMinBodyPct: 0.0005 },
  { impulseMinAtr: 0.8, retracementMinAtr: 0.3, maxEntryDistanceAtr: 1.5, resumptionMinBodyPct: 0.001 },
  { impulseMinAtr: 1.0, retracementMinAtr: 0.2, maxEntryDistanceAtr: 1.0, resumptionMinBodyPct: 0.0005 },
  { impulseMinAtr: 1.0, retracementMinAtr: 0.3, maxEntryDistanceAtr: 1.5, resumptionMinBodyPct: 0.001 },
  { impulseMinAtr: 1.2, retracementMinAtr: 0.4, maxEntryDistanceAtr: 2.0, resumptionMinBodyPct: 0.002 },
  { impulseMinAtr: 1.5, retracementMinAtr: 0.5, maxEntryDistanceAtr: 2.0, resumptionMinBodyPct: 0.003 },
];

export function runWalkForward(pair: string): WFOReport {
  const datasets = loadAllCached();
  const c5 = datasets.get(`${pair}_5m`);
  const c15 = datasets.get(`${pair}_15m`);
  const c60 = datasets.get(`${pair}_60m`);
  const c240 = datasets.get(`${pair}_240m`);
  if (!c5 || !c15 || !c60 || !c240) throw new Error(`Missing datasets for ${pair}`);

  const all5m = c5.rows.map(toSpotCandle);
  const all15m = c15.rows.map(toSpotCandle);
  const all1h = c60.rows.map(toSpotCandle);
  const all4h = c240.rows.map(toSpotCandle);

  const dataStart = c5.firstTimestamp;
  const dataEnd = c5.lastTimestamp;
  const trainDays = 90;
  const testDays = 30;
  const stepDays = 30;

  const folds: WFOFold[] = [];
  let foldIdx = 0;

  for (let start = dataStart; start + (trainDays + testDays) * DAY_MS <= dataEnd; start += stepDays * DAY_MS) {
    const trainStart = start;
    const trainEnd = start + trainDays * DAY_MS;
    const testStart = trainEnd;
    const testEnd = testStart + testDays * DAY_MS;

    const filter = (arr: SpotCandle[], s: number, e: number) => arr.filter(c => c.time >= s && c.time <= e);

    const trainCandles: ReplayCandleSet = {
      pair,
      candles5m: filter(all5m, trainStart, trainEnd),
      candles15m: filter(all15m, trainStart, trainEnd),
      candles1h: filter(all1h, trainStart, trainEnd),
      candles4h: filter(all4h, trainStart, trainEnd),
    };

    const testCandles: ReplayCandleSet = {
      pair,
      candles5m: filter(all5m, testStart, testEnd),
      candles15m: filter(all15m, testStart, testEnd),
      candles1h: filter(all1h, testStart, testEnd),
      candles4h: filter(all4h, testStart, testEnd),
    };

    if (trainCandles.candles5m.length < 700 || testCandles.candles5m.length < 700) continue;

    // Grid search on train
    let bestParams: EntryV3Config = { ...V3_ENABLED, ...PARAM_GRID[0] };
    let bestTrainPnl = -Infinity;
    let bestTrainPF = 0;

    for (const gridParams of PARAM_GRID) {
      const params: EntryV3Config = { ...V3_ENABLED, ...gridParams };
      const config: ReplayConfig = { pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL, entryV3Config: params };
      const result = runReplay(trainCandles, config);
      const pf = result.stats.profitFactor === Infinity ? 999 : result.stats.profitFactor;
      if (result.stats.netPnlUsd > bestTrainPnl || (result.stats.netPnlUsd === bestTrainPnl && pf > bestTrainPF)) {
        bestTrainPnl = result.stats.netPnlUsd;
        bestTrainPF = pf;
        bestParams = params;
      }
    }

    // Test with best params
    const testConfig: ReplayConfig = { pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL, entryV3Config: bestParams };
    const testResult = runReplay(testCandles, testConfig);
    const testPF = testResult.stats.profitFactor === Infinity ? 999 : testResult.stats.profitFactor;

    folds.push({
      foldIndex: foldIdx++,
      trainStart, trainEnd, testStart, testEnd,
      bestParams,
      trainNetPnl: Math.round(bestTrainPnl * 100) / 100,
      trainPF: Math.round(bestTrainPF * 100) / 100,
      testNetPnl: Math.round(testResult.stats.netPnlUsd * 100) / 100,
      testPF: Math.round(testPF * 100) / 100,
      testTrades: testResult.stats.totalTrades,
      testMaxDD: Math.round(testResult.stats.maxDrawdownUsd * 100) / 100,
    });
  }

  // Aggregate OOS
  const oosTrades = folds.reduce((s, f) => s + f.testTrades, 0);
  const oosPnl = folds.reduce((s, f) => s + f.testNetPnl, 0);
  const oosPF = folds.length > 0 ? folds.reduce((s, f) => s + f.testPF, 0) / folds.length : 0;
  const oosDD = folds.length > 0 ? folds.reduce((s, f) => s + f.testMaxDD, 0) / folds.length : 0;

  return {
    folds,
    aggregatedOos: {
      totalTrades: oosTrades,
      netPnl: Math.round(oosPnl * 100) / 100,
      profitFactor: Math.round(oosPF * 100) / 100,
      avgMaxDD: Math.round(oosDD * 100) / 100,
    },
  };
}
