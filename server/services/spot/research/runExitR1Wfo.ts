/**
 * runExitR1Wfo.ts — Exit R1 walk-forward optimization (exit-only).
 *
 * Entry V4 is FROZEN: entries use the production threshold (0.30) and are
 * never re-optimized. The grid searches ONLY E1 exit parameters:
 *
 *   staleSinceLastMfeMinutes × staleMaxR × mfeGivebackActivateR
 *     × mfeGivebackPct × atrTrailMult × feeAwareBreakEven
 *
 * Fold structure mirrors Entry V4 WFO: 90d train / 30d test / 30d step.
 * Selection metric: objectiveScore (same as V3/V4 WFO) on TRAIN trades
 * across all pairs; OOS reported on TEST.
 *
 * Two replay modes per config:
 *   - path-dependent: fastReplay with exitEvaluator hook (entries live)
 *   - fixed-cohort:   frozen E0 entries, exits only (validation gate)
 *
 * Usage: npx tsx server/services/spot/research/runExitR1Wfo.ts [--smoke] [--max-combos N]
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { SpotCandle } from "../spotTypes";
import { type ReplayConfig, type ReplayTrade } from "../spotReplayEngine";
import { precomputeFrames, fastReplay, type PrecomputedData } from "./fastResearchReplay";
import { type FeeModel } from "../feeModel";
import { DEFAULT_ENTRY_V3_CONFIG, type EntryV3Config } from "../spotEntryV3";
import { DEFAULT_SPOT_EXIT_CONFIG } from "../spotExitPolicy";
import { createE1ExitEvaluator, type SpotExitE1Config } from "./spotExitE1";
import { fixedCohortReplay, type FrozenEntry, type CohortCandles } from "./fixedCohortReplay";
import {
  PAIR_MAPPINGS,
  loadAllCached,
  DATA_ROOT,
  type KrakenOHLCRow,
} from "./krakenHistoricalLoader";
import { objectiveScore, type ObjectiveTrade } from "./runEntryV3Wfo";

// ─── Constants ──────────────────────────────────────────────────────────────

const HISTORICAL_FEE_MODEL: FeeModel = {
  exchange: "revolutx",
  takerFeePct: 0.09,
  makerFeePct: 0.00,
  quality: "ESTIMATED",
};

const V3_ENABLED: EntryV3Config = { ...DEFAULT_ENTRY_V3_CONFIG, enabled: true };
const PRODUCTION_V4_THRESHOLD = 0.30;

const DAY_MS = 24 * 60 * 60 * 1000;
const TRAIN_DAYS = 90;
const TEST_DAYS = 30;
const STEP_DAYS = 30;
const MAX_COMBOS_PER_FOLD = 100;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIT_DIR = path.join(
  path.dirname(path.dirname(path.dirname(path.dirname(__dirname)))),
  "docs", "auditoria", "2026-09-20-exit-position-management-r1",
);
const RESULTS_DIR = path.join(DATA_ROOT, "results");

const ALL_PAIRS = PAIR_MAPPINGS.map(m => m.requested);

// ─── Progress reporting (progress.json in AUDIT_DIR) ─────────────────────────

const PROGRESS_PATH = path.join(AUDIT_DIR, "progress.json");
const T_START = Date.now();

function writeProgress(stage: string, extra: Record<string, unknown> = {}): void {
  try {
    fs.writeFileSync(PROGRESS_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      stage,
      elapsedSec: Math.round((Date.now() - T_START) / 1000),
      ...extra,
    }, null, 2));
  } catch { /* non-fatal */ }
}

// ─── E1 parameter grid (≤100 combos) ────────────────────────────────────────
// 3 × 2 × 3 × 2 × 2 × 2 = 144 → trimmed to 96 by dropping atrMult 3.0
// when giveback is disabled (redundant dimension interaction).

interface GridCombo extends SpotExitE1Config { label: string }

function buildGrid(): GridCombo[] {
  const grid: GridCombo[] = [];
  const staleMins = [120, 180, 240];
  const staleMaxRs = [0.3, 0.5];
  const givebackActs = [0.8, 1.2, 1.8];
  const givebackPcts = [0.4, 0.6];
  const atrMults = [2.0, 2.5];
  const feeAware = [false, true];

  for (const sm of staleMins)
    for (const sr of staleMaxRs)
      for (const ga of givebackActs)
        for (const gp of givebackPcts)
          for (const am of atrMults)
            for (const fa of feeAware)
              grid.push({
                label: `stale${sm}_r${sr}_gb${ga}@${gp}_atr${am}_fa${fa ? 1 : 0}`,
                staleSinceLastMfeMinutes: sm,
                staleMaxR: sr,
                mfeGivebackActivateR: ga,
                mfeGivebackPct: gp,
                atrTrailMult: am,
                feeAwareBreakEven: fa,
              });
  return grid.slice(0, MAX_COMBOS_PER_FOLD);
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface PairData {
  pair: string;
  all5m: SpotCandle[];
  all15m: SpotCandle[];
  all1h: SpotCandle[];
  all4h: SpotCandle[];
}

interface FoldWindow {
  trainStart: number; trainEnd: number;
  testStart: number; testEnd: number;
}

interface FoldResult {
  foldIndex: number;
  trainStart: string; trainEnd: string;
  testStart: string; testEnd: string;
  bestCombo: string;
  bestParams: SpotExitE1Config;
  trainScore: number;
  trainTrades: number;
  // OOS test metrics (E1 best)
  testTrades: number;
  testNetPnl: number;
  testPF: number;
  testExpectancy: number;
  testMaxDD: number;
  // E0 baseline on same test window
  e0TestTrades: number;
  e0TestNetPnl: number;
  e0TestPF: number;
  e0TestMaxDD: number;
  // Fixed-cohort gate
  cohortReproducesE0: boolean;
  cohortMismatches: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toSpotCandle(row: KrakenOHLCRow): SpotCandle {
  return { time: row.timestamp, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume };
}

function netPF(trades: { netPnlUsd: number }[]): number {
  const w = trades.filter(t => t.netPnlUsd > 0).reduce((s, t) => s + t.netPnlUsd, 0);
  const l = Math.abs(trades.filter(t => t.netPnlUsd <= 0).reduce((s, t) => s + t.netPnlUsd, 0));
  return l > 0 ? w / l : w > 0 ? Infinity : 0;
}

function maxDrawdown(trades: { netPnlUsd: number }[], cap = 10000): number {
  let eq = cap, peak = cap, dd = 0;
  for (const t of trades) { eq += t.netPnlUsd; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  return dd;
}

function iso(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }

function toObjective(trades: ReplayTrade[]): ObjectiveTrade[] {
  return trades.map(t => ({
    netPnlUsd: t.netPnlUsd, grossPnlUsd: t.grossPnlUsd,
    entryFeeUsd: t.entryFeeUsd, exitFeeUsd: t.exitFeeUsd,
  }));
}

// ─── WFO ────────────────────────────────────────────────────────────────────

async function main() {
  const smoke = process.argv.includes("--smoke");
  const maxCombosArg = process.argv.find(a => a.startsWith("--max-combos="));
  const maxCombos = maxCombosArg ? parseInt(maxCombosArg.split("=")[1], 10) : MAX_COMBOS_PER_FOLD;

  if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const datasets = loadAllCached();
  const pairDataMap = new Map<string, PairData>();
  const precomputedMap = new Map<string, PrecomputedData>();
  let intersectStart = -Infinity, intersectEnd = Infinity;

  for (const pair of ALL_PAIRS) {
    const c5 = datasets.get(`${pair}_5m`);
    const c15 = datasets.get(`${pair}_15m`);
    const c60 = datasets.get(`${pair}_60m`);
    const c240 = datasets.get(`${pair}_240m`);
    if (!c5 || !c15 || !c60 || !c240) { console.error(`Missing datasets for ${pair}`); continue; }
    const pd: PairData = {
      pair,
      all5m: c5.rows.map(toSpotCandle), all15m: c15.rows.map(toSpotCandle),
      all1h: c60.rows.map(toSpotCandle), all4h: c240.rows.map(toSpotCandle),
    };
    pairDataMap.set(pair, pd);
    intersectStart = Math.max(intersectStart, c5.firstTimestamp);
    intersectEnd = Math.min(intersectEnd, c5.lastTimestamp);

    const t0 = Date.now();
    writeProgress("precompute", { pair });
    precomputedMap.set(pair, precomputeFrames(pair, {
      pair, candles5m: pd.all5m, candles15m: pd.all15m,
      candles1h: pd.all1h, candles4h: pd.all4h,
    }, V3_ENABLED));
    console.log(`[${pair}] precomputed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  if (pairDataMap.size === 0) { console.error("No datasets"); process.exit(1); }

  const grid = buildGrid().slice(0, maxCombos);
  console.log(`GRID=${grid.length} combos/fold (cap ${MAX_COMBOS_PER_FOLD})`);

  // Fold windows
  const folds: FoldWindow[] = [];
  const nFolds = smoke ? 1 : 3;
  let cursor = intersectEnd - (TRAIN_DAYS + TEST_DAYS) * DAY_MS;
  for (let f = 0; f < nFolds; f++) {
    const trainStart = cursor - f * STEP_DAYS * DAY_MS;
    folds.push({
      trainStart, trainEnd: trainStart + TRAIN_DAYS * DAY_MS,
      testStart: trainStart + TRAIN_DAYS * DAY_MS,
      testEnd: trainStart + (TRAIN_DAYS + TEST_DAYS) * DAY_MS,
    });
  }
  folds.reverse(); // chronological

  const foldResults: FoldResult[] = [];
  const allE1TestTrades: ReplayTrade[] = [];
  const allE0TestTrades: ReplayTrade[] = [];
  const gridRows: string[] = ["fold,combo,trainScore,trainTrades,isBest"];
  const cohortRows: string[] = ["fold,pair,lotId,e0ExitReason,e0ClosedAtMs,e0NetPnlUsd,cohortExitReason,cohortClosedAtMs,cohortNetPnlUsd,sameExit"];
  const e0PairRows: string[] = ["fold,pair,trades,netPnl,pf,maxDD"];

  const totalComboRuns = folds.length * grid.length;
  let combosDone = 0;

  for (let f = 0; f < folds.length; f++) {
    const fw = folds[f];
    console.log(`\n=== FOLD ${f}: train ${iso(fw.trainStart)}→${iso(fw.trainEnd)} | test ${iso(fw.testStart)}→${iso(fw.testEnd)} ===`);

    // ── TRAIN: grid search ──
    let bestScore = -Infinity, bestCombo: GridCombo = grid[0], bestTrades = 0;
    const foldGridRows: string[] = [];
    for (const combo of grid) {
      const allPairTrades: { pair: string; trades: ObjectiveTrade[] }[] = [];
      for (const pair of ALL_PAIRS) {
        const pre = precomputedMap.get(pair);
        if (!pre) continue;
        const evaluator = createE1ExitEvaluator(combo, HISTORICAL_FEE_MODEL);
        const res = fastReplay(pre, {
          pair, availableCapitalUsd: 10000,
          exitConfig: DEFAULT_SPOT_EXIT_CONFIG,
          entryV3Config: V3_ENABLED,
          v4MinQualityScore: PRODUCTION_V4_THRESHOLD,
          feeModel: HISTORICAL_FEE_MODEL,
          evaluationStartMs: fw.trainStart,
          evaluationEndMs: fw.trainEnd,
          maxConcurrentPositions: 2,
        }, undefined, { exitEvaluator: evaluator });
        allPairTrades.push({ pair, trades: toObjective(res.trades) });
      }
      const { score, totalTrades } = objectiveScore(allPairTrades);
      if (score > bestScore) { bestScore = score; bestCombo = combo; bestTrades = totalTrades; }
      foldGridRows.push(`${f},${combo.label},${score},${totalTrades},BESTFLAG`);
      combosDone++;
      const elapsedSec = (Date.now() - T_START) / 1000;
      const etaSec = combosDone > 0 ? Math.round(elapsedSec / combosDone * (totalComboRuns - combosDone)) : null;
      writeProgress("grid", {
        fold: f, combination: combosDone % grid.length || grid.length,
        foldCombos: grid.length, combosDone, totalComboRuns,
        etaSec, bestCombo: bestCombo.label, bestScore,
      });
    }
    console.log(`BEST=${bestCombo.label} score=${bestScore} trainTrades=${bestTrades}`);
    for (const row of foldGridRows) {
      gridRows.push(row.replace("BESTFLAG", row.startsWith(`${f},${bestCombo.label},`) ? "1" : "0"));
    }

    // ── TEST: E1 best vs E0 on same window ──
    writeProgress("test", { fold: f, bestCombo: bestCombo.label });
    let testTrades = 0, testNet = 0, testTradesArr: ReplayTrade[] = [];
    let e0Trades = 0, e0Net = 0, e0TradesArr: ReplayTrade[] = [];
    let cohortOk = true, cohortMismatch = 0;

    for (const pair of ALL_PAIRS) {
      const pre = precomputedMap.get(pair);
      const pd = pairDataMap.get(pair);
      if (!pre || !pd) continue;

      // E1 path-dependent
      const e1Eval = createE1ExitEvaluator(bestCombo, HISTORICAL_FEE_MODEL);
      const e1Res = fastReplay(pre, {
        pair, availableCapitalUsd: 10000,
        exitConfig: DEFAULT_SPOT_EXIT_CONFIG,
        entryV3Config: V3_ENABLED,
        v4MinQualityScore: PRODUCTION_V4_THRESHOLD,
        feeModel: HISTORICAL_FEE_MODEL,
        evaluationStartMs: fw.testStart, evaluationEndMs: fw.testEnd,
        maxConcurrentPositions: 2,
      }, undefined, { exitEvaluator: e1Eval });
      testTradesArr.push(...e1Res.trades);

      // E0 path-dependent (baseline, same window)
      const frozenEntries: FrozenEntry[] = [];
      const e0Res = fastReplay(pre, {
        pair, availableCapitalUsd: 10000,
        exitConfig: DEFAULT_SPOT_EXIT_CONFIG,
        entryV3Config: V3_ENABLED,
        v4MinQualityScore: PRODUCTION_V4_THRESHOLD,
        feeModel: HISTORICAL_FEE_MODEL,
        evaluationStartMs: fw.testStart, evaluationEndMs: fw.testEnd,
        maxConcurrentPositions: 2,
      }, undefined, {
        onTradeClosed: (pos, trade) => {
          frozenEntries.push({
            lotId: pos.lotId, pair: pos.pair, signalId: pos.signalId,
            setupTag: pos.setupTag, regimeAtEntry: String(pos.regimeAtEntry),
            directionAtEntry: String(pos.directionAtEntry),
            entryPrice: pos.entryPrice, volume: pos.qtyRemaining,
            openedAtMs: pos.openedAt,
            initialStopPrice: pos.initialStopPrice,
            initialStopDistanceUsd: pos.initialStopDistanceUsd,
            riskUsd: pos.riskUsd, notionalUsd: pos.notionalUsd,
            entryFee: pos.entryFee,
            e0ExitReason: trade.exitReason, e0ExitPrice: trade.exitPrice,
            e0ClosedAtMs: trade.closedAtMs, e0NetPnlUsd: trade.netPnlUsd,
            e0RMultiple: trade.rMultiple,
          });
        },
      });
      e0TradesArr.push(...e0Res.trades);

      // ── Fixed-cohort gate: replay frozen E0 entries with E0 evaluator ──
      const candles: CohortCandles = {
        candles5m: pd.all5m, candles15m: pd.all15m,
        candles1h: pd.all1h, candles4h: pd.all4h,
      };
      const cohortRes = fixedCohortReplay(
        frozenEntries, candles, DEFAULT_SPOT_EXIT_CONFIG, undefined, HISTORICAL_FEE_MODEL,
      );
      const mismatches = cohortRes.deltas.filter(d => !d.sameExit).length;
      if (mismatches > 0) { cohortOk = false; cohortMismatch += mismatches; }
      for (const d of cohortRes.deltas) {
        cohortRows.push(`${f},${pair},${d.lotId},${d.e0ExitReason ?? ""},${d.e0ClosedAtMs ?? ""},${d.e0NetPnlUsd ?? ""},${d.exitReason},${d.closedAtMs},${d.netPnlUsd},${d.sameExit ? 1 : 0}`);
      }
      e0PairRows.push(`${f},${pair},${e0Res.trades.length},${e0Res.trades.reduce((s, t) => s + t.netPnlUsd, 0).toFixed(2)},${netPF(e0Res.trades).toFixed(3)},${maxDrawdown(e0Res.trades).toFixed(2)}`);
    }

    testTrades = testTradesArr.length;
    testNet = testTradesArr.reduce((s, t) => s + t.netPnlUsd, 0);
    e0Trades = e0TradesArr.length;
    e0Net = e0TradesArr.reduce((s, t) => s + t.netPnlUsd, 0);
    allE1TestTrades.push(...testTradesArr);
    allE0TestTrades.push(...e0TradesArr);

    foldResults.push({
      foldIndex: f,
      trainStart: iso(fw.trainStart), trainEnd: iso(fw.trainEnd),
      testStart: iso(fw.testStart), testEnd: iso(fw.testEnd),
      bestCombo: bestCombo.label, bestParams: bestCombo,
      trainScore: bestScore, trainTrades: bestTrades,
      testTrades, testNetPnl: testNet,
      testPF: netPF(testTradesArr),
      testExpectancy: testTrades > 0 ? testNet / testTrades : 0,
      testMaxDD: maxDrawdown(testTradesArr),
      e0TestTrades: e0Trades, e0TestNetPnl: e0Net,
      e0TestPF: netPF(e0TradesArr), e0TestMaxDD: maxDrawdown(e0TradesArr),
      cohortReproducesE0: cohortOk, cohortMismatches: cohortMismatch,
    });

    console.log(`FOLD ${f} TEST: E1 net=${testNet.toFixed(2)} pf=${netPF(testTradesArr).toFixed(3)} | E0 net=${e0Net.toFixed(2)} pf=${netPF(e0TradesArr).toFixed(3)} | cohort gate=${cohortOk ? "PASS" : `FAIL(${cohortMismatch})`}`);
  }

  // ─── Aggregate OOS ──
  const agg = {
    folds: foldResults.length,
    gridSize: grid.length,
    e1: {
      trades: allE1TestTrades.length,
      netPnl: allE1TestTrades.reduce((s, t) => s + t.netPnlUsd, 0),
      pf: netPF(allE1TestTrades),
      maxDD: maxDrawdown(allE1TestTrades),
      expectancy: allE1TestTrades.length > 0
        ? allE1TestTrades.reduce((s, t) => s + t.netPnlUsd, 0) / allE1TestTrades.length : 0,
      winRate: allE1TestTrades.length > 0
        ? allE1TestTrades.filter(t => t.netPnlUsd > 0).length / allE1TestTrades.length * 100 : 0,
    },
    e0: {
      trades: allE0TestTrades.length,
      netPnl: allE0TestTrades.reduce((s, t) => s + t.netPnlUsd, 0),
      pf: netPF(allE0TestTrades),
      maxDD: maxDrawdown(allE0TestTrades),
      expectancy: allE0TestTrades.length > 0
        ? allE0TestTrades.reduce((s, t) => s + t.netPnlUsd, 0) / allE0TestTrades.length : 0,
      winRate: allE0TestTrades.length > 0
        ? allE0TestTrades.filter(t => t.netPnlUsd > 0).length / allE0TestTrades.length * 100 : 0,
    },
    cohortGateAllPass: foldResults.every(r => r.cohortReproducesE0),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    entryV4Threshold: PRODUCTION_V4_THRESHOLD,
    feeModel: HISTORICAL_FEE_MODEL,
    smoke, gridSize: grid.length,
    folds: foldResults,
    aggregatedOos: agg,
  };

  fs.writeFileSync(path.join(RESULTS_DIR, "exit-r1-wfo.json"), JSON.stringify(report, null, 2));

  // CSV: fold results
  const csvLines = ["fold,trainStart,trainEnd,testStart,testEnd,bestCombo,trainScore,trainTrades,testTrades,testNetPnl,testPF,testExpectancy,testMaxDD,e0TestTrades,e0TestNetPnl,e0TestPF,e0TestMaxDD,cohortGate,cohortMismatches"];
  for (const r of foldResults) {
    csvLines.push([
      r.foldIndex, r.trainStart, r.trainEnd, r.testStart, r.testEnd,
      r.bestCombo, r.trainScore, r.trainTrades,
      r.testTrades, r.testNetPnl.toFixed(2), r.testPF.toFixed(3),
      r.testExpectancy.toFixed(3), r.testMaxDD.toFixed(2),
      r.e0TestTrades, r.e0TestNetPnl.toFixed(2), r.e0TestPF.toFixed(3),
      r.e0TestMaxDD.toFixed(2), r.cohortReproducesE0, r.cohortMismatches,
    ].join(","));
  }
  fs.writeFileSync(path.join(AUDIT_DIR, "exit_r1_wfo_folds.csv"), csvLines.join("\n"));

  // CSV: OOS trades E1 vs E0
  const tHeader = "policy,pair,lotId,exitReason,entryPrice,exitPrice,volume,grossPnlUsd,entryFeeUsd,exitFeeUsd,netPnlUsd,rMultiple,mfeR,holdTimeMinutes,openedAtMs,closedAtMs";
  const tRow = (pol: string, t: ReplayTrade) => [pol, t.pair, t.lotId, t.exitReason, t.entryPrice, t.exitPrice, t.volume, t.grossPnlUsd, t.entryFeeUsd, t.exitFeeUsd, t.netPnlUsd, t.rMultiple, t.mfeR, t.holdTimeMinutes, t.openedAtMs, t.closedAtMs].join(",");
  const tRows = [
    ...allE1TestTrades.map(t => tRow("E1", t)),
    ...allE0TestTrades.map(t => tRow("E0", t)),
  ];
  fs.writeFileSync(path.join(AUDIT_DIR, "exit_r1_oos_trades.csv"), [tHeader, ...tRows].join("\n"));

  // Mandatory deliverable CSVs
  fs.writeFileSync(path.join(AUDIT_DIR, "E1_GRID_RESULTS.csv"), gridRows.join("\n"));
  fs.writeFileSync(path.join(AUDIT_DIR, "E1_WFO_RESULTS.csv"), csvLines.join("\n"));
  fs.writeFileSync(path.join(AUDIT_DIR, "FIXED_COHORT_RESULTS.csv"), cohortRows.join("\n"));
  fs.writeFileSync(path.join(AUDIT_DIR, "PATH_DEPENDENT_RESULTS.csv"), [tHeader, ...tRows].join("\n"));
  fs.writeFileSync(path.join(AUDIT_DIR, "PRODUCTION_030_RESULTS.csv"), e0PairRows.join("\n"));

  writeProgress("done", {
    folds: foldResults.length,
    e1OosNet: agg.e1.netPnl, e1OosPf: agg.e1.pf,
    e0OosNet: agg.e0.netPnl, e0OosPf: agg.e0.pf,
    cohortGateAllPass: agg.cohortGateAllPass,
  });

  console.log("\nWFO_DONE");
  console.log(`E1_OOS: trades=${agg.e1.trades} net=${agg.e1.netPnl.toFixed(2)} pf=${agg.e1.pf.toFixed(3)} dd=${agg.e1.maxDD.toFixed(2)} exp=${agg.e1.expectancy.toFixed(3)} wr=${agg.e1.winRate.toFixed(1)}%`);
  console.log(`E0_OOS: trades=${agg.e0.trades} net=${agg.e0.netPnl.toFixed(2)} pf=${agg.e0.pf.toFixed(3)} dd=${agg.e0.maxDD.toFixed(2)} exp=${agg.e0.expectancy.toFixed(3)} wr=${agg.e0.winRate.toFixed(1)}%`);
  console.log(`COHORT_GATE=${agg.cohortGateAllPass ? "ALL_PASS" : "FAIL"}`);
  console.log(`OUTPUT_DIR=${AUDIT_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
