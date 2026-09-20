/**
 * runEntryV3Wfo — Joint Walk-Forward Optimization + Ablation Study for Entry V3.
 *
 * Methodology:
 *   - JOINT WFO: 1 params set per fold across ALL pairs (not per-pair optimization)
 *   - Common chronological windows: all pairs share trainStart/trainEnd/testStart/testEnd
 *   - Warmup preserved: full historical candles loaded, evaluationStartMs/evaluationEndMs
 *     boundary prevents trades before/after the evaluation window
 *   - Strict boundary: positions open at evaluationEndMs get RESEARCH_WINDOW_END
 *   - TRAIN and TEST start flat (no position inheritance)
 *   - B0 (V3 OFF) run on same test windows for exact comparison
 *   - Ablation: 6 architectures × 6 param combos, TRAIN-only selection, OOS once
 *   - Corrected objective: documented formula with caps and penalties
 *   - DD calculated independently for B0 and V3
 *
 * Usage:
 *   node --import tsx server/services/spot/research/runEntryV3Wfo.ts --all
 *   node --import tsx server/services/spot/research/runEntryV3Wfo.ts --all --smoke --max-combos 2
 */

import * as fs from "fs";
import * as path from "path";
import type { SpotCandle } from "../spotTypes";
import { type ReplayCandleSet, type ReplayConfig, type ReplayTrade, V3InstrumentationLog } from "../spotReplayEngine";
import { precomputeFrames, fastReplay, type PrecomputedData, type ResearchV3StageMask, ALL_STAGES_MASK } from "./fastResearchReplay";
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

// ─── Ablation Architectures ─────────────────────────────────────────────────

const ABLATION_ARCHITECTURES: { name: string; mask: ResearchV3StageMask }[] = [
  { name: "ALL", mask: ALL_STAGES_MASK },
  { name: "NO_IMPULSE", mask: { impulse: false, retracement: true, structure: true, reclaim: true, resumption: true } },
  { name: "NO_RETRACEMENT", mask: { impulse: true, retracement: false, structure: true, reclaim: true, resumption: true } },
  { name: "NO_STRUCTURE", mask: { impulse: true, retracement: true, structure: false, reclaim: true, resumption: true } },
  { name: "NO_RECLAIM", mask: { impulse: true, retracement: true, structure: true, reclaim: false, resumption: true } },
  { name: "NO_RESUMPTION", mask: { impulse: true, retracement: true, structure: true, reclaim: true, resumption: false } },
];

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
  strictBestParams: EntryV3Config;
  strictTrainScore: number;
  strictTrainTrades: number;
  strictTrainNetPnl: number;
  ablationBestParams: EntryV3Config;
  ablationBestArchitecture: string;
  ablationTrainScore: number;
  ablationTrainTrades: number;
  ablationTrainNetPnl: number;
  b0Results: PairFoldResult[];
  v3Results: PairFoldResult[];
  ablationResults: PairFoldResult[];
}

interface StageAttributionSummary {
  pair: string;
  totalCandidates: number;
  rawPassImpulsePct: number;
  rawPassRetracementPct: number;
  rawPassStructurePct: number;
  rawPassReclaimPct: number;
  rawPassResumptionPct: number;
  failOnlyImpulse: number;
  failOnlyRetracement: number;
  failOnlyStructure: number;
  failOnlyReclaim: number;
  failOnlyResumption: number;
  failMultipleStages: number;
  antiLateDistanceFails: number;
  antiLateExpiryFails: number;
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
    b0WorstFoldDD: number;
    b0WorstPairDD: number;
    b0WorstPairName: string;
    v3Trades: number;
    v3NetPnl: number;
    v3NetWin: number;
    v3NetLoss: number;
    v3ProfitFactor: number;
    v3Fees: number;
    v3Expectancy: number;
    v3WinRate: number;
    v3WorstFoldDD: number;
    v3WorstPairDD: number;
    v3WorstPairName: string;
    ablationTrades: number;
    ablationNetPnl: number;
    ablationNetWin: number;
    ablationNetLoss: number;
    ablationProfitFactor: number;
    ablationFees: number;
    ablationExpectancy: number;
    ablationWinRate: number;
    ablationWorstFoldDD: number;
    ablationWorstPairDD: number;
    ablationWorstPairName: string;
    sampleSufficient: boolean;
    architectureStability: string;
  };
  runtimeSec: number;
  precomputeSec: number;
  researchSec: number;
  combosTotal: number;
  stageAttribution: StageAttributionSummary[];
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

function maxDrawdown(trades: { netPnlUsd: number }[], initialCapital: number = 10000): number {
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
 * Corrected Objective Function for TRAIN phase scoring.
 *
 * ADDITIVE / MONOTONIC model. Penalties always SUBTRACT, regardless of
 * the sign of expectancy. No multiplicative penalties on signed values.
 *
 *   baseQuality = normalizedNetExpectancy + cappedPfContribution
 *   score = baseQuality - sparseSamplePenalty - crossPairPenalty
 *           - drawdownPenalty - feePenalty - worstPairPenalty
 *
 * Components:
 *   - normalizedNetExpectancy = expectancy / 10  ($10/trade = 1.0)
 *   - cappedPfContribution = totalTrades >= 5 ? min(netPF, 3) / 3 * 0.5 : 0
 *     (PF capped at 3, Infinity treated as 3, NOT used for <5 trades)
 *   - sparseSamplePenalty: 0 trades -> -1000 (hard), 1 -> -500 (hard),
 *       2 -> 0.3, 3 -> 0.2, 4 -> 0.1, >=5 -> 0
 *   - crossPairPenalty: 1 pair active -> 0.5, else 0
 *   - drawdownPenalty: worstDD > 200 -> worstDD / 500 (max ~1.0), else 0
 *   - feePenalty: fees > 50% of grossEdge -> 0.3, else 0
 *   - worstPairPenalty: any pair expectancy < -50 -> 0.5, else 0
 *
 * Monotonicity guarantees:
 *   - More DD -> score never improves (drawdownPenalty only increases)
 *   - More fees -> score never improves (feePenalty only activates/increases)
 *   - Fewer pairs -> score never improves (crossPairPenalty only activates)
 *   - Smaller sample -> score never improves (sparseSamplePenalty only increases)
 *   - Lower PF -> score never improves (cappedPfContribution only decreases)
 *   - More negative expectancy -> score never improves (normalizedNetExpectancy decreases)
 *   - Penalties on negative expectancy make score MORE negative (worse)
 */
export interface ObjectiveTrade {
  netPnlUsd: number;
  grossPnlUsd: number;
  entryFeeUsd: number;
  exitFeeUsd: number;
}

export function objectiveScore(allPairTrades: { pair: string; trades: ObjectiveTrade[] }[]): { score: number; totalTrades: number; netPnl: number } {
  let totalTrades = 0;
  let totalNetPnl = 0;
  let totalFees = 0;
  let totalGrossEdge = 0;
  let netWin = 0;
  let netLoss = 0;
  const pairsWithTrades: string[] = [];
  let worstDD = 0;
  let worstPairExpectancy = 0;

  for (const { pair, trades } of allPairTrades) {
    totalTrades += trades.length;
    const pairNet = trades.reduce((s, t) => s + t.netPnlUsd, 0);
    totalNetPnl += pairNet;
    const pairFees = trades.reduce((s, t) => s + t.entryFeeUsd + t.exitFeeUsd, 0);
    totalFees += pairFees;
    totalGrossEdge += trades.reduce((s, t) => s + Math.abs(t.grossPnlUsd), 0);
    netWin += trades.filter(t => t.netPnlUsd > 0).reduce((s, t) => s + t.netPnlUsd, 0);
    netLoss += Math.abs(trades.filter(t => t.netPnlUsd <= 0).reduce((s, t) => s + t.netPnlUsd, 0));
    if (trades.length > 0) {
      pairsWithTrades.push(pair);
      const pairExp = pairNet / trades.length;
      if (pairExp < worstPairExpectancy) worstPairExpectancy = pairExp;
    }
    const dd = maxDrawdown(trades);
    if (dd > worstDD) worstDD = dd;
  }

  if (totalTrades === 0) return { score: -1000, totalTrades: 0, netPnl: 0 };
  if (totalTrades === 1) return { score: -500, totalTrades: 1, netPnl: totalNetPnl };

  const expectancy = totalNetPnl / totalTrades;
  const normalizedNetExpectancy = expectancy / 10;

  // NET PF capped at 3, Infinity treated as 3
  const rawPF = netLoss > 0 ? netWin / netLoss : netWin > 0 ? Infinity : 0;
  const cappedPF = Math.min(rawPF === Infinity ? 3 : rawPF, 3);
  // PF contribution only for sufficient samples (>= 5 trades)
  const cappedPfContribution = totalTrades >= 5 ? (cappedPF / 3) * 0.5 : 0;

  const baseQuality = normalizedNetExpectancy + cappedPfContribution;

  // Penalties (all additive, always subtract)
  let sparseSamplePenalty = 0;
  if (totalTrades === 2) sparseSamplePenalty = 0.3;
  else if (totalTrades === 3) sparseSamplePenalty = 0.2;
  else if (totalTrades === 4) sparseSamplePenalty = 0.1;

  const crossPairPenalty = pairsWithTrades.length <= 1 ? 0.5 : 0;
  const drawdownPenalty = worstDD > 200 ? worstDD / 500 : 0;
  const feePenalty = totalGrossEdge > 0 && totalFees > totalGrossEdge * 0.5 ? 0.3 : 0;
  const worstPairPenalty = worstPairExpectancy < -50 ? 0.5 : 0;

  const score = baseQuality - sparseSamplePenalty - crossPairPenalty - drawdownPenalty - feePenalty - worstPairPenalty;

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
  // ── Precompute frames once per pair ──
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
  const architectures = smoke ? ABLATION_ARCHITECTURES.slice(0, 2) : ABLATION_ARCHITECTURES;
  // Strict: folds × 6 params. Ablation: folds × 6 architectures × 6 params.
  const strictCombos = foldsTotal * grid.length;
  const ablationCombos = foldsTotal * grid.length * architectures.length;
  const totalCombos = strictCombos + ablationCombos;

  const startTime = Date.now();
  const pid = process.pid;
  let comboCount = 0;
  let lastProgressWrite = 0;

  const foldResults: FoldResult[] = [];
  const stageAttributionAggregated: StageAttributionSummary[] = [];

  for (let fi = 0; fi < foldWindows.length; fi++) {
    const fw = foldWindows[fi];

    // ── A) STRICT TRAIN: ALL_STAGES_MASK × 6 params ──
    let strictBestParams: EntryV3Config = { ...V3_ENABLED, ...grid[0] };
    let strictBestScore = -Infinity;
    let strictBestTrainTrades = 0;
    let strictBestTrainNetPnl = 0;

    for (let ci = 0; ci < grid.length; ci++) {
      const params: EntryV3Config = { ...V3_ENABLED, ...grid[ci] };
      const allPairTrades: { pair: string; trades: ReplayTrade[] }[] = [];

      for (const pair of ALL_PAIRS) {
        const precomputed = precomputedMap.get(pair);
        if (!precomputed) continue;
        const config: ReplayConfig = {
          pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL,
          entryV3Config: params,
          evaluationStartMs: fw.trainStart, evaluationEndMs: fw.trainEnd,
        };
        const result = fastReplay(precomputed, config, ALL_STAGES_MASK);
        allPairTrades.push({ pair, trades: result.trades });
      }

      const { score, totalTrades, netPnl } = objectiveScore(allPairTrades);
      if (score > strictBestScore) {
        strictBestScore = score;
        strictBestParams = params;
        strictBestTrainTrades = totalTrades;
        strictBestTrainNetPnl = netPnl;
      }

      comboCount++;
      const now = Date.now();
      if (now - lastProgressWrite > 5000) {
        const elapsedSec = (now - startTime) / 1000;
        const etaSec = comboCount > 0 ? (elapsedSec / comboCount) * (totalCombos - comboCount) : 0;
        writeProgress({
          status: "RUNNING", pid, phase: "TRAIN_STRICT", fold: fi + 1, foldsTotal,
          combo: comboCount, combosTotal: totalCombos,
          elapsedSec: Math.round(elapsedSec * 10) / 10, etaSec: Math.round(etaSec * 10) / 10,
          heartbeatAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
        lastProgressWrite = now;
      }
    }

    // ── B) ABLATION TRAIN: 6 architectures × 6 params ──
    let ablationBestParams: EntryV3Config = { ...V3_ENABLED, ...grid[0] };
    let ablationBestArchitecture = "ALL";
    let ablationBestScore = -Infinity;
    let ablationBestTrainTrades = 0;
    let ablationBestTrainNetPnl = 0;

    for (const arch of architectures) {
      for (let ci = 0; ci < grid.length; ci++) {
        const params: EntryV3Config = { ...V3_ENABLED, ...grid[ci] };
        const allPairTrades: { pair: string; trades: ReplayTrade[] }[] = [];

        for (const pair of ALL_PAIRS) {
          const precomputed = precomputedMap.get(pair);
          if (!precomputed) continue;
          const config: ReplayConfig = {
            pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL,
            entryV3Config: params,
            evaluationStartMs: fw.trainStart, evaluationEndMs: fw.trainEnd,
          };
          const result = fastReplay(precomputed, config, arch.mask);
          allPairTrades.push({ pair, trades: result.trades });
        }

        const { score, totalTrades, netPnl } = objectiveScore(allPairTrades);
        if (score > ablationBestScore) {
          ablationBestScore = score;
          ablationBestParams = params;
          ablationBestArchitecture = arch.name;
          ablationBestTrainTrades = totalTrades;
          ablationBestTrainNetPnl = netPnl;
        }

        comboCount++;
        const now = Date.now();
        if (now - lastProgressWrite > 5000 || comboCount === totalCombos) {
          const elapsedSec = (now - startTime) / 1000;
          const etaSec = comboCount > 0 ? (elapsedSec / comboCount) * (totalCombos - comboCount) : 0;
          writeProgress({
            status: "RUNNING", pid, phase: "TRAIN_ABLATION", fold: fi + 1, foldsTotal,
            architecture: arch.name, combo: comboCount, combosTotal: totalCombos,
            elapsedSec: Math.round(elapsedSec * 10) / 10, etaSec: Math.round(etaSec * 10) / 10,
            heartbeatAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          });
          lastProgressWrite = now;
        }
      }
    }

    // ── TEST phase: B0, STRICT (ALL + strictBestParams), ABLATION (selected arch + ablationBestParams) ──
    const b0Results: PairFoldResult[] = [];
    const v3Results: PairFoldResult[] = [];
    const ablationResults: PairFoldResult[] = [];
    const selectedArch = ABLATION_ARCHITECTURES.find(a => a.name === ablationBestArchitecture)!;

    for (const pair of ALL_PAIRS) {
      const precomputed = precomputedMap.get(pair);
      if (!precomputed) continue;

      // V3 strict ALL-stages test (strictBestParams, NOT ablationBestParams)
      const v3Config: ReplayConfig = {
        pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL,
        entryV3Config: strictBestParams,
        evaluationStartMs: fw.testStart, evaluationEndMs: fw.testEnd,
      };
      const v3Result = fastReplay(precomputed, v3Config, ALL_STAGES_MASK);
      v3Results.push(summarizePairResult(pair, v3Result.trades));

      // Ablation test (selected architecture + ablationBestParams)
      const ablationConfig: ReplayConfig = {
        pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL,
        entryV3Config: ablationBestParams,
        evaluationStartMs: fw.testStart, evaluationEndMs: fw.testEnd,
      };
      const ablationResult = fastReplay(precomputed, ablationConfig, selectedArch.mask);
      ablationResults.push(summarizePairResult(pair, ablationResult.trades));

      // B0 test (V3 OFF)
      const b0Config: ReplayConfig = {
        pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL,
        evaluationStartMs: fw.testStart, evaluationEndMs: fw.testEnd,
      };
      const b0Result = fastReplay(precomputed, b0Config);
      b0Results.push(summarizePairResult(pair, b0Result.trades));

      // Stage attribution from TRAIN (ALL mask, strictBestParams)
      const v3Log = new V3InstrumentationLog();
      const trainConfig: ReplayConfig = {
        pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL,
        entryV3Config: strictBestParams,
        evaluationStartMs: fw.trainStart, evaluationEndMs: fw.trainEnd,
        v3Instrumentation: v3Log,
      };
      fastReplay(precomputed, trainConfig, ALL_STAGES_MASK);
      const sa = (v3Log as any).stageAttribution;
      if (sa) {
        stageAttributionAggregated.push({
          pair,
          totalCandidates: sa.totalCandidates,
          rawPassImpulsePct: Math.round(sa.rawPassImpulsePct * 1000) / 10,
          rawPassRetracementPct: Math.round(sa.rawPassRetracementPct * 1000) / 10,
          rawPassStructurePct: Math.round(sa.rawPassStructurePct * 1000) / 10,
          rawPassReclaimPct: Math.round(sa.rawPassReclaimPct * 1000) / 10,
          rawPassResumptionPct: Math.round(sa.rawPassResumptionPct * 1000) / 10,
          failOnlyImpulse: sa.failOnlyImpulse,
          failOnlyRetracement: sa.failOnlyRetracement,
          failOnlyStructure: sa.failOnlyStructure,
          failOnlyReclaim: sa.failOnlyReclaim,
          failOnlyResumption: sa.failOnlyResumption,
          failMultipleStages: sa.failMultipleStages,
          antiLateDistanceFails: sa.antiLateDistanceFails,
          antiLateExpiryFails: sa.antiLateExpiryFails,
        });
      }
    }

    foldResults.push({
      foldIndex: fi,
      trainStart: fw.trainStart,
      trainEnd: fw.trainEnd,
      testStart: fw.testStart,
      testEnd: fw.testEnd,
      strictBestParams,
      strictTrainScore: strictBestScore,
      strictTrainTrades: strictBestTrainTrades,
      strictTrainNetPnl: strictBestTrainNetPnl,
      ablationBestParams,
      ablationBestArchitecture,
      ablationTrainScore: ablationBestScore,
      ablationTrainTrades: ablationBestTrainTrades,
      ablationTrainNetPnl: ablationBestTrainNetPnl,
      b0Results,
      v3Results,
      ablationResults,
    });

    const now = Date.now();
    const elapsedSec = (now - startTime) / 1000;
    writeProgress({
      status: "RUNNING", pid, phase: "TEST_DONE", fold: fi + 1, foldsTotal,
      selectedArchitecture: ablationBestArchitecture,
      combo: comboCount, combosTotal: totalCombos,
      elapsedSec: Math.round(elapsedSec * 10) / 10,
      heartbeatAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    lastProgressWrite = now;
  }

  // ── Aggregate OOS ──
  let b0Trades = 0, b0NetPnl = 0, b0NetWin = 0, b0NetLoss = 0, b0Fees = 0, b0Wins = 0;
  let v3Trades = 0, v3NetPnl = 0, v3NetWin = 0, v3NetLoss = 0, v3Fees = 0, v3Wins = 0;
  let ablationTrades = 0, ablationNetPnl = 0, ablationNetWin = 0, ablationNetLoss = 0, ablationFees = 0, ablationWins = 0;
  let b0WorstFoldDD = 0, b0WorstPairDD = 0, b0WorstPairName = "";
  let v3WorstFoldDD = 0, v3WorstPairDD = 0, v3WorstPairName = "";
  let ablationWorstFoldDD = 0, ablationWorstPairDD = 0, ablationWorstPairName = "";

  for (const fold of foldResults) {
    let b0FoldMaxDD = 0, v3FoldMaxDD = 0, ablationFoldMaxDD = 0;

    for (const r of fold.b0Results) {
      b0Trades += r.trades; b0NetPnl += r.netPnl; b0NetWin += r.netWin; b0NetLoss += r.netLoss; b0Fees += r.fees;
      b0Wins += Math.round(r.winRate * r.trades);
      if (r.maxDD > b0FoldMaxDD) b0FoldMaxDD = r.maxDD;
      if (r.maxDD > b0WorstPairDD) { b0WorstPairDD = r.maxDD; b0WorstPairName = r.pair; }
    }
    if (b0FoldMaxDD > b0WorstFoldDD) b0WorstFoldDD = b0FoldMaxDD;

    for (const r of fold.v3Results) {
      v3Trades += r.trades; v3NetPnl += r.netPnl; v3NetWin += r.netWin; v3NetLoss += r.netLoss; v3Fees += r.fees;
      v3Wins += Math.round(r.winRate * r.trades);
      if (r.maxDD > v3FoldMaxDD) v3FoldMaxDD = r.maxDD;
      if (r.maxDD > v3WorstPairDD) { v3WorstPairDD = r.maxDD; v3WorstPairName = r.pair; }
    }
    if (v3FoldMaxDD > v3WorstFoldDD) v3WorstFoldDD = v3FoldMaxDD;

    for (const r of fold.ablationResults) {
      ablationTrades += r.trades; ablationNetPnl += r.netPnl; ablationNetWin += r.netWin; ablationNetLoss += r.netLoss; ablationFees += r.fees;
      ablationWins += Math.round(r.winRate * r.trades);
      if (r.maxDD > ablationFoldMaxDD) ablationFoldMaxDD = r.maxDD;
      if (r.maxDD > ablationWorstPairDD) { ablationWorstPairDD = r.maxDD; ablationWorstPairName = r.pair; }
    }
    if (ablationFoldMaxDD > ablationWorstFoldDD) ablationWorstFoldDD = ablationFoldMaxDD;
  }

  const b0PF = b0NetLoss > 0 ? b0NetWin / b0NetLoss : b0NetWin > 0 ? Infinity : 0;
  const v3PF = v3NetLoss > 0 ? v3NetWin / v3NetLoss : v3NetWin > 0 ? Infinity : 0;
  const ablationPF = ablationNetLoss > 0 ? ablationNetWin / ablationNetLoss : ablationNetWin > 0 ? Infinity : 0;

  const selectedArchs = foldResults.map(f => f.ablationBestArchitecture);
  const archCounts: Record<string, number> = {};
  for (const a of selectedArchs) archCounts[a] = (archCounts[a] ?? 0) + 1;
  const maxArchCount = Math.max(...Object.values(archCounts));
  let architectureStability: string;
  if (maxArchCount === foldsTotal) architectureStability = "HIGH";
  else if (maxArchCount >= Math.ceil(foldsTotal / 2)) architectureStability = "MEDIUM";
  else architectureStability = "LOW";

  const runtimeSec = (Date.now() - startTime) / 1000;
  const researchSec = runtimeSec;

  writeProgress({
    status: "ALL_DONE",
    pid,
    fold: foldsTotal,
    foldsTotal,
    combo: comboCount,
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
      b0WorstFoldDD: Math.round(b0WorstFoldDD * 100) / 100,
      b0WorstPairDD: Math.round(b0WorstPairDD * 100) / 100,
      b0WorstPairName,
      v3Trades,
      v3NetPnl: Math.round(v3NetPnl * 100) / 100,
      v3NetWin: Math.round(v3NetWin * 100) / 100,
      v3NetLoss: Math.round(v3NetLoss * 100) / 100,
      v3ProfitFactor: v3PF,
      v3Fees: Math.round(v3Fees * 100) / 100,
      v3Expectancy: v3Trades > 0 ? Math.round((v3NetPnl / v3Trades) * 100) / 100 : 0,
      v3WinRate: v3Trades > 0 ? v3Wins / v3Trades : 0,
      v3WorstFoldDD: Math.round(v3WorstFoldDD * 100) / 100,
      v3WorstPairDD: Math.round(v3WorstPairDD * 100) / 100,
      v3WorstPairName,
      ablationTrades,
      ablationNetPnl: Math.round(ablationNetPnl * 100) / 100,
      ablationNetWin: Math.round(ablationNetWin * 100) / 100,
      ablationNetLoss: Math.round(ablationNetLoss * 100) / 100,
      ablationProfitFactor: ablationPF,
      ablationFees: Math.round(ablationFees * 100) / 100,
      ablationExpectancy: ablationTrades > 0 ? Math.round((ablationNetPnl / ablationTrades) * 100) / 100 : 0,
      ablationWinRate: ablationTrades > 0 ? ablationWins / ablationTrades : 0,
      ablationWorstFoldDD: Math.round(ablationWorstFoldDD * 100) / 100,
      ablationWorstPairDD: Math.round(ablationWorstPairDD * 100) / 100,
      ablationWorstPairName,
      sampleSufficient: ablationTrades >= MIN_OOS_TRADES,
      architectureStability,
    },
    runtimeSec: Math.round(runtimeSec * 10) / 10,
    precomputeSec: Math.round(precomputeSec * 10) / 10,
    researchSec: Math.round(researchSec * 10) / 10,
    combosTotal: totalCombos,
    stageAttribution: stageAttributionAggregated,
  };
}

// ─── CSV Output ─────────────────────────────────────────────────────────────

function writeCSVs(report: JointWFOReport): void {
  ensureDir(RESULTS_DIR);

  // STRICT_WINDOW_RESULTS.csv
  let strictCsv = "fold,pair,v3_trades,v3_net,v3_pf,v3_fees,v3_dd,v3_winRate,v3_expectancy,b0_trades,b0_net,b0_pf,b0_fees,b0_dd,b0_winRate,b0_expectancy\n";
  for (const f of report.folds) {
    for (let pi = 0; pi < f.b0Results.length; pi++) {
      const b0 = f.b0Results[pi];
      const v3 = f.v3Results[pi];
      strictCsv += `${f.foldIndex},${b0.pair},${v3.trades},${v3.netPnl},${v3.profitFactor},${v3.fees},${v3.maxDD},${v3.winRate},${v3.expectancy},${b0.trades},${b0.netPnl},${b0.profitFactor},${b0.fees},${b0.maxDD},${b0.winRate},${b0.expectancy}\n`;
    }
  }
  fs.writeFileSync(path.join(RESULTS_DIR, "STRICT_WINDOW_RESULTS.csv"), strictCsv);

  // STAGE_ATTRIBUTION.csv
  let attrCsv = "pair,totalCandidates,rawPassImpulsePct,rawPassRetracementPct,rawPassStructurePct,rawPassReclaimPct,rawPassResumptionPct,failOnlyImpulse,failOnlyRetracement,failOnlyStructure,failOnlyReclaim,failOnlyResumption,failMultipleStages,antiLateDistanceFails,antiLateExpiryFails\n";
  for (const sa of report.stageAttribution) {
    attrCsv += `${sa.pair},${sa.totalCandidates},${sa.rawPassImpulsePct},${sa.rawPassRetracementPct},${sa.rawPassStructurePct},${sa.rawPassReclaimPct},${sa.rawPassResumptionPct},${sa.failOnlyImpulse},${sa.failOnlyRetracement},${sa.failOnlyStructure},${sa.failOnlyReclaim},${sa.failOnlyResumption},${sa.failMultipleStages},${sa.antiLateDistanceFails},${sa.antiLateExpiryFails}\n`;
  }
  fs.writeFileSync(path.join(RESULTS_DIR, "STAGE_ATTRIBUTION.csv"), attrCsv);

  // ABLATION_TRAIN.csv
  let trainCsv = "fold,strictImpulseMinAtr,strictRetracementMinAtr,strictMaxEntryDistanceAtr,strictResumptionMinBodyPct,strictTrainScore,strictTrainTrades,strictTrainNetPnl,ablationArchitecture,ablationImpulseMinAtr,ablationRetracementMinAtr,ablationMaxEntryDistanceAtr,ablationResumptionMinBodyPct,ablationTrainScore,ablationTrainTrades,ablationTrainNetPnl\n";
  for (const f of report.folds) {
    trainCsv += `${f.foldIndex},${f.strictBestParams.impulseMinAtr},${f.strictBestParams.retracementMinAtr},${f.strictBestParams.maxEntryDistanceAtr},${f.strictBestParams.resumptionMinBodyPct},${f.strictTrainScore},${f.strictTrainTrades},${f.strictTrainNetPnl},${f.ablationBestArchitecture},${f.ablationBestParams.impulseMinAtr},${f.ablationBestParams.retracementMinAtr},${f.ablationBestParams.maxEntryDistanceAtr},${f.ablationBestParams.resumptionMinBodyPct},${f.ablationTrainScore},${f.ablationTrainTrades},${f.ablationTrainNetPnl}\n`;
  }
  fs.writeFileSync(path.join(RESULTS_DIR, "ABLATION_TRAIN.csv"), trainCsv);

  // ABLATION_SELECTED_OOS.csv
  let oosCsv = "fold,pair,ablation_trades,ablation_net,ablation_pf,ablation_fees,ablation_dd,ablation_winRate,ablation_expectancy,v3_strict_trades,v3_strict_net,v3_strict_pf,b0_trades,b0_net,b0_pf\n";
  for (const f of report.folds) {
    for (let pi = 0; pi < f.ablationResults.length; pi++) {
      const abl = f.ablationResults[pi];
      const v3 = f.v3Results[pi];
      const b0 = f.b0Results[pi];
      oosCsv += `${f.foldIndex},${abl.pair},${abl.trades},${abl.netPnl},${abl.profitFactor},${abl.fees},${abl.maxDD},${abl.winRate},${abl.expectancy},${v3.trades},${v3.netPnl},${v3.profitFactor},${b0.trades},${b0.netPnl},${b0.profitFactor}\n`;
    }
  }
  fs.writeFileSync(path.join(RESULTS_DIR, "ABLATION_SELECTED_OOS.csv"), oosCsv);

  // JOINT_WFO_FOLDS.csv
  let foldsCsv = "fold,trainStart,trainEnd,testStart,testEnd,strictImpulseMinAtr,strictRetracementMinAtr,strictMaxEntryDistanceAtr,strictResumptionMinBodyPct,strictTrainScore,ablationArchitecture,ablationImpulseMinAtr,ablationRetracementMinAtr,ablationMaxEntryDistanceAtr,ablationResumptionMinBodyPct,ablationTrainScore\n";
  for (const f of report.folds) {
    foldsCsv += `${f.foldIndex},${new Date(f.trainStart).toISOString()},${new Date(f.trainEnd).toISOString()},${new Date(f.testStart).toISOString()},${new Date(f.testEnd).toISOString()},${f.strictBestParams.impulseMinAtr},${f.strictBestParams.retracementMinAtr},${f.strictBestParams.maxEntryDistanceAtr},${f.strictBestParams.resumptionMinBodyPct},${f.strictTrainScore},${f.ablationBestArchitecture},${f.ablationBestParams.impulseMinAtr},${f.ablationBestParams.retracementMinAtr},${f.ablationBestParams.maxEntryDistanceAtr},${f.ablationBestParams.resumptionMinBodyPct},${f.ablationTrainScore}\n`;
  }
  fs.writeFileSync(path.join(RESULTS_DIR, "JOINT_WFO_FOLDS.csv"), foldsCsv);

  // B0_VS_V3_OOS.csv
  let b0v3Csv = "fold,pair,b0_trades,b0_net,b0_pf,b0_fees,b0_dd,b0_winRate,b0_expectancy,v3_trades,v3_net,v3_pf,v3_fees,v3_dd,v3_winRate,v3_expectancy,ablation_trades,ablation_net,ablation_pf,ablation_fees,ablation_dd,ablation_winRate,ablation_expectancy\n";
  for (const f of report.folds) {
    for (let pi = 0; pi < f.b0Results.length; pi++) {
      const b0 = f.b0Results[pi];
      const v3 = f.v3Results[pi];
      const abl = f.ablationResults[pi];
      b0v3Csv += `${f.foldIndex},${b0.pair},${b0.trades},${b0.netPnl},${b0.profitFactor},${b0.fees},${b0.maxDD},${b0.winRate},${b0.expectancy},${v3.trades},${v3.netPnl},${v3.profitFactor},${v3.fees},${v3.maxDD},${v3.winRate},${v3.expectancy},${abl.trades},${abl.netPnl},${abl.profitFactor},${abl.fees},${abl.maxDD},${abl.winRate},${abl.expectancy}\n`;
    }
  }
  fs.writeFileSync(path.join(RESULTS_DIR, "B0_VS_V3_OOS.csv"), b0v3Csv);

  // OOS_SUMMARY.csv
  let sumCsv = "pair,b0_trades,b0_net,b0_pf,v3_trades,v3_net,v3_pf,ablation_trades,ablation_net,ablation_pf\n";
  for (const pair of ALL_PAIRS) {
    let bt = 0, bn = 0, bw = 0, bl = 0, vt = 0, vn = 0, vw = 0, vl = 0, at = 0, an = 0, aw = 0, al = 0;
    for (const f of report.folds) {
      const b0r = f.b0Results.find(r => r.pair === pair);
      const v3r = f.v3Results.find(r => r.pair === pair);
      const ablr = f.ablationResults.find(r => r.pair === pair);
      if (b0r) { bt += b0r.trades; bn += b0r.netPnl; bw += b0r.netWin; bl += b0r.netLoss; }
      if (v3r) { vt += v3r.trades; vn += v3r.netPnl; vw += v3r.netWin; vl += v3r.netLoss; }
      if (ablr) { at += ablr.trades; an += ablr.netPnl; aw += ablr.netWin; al += ablr.netLoss; }
    }
    const bpf = bl > 0 ? bw / bl : bw > 0 ? Infinity : 0;
    const vpf = vl > 0 ? vw / vl : vw > 0 ? Infinity : 0;
    const apf = al > 0 ? aw / al : aw > 0 ? Infinity : 0;
    sumCsv += `${pair},${bt},${Math.round(bn * 100) / 100},${bpf},${vt},${Math.round(vn * 100) / 100},${vpf},${at},${Math.round(an * 100) / 100},${apf}\n`;
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
  console.log(`PRECOMPUTE_SEC=${report.precomputeSec}`);
  console.log(`RESEARCH_SEC=${report.researchSec}`);
  console.log(`TOTAL_RUNTIME_SEC=${report.runtimeSec}`);

  console.log(`B0_OOS_TRADES=${a.b0Trades}`);
  console.log(`B0_OOS_NET=${a.b0NetPnl}`);
  console.log(`B0_OOS_PF=${a.b0ProfitFactor}`);
  console.log(`B0_OOS_EXPECTANCY=${a.b0Expectancy}`);
  console.log(`B0_OOS_FEES=${a.b0Fees}`);
  console.log(`B0_WORST_FOLD_DD=${a.b0WorstFoldDD}`);
  console.log(`B0_WORST_PAIR_DD=${a.b0WorstPairDD} (${a.b0WorstPairName})`);

  console.log(`STRICT_V3_OOS_TRADES=${a.v3Trades}`);
  console.log(`STRICT_V3_OOS_NET=${a.v3NetPnl}`);
  console.log(`STRICT_V3_OOS_PF=${a.v3ProfitFactor}`);
  console.log(`STRICT_V3_OOS_EXPECTANCY=${a.v3Expectancy}`);
  console.log(`STRICT_V3_OOS_FEES=${a.v3Fees}`);
  console.log(`V3_WORST_FOLD_DD=${a.v3WorstFoldDD}`);
  console.log(`V3_WORST_PAIR_DD=${a.v3WorstPairDD} (${a.v3WorstPairName})`);

  console.log(`ABLATION_OOS_TRADES=${a.ablationTrades}`);
  console.log(`ABLATION_OOS_NET=${a.ablationNetPnl}`);
  console.log(`ABLATION_OOS_PF=${a.ablationProfitFactor}`);
  console.log(`ABLATION_OOS_EXPECTANCY=${a.ablationExpectancy}`);
  console.log(`ABLATION_OOS_FEES=${a.ablationFees}`);
  console.log(`ABLATION_WORST_FOLD_DD=${a.ablationWorstFoldDD}`);
  console.log(`ABLATION_WORST_PAIR_DD=${a.ablationWorstPairDD} (${a.ablationWorstPairName})`);

  for (const f of report.folds) {
    console.log(`STRICT_FOLD_${f.foldIndex}_PARAMS=${f.strictBestParams.impulseMinAtr}/${f.strictBestParams.retracementMinAtr}/${f.strictBestParams.maxEntryDistanceAtr}/${f.strictBestParams.resumptionMinBodyPct}`);
  }

  for (const f of report.folds) {
    console.log(`ABLATION_FOLD_${f.foldIndex}_ARCH=${f.ablationBestArchitecture}`);
  }

  for (const f of report.folds) {
    console.log(`ABLATION_FOLD_${f.foldIndex}_PARAMS=${f.ablationBestParams.impulseMinAtr}/${f.ablationBestParams.retracementMinAtr}/${f.ablationBestParams.maxEntryDistanceAtr}/${f.ablationBestParams.resumptionMinBodyPct}`);
  }

  const archCounts: Record<string, number> = {};
  for (const f of report.folds) {
    archCounts[f.ablationBestArchitecture] = (archCounts[f.ablationBestArchitecture] ?? 0) + 1;
  }
  const mostCommon = Object.entries(archCounts).sort((x, y) => y[1] - x[1])[0]?.[0] ?? "UNKNOWN";
  console.log(`MOST_COMMON_SELECTED_ARCHITECTURE=${mostCommon}`);
  console.log(`ARCHITECTURE_STABILITY=${a.architectureStability}`);
  console.log(`OOS_SAMPLE_SUFFICIENT=${a.sampleSufficient ? "YES" : "NO"}`);

  for (const pair of ALL_PAIRS) {
    let bn = 0, an = 0;
    for (const f of report.folds) {
      const b0r = f.b0Results.find(r => r.pair === pair);
      const ablr = f.ablationResults.find(r => r.pair === pair);
      if (b0r) bn += b0r.netPnl;
      if (ablr) an += ablr.netPnl;
    }
    console.log(`${pair.replace("/", "_")}_B0_NET=${Math.round(bn * 100) / 100}`);
    console.log(`${pair.replace("/", "_")}_ABLATION_NET=${Math.round(an * 100) / 100}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
