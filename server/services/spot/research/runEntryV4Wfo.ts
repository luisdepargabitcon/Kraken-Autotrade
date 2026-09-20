/**
 * runEntryV4Wfo — Soft Quality Score Overlay WFO (RESEARCH-ONLY)
 *
 * Replaces V3 hard AND-gates with a continuous quality score.
 * Single parameter: minQualityScore (5 thresholds).
 *
 * Methodology:
 *   - Same fold structure as V3 WFO (90d train, 30d test, 30d step, 3 folds)
 *   - Joint selection: 1 minQualityScore per fold across ALL pairs
 *   - B0 baseline run on same test windows
 *   - Corrected additive objective function (from b760031)
 *   - Quality calibration: B0 trades grouped by V4 score into Q1-Q4 bins
 *   - Spearman correlation: score vs netR, score vs MFE-R
 *
 * Usage:
 *   node --import tsx server/services/spot/research/runEntryV4Wfo.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
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
import { objectiveScore, type ObjectiveTrade } from "./runEntryV3Wfo";
import { V4_QUALITY_THRESHOLDS, computeV4QualityScores } from "./spotEntryV4Research";

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
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIT_DIR = path.join(path.dirname(path.dirname(path.dirname(path.dirname(__dirname)))), "docs", "auditoria", "2026-09-12-entry-v4-soft-quality");

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

interface V4FoldResult {
  foldIndex: number;
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
  bestThreshold: number;
  trainScore: number;
  trainTrades: number;
  testTrades: number;
  testNetPnl: number;
  testProfitFactor: number;
  testExpectancy: number;
  b0Results: PairFoldResult[];
  v4Results: PairFoldResult[];
}

interface ScoreBin {
  bin: string;
  trades: number;
  netExpectancy: number;
  profitFactor: number;
  winRate: number;
  mfeR: number;
  fees: number;
}

interface V4WFOReport {
  folds: V4FoldResult[];
  aggregatedOos: {
    b0Trades: number;
    b0NetPnl: number;
    b0ProfitFactor: number;
    b0Expectancy: number;
    b0Fees: number;
    b0WinRate: number;
    b0WorstFoldDD: number;
    b0WorstPairDD: number;
    b0WorstPairName: string;
    b0PortfolioMaxDD: number;
    v4Trades: number;
    v4NetPnl: number;
    v4ProfitFactor: number;
    v4Expectancy: number;
    v4Fees: number;
    v4WinRate: number;
    v4WorstFoldDD: number;
    v4WorstPairDD: number;
    v4WorstPairName: string;
    v4PortfolioMaxDD: number;
    sampleSufficient: boolean;
    thresholdStability: string;
    pctNetFromBestFold: number;
    temporalConcentration: string;
  };
  scoreBins: ScoreBin[];
  spearmanScoreNetR: number;
  spearmanScoreMfeR: number;
  b0ScoreTrades: number;
  b0ScoreMapped: number;
  b0ScoreMissing: number;
  b0ScoreCoverage: number;
  b0EligibleCandidates: number;
  v4AcceptedCandidates: number;
  v4AcceptsB0Rejected: number;
  b0SignalCandidates: number;
  b0IntentEligible: number;
  b0SizingApproved: number;
  v4ScoreEligible: number;
  v4FinalExecuted: number;
  robustness: string;
  runtimeSec: number;
  precomputeSec: number;
  researchSec: number;
  combosTotal: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toSpotCandle(row: KrakenOHLCRow): SpotCandle {
  return { time: row.timestamp, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume };
}

function netPF(trades: { netPnlUsd: number }[]): { netWin: number; netLoss: number; pf: number } {
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

// ─── Spearman rank correlation ──────────────────────────────────────────────

function rank(values: number[]): number[] {
  const sorted = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].v === sorted[i].v) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) ranks[sorted[k].i] = avgRank;
    i = j;
  }
  return ranks;
}

function spearman(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 3) return 0;
  const rx = rank(x);
  const ry = rank(y);
  const n = x.length;
  const meanRx = rx.reduce((s, v) => s + v, 0) / n;
  const meanRy = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - meanRx) * (ry[i] - meanRy);
    dx += (rx[i] - meanRx) ** 2;
    dy += (ry[i] - meanRy) ** 2;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

// ─── Main V4 WFO ─────────────────────────────────────────────────────────────

function runV4WFO(
  pairDataMap: Map<string, PairData>,
  commonStart: number,
  commonEnd: number,
): V4WFOReport {
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

  const thresholds = V4_QUALITY_THRESHOLDS;
  const totalCombos = foldWindows.length * thresholds.length;
  const startTime = Date.now();
  let comboCount = 0;

  const foldResults: V4FoldResult[] = [];

  for (let fi = 0; fi < foldWindows.length; fi++) {
    const fw = foldWindows[fi];

    // ── TRAIN: select best minQualityScore ──
    let bestThreshold = thresholds[0];
    let bestScore = -Infinity;
    let bestTrainTrades = 0;

    for (const threshold of thresholds) {
      const allPairTrades: { pair: string; trades: ReplayTrade[] }[] = [];

      for (const pair of ALL_PAIRS) {
        const precomputed = precomputedMap.get(pair);
        if (!precomputed) continue;
        const config: ReplayConfig = {
          pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL,
          entryV3Config: V3_ENABLED,
          evaluationStartMs: fw.trainStart, evaluationEndMs: fw.trainEnd,
          v4MinQualityScore: threshold,
        };
        const result = fastReplay(precomputed, config);
        allPairTrades.push({ pair, trades: result.trades });
      }

      const { score, totalTrades } = objectiveScore(allPairTrades);
      if (score > bestScore) {
        bestScore = score;
        bestThreshold = threshold;
        bestTrainTrades = totalTrades;
      }

      comboCount++;
      const elapsedSec = (Date.now() - startTime) / 1000;
      if (comboCount % 5 === 0 || comboCount === totalCombos) {
        console.log(`  TRAIN fold ${fi + 1}/${foldWindows.length} threshold=${threshold} score=${score} trades=${totalTrades} elapsed=${Math.round(elapsedSec * 10) / 10}s`);
      }
    }

    // ── TEST: run B0 and V4 with selected threshold ──
    const b0Results: PairFoldResult[] = [];
    const v4Results: PairFoldResult[] = [];
    const allTestTrades: ReplayTrade[] = [];

    for (const pair of ALL_PAIRS) {
      const precomputed = precomputedMap.get(pair);
      if (!precomputed) continue;

      // B0 (V3 OFF)
      const b0Config: ReplayConfig = {
        pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL,
        evaluationStartMs: fw.testStart, evaluationEndMs: fw.testEnd,
      };
      const b0Result = fastReplay(precomputed, b0Config);
      b0Results.push(summarizePairResult(pair, b0Result.trades));

      // V4 with selected threshold
      const v4Config: ReplayConfig = {
        pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL,
        entryV3Config: V3_ENABLED,
        evaluationStartMs: fw.testStart, evaluationEndMs: fw.testEnd,
        v4MinQualityScore: bestThreshold,
      };
      const v4Result = fastReplay(precomputed, v4Config);
      v4Results.push(summarizePairResult(pair, v4Result.trades));
      allTestTrades.push(...v4Result.trades);
    }

    // Aggregate test metrics
    const v4TestTrades = v4Results.reduce((s, r) => s + r.trades, 0);
    const v4TestNet = v4Results.reduce((s, r) => s + r.netPnl, 0);
    const v4TestWin = v4Results.reduce((s, r) => s + r.netWin, 0);
    const v4TestLoss = v4Results.reduce((s, r) => s + r.netLoss, 0);
    const v4TestPF = v4TestLoss > 0 ? v4TestWin / v4TestLoss : v4TestWin > 0 ? Infinity : 0;
    const v4TestExp = v4TestTrades > 0 ? v4TestNet / v4TestTrades : 0;

    foldResults.push({
      foldIndex: fi,
      trainStart: fw.trainStart,
      trainEnd: fw.trainEnd,
      testStart: fw.testStart,
      testEnd: fw.testEnd,
      bestThreshold,
      trainScore: Math.round(bestScore * 100) / 100,
      trainTrades: bestTrainTrades,
      testTrades: v4TestTrades,
      testNetPnl: Math.round(v4TestNet * 100) / 100,
      testProfitFactor: v4TestPF,
      testExpectancy: Math.round(v4TestExp * 100) / 100,
      b0Results,
      v4Results,
    });

    console.log(`FOLD ${fi + 1}: threshold=${bestThreshold} trainScore=${Math.round(bestScore * 100) / 100} trainTrades=${bestTrainTrades} testTrades=${v4TestTrades} testNet=${Math.round(v4TestNet * 100) / 100}`);
  }

  const researchSec = (Date.now() - startTime) / 1000;
  const runtimeSec = precomputeSec + researchSec;

  // ── Aggregate OOS ──
  let b0Trades = 0, b0Net = 0, b0Win = 0, b0Loss = 0, b0Fees = 0, b0Wins = 0;
  let v4Trades = 0, v4Net = 0, v4Win = 0, v4Loss = 0, v4Fees = 0, v4Wins = 0;
  let b0WorstFoldDD = 0, v4WorstFoldDD = 0;
  let b0WorstPairDD = 0, b0WorstPairName = "";
  let v4WorstPairDD = 0, v4WorstPairName = "";

  for (const pair of ALL_PAIRS) {
    let pairB0DD = 0, pairV4DD = 0;
    let pairB0Net = 0, pairV4Net = 0;

    for (const f of foldResults) {
      const b0r = f.b0Results.find(r => r.pair === pair);
      const v4r = f.v4Results.find(r => r.pair === pair);
      if (b0r) {
        b0Trades += b0r.trades; b0Net += b0r.netPnl; b0Win += b0r.netWin; b0Loss += b0r.netLoss;
        b0Fees += b0r.fees; b0Wins += Math.round(b0r.trades * b0r.winRate);
        if (b0r.maxDD > b0WorstFoldDD) b0WorstFoldDD = b0r.maxDD;
        if (b0r.maxDD > pairB0DD) pairB0DD = b0r.maxDD;
        pairB0Net += b0r.netPnl;
      }
      if (v4r) {
        v4Trades += v4r.trades; v4Net += v4r.netPnl; v4Win += v4r.netWin; v4Loss += v4r.netLoss;
        v4Fees += v4r.fees; v4Wins += Math.round(v4r.trades * v4r.winRate);
        if (v4r.maxDD > v4WorstFoldDD) v4WorstFoldDD = v4r.maxDD;
        if (v4r.maxDD > pairV4DD) pairV4DD = v4r.maxDD;
        pairV4Net += v4r.netPnl;
      }
    }
    if (pairB0DD > b0WorstPairDD) { b0WorstPairDD = pairB0DD; b0WorstPairName = pair; }
    if (pairV4DD > v4WorstPairDD) { v4WorstPairDD = pairV4DD; v4WorstPairName = pair; }
  }

  const b0PF = b0Loss > 0 ? b0Win / b0Loss : b0Win > 0 ? Infinity : 0;
  const v4PF = v4Loss > 0 ? v4Win / v4Loss : v4Win > 0 ? Infinity : 0;

  // Threshold stability
  const selectedThresholds = foldResults.map(f => f.bestThreshold);
  const uniqueThresholds = [...new Set(selectedThresholds)];
  let thresholdStability: string;
  if (uniqueThresholds.length === 1) thresholdStability = "HIGH";
  else if (uniqueThresholds.length === 2) thresholdStability = "MEDIUM";
  else thresholdStability = "LOW";

  // ── Quality calibration: group B0 test trades by V4 score into Q1-Q4 ──
  // Collect all B0 test trades with V4 scores computed from precomputed features
  const allB0TestTradesWithScores: { netR: number; mfeR: number; qualityScore: number; netPnl: number; fees: number; win: boolean }[] = [];
  let b0ScoreTrades = 0, b0ScoreMapped = 0, b0ScoreMissing = 0;
  let totalB0Eligible = 0, totalV4Accepted = 0, totalV4AcceptsB0Rejected = 0;
  let totalB0SignalCandidates = 0, totalB0IntentEligible = 0, totalB0SizingApproved = 0;
  let totalV4ScoreEligible = 0, totalV4FinalExecuted = 0;

  // Also collect all B0 and V4 trades for portfolio DD
  const allB0TestTrades: ReplayTrade[] = [];
  const allV4TestTrades: ReplayTrade[] = [];

  for (let fi = 0; fi < foldWindows.length; fi++) {
    const fw = foldWindows[fi];
    for (const pair of ALL_PAIRS) {
      const precomputed = precomputedMap.get(pair);
      if (!precomputed) continue;

      // Run B0 and compute V4 scores for each trade
      const b0Config: ReplayConfig = {
        pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL,
        evaluationStartMs: fw.testStart, evaluationEndMs: fw.testEnd,
      };
      const b0Result = fastReplay(precomputed, b0Config);
      allB0TestTrades.push(...b0Result.trades);
      totalB0SignalCandidates += b0Result.b0SignalCandidates ?? 0;
      totalB0IntentEligible += b0Result.b0IntentEligible ?? 0;
      totalB0SizingApproved += b0Result.b0SizingApproved ?? 0;

      // Run V4 with threshold=0 to get all B0-eligible V4 trades for comparison
      const v4ZeroConfig: ReplayConfig = {
        pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL,
        entryV3Config: V3_ENABLED,
        evaluationStartMs: fw.testStart, evaluationEndMs: fw.testEnd,
        v4MinQualityScore: 0,
      };
      const v4ZeroResult = fastReplay(precomputed, v4ZeroConfig);
      totalB0Eligible += v4ZeroResult.b0EligibleCandidates ?? 0;
      totalV4Accepted += v4ZeroResult.v4AcceptedCandidates ?? 0;
      totalV4ScoreEligible += v4ZeroResult.v4ScoreEligible ?? 0;
      totalV4FinalExecuted += v4ZeroResult.v4FinalExecuted ?? 0;
      totalV4AcceptsB0Rejected += v4ZeroResult.v4AcceptsB0Rejected ?? 0;

      // For each B0 trade, find the corresponding frame and compute V4 score
      for (const trade of b0Result.trades) {
        b0ScoreTrades++;
        const frame = precomputed.frames.find(f => f.evaluationTime === trade.openedAtMs);
        if (!frame || !frame.v3Features) {
          b0ScoreMissing++;
          continue;
        }
        const scores = computeV4QualityScores(frame.v3Features);
        b0ScoreMapped++;
        allB0TestTradesWithScores.push({
          netR: trade.rMultiple, mfeR: trade.mfeR,
          qualityScore: scores.qualityScore,
          netPnl: trade.netPnlUsd,
          fees: trade.entryFeeUsd + trade.exitFeeUsd,
          win: trade.netPnlUsd > 0,
        });
      }
    }
  }

  // Collect V4 test trades for portfolio DD
  for (const f of foldResults) {
    for (const v4r of f.v4Results) {
      const precomputed = precomputedMap.get(v4r.pair);
      if (!precomputed) continue;
      const fw = foldWindows[f.foldIndex];
      const v4Config: ReplayConfig = {
        pair: v4r.pair, availableCapitalUsd: 10000, feeModel: HISTORICAL_FEE_MODEL,
        entryV3Config: V3_ENABLED,
        evaluationStartMs: fw.testStart, evaluationEndMs: fw.testEnd,
        v4MinQualityScore: f.bestThreshold,
      };
      const v4Result = fastReplay(precomputed, v4Config);
      allV4TestTrades.push(...v4Result.trades);
    }
  }

  // Sort by quality score and split into Q1-Q4
  allB0TestTradesWithScores.sort((a, b) => a.qualityScore - b.qualityScore);
  const n = allB0TestTradesWithScores.length;
  const qSize = Math.ceil(n / 4);
  const scoreBins: ScoreBin[] = [];

  for (let qi = 0; qi < 4; qi++) {
    const start = qi * qSize;
    const end = Math.min((qi + 1) * qSize, n);
    const binTrades = allB0TestTradesWithScores.slice(start, end);
    if (binTrades.length === 0) {
      scoreBins.push({ bin: `Q${qi + 1}`, trades: 0, netExpectancy: 0, profitFactor: 0, winRate: 0, mfeR: 0, fees: 0 });
      continue;
    }
    const binNet = binTrades.reduce((s, t) => s + t.netPnl, 0);
    const binWin = binTrades.filter(t => t.win).reduce((s, t) => s + t.netPnl, 0);
    const binLoss = Math.abs(binTrades.filter(t => !t.win).reduce((s, t) => s + t.netPnl, 0));
    const binFees = binTrades.reduce((s, t) => s + t.fees, 0);
    const binWins = binTrades.filter(t => t.win).length;
    const binMfeR = binTrades.reduce((s, t) => s + t.mfeR, 0) / binTrades.length;
    scoreBins.push({
      bin: `Q${qi + 1}`,
      trades: binTrades.length,
      netExpectancy: Math.round((binNet / binTrades.length) * 100) / 100,
      profitFactor: binLoss > 0 ? Math.round((binWin / binLoss) * 100) / 100 : binWin > 0 ? Infinity : 0,
      winRate: Math.round((binWins / binTrades.length) * 100) / 100,
      mfeR: Math.round(binMfeR * 100) / 100,
      fees: Math.round(binFees * 100) / 100,
    });
  }

  // Spearman correlations
  const scores = allB0TestTradesWithScores.map(t => t.qualityScore);
  const netRs = allB0TestTradesWithScores.map(t => t.netR);
  const mfeRs = allB0TestTradesWithScores.map(t => t.mfeR);
  const spearmanNetR = n >= 5 ? Math.round(spearman(scores, netRs) * 1000) / 1000 : 0;
  const spearmanMfeR = n >= 5 ? Math.round(spearman(scores, mfeRs) * 1000) / 1000 : 0;

  // ── Portfolio DD: chronological across all pairs, grouped by closedAtMs ──
  function portfolioMaxDD(trades: ReplayTrade[]): number {
    const byTs = new Map<number, number>();
    for (const t of trades) {
      byTs.set(t.closedAtMs, (byTs.get(t.closedAtMs) ?? 0) + t.netPnlUsd);
    }
    const sortedTs = [...byTs.keys()].sort((a, b) => a - b);
    let equity = 10000;
    let peak = 10000;
    let maxDD = 0;
    for (const ts of sortedTs) {
      equity += byTs.get(ts)!;
      peak = Math.max(peak, equity);
      const dd = peak - equity;
      if (dd > maxDD) maxDD = dd;
    }
    return maxDD;
  }
  const b0PortfolioMaxDD = portfolioMaxDD(allB0TestTrades);
  const v4PortfolioMaxDD = portfolioMaxDD(allV4TestTrades);

  // ── Fold robustness: PCT_TOTAL_V4_NET_FROM_BEST_FOLD ──
  const foldNets = foldResults.map(f => f.testNetPnl);
  const bestFoldNet = Math.max(...foldNets);
  const totalV4Net = foldNets.reduce((s, v) => s + v, 0);
  const pctNetFromBestFold = totalV4Net > 0 ? Math.round((bestFoldNet / totalV4Net) * 10000) / 100 : 0;
  const temporalConcentration = pctNetFromBestFold > 80 ? "HIGH" : pctNetFromBestFold > 50 ? "MEDIUM" : "LOW";

  const b0ScoreCoverage = b0ScoreTrades > 0 ? Math.round((b0ScoreMapped / b0ScoreTrades) * 10000) / 100 : 0;

  return {
    folds: foldResults,
    aggregatedOos: {
      b0Trades, b0NetPnl: Math.round(b0Net * 100) / 100,
      b0ProfitFactor: b0PF, b0Expectancy: b0Trades > 0 ? Math.round((b0Net / b0Trades) * 100) / 100 : 0,
      b0Fees: Math.round(b0Fees * 100) / 100, b0WinRate: b0Trades > 0 ? Math.round((b0Wins / b0Trades) * 100) / 100 : 0,
      b0WorstFoldDD: Math.round(b0WorstFoldDD * 100) / 100,
      b0WorstPairDD: Math.round(b0WorstPairDD * 100) / 100, b0WorstPairName,
      b0PortfolioMaxDD: Math.round(b0PortfolioMaxDD * 100) / 100,
      v4Trades, v4NetPnl: Math.round(v4Net * 100) / 100,
      v4ProfitFactor: v4PF, v4Expectancy: v4Trades > 0 ? Math.round((v4Net / v4Trades) * 100) / 100 : 0,
      v4Fees: Math.round(v4Fees * 100) / 100, v4WinRate: v4Trades > 0 ? Math.round((v4Wins / v4Trades) * 100) / 100 : 0,
      v4WorstFoldDD: Math.round(v4WorstFoldDD * 100) / 100,
      v4WorstPairDD: Math.round(v4WorstPairDD * 100) / 100, v4WorstPairName,
      v4PortfolioMaxDD: Math.round(v4PortfolioMaxDD * 100) / 100,
      sampleSufficient: v4Trades >= MIN_OOS_TRADES,
      thresholdStability,
      pctNetFromBestFold,
      temporalConcentration,
    },
    scoreBins,
    spearmanScoreNetR: spearmanNetR,
    spearmanScoreMfeR: spearmanMfeR,
    b0ScoreTrades,
    b0ScoreMapped,
    b0ScoreMissing,
    b0ScoreCoverage,
    b0EligibleCandidates: totalB0Eligible,
    v4AcceptedCandidates: totalV4Accepted,
    v4AcceptsB0Rejected: totalV4AcceptsB0Rejected,
    b0SignalCandidates: totalB0SignalCandidates,
    b0IntentEligible: totalB0IntentEligible,
    b0SizingApproved: totalB0SizingApproved,
    v4ScoreEligible: totalV4ScoreEligible,
    v4FinalExecuted: totalV4FinalExecuted,
    robustness: pctNetFromBestFold > 80 ? "LOW" : "MEDIUM",
    runtimeSec: Math.round(runtimeSec * 10) / 10,
    precomputeSec: Math.round(precomputeSec * 10) / 10,
    researchSec: Math.round(researchSec * 10) / 10,
    combosTotal: totalCombos,
  };
}

// ─── CSV output ──────────────────────────────────────────────────────────────

function writeCSVs(report: V4WFOReport, auditDir: string): void {
  if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });

  // V4_WFO.csv — per fold
  let csv = "fold,threshold,train_score,train_trades,test_trades,test_net,test_pf,test_expectancy\n";
  for (const f of report.folds) {
    csv += `${f.foldIndex},${f.bestThreshold},${f.trainScore},${f.trainTrades},${f.testTrades},${f.testNetPnl},${f.testProfitFactor},${f.testExpectancy}\n`;
  }
  fs.writeFileSync(path.join(auditDir, "V4_WFO.csv"), csv);

  // V4_OOS_BY_PAIR.csv
  csv = "pair,b0_trades,b0_net,b0_pf,v4_trades,v4_net,v4_pf\n";
  for (const pair of ALL_PAIRS) {
    let bt = 0, bn = 0, bw = 0, bl = 0, vt = 0, vn = 0, vw = 0, vl = 0;
    for (const f of report.folds) {
      const b0r = f.b0Results.find(r => r.pair === pair);
      const v4r = f.v4Results.find(r => r.pair === pair);
      if (b0r) { bt += b0r.trades; bn += b0r.netPnl; bw += b0r.netWin; bl += b0r.netLoss; }
      if (v4r) { vt += v4r.trades; vn += v4r.netPnl; vw += v4r.netWin; vl += v4r.netLoss; }
    }
    const bpf = bl > 0 ? bw / bl : bw > 0 ? Infinity : 0;
    const vpf = vl > 0 ? vw / vl : vw > 0 ? Infinity : 0;
    csv += `${pair},${bt},${Math.round(bn * 100) / 100},${bpf},${vt},${Math.round(vn * 100) / 100},${vpf}\n`;
  }
  fs.writeFileSync(path.join(auditDir, "V4_OOS_BY_PAIR.csv"), csv);

  // V4_SCORE_BINS.csv
  csv = "bin,trades,net_expectancy,profit_factor,win_rate,mfe_r,fees\n";
  for (const b of report.scoreBins) {
    csv += `${b.bin},${b.trades},${b.netExpectancy},${b.profitFactor},${b.winRate},${b.mfeR},${b.fees}\n`;
  }
  fs.writeFileSync(path.join(auditDir, "V4_SCORE_BINS.csv"), csv);
}

// ─── Entry point ────────────────────────────────────────────────────────────

function main(): void {
  if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

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

  const report = runV4WFO(pairDataMap, intersectStart, intersectEnd);

  fs.writeFileSync(path.join(RESULTS_DIR, "entry-v4-wfo.json"), JSON.stringify(report, null, 2));
  writeCSVs(report, AUDIT_DIR);

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
  console.log(`B0_OOS_WIN_RATE=${a.b0WinRate}`);
  console.log(`B0_WORST_FOLD_DD=${a.b0WorstFoldDD}`);
  console.log(`B0_WORST_PAIR_DD=${a.b0WorstPairDD} (${a.b0WorstPairName})`);
  console.log(`B0_OOS_PORTFOLIO_MAX_DD=${a.b0PortfolioMaxDD}`);

  console.log(`V4_OOS_TRADES=${a.v4Trades}`);
  console.log(`V4_OOS_NET=${a.v4NetPnl}`);
  console.log(`V4_OOS_PF=${a.v4ProfitFactor}`);
  console.log(`V4_OOS_EXPECTANCY=${a.v4Expectancy}`);
  console.log(`V4_OOS_FEES=${a.v4Fees}`);
  console.log(`V4_OOS_WIN_RATE=${a.v4WinRate}`);
  console.log(`V4_WORST_FOLD_DD=${a.v4WorstFoldDD}`);
  console.log(`V4_WORST_PAIR_DD=${a.v4WorstPairDD} (${a.v4WorstPairName})`);
  console.log(`V4_OOS_PORTFOLIO_MAX_DD=${a.v4PortfolioMaxDD}`);

  for (const f of report.folds) {
    console.log(`FOLD${f.foldIndex}_THRESHOLD=${f.bestThreshold}`);
    // Per-fold B0 and V4 net and trades
    let foldB0Net = 0, foldV4Net = 0, foldB0Trades = 0, foldV4Trades = 0;
    for (const b0r of f.b0Results) { foldB0Net += b0r.netPnl; foldB0Trades += b0r.trades; }
    for (const v4r of f.v4Results) { foldV4Net += v4r.netPnl; foldV4Trades += v4r.trades; }
    console.log(`FOLD${f.foldIndex}_B0_NET=${Math.round(foldB0Net * 100) / 100}`);
    console.log(`FOLD${f.foldIndex}_V4_NET=${Math.round(foldV4Net * 100) / 100}`);
    console.log(`FOLD${f.foldIndex}_B0_TRADES=${foldB0Trades}`);
    console.log(`FOLD${f.foldIndex}_V4_TRADES=${foldV4Trades}`);
  }
  console.log(`THRESHOLD_STABILITY=${a.thresholdStability}`);
  console.log(`OOS_TRADES_SUFFICIENT=${a.sampleSufficient ? "YES" : "NO"}`);

  for (const pair of ALL_PAIRS) {
    let bn = 0, vn = 0;
    for (const f of report.folds) {
      const b0r = f.b0Results.find(r => r.pair === pair);
      const v4r = f.v4Results.find(r => r.pair === pair);
      if (b0r) bn += b0r.netPnl;
      if (v4r) vn += v4r.netPnl;
    }
    console.log(`${pair.replace("/", "_")}_B0_NET=${Math.round(bn * 100) / 100}`);
    console.log(`${pair.replace("/", "_")}_V4_NET=${Math.round(vn * 100) / 100}`);
  }

  for (const b of report.scoreBins) {
    console.log(`SCORE_${b.bin}_EXPECTANCY=${b.netExpectancy}`);
    console.log(`SCORE_${b.bin}_TRADES=${b.trades}`);
    console.log(`SCORE_${b.bin}_PF=${b.profitFactor}`);
    console.log(`SCORE_${b.bin}_WINRATE=${b.winRate}`);
  }
  console.log(`SPEARMAN_SCORE_NET_R=${report.spearmanScoreNetR}`);
  console.log(`SPEARMAN_SCORE_MFE_R=${report.spearmanScoreMfeR}`);
  console.log(`B0_SCORE_TRADES=${report.b0ScoreTrades}`);
  console.log(`B0_SCORE_MAPPED=${report.b0ScoreMapped}`);
  console.log(`B0_SCORE_MISSING=${report.b0ScoreMissing}`);
  console.log(`B0_SCORE_COVERAGE=${report.b0ScoreCoverage}%`);
  console.log(`B0_ELIGIBLE_CANDIDATES=${report.b0EligibleCandidates}`);
  console.log(`V4_ACCEPTED_CANDIDATES=${report.v4AcceptedCandidates}`);
  console.log(`V4_ACCEPTS_B0_REJECTED=${report.v4AcceptsB0Rejected}`);
  console.log(`B0_SIGNAL_CANDIDATES=${report.b0SignalCandidates}`);
  console.log(`B0_INTENT_ELIGIBLE=${report.b0IntentEligible}`);
  console.log(`B0_SIZING_APPROVED=${report.b0SizingApproved}`);
  console.log(`V4_SCORE_ELIGIBLE=${report.v4ScoreEligible}`);
  console.log(`V4_FINAL_EXECUTED=${report.v4FinalExecuted}`);
  console.log(`PCT_NET_FROM_BEST_FOLD=${a.pctNetFromBestFold}%`);
  console.log(`TEMPORAL_CONCENTRATION=${a.temporalConcentration}`);
  console.log(`ROBUSTNESS=${report.robustness}`);

  // Verdict
  const deltaNet = a.v4NetPnl - a.b0NetPnl;
  const deltaPF = a.v4ProfitFactor - a.b0ProfitFactor;
  const deltaExp = a.v4Expectancy - a.b0Expectancy;
  console.log(`DELTA_NET_V4_VS_B0=${Math.round(deltaNet * 100) / 100}`);
  console.log(`DELTA_PF_V4_VS_B0=${Math.round(deltaPF * 100) / 100}`);
  console.log(`DELTA_EXPECTANCY_V4_VS_B0=${Math.round(deltaExp * 100) / 100}`);

  let verdict = "INCONCLUSIVE";
  if (a.sampleSufficient) {
    const pairsNotDeteriorated = ALL_PAIRS.filter(pair => {
      let bn = 0, vn = 0;
      for (const f of report.folds) {
        const b0r = f.b0Results.find(r => r.pair === pair);
        const v4r = f.v4Results.find(r => r.pair === pair);
        if (b0r) bn += b0r.netPnl;
        if (v4r) vn += v4r.netPnl;
      }
      return vn >= bn * 0.5; // not materially deteriorated
    }).length;
    if (a.v4NetPnl > a.b0NetPnl && a.v4ProfitFactor > a.b0ProfitFactor && a.v4Expectancy > a.b0Expectancy && pairsNotDeteriorated >= 2) {
      verdict = "DEVELOPMENT_PASS";
    } else {
      verdict = "FAIL";
    }
  }
  console.log(`FINAL_VERDICT=${verdict}`);
}

if (import.meta.url === `file://${process.argv[1]}` || path.resolve(process.argv[1]) === __filename) {
  main();
}
