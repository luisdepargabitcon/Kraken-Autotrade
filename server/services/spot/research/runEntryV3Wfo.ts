/**
 * runEntryV3Wfo — Walk-Forward Optimization runner for Entry V3.
 *
 * Usage:
 *   node --import tsx server/services/spot/research/runEntryV3Wfo.ts --pair BTC/USD
 *   node --import tsx server/services/spot/research/runEntryV3Wfo.ts --all
 *   node --import tsx server/services/spot/research/runEntryV3Wfo.ts --pair BTC/USD --smoke --max-combos 10
 *
 * Output:
 *   - Progress:  SPOT_ADAPTIVE_V3_DATA/kraken/results/entry-v3-wfo-progress.json
 *   - Detailed:  SPOT_ADAPTIVE_V3_DATA/kraken/results/entry-v3-wfo-<PAIR>.json
 *   - Stdout:     WFO_DONE summary only
 */

import * as fs from "fs";
import * as path from "path";
import type { SpotCandle } from "../spotTypes";
import { runReplay, type ReplayCandleSet, type ReplayConfig, type ReplayStats } from "../spotReplayEngine";
import { type FeeModel } from "../feeModel";
import { DEFAULT_ENTRY_V3_CONFIG, type EntryV3Config } from "../spotEntryV3";
import {
  PAIR_MAPPINGS,
  loadAllCached,
  type KrakenDataset,
  type KrakenOHLCRow,
  DATA_ROOT,
} from "./krakenHistoricalLoader";

// ─── Constants ──────────────────────────────────────────────────────────────

const HISTORICAL_FEE_MODEL: FeeModel = {
  exchange: "revolutx",
  takerFeePct: 0.09,
  makerFeePct: 0.00,
  quality: "ESTIMATED",
};

const V3_ENABLED: EntryV3Config = { ...DEFAULT_ENTRY_V3_CONFIG, enabled: true };

const DAY_MS = 24 * 60 * 60 * 1000;
const TRAIN_DAYS = 90;
const TEST_DAYS = 30;
const STEP_DAYS = 30;
const MIN_CANDLES_5M = 700;

const RESULTS_DIR = path.join(DATA_ROOT, "results");
const PROGRESS_FILE = path.join(RESULTS_DIR, "entry-v3-wfo-progress.json");

const PARAM_GRID: Partial<EntryV3Config>[] = [
  { impulseMinAtr: 0.8, retracementMinAtr: 0.2, maxEntryDistanceAtr: 1.0, resumptionMinBodyPct: 0.0005 },
  { impulseMinAtr: 0.8, retracementMinAtr: 0.3, maxEntryDistanceAtr: 1.5, resumptionMinBodyPct: 0.001 },
  { impulseMinAtr: 1.0, retracementMinAtr: 0.2, maxEntryDistanceAtr: 1.0, resumptionMinBodyPct: 0.0005 },
  { impulseMinAtr: 1.0, retracementMinAtr: 0.3, maxEntryDistanceAtr: 1.5, resumptionMinBodyPct: 0.001 },
  { impulseMinAtr: 1.2, retracementMinAtr: 0.4, maxEntryDistanceAtr: 2.0, resumptionMinBodyPct: 0.002 },
  { impulseMinAtr: 1.5, retracementMinAtr: 0.5, maxEntryDistanceAtr: 2.0, resumptionMinBodyPct: 0.003 },
];

// ─── Types ──────────────────────────────────────────────────────────────────

interface FoldSlice {
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
  trainIdx: { s5: number; e5: number; s15: number; e15: number; s1: number; e1: number; s4: number; e4: number };
  testIdx: { s5: number; e5: number; s15: number; e15: number; s1: number; e1: number; s4: number; e4: number };
}

interface FoldResult {
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

interface PairWFOReport {
  pair: string;
  folds: FoldResult[];
  aggregatedOos: {
    totalTrades: number;
    netPnl: number;
    profitFactor: number;
    avgMaxDD: number;
  };
  runtimeSec: number;
  combosTotal: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toSpotCandle(row: KrakenOHLCRow): SpotCandle {
  return { time: row.timestamp, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume };
}

function parseArgs(): { pair: string | null; all: boolean; smoke: boolean; maxCombos: number; out: string | null } {
  const args = process.argv.slice(2);
  let pair: string | null = null;
  let all = false;
  let smoke = false;
  let maxCombos = 0;
  let out: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--pair" && i + 1 < args.length) pair = args[++i];
    else if (args[i] === "--all") all = true;
    else if (args[i] === "--smoke") smoke = true;
    else if (args[i] === "--max-combos" && i + 1 < args.length) maxCombos = parseInt(args[++i], 10);
    else if (args[i] === "--out" && i + 1 < args.length) out = args[++i];
  }

  return { pair, all, smoke, maxCombos, out };
}

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function writeProgress(progress: Record<string, unknown>): void {
  ensureDir(RESULTS_DIR);
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function binarySearchStart(arr: SpotCandle[], targetTime: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].time < targetTime) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function binarySearchEnd(arr: SpotCandle[], targetTime: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].time <= targetTime) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function computeFoldSlices(
  all5m: SpotCandle[], all15m: SpotCandle[], all1h: SpotCandle[], all4h: SpotCandle[],
  dataStart: number, dataEnd: number,
): FoldSlice[] {
  const slices: FoldSlice[] = [];

  for (let start = dataStart; start + (TRAIN_DAYS + TEST_DAYS) * DAY_MS <= dataEnd; start += STEP_DAYS * DAY_MS) {
    const trainStart = start;
    const trainEnd = start + TRAIN_DAYS * DAY_MS;
    const testStart = trainEnd;
    const testEnd = testStart + TEST_DAYS * DAY_MS;

    const trainIdx = {
      s5: binarySearchStart(all5m, trainStart), e5: binarySearchEnd(all5m, trainEnd),
      s15: binarySearchStart(all15m, trainStart), e15: binarySearchEnd(all15m, trainEnd),
      s1: binarySearchStart(all1h, trainStart), e1: binarySearchEnd(all1h, trainEnd),
      s4: binarySearchStart(all4h, trainStart), e4: binarySearchEnd(all4h, trainEnd),
    };
    const testIdx = {
      s5: binarySearchStart(all5m, testStart), e5: binarySearchEnd(all5m, testEnd),
      s15: binarySearchStart(all15m, testStart), e15: binarySearchEnd(all15m, testEnd),
      s1: binarySearchStart(all1h, testStart), e1: binarySearchEnd(all1h, testEnd),
      s4: binarySearchStart(all4h, testStart), e4: binarySearchEnd(all4h, testEnd),
    };

    if (trainIdx.e5 - trainIdx.s5 < MIN_CANDLES_5M || testIdx.e5 - testIdx.s5 < MIN_CANDLES_5M) continue;

    slices.push({ trainStart, trainEnd, testStart, testEnd, trainIdx, testIdx });
  }

  return slices;
}

function sliceCandles(
  all5m: SpotCandle[], all15m: SpotCandle[], all1h: SpotCandle[], all4h: SpotCandle[],
  idx: { s5: number; e5: number; s15: number; e15: number; s1: number; e1: number; s4: number; e4: number },
  pair: string,
): ReplayCandleSet {
  return {
    pair,
    candles5m: all5m.slice(idx.s5, idx.e5),
    candles15m: all15m.slice(idx.s15, idx.e15),
    candles1h: all1h.slice(idx.s1, idx.e1),
    candles4h: all4h.slice(idx.s4, idx.e4),
  };
}

function quickStats(result: { stats: ReplayStats }): { netPnl: number; pf: number; trades: number; maxDD: number } {
  const pf = result.stats.profitFactor === Infinity ? 999 : result.stats.profitFactor;
  return {
    netPnl: result.stats.netPnlUsd,
    pf,
    trades: result.stats.totalTrades,
    maxDD: result.stats.maxDrawdownUsd,
  };
}

// ─── Main WFO per pair ──────────────────────────────────────────────────────

function runWfoForPair(
  pair: string,
  all5m: SpotCandle[], all15m: SpotCandle[], all1h: SpotCandle[], all4h: SpotCandle[],
  dataStart: number, dataEnd: number,
  smoke: boolean, maxCombos: number,
): PairWFOReport {
  const foldSlices = computeFoldSlices(all5m, all15m, all1h, all4h, dataStart, dataEnd);
  const foldsTotal = foldSlices.length;
  const combosTotal = Math.min(maxCombos > 0 ? maxCombos : PARAM_GRID.length, PARAM_GRID.length);
  const grid = smoke ? PARAM_GRID.slice(0, combosTotal) : PARAM_GRID;
  const totalCombos = foldsTotal * grid.length;

  const startTime = Date.now();
  const pid = process.pid;
  let comboCount = 0;
  let lastProgressWrite = 0;
  let lastComboStart = 0;
  let lastComboDurationSec = 0;

  const foldResults: FoldResult[] = [];

  for (let fi = 0; fi < foldSlices.length; fi++) {
    const fs_ = foldSlices[fi];

    const trainCandles = sliceCandles(all5m, all15m, all1h, all4h, fs_.trainIdx, pair);

    let bestParams: EntryV3Config = { ...V3_ENABLED, ...grid[0] };
    let bestTrainPnl = -Infinity;
    let bestTrainPF = 0;

    for (let ci = 0; ci < grid.length; ci++) {
      lastComboStart = Date.now();
      const params: EntryV3Config = { ...V3_ENABLED, ...grid[ci] };
      const config: ReplayConfig = { pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL, entryV3Config: params };
      const result = runReplay(trainCandles, config);
      const qs = quickStats(result);
      lastComboDurationSec = (Date.now() - lastComboStart) / 1000;

      if (qs.netPnl > bestTrainPnl || (qs.netPnl === bestTrainPnl && qs.pf > bestTrainPF)) {
        bestTrainPnl = qs.netPnl;
        bestTrainPF = qs.pf;
        bestParams = params;
      }

      comboCount++;
      const now = Date.now();
      if (now - lastProgressWrite > 5000 || comboCount === totalCombos) {
        const elapsedSec = (now - startTime) / 1000;
        const etaSec = comboCount > 0 ? (elapsedSec / comboCount) * (totalCombos - comboCount) : 0;
        writeProgress({
          status: "RUNNING",
          pid,
          pair,
          fold: fi + 1,
          foldsTotal,
          combo: comboCount,
          combosTotal: totalCombos,
          elapsedSec: Math.round(elapsedSec * 10) / 10,
          etaSec: Math.round(etaSec * 10) / 10,
          lastComboDurationSec: Math.round(lastComboDurationSec * 10) / 10,
          heartbeatAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        lastProgressWrite = now;
      }
    }

    // Test with best params — single replay
    const testCandles = sliceCandles(all5m, all15m, all1h, all4h, fs_.testIdx, pair);
    const testConfig: ReplayConfig = { pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL, entryV3Config: bestParams };
    const testResult = runReplay(testCandles, testConfig);
    const testQS = quickStats(testResult);

    foldResults.push({
      foldIndex: fi,
      trainStart: fs_.trainStart,
      trainEnd: fs_.trainEnd,
      testStart: fs_.testStart,
      testEnd: fs_.testEnd,
      bestParams,
      trainNetPnl: Math.round(bestTrainPnl * 100) / 100,
      trainPF: Math.round(bestTrainPF * 100) / 100,
      testNetPnl: Math.round(testQS.netPnl * 100) / 100,
      testPF: Math.round(testQS.pf * 100) / 100,
      testTrades: testQS.trades,
      testMaxDD: Math.round(testQS.maxDD * 100) / 100,
    });
  }

  const oosTrades = foldResults.reduce((s, f) => s + f.testTrades, 0);
  const oosPnl = foldResults.reduce((s, f) => s + f.testNetPnl, 0);
  const oosPF = foldResults.length > 0 ? foldResults.reduce((s, f) => s + f.testPF, 0) / foldResults.length : 0;
  const oosDD = foldResults.length > 0 ? foldResults.reduce((s, f) => s + f.testMaxDD, 0) / foldResults.length : 0;
  const runtimeSec = (Date.now() - startTime) / 1000;

  writeProgress({
    status: "DONE",
    pid,
    pair,
    fold: foldsTotal,
    foldsTotal,
    combo: totalCombos,
    combosTotal: totalCombos,
    elapsedSec: Math.round(runtimeSec * 10) / 10,
    etaSec: 0,
    lastComboDurationSec: Math.round(lastComboDurationSec * 10) / 10,
    heartbeatAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return {
    pair,
    folds: foldResults,
    aggregatedOos: {
      totalTrades: oosTrades,
      netPnl: Math.round(oosPnl * 100) / 100,
      profitFactor: Math.round(oosPF * 100) / 100,
      avgMaxDD: Math.round(oosDD * 100) / 100,
    },
    runtimeSec: Math.round(runtimeSec * 10) / 10,
    combosTotal: totalCombos,
  };
}

// ─── Entry point ────────────────────────────────────────────────────────────

function main(): void {
  const { pair, all, smoke, maxCombos, out } = parseArgs();

  if (!pair && !all) {
    console.error("Usage: node --import tsx runEntryV3Wfo.ts --pair BTC/USD | --all [--smoke --max-combos N]");
    process.exit(1);
  }

  ensureDir(RESULTS_DIR);

  // Load datasets ONCE
  const datasets = loadAllCached();

  const pairsToRun = all
    ? PAIR_MAPPINGS.map(m => m.requested)
    : pair
      ? [pair]
      : [];

  for (const p of pairsToRun) {
    const c5 = datasets.get(`${p}_5m`);
    const c15 = datasets.get(`${p}_15m`);
    const c60 = datasets.get(`${p}_60m`);
    const c240 = datasets.get(`${p}_240m`);
    if (!c5 || !c15 || !c60 || !c240) {
      console.error(`Missing datasets for ${p}, skipping`);
      continue;
    }

    // Convert ONCE per pair
    const all5m = c5.rows.map(toSpotCandle);
    const all15m = c15.rows.map(toSpotCandle);
    const all1h = c60.rows.map(toSpotCandle);
    const all4h = c240.rows.map(toSpotCandle);
    const dataStart = c5.firstTimestamp;
    const dataEnd = c5.lastTimestamp;

    const report = runWfoForPair(p, all5m, all15m, all1h, all4h, dataStart, dataEnd, smoke, maxCombos);

    // Save detailed result outside git
    const safePair = p.replace("/", "_");
    const outPath = out ?? path.join(RESULTS_DIR, `entry-v3-wfo-${safePair}.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

    // Print only summary
    console.log("WFO_DONE");
    console.log(`PAIR=${p}`);
    console.log(`FOLDS=${report.folds.length}`);
    console.log(`COMBOS=${report.combosTotal}`);
    console.log(`TRADES_OOS=${report.aggregatedOos.totalTrades}`);
    console.log(`NET_OOS=${report.aggregatedOos.netPnl}`);
    console.log(`PF_OOS=${report.aggregatedOos.profitFactor}`);
    console.log(`AVG_DD_OOS=${report.aggregatedOos.avgMaxDD}`);
    console.log(`RUNTIME_SEC=${report.runtimeSec}`);
    if (smoke) {
      const cps = report.combosTotal > 0 ? report.combosTotal / report.runtimeSec : 0;
      const estFull = PARAM_GRID.length * report.folds.length / cps;
      console.log(`COMBOS_PER_SEC=${Math.round(cps * 100) / 100}`);
      console.log(`ESTIMATED_FULL_SEC=${Math.round(estFull)}`);
    }
  }
}

main();
