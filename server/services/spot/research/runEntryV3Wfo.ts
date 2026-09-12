/**
 * runEntryV3Wfo — Joint Walk-Forward Optimization runner for Entry V3.
 *
 * Methodology:
 *   - JOINT WFO: 1 params set per fold across ALL pairs (not per-pair optimization)
 *   - Common chronological windows: all pairs share trainStart/trainEnd/testStart/testEnd
 *   - Warmup preserved: full historical candles loaded, evaluationStartMs/evaluationEndMs
 *     boundary prevents trades before/after the evaluation window
 *   - B0 (V3 OFF) run on same test windows for exact comparison
 *   - Net PF: netWins / abs(netLosses), INF if netLosses==0 && netWins>0
 *   - Objective function: penalizes 0-1 trades, single-pair results, excessive DD
 *   - Sample sufficiency: INCONCLUSIVE if < 30 OOS trades
 *
 * Usage:
 *   node --import tsx server/services/spot/research/runEntryV3Wfo.ts --all
 *   node --import tsx server/services/spot/research/runEntryV3Wfo.ts --all --smoke --max-combos 2
 *
 * Output:
 *   - Progress:  SPOT_ADAPTIVE_V3_DATA/kraken/results/entry-v3-wfo-progress.json
 *   - Detailed:  SPOT_ADAPTIVE_V3_DATA/kraken/results/entry-v3-wfo-joint.json
 *   - CSVs:      SPOT_ADAPTIVE_V3_DATA/kraken/results/B0_VS_V3_OOS.csv, JOINT_WFO_FOLDS.csv, etc.
 *   - Stdout:     WFO_DONE summary only
 */

import * as fs from "fs";
import * as path from "path";
import type { SpotCandle } from "../spotTypes";
import { type ReplayCandleSet, type ReplayConfig, type ReplayTrade } from "../spotReplayEngine";
import { precomputeFrames, fastReplay, type PrecomputedData } from "./fastResearchReplay";
import { type FeeModel } from "../feeModel";
import { DEFAULT_ENTRY_V3_CONFIG, type EntryV3Config } from "../spotEntryV3";
import {
  PAIR_MAPPINGS,
  loadAllCached,
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
const MIN_OOS_TRADES = 30;

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

const ALL_PAIRS = PAIR_MAPPINGS.map(m => m.requested);

// ─── Types ──────────────────────────────────────────────────────────────────

interface PairData {
  pair: string;
  all5m: SpotCandle[];
  all15m: SpotCandle[];
  all1h: SpotCandle[];
  all4h: SpotCandle[];
}

interface FoldWindow {
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
}

interface PairFoldResult {
  pair: string;
  trades: number;
  netPnl: number;
  netWin: number;
  netLoss: number;
  profitFactor: number;
  fees: number;
  maxDD: number;
  winRate: number;
  expectancy: number;
}

interface FoldResult {
  foldIndex: number;
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
  bestParams: EntryV3Config;
  trainScore: number;
  trainTrades: number;
  trainNetPnl: number;
  b0Results: PairFoldResult[];
  v3Results: PairFoldResult[];
}

interface JointWFOReport {
  folds: FoldResult[];
  aggregatedOos: {
    b0Trades: number;
    b0NetPnl: number;
    b0NetWin: number;
    b0NetLoss: number;
    b0ProfitFactor: number;
    b0Fees: number;
    b0Expectancy: number;
    b0WinRate: number;
    v3Trades: number;
    v3NetPnl: number;
    v3NetWin: number;
    v3NetLoss: number;
    v3ProfitFactor: number;
    v3Fees: number;
    v3Expectancy: number;
    v3WinRate: number;
    worstFoldDD: number;
    worstPairDD: number;
    worstPairName: string;
    sampleSufficient: boolean;
  };
  runtimeSec: number;
  combosTotal: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toSpotCandle(row: KrakenOHLCRow): SpotCandle {
  return { time: row.timestamp, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume };
}

function parseArgs(): { smoke: boolean; maxCombos: number } {
  const args = process.argv.slice(2);
  let smoke = false;
  let maxCombos = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--smoke") smoke = true;
    else if (args[i] === "--max-combos" && i + 1 < args.length) maxCombos = parseInt(args[++i], 10);
  }
  return { smoke, maxCombos };
}

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function writeProgress(progress: Record<string, unknown>): void {
  ensureDir(RESULTS_DIR);
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function netPF(trades: ReplayTrade[]): { netWin: number; netLoss: number; pf: number } {
  const netWin = trades.filter(t => t.netPnlUsd > 0).reduce((s, t) => s + t.netPnlUsd, 0);
  const netLoss = Math.abs(trades.filter(t => t.netPnlUsd <= 0).reduce((s, t) => s + t.netPnlUsd, 0));
  const pf = netLoss > 0 ? netWin / netLoss : netWin > 0 ? Infinity : 0;
  return { netWin, netLoss, pf };
}

function maxDrawdown(trades: ReplayTrade[], initialCapital: number = 10000): number {
  let equity = initialCapital;
  let peak = initialCapital;
  let maxDD = 0;
  for (const t of trades) {
    equity += t.netPnlUsd;
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function summarizePairResult(pair: string, trades: ReplayTrade[]): PairFoldResult {
  const { netWin, netLoss, pf } = netPF(trades);
  const fees = trades.reduce((s, t) => s + t.entryFeeUsd + t.exitFeeUsd, 0);
  const dd = maxDrawdown(trades);
  const wins = trades.filter(t => t.netPnlUsd > 0).length;
  const n = trades.length;
  return {
    pair,
    trades: n,
    netPnl: Math.round(trades.reduce((s, t) => s + t.netPnlUsd, 0) * 100) / 100,
    netWin: Math.round(netWin * 100) / 100,
    netLoss: Math.round(netLoss * 100) / 100,
    profitFactor: pf,
    fees: Math.round(fees * 100) / 100,
    maxDD: Math.round(dd * 100) / 100,
    winRate: n > 0 ? wins / n : 0,
    expectancy: n > 0 ? Math.round((trades.reduce((s, t) => s + t.netPnlUsd, 0) / n) * 100) / 100 : 0,
  };
}

/**
 * Objective function for TRAIN phase scoring.
 *
 * Score = netExpectancy * tradeCountFactor * crossPairFactor * ddPenalty
 *
 * Penalties:
 *   - 0 trades: score = -1000 (hard penalty)
 *   - 1 trade: score = -500 (hard penalty)
 *   - Single-pair results: penalty * 0.5
 *   - Excessive DD (> 200): penalty * (1 - DD/500)
 *   - Negative expectancy: negative score
 */
function objectiveScore(allPairTrades: { pair: string; trades: ReplayTrade[] }[]): { score: number; totalTrades: number; netPnl: number } {
  let totalTrades = 0;
  let totalNetPnl = 0;
  const pairsWithTrades: string[] = [];
  let worstDD = 0;

  for (const { pair, trades } of allPairTrades) {
    totalTrades += trades.length;
    totalNetPnl += trades.reduce((s, t) => s + t.netPnlUsd, 0);
    if (trades.length > 0) pairsWithTrades.push(pair);
    const dd = maxDrawdown(trades);
    if (dd > worstDD) worstDD = dd;
  }

  if (totalTrades === 0) return { score: -1000, totalTrades: 0, netPnl: 0 };
  if (totalTrades === 1) return { score: -500, totalTrades: 1, netPnl: totalNetPnl };

  const expectancy = totalNetPnl / totalTrades;
  const crossPairFactor = pairsWithTrades.length === 1 ? 0.5 : 1.0;
  const ddPenalty = worstDD > 200 ? Math.max(0.1, 1 - worstDD / 500) : 1.0;
  const tradeCountFactor = Math.min(1.0, totalTrades / 10);

  const score = expectancy * tradeCountFactor * crossPairFactor * ddPenalty;

  return { score: Math.round(score * 100) / 100, totalTrades, netPnl: Math.round(totalNetPnl * 100) / 100 };
}

// ─── Main Joint WFO ─────────────────────────────────────────────────────────

function runJointWalkForward(
  pairDataMap: Map<string, PairData>,
  commonStart: number,
  commonEnd: number,
  smoke: boolean,
  maxCombos: number,
): JointWFOReport {
  // ── Precompute frames once per pair (expensive, O(n) per pair) ──
  const precomputeStart = Date.now();
  const precomputedMap = new Map<string, PrecomputedData>();
  for (const pair of ALL_PAIRS) {
    const pd = pairDataMap.get(pair);
    if (!pd) continue;
    const candleSet: ReplayCandleSet = {
      pair,
      candles5m: pd.all5m,
      candles15m: pd.all15m,
      candles1h: pd.all1h,
      candles4h: pd.all4h,
    };
    precomputedMap.set(pair, precomputeFrames(pair, candleSet, V3_ENABLED));
  }
  const precomputeSec = (Date.now() - precomputeStart) / 1000;
  console.log(`PRECOMPUTE_DONE pairs=${precomputedMap.size} sec=${Math.round(precomputeSec * 10) / 10}`);

  const foldWindows: FoldWindow[] = [];
  for (let start = commonStart; start + (TRAIN_DAYS + TEST_DAYS) * DAY_MS <= commonEnd; start += STEP_DAYS * DAY_MS) {
    foldWindows.push({
      trainStart: start,
      trainEnd: start + TRAIN_DAYS * DAY_MS,
      testStart: start + TRAIN_DAYS * DAY_MS,
      testEnd: start + (TRAIN_DAYS + TEST_DAYS) * DAY_MS,
    });
  }

  const foldsTotal = foldWindows.length;
  const grid = smoke ? PARAM_GRID.slice(0, Math.min(maxCombos > 0 ? maxCombos : 2, PARAM_GRID.length)) : PARAM_GRID;
  const totalCombos = foldsTotal * grid.length;

  const startTime = Date.now();
  const pid = process.pid;
  let comboCount = 0;
  let lastProgressWrite = 0;
  let lastComboStart = 0;
  let lastComboDurationSec = 0;

  const foldResults: FoldResult[] = [];

  for (let fi = 0; fi < foldWindows.length; fi++) {
    const fw = foldWindows[fi];

    let bestParams: EntryV3Config = { ...V3_ENABLED, ...grid[0] };
    let bestScore = -Infinity;
    let bestTrainTrades = 0;
    let bestTrainNetPnl = 0;

    for (let ci = 0; ci < grid.length; ci++) {
      lastComboStart = Date.now();
      const params: EntryV3Config = { ...V3_ENABLED, ...grid[ci] };

      const allPairTrades: { pair: string; trades: ReplayTrade[] }[] = [];

      for (const pair of ALL_PAIRS) {
        const precomputed = precomputedMap.get(pair);
        if (!precomputed) continue;

        const config: ReplayConfig = {
          pair,
          availableCapitalUsd: 10000,
          feeModel: HISTORICAL_FEE_MODEL,
          entryV3Config: params,
          evaluationStartMs: fw.trainStart,
          evaluationEndMs: fw.trainEnd,
        };

        const result = fastReplay(precomputed, config);
        allPairTrades.push({ pair, trades: result.trades });
      }

      const { score, totalTrades, netPnl } = objectiveScore(allPairTrades);

      if (score > bestScore) {
        bestScore = score;
        bestParams = params;
        bestTrainTrades = totalTrades;
        bestTrainNetPnl = netPnl;
      }

      lastComboDurationSec = (Date.now() - lastComboStart) / 1000;
      comboCount++;
      const now = Date.now();
      if (now - lastProgressWrite > 5000 || comboCount === totalCombos) {
        const elapsedSec = (now - startTime) / 1000;
        const etaSec = comboCount > 0 ? (elapsedSec / comboCount) * (totalCombos - comboCount) : 0;
        writeProgress({
          status: "RUNNING",
          pid,
          phase: "TRAIN",
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

    // TEST phase: run bestParams AND B0 on test windows for all pairs
    const b0Results: PairFoldResult[] = [];
    const v3Results: PairFoldResult[] = [];

    for (const pair of ALL_PAIRS) {
      const precomputed = precomputedMap.get(pair);
      if (!precomputed) continue;

      // V3 test
      const v3Config: ReplayConfig = {
        pair,
        availableCapitalUsd: 10000,
        feeModel: HISTORICAL_FEE_MODEL,
        entryV3Config: bestParams,
        evaluationStartMs: fw.testStart,
        evaluationEndMs: fw.testEnd,
      };
      const v3Result = fastReplay(precomputed, v3Config);
      v3Results.push(summarizePairResult(pair, v3Result.trades));

      // B0 test (V3 OFF)
      const b0Config: ReplayConfig = {
        pair,
        availableCapitalUsd: 10000,
        feeModel: HISTORICAL_FEE_MODEL,
        evaluationStartMs: fw.testStart,
        evaluationEndMs: fw.testEnd,
      };
      const b0Result = fastReplay(precomputed, b0Config);
      b0Results.push(summarizePairResult(pair, b0Result.trades));
    }

    foldResults.push({
      foldIndex: fi,
      trainStart: fw.trainStart,
      trainEnd: fw.trainEnd,
      testStart: fw.testStart,
      testEnd: fw.testEnd,
      bestParams,
      trainScore: bestScore,
      trainTrades: bestTrainTrades,
      trainNetPnl: bestTrainNetPnl,
      b0Results,
      v3Results,
    });

    const now = Date.now();
    const elapsedSec = (now - startTime) / 1000;
    const etaSec = comboCount > 0 ? (elapsedSec / comboCount) * (totalCombos - comboCount) : 0;
    writeProgress({
      status: "RUNNING",
      pid,
      phase: "TEST_DONE",
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

  // Aggregate OOS
  let b0Trades = 0, b0NetPnl = 0, b0NetWin = 0, b0NetLoss = 0, b0Fees = 0, b0Wins = 0;
  let v3Trades = 0, v3NetPnl = 0, v3NetWin = 0, v3NetLoss = 0, v3Fees = 0, v3Wins = 0;
  let worstFoldDD = 0;
  let worstPairDD = 0;
  let worstPairName = "";

  for (const fold of foldResults) {
    let foldMaxDD = 0;
    for (const r of fold.b0Results) {
      b0Trades += r.trades;
      b0NetPnl += r.netPnl;
      b0NetWin += r.netWin;
      b0NetLoss += r.netLoss;
      b0Fees += r.fees;
      b0Wins += Math.round(r.winRate * r.trades);
      if (r.maxDD > foldMaxDD) foldMaxDD = r.maxDD;
      if (r.maxDD > worstPairDD) { worstPairDD = r.maxDD; worstPairName = r.pair; }
    }
    if (foldMaxDD > worstFoldDD) worstFoldDD = foldMaxDD;

    for (const r of fold.v3Results) {
      v3Trades += r.trades;
      v3NetPnl += r.netPnl;
      v3NetWin += r.netWin;
      v3NetLoss += r.netLoss;
      v3Fees += r.fees;
      v3Wins += Math.round(r.winRate * r.trades);
    }
  }

  const b0PF = b0NetLoss > 0 ? b0NetWin / b0NetLoss : b0NetWin > 0 ? Infinity : 0;
  const v3PF = v3NetLoss > 0 ? v3NetWin / v3NetLoss : v3NetWin > 0 ? Infinity : 0;

  const runtimeSec = (Date.now() - startTime) / 1000;

  writeProgress({
    status: "ALL_DONE",
    pid,
    fold: foldsTotal,
    foldsTotal,
    combo: totalCombos,
    combosTotal: totalCombos,
    elapsedSec: Math.round(runtimeSec * 10) / 10,
    etaSec: 0,
    heartbeatAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return {
    folds: foldResults,
    aggregatedOos: {
      b0Trades,
      b0NetPnl: Math.round(b0NetPnl * 100) / 100,
      b0NetWin: Math.round(b0NetWin * 100) / 100,
      b0NetLoss: Math.round(b0NetLoss * 100) / 100,
      b0ProfitFactor: b0PF,
      b0Fees: Math.round(b0Fees * 100) / 100,
      b0Expectancy: b0Trades > 0 ? Math.round((b0NetPnl / b0Trades) * 100) / 100 : 0,
      b0WinRate: b0Trades > 0 ? b0Wins / b0Trades : 0,
      v3Trades,
      v3NetPnl: Math.round(v3NetPnl * 100) / 100,
      v3NetWin: Math.round(v3NetWin * 100) / 100,
      v3NetLoss: Math.round(v3NetLoss * 100) / 100,
      v3ProfitFactor: v3PF,
      v3Fees: Math.round(v3Fees * 100) / 100,
      v3Expectancy: v3Trades > 0 ? Math.round((v3NetPnl / v3Trades) * 100) / 100 : 0,
      v3WinRate: v3Trades > 0 ? v3Wins / v3Trades : 0,
      worstFoldDD: Math.round(worstFoldDD * 100) / 100,
      worstPairDD: Math.round(worstPairDD * 100) / 100,
      worstPairName,
      sampleSufficient: v3Trades >= MIN_OOS_TRADES,
    },
    runtimeSec: Math.round(runtimeSec * 10) / 10,
    combosTotal: totalCombos,
  };
}

// ─── CSV Output ─────────────────────────────────────────────────────────────

function writeCSVs(report: JointWFOReport): void {
  ensureDir(RESULTS_DIR);

  // JOINT_WFO_FOLDS.csv
  let foldsCsv = "fold,trainStart,trainEnd,testStart,testEnd,bestImpulseMinAtr,bestRetracementMinAtr,bestMaxEntryDistanceAtr,bestResumptionMinBodyPct,trainScore,trainTrades,trainNetPnl\n";
  for (const f of report.folds) {
    foldsCsv += `${f.foldIndex},${new Date(f.trainStart).toISOString()},${new Date(f.trainEnd).toISOString()},${new Date(f.testStart).toISOString()},${new Date(f.testEnd).toISOString()},${f.bestParams.impulseMinAtr},${f.bestParams.retracementMinAtr},${f.bestParams.maxEntryDistanceAtr},${f.bestParams.resumptionMinBodyPct},${f.trainScore},${f.trainTrades},${f.trainNetPnl}\n`;
  }
  fs.writeFileSync(path.join(RESULTS_DIR, "JOINT_WFO_FOLDS.csv"), foldsCsv);

  // B0_VS_V3_OOS.csv
  let oosCsv = "fold,pair,b0_trades,b0_net,b0_pf,b0_fees,b0_dd,b0_winRate,b0_expectancy,v3_trades,v3_net,v3_pf,v3_fees,v3_dd,v3_winRate,v3_expectancy\n";
  for (const f of report.folds) {
    for (let pi = 0; pi < f.b0Results.length; pi++) {
      const b0 = f.b0Results[pi];
      const v3 = f.v3Results[pi];
      oosCsv += `${f.foldIndex},${b0.pair},${b0.trades},${b0.netPnl},${b0.profitFactor},${b0.fees},${b0.maxDD},${b0.winRate},${b0.expectancy},${v3.trades},${v3.netPnl},${v3.profitFactor},${v3.fees},${v3.maxDD},${v3.winRate},${v3.expectancy}\n`;
    }
  }
  fs.writeFileSync(path.join(RESULTS_DIR, "B0_VS_V3_OOS.csv"), oosCsv);

  // B0_VS_V3_FULL.csv (aggregated)
  let fullCsv = "metric,B0,V3,delta\n";
  const a = report.aggregatedOos;
  fullCsv += `trades,${a.b0Trades},${a.v3Trades},${a.v3Trades - a.b0Trades}\n`;
  fullCsv += `netPnl,${a.b0NetPnl},${a.v3NetPnl},${Math.round((a.v3NetPnl - a.b0NetPnl) * 100) / 100}\n`;
  fullCsv += `netWin,${a.b0NetWin},${a.v3NetWin},${Math.round((a.v3NetWin - a.b0NetWin) * 100) / 100}\n`;
  fullCsv += `netLoss,${a.b0NetLoss},${a.v3NetLoss},${Math.round((a.v3NetLoss - a.b0NetLoss) * 100) / 100}\n`;
  fullCsv += `profitFactor,${a.b0ProfitFactor},${a.v3ProfitFactor},\n`;
  fullCsv += `fees,${a.b0Fees},${a.v3Fees},${Math.round((a.v3Fees - a.b0Fees) * 100) / 100}\n`;
  fullCsv += `expectancy,${a.b0Expectancy},${a.v3Expectancy},${Math.round((a.v3Expectancy - a.b0Expectancy) * 100) / 100}\n`;
  fullCsv += `winRate,${a.b0WinRate},${a.v3WinRate},\n`;
  fullCsv += `worstFoldDD,,${a.worstFoldDD},\n`;
  fullCsv += `worstPairDD,,${a.worstPairDD},\n`;
  fullCsv += `worstPairName,,${a.worstPairName},\n`;
  fullCsv += `sampleSufficient,,${a.sampleSufficient},\n`;
  fs.writeFileSync(path.join(RESULTS_DIR, "B0_VS_V3_FULL.csv"), fullCsv);

  // OOS_SUMMARY.csv
  let sumCsv = "pair,b0_trades,b0_net,b0_pf,v3_trades,v3_net,v3_pf\n";
  for (const pair of ALL_PAIRS) {
    let bt = 0, bn = 0, bw = 0, bl = 0, vt = 0, vn = 0, vw = 0, vl = 0;
    for (const f of report.folds) {
      const b0r = f.b0Results.find(r => r.pair === pair);
      const v3r = f.v3Results.find(r => r.pair === pair);
      if (b0r) { bt += b0r.trades; bn += b0r.netPnl; bw += b0r.netWin; bl += b0r.netLoss; }
      if (v3r) { vt += v3r.trades; vn += v3r.netPnl; vw += v3r.netWin; vl += v3r.netLoss; }
    }
    const bpf = bl > 0 ? bw / bl : bw > 0 ? Infinity : 0;
    const vpf = vl > 0 ? vw / vl : vw > 0 ? Infinity : 0;
    sumCsv += `${pair},${bt},${Math.round(bn * 100) / 100},${bpf},${vt},${Math.round(vn * 100) / 100},${vpf}\n`;
  }
  fs.writeFileSync(path.join(RESULTS_DIR, "OOS_SUMMARY.csv"), sumCsv);
}

// ─── Entry point ────────────────────────────────────────────────────────────

function main(): void {
  const { smoke, maxCombos } = parseArgs();
  ensureDir(RESULTS_DIR);

  const datasets = loadAllCached();
  const pairDataMap = new Map<string, PairData>();

  let intersectStart = -Infinity;
  let intersectEnd = Infinity;

  for (const pair of ALL_PAIRS) {
    const c5 = datasets.get(`${pair}_5m`);
    const c15 = datasets.get(`${pair}_15m`);
    const c60 = datasets.get(`${pair}_60m`);
    const c240 = datasets.get(`${pair}_240m`);
    if (!c5 || !c15 || !c60 || !c240) {
      console.error(`Missing datasets for ${pair}`);
      continue;
    }

    pairDataMap.set(pair, {
      pair,
      all5m: c5.rows.map(toSpotCandle),
      all15m: c15.rows.map(toSpotCandle),
      all1h: c60.rows.map(toSpotCandle),
      all4h: c240.rows.map(toSpotCandle),
    });

    intersectStart = Math.max(intersectStart, c5.firstTimestamp);
    intersectEnd = Math.min(intersectEnd, c5.lastTimestamp);
  }

  if (pairDataMap.size === 0) {
    console.error("No datasets available");
    process.exit(1);
  }

  const report = runJointWalkForward(pairDataMap, intersectStart, intersectEnd, smoke, maxCombos);

  fs.writeFileSync(path.join(RESULTS_DIR, "entry-v3-wfo-joint.json"), JSON.stringify(report, null, 2));
  writeCSVs(report);

  const a = report.aggregatedOos;
  console.log("WFO_DONE");
  console.log(`FOLDS=${report.folds.length}`);
  console.log(`COMBOS=${report.combosTotal}`);
  console.log(`B0_OOS_TRADES=${a.b0Trades}`);
  console.log(`V3_OOS_TRADES=${a.v3Trades}`);
  console.log(`B0_OOS_NET=${a.b0NetPnl}`);
  console.log(`V3_OOS_NET=${a.v3NetPnl}`);
  console.log(`DELTA_OOS_NET=${Math.round((a.v3NetPnl - a.b0NetPnl) * 100) / 100}`);
  console.log(`B0_OOS_PF=${a.b0ProfitFactor}`);
  console.log(`V3_OOS_PF=${a.v3ProfitFactor}`);
  console.log(`B0_OOS_EXPECTANCY=${a.b0Expectancy}`);
  console.log(`V3_OOS_EXPECTANCY=${a.v3Expectancy}`);
  console.log(`B0_OOS_FEES=${a.b0Fees}`);
  console.log(`V3_OOS_FEES=${a.v3Fees}`);
  console.log(`OOS_WORST_FOLD_DD=${a.worstFoldDD}`);
  console.log(`OOS_WORST_PAIR_DD=${a.worstPairDD} (${a.worstPairName})`);
  console.log(`OOS_SAMPLE_SUFFICIENT=${a.sampleSufficient ? "YES" : "NO"}`);
  console.log(`RUNTIME_SEC=${report.runtimeSec}`);
  if (smoke) {
    const cps = report.combosTotal > 0 ? report.combosTotal / report.runtimeSec : 0;
    const estFull = PARAM_GRID.length * report.folds.length / cps;
    console.log(`COMBOS_PER_SEC=${Math.round(cps * 100) / 100}`);
    console.log(`ESTIMATED_FULL_SEC=${Math.round(estFull)}`);
  }
}

main();
