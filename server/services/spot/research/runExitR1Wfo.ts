/**
 * runExitR1Wfo.ts — Exit R1 walk-forward optimization (exit-only).
 *
 * Entry V4 is FROZEN: entries are never re-optimized. The WFO reproduces the
 * HISTORICAL entry decisions by applying the entry threshold that was live in
 * each fold window:
 *
 *   HISTORICAL_ENTRY_THRESHOLDS = [0.50, 0.30, 0.30]  (fold0, fold1, fold2)
 *
 * The grid searches ONLY E1 exit parameters — EXACTLY 96 balanced combos:
 *
 *   staleSinceLastMfeMinutes(3) × staleMaxR(2) × mfeGivebackActivateR(2)
 *     × mfeGivebackPct(2) × atrTrailMult(2) × feeAwareBreakEven(2) = 96
 *
 * Fold structure mirrors Entry V4 WFO: 90d train / 30d test / 30d step.
 * Selection metric: objectiveScore on TRAIN trades across all pairs; the
 * selected combo is evaluated ONCE on TEST (no test retune).
 *
 * Per fold TEST, three analyses:
 *   - path-dependent: E0 vs E1 live replay (same window/conditions)
 *   - fixed-cohort: frozen E0 entries replayed with E0 (gate: must reproduce
 *     E0 exactly) AND with E1 (same entries — FIXED_COHORT_E0_VS_E1.csv)
 *   - production-030: secondary pass — E0 @0.30 vs E1 @0.30 using the E1
 *     params selected by the historical WFO (no entry re-optimization)
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
import { DEFAULT_SPOT_EXIT_CONFIG, evaluateExit } from "../spotExitPolicy";
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

/** Entry threshold that was historically live in each fold window. FROZEN —
 *  entries are never re-optimized; this only reproduces past V4 decisions. */
export const HISTORICAL_ENTRY_THRESHOLDS = [0.50, 0.30, 0.30] as const;
/** Secondary production analysis: current production threshold on all folds. */
export const PRODUCTION_030_THRESHOLDS = [0.30, 0.30, 0.30] as const;
export const EXPECTED_GRID_SIZE = 96;

const DAY_MS = 24 * 60 * 60 * 1000;
const TRAIN_DAYS = 90;
const TEST_DAYS = 30;
const STEP_DAYS = 30;
const MAX_COMBOS_PER_FOLD = 96;

/** Capture ratio is only defined when MFE is meaningful. */
const CAPTURE_MFE_R_MIN = 0.05;

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

// ─── E1 parameter grid — EXACTLY 96 balanced combos ─────────────────────────
// 3 × 2 × 2 × 2 × 2 × 2 = 96. Every dimension fully represented; no slicing.

interface GridCombo extends SpotExitE1Config { label: string }

export function buildGrid(): GridCombo[] {
  const grid: GridCombo[] = [];
  const staleMins = [120, 180, 240];
  const staleMaxRs = [0.3, 0.5];
  const givebackActs = [0.8, 1.2];
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
  if (grid.length !== EXPECTED_GRID_SIZE) {
    throw new Error(`Grid must be exactly ${EXPECTED_GRID_SIZE} balanced combos, got ${grid.length}`);
  }
  return grid;
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
  entryThreshold: number;
  trainStart: string; trainEnd: string;
  testStart: string; testEnd: string;
  bestCombo: string;
  bestParams: SpotExitE1Config;
  trainScore: number;
  trainTrades: number;
  testTrades: number;
  testNetPnl: number;
  testPF: number;
  testExpectancy: number;
  testMaxDD: number;
  e0TestTrades: number;
  e0TestNetPnl: number;
  e0TestPF: number;
  e0TestMaxDD: number;
  cohortReproducesE0: boolean;
  cohortMismatches: number;
}

interface TradeMetrics {
  n: number; net: number; pf: number; exp: number; dd: number; wr: number;
  fees: number; gross: number; durMin: number;
  captureMean: number; captureMedian: number; captureN: number;
  givebackMean: number; givebackMedian: number;
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

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Aggregate metrics. Capture uses ONLY trades with mfeR > 0.05 (documented
 *  filter — mean capture is undefined when MFE≈0). Giveback = mfeR - final R. */
function metricsOf(trades: ReplayTrade[]): TradeMetrics {
  const n = trades.length;
  const net = trades.reduce((s, t) => s + t.netPnlUsd, 0);
  const sorted = [...trades].sort((a, b) => a.closedAtMs - b.closedAtMs);
  const capSample = trades.filter(t => t.mfeR > CAPTURE_MFE_R_MIN);
  const captures = capSample.map(t => t.rMultiple / t.mfeR);
  const givebacks = trades.map(t => t.mfeR - t.rMultiple);
  return {
    n, net,
    pf: netPF(trades),
    exp: n > 0 ? net / n : 0,
    dd: maxDrawdown(sorted),
    wr: n > 0 ? trades.filter(t => t.netPnlUsd > 0).length / n * 100 : 0,
    fees: trades.reduce((s, t) => s + t.entryFeeUsd + t.exitFeeUsd, 0),
    gross: trades.reduce((s, t) => s + t.grossPnlUsd, 0),
    durMin: n > 0 ? trades.reduce((s, t) => s + t.holdTimeMinutes, 0) / n : 0,
    captureMean: captures.length ? captures.reduce((a, b) => a + b, 0) / captures.length : 0,
    captureMedian: median(captures),
    captureN: captures.length,
    givebackMean: givebacks.length ? givebacks.reduce((a, b) => a + b, 0) / givebacks.length : 0,
    givebackMedian: median(givebacks),
  };
}

function iso(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }

function toObjective(trades: ReplayTrade[]): ObjectiveTrade[] {
  return trades.map(t => ({
    netPnlUsd: t.netPnlUsd, grossPnlUsd: t.grossPnlUsd,
    entryFeeUsd: t.entryFeeUsd, exitFeeUsd: t.exitFeeUsd,
  }));
}

function replayArgs(pair: string, threshold: number, startMs: number, endMs: number): ReplayConfig {
  return {
    pair, availableCapitalUsd: 10000,
    exitConfig: DEFAULT_SPOT_EXIT_CONFIG,
    entryV3Config: V3_ENABLED,
    v4MinQualityScore: threshold,
    feeModel: HISTORICAL_FEE_MODEL,
    evaluationStartMs: startMs, evaluationEndMs: endMs,
    maxConcurrentPositions: 2,
  };
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
  console.log(`GRID=${grid.length} combos/fold (balanced ${EXPECTED_GRID_SIZE}, cap ${MAX_COMBOS_PER_FOLD})`);
  console.log(`HISTORICAL_ENTRY_THRESHOLDS=${HISTORICAL_ENTRY_THRESHOLDS.join(",")}`);

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
  const selectedByFold: GridCombo[] = [];
  const allE1TestTrades: ReplayTrade[] = [];
  const allE0TestTrades: ReplayTrade[] = [];
  const gridRows: string[] = ["fold,entryThreshold,combo,trainScore,trainTrades,isBest"];
  const cohortRows: string[] = ["fold,pair,lotId,e0ExitReason,e0ClosedAtMs,e0NetPnlUsd,cohortExitReason,cohortClosedAtMs,cohortNetPnlUsd,sameExit"];
  const cohortE0E1Rows: string[] = ["fold,pair,lotId,entryTime,entryPrice,e0ExitTime,e1ExitTime,e0Reason,e1Reason,e0Net,e1Net,e0R,e1R,e0MfeR,e1MfeR,e0Capture,e1Capture,e0Giveback,e1Giveback,deltaNet,deltaR,deltaCapture,deltaGiveback"];
  const prodRows: string[] = ["policy,fold,pair,trades,net,pf,expectancy,maxDD,fees,captureMean,captureMedian,captureN,givebackMean,givebackMedian"];
  const allFixedE0Trades: ReplayTrade[] = [];
  const allFixedE1Trades: ReplayTrade[] = [];

  const totalComboRuns = folds.length * grid.length;
  let combosDone = 0;

  for (let f = 0; f < folds.length; f++) {
    const fw = folds[f];
    const entryThreshold = HISTORICAL_ENTRY_THRESHOLDS[f] ?? HISTORICAL_ENTRY_THRESHOLDS[HISTORICAL_ENTRY_THRESHOLDS.length - 1];
    console.log(`\n=== FOLD ${f}: ENTRY_THRESHOLD=${entryThreshold} | train ${iso(fw.trainStart)}→${iso(fw.trainEnd)} | test ${iso(fw.testStart)}→${iso(fw.testEnd)} ===`);

    // ── TRAIN: grid search (EXIT params only; entry threshold fixed per fold) ──
    let bestScore = -Infinity, bestCombo: GridCombo = grid[0], bestTrades = 0;
    const foldGridRows: string[] = [];
    for (const combo of grid) {
      const allPairTrades: { pair: string; trades: ObjectiveTrade[] }[] = [];
      for (const pair of ALL_PAIRS) {
        const pre = precomputedMap.get(pair);
        if (!pre) continue;
        const evaluator = createE1ExitEvaluator(combo, HISTORICAL_FEE_MODEL);
        const res = fastReplay(pre, replayArgs(pair, entryThreshold, fw.trainStart, fw.trainEnd),
          undefined, { exitEvaluator: evaluator });
        allPairTrades.push({ pair, trades: toObjective(res.trades) });
      }
      const { score, totalTrades } = objectiveScore(allPairTrades);
      if (score > bestScore) { bestScore = score; bestCombo = combo; bestTrades = totalTrades; }
      foldGridRows.push(`${f},${entryThreshold},${combo.label},${score},${totalTrades},BESTFLAG`);
      combosDone++;
      const elapsedSec = (Date.now() - T_START) / 1000;
      const etaSec = combosDone > 0 ? Math.round(elapsedSec / combosDone * (totalComboRuns - combosDone)) : null;
      writeProgress("grid", {
        fold: f, entryThreshold, combination: combosDone % grid.length || grid.length,
        foldCombos: grid.length, combosDone, totalComboRuns,
        etaSec, bestCombo: bestCombo.label, bestScore,
      });
    }
    console.log(`BEST=${bestCombo.label} score=${bestScore} trainTrades=${bestTrades}`);
    for (const row of foldGridRows) {
      gridRows.push(row.replace("BESTFLAG", row.startsWith(`${f},${entryThreshold},${bestCombo.label},`) ? "1" : "0"));
    }
    selectedByFold.push(bestCombo);

    // ── TEST: E1 best vs E0 on same window (single evaluation, no retune) ──
    writeProgress("test", { fold: f, bestCombo: bestCombo.label });
    const testTradesArr: ReplayTrade[] = [];
    const e0TradesArr: ReplayTrade[] = [];
    let foldCohortOk = true;
    let foldCohortMismatch = 0;

    for (const pair of ALL_PAIRS) {
      const pre = precomputedMap.get(pair);
      const pd = pairDataMap.get(pair);
      if (!pre || !pd) continue;

      // E1 path-dependent
      const e1Eval = createE1ExitEvaluator(bestCombo, HISTORICAL_FEE_MODEL);
      const e1Res = fastReplay(pre, replayArgs(pair, entryThreshold, fw.testStart, fw.testEnd),
        undefined, { exitEvaluator: e1Eval });
      testTradesArr.push(...e1Res.trades);

      // E0 path-dependent (baseline, same window) — freeze entries for cohort
      const frozenEntries: FrozenEntry[] = [];
      const e0Res = fastReplay(pre, replayArgs(pair, entryThreshold, fw.testStart, fw.testEnd),
        undefined, {
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

      // ── FIXED COHORT: same frozen E0 entries → E0 evaluator (gate) + E1 evaluator ──
      const candles: CohortCandles = {
        candles5m: pd.all5m, candles15m: pd.all15m,
        candles1h: pd.all1h, candles4h: pd.all4h,
      };
      const cohortE0 = fixedCohortReplay(
        frozenEntries, candles, DEFAULT_SPOT_EXIT_CONFIG, evaluateExit, HISTORICAL_FEE_MODEL,
      );
      const mismatches = cohortE0.deltas.filter(d => !d.sameExit).length;
      const cohortOk = mismatches === 0;
      for (const d of cohortE0.deltas) {
        cohortRows.push(`${f},${pair},${d.lotId},${d.e0ExitReason ?? ""},${d.e0ClosedAtMs ?? ""},${d.e0NetPnlUsd ?? ""},${d.exitReason},${d.closedAtMs},${d.netPnlUsd},${d.sameExit ? 1 : 0}`);
      }

      const cohortE1 = fixedCohortReplay(
        frozenEntries, candles, DEFAULT_SPOT_EXIT_CONFIG,
        createE1ExitEvaluator(bestCombo, HISTORICAL_FEE_MODEL), HISTORICAL_FEE_MODEL,
      );
      const e1ByLot = new Map(cohortE1.trades.map(t => [t.lotId, t]));
      for (const e0t of cohortE0.trades) {
        const e1t = e1ByLot.get(e0t.lotId);
        if (!e1t) { console.warn(`cohort E1 missing trade for ${e0t.lotId}`); continue; }
        const e0Cap = e0t.mfeR > CAPTURE_MFE_R_MIN ? e0t.rMultiple / e0t.mfeR : "";
        const e1Cap = e1t.mfeR > CAPTURE_MFE_R_MIN ? e1t.rMultiple / e1t.mfeR : "";
        const e0Gb = e0t.mfeR - e0t.rMultiple;
        const e1Gb = e1t.mfeR - e1t.rMultiple;
        cohortE0E1Rows.push([
          f, pair, e0t.lotId, e0t.openedAtMs, e0t.entryPrice,
          e0t.closedAtMs, e1t.closedAtMs,
          e0t.exitReason, e1t.exitReason,
          e0t.netPnlUsd, e1t.netPnlUsd,
          e0t.rMultiple, e1t.rMultiple,
          e0t.mfeR, e1t.mfeR,
          e0Cap, e1Cap,
          e0Gb, e1Gb,
          e1t.netPnlUsd - e0t.netPnlUsd,
          e1t.rMultiple - e0t.rMultiple,
          e0Cap !== "" && e1Cap !== "" ? (e1Cap as number) - (e0Cap as number) : "",
          e1Gb - e0Gb,
        ].join(","));
        allFixedE0Trades.push(e0t);
        allFixedE1Trades.push(e1t);
      }
      foldCohortMismatch += mismatches;
      foldCohortOk = foldCohortOk && cohortOk;
    }

    allE1TestTrades.push(...testTradesArr);
    allE0TestTrades.push(...e0TradesArr);

    foldResults.push({
      foldIndex: f,
      entryThreshold,
      trainStart: iso(fw.trainStart), trainEnd: iso(fw.trainEnd),
      testStart: iso(fw.testStart), testEnd: iso(fw.testEnd),
      bestCombo: bestCombo.label, bestParams: bestCombo,
      trainScore: bestScore, trainTrades: bestTrades,
      testTrades: testTradesArr.length,
      testNetPnl: testTradesArr.reduce((s, t) => s + t.netPnlUsd, 0),
      testPF: netPF(testTradesArr),
      testExpectancy: testTradesArr.length > 0 ? testTradesArr.reduce((s, t) => s + t.netPnlUsd, 0) / testTradesArr.length : 0,
      testMaxDD: maxDrawdown(testTradesArr),
      e0TestTrades: e0TradesArr.length,
      e0TestNetPnl: e0TradesArr.reduce((s, t) => s + t.netPnlUsd, 0),
      e0TestPF: netPF(e0TradesArr), e0TestMaxDD: maxDrawdown(e0TradesArr),
      cohortReproducesE0: foldCohortOk, cohortMismatches: foldCohortMismatch,
    });

    console.log(`FOLD ${f} TEST: E1 net=${foldResults[f].testNetPnl.toFixed(2)} pf=${foldResults[f].testPF.toFixed(3)} | E0 net=${foldResults[f].e0TestNetPnl.toFixed(2)} pf=${foldResults[f].e0TestPF.toFixed(3)} | cohort gate=${foldCohortOk ? "PASS" : `FAIL(${foldCohortMismatch})`}`);
  }

  // ─── PRODUCTION_FIXED_030: secondary analysis, E1 params from historical WFO ──
  // No entry re-optimization: replay TEST windows at threshold 0.30, E0 vs E1
  // with the combo each fold selected on TRAIN.
  if (!smoke) {
    writeProgress("production030");
    const prodE0All: ReplayTrade[] = [];
    const prodE1All: ReplayTrade[] = [];
    for (let f = 0; f < folds.length; f++) {
      const fw = folds[f];
      const combo = selectedByFold[f];
      for (const pair of ALL_PAIRS) {
        const pre = precomputedMap.get(pair);
        if (!pre) continue;
        const e0 = fastReplay(pre, replayArgs(pair, 0.30, fw.testStart, fw.testEnd));
        const e1 = fastReplay(pre, replayArgs(pair, 0.30, fw.testStart, fw.testEnd),
          undefined, { exitEvaluator: createE1ExitEvaluator(combo, HISTORICAL_FEE_MODEL) });
        prodE0All.push(...e0.trades);
        prodE1All.push(...e1.trades);
        for (const [pol, tr] of [["E0", e0.trades], ["E1", e1.trades]] as const) {
          const m = metricsOf(tr);
          prodRows.push([pol, f, pair, m.n, m.net.toFixed(2), m.pf.toFixed(3), m.exp.toFixed(3),
            m.dd.toFixed(2), m.fees.toFixed(2), m.captureMean.toFixed(3), m.captureMedian.toFixed(3),
            m.captureN, m.givebackMean.toFixed(3), m.givebackMedian.toFixed(3)].join(","));
        }
      }
    }
    const m0 = metricsOf(prodE0All), m1 = metricsOf(prodE1All);
    for (const [pol, m] of [["E0", m0], ["E1", m1]] as const) {
      prodRows.push([pol, "ALL", "ALL", m.n, m.net.toFixed(2), m.pf.toFixed(3), m.exp.toFixed(3),
        m.dd.toFixed(2), m.fees.toFixed(2), m.captureMean.toFixed(3), m.captureMedian.toFixed(3),
        m.captureN, m.givebackMean.toFixed(3), m.givebackMedian.toFixed(3)].join(","));
    }
    console.log(`PRODUCTION_030_E0_NET=${m0.net.toFixed(2)} PRODUCTION_030_E1_NET=${m1.net.toFixed(2)}`);
    console.log(`PRODUCTION_030_E0_PF=${m0.pf.toFixed(3)} PRODUCTION_030_E1_PF=${m1.pf.toFixed(3)}`);
    console.log(`PRODUCTION_030_DELTA_NET=${(m1.net - m0.net).toFixed(2)} PRODUCTION_030_DELTA_PF=${(m1.pf - m0.pf).toFixed(3)}`);
  }

  // ─── Aggregate OOS ──
  const e1M = metricsOf(allE1TestTrades);
  const e0M = metricsOf(allE0TestTrades);
  const fxE0 = metricsOf(allFixedE0Trades);
  const fxE1 = metricsOf(allFixedE1Trades);
  const agg = {
    folds: foldResults.length,
    gridSize: grid.length,
    historicalEntryThresholds: [...HISTORICAL_ENTRY_THRESHOLDS],
    e1: { trades: e1M.n, netPnl: e1M.net, pf: e1M.pf, maxDD: e1M.dd, expectancy: e1M.exp, winRate: e1M.wr },
    e0: { trades: e0M.n, netPnl: e0M.net, pf: e0M.pf, maxDD: e0M.dd, expectancy: e0M.exp, winRate: e0M.wr },
    cohortGateAllPass: foldResults.every(r => r.cohortReproducesE0),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    historicalEntryThresholds: [...HISTORICAL_ENTRY_THRESHOLDS],
    productionThresholds: [...PRODUCTION_030_THRESHOLDS],
    feeModel: HISTORICAL_FEE_MODEL,
    captureMfeRMin: CAPTURE_MFE_R_MIN,
    smoke, gridSize: grid.length,
    folds: foldResults,
    aggregatedOos: agg,
  };

  fs.writeFileSync(path.join(RESULTS_DIR, "exit-r1-wfo.json"), JSON.stringify(report, null, 2));

  // CSV: fold results
  const csvLines = ["fold,entryThreshold,trainStart,trainEnd,testStart,testEnd,bestCombo,trainScore,trainTrades,testTrades,testNetPnl,testPF,testExpectancy,testMaxDD,e0TestTrades,e0TestNetPnl,e0TestPF,e0TestMaxDD,cohortGate,cohortMismatches"];
  for (const r of foldResults) {
    csvLines.push([
      r.foldIndex, r.entryThreshold, r.trainStart, r.trainEnd, r.testStart, r.testEnd,
      r.bestCombo, r.trainScore, r.trainTrades,
      r.testTrades, r.testNetPnl.toFixed(2), r.testPF.toFixed(3),
      r.testExpectancy.toFixed(3), r.testMaxDD.toFixed(2),
      r.e0TestTrades, r.e0TestNetPnl.toFixed(2), r.e0TestPF.toFixed(3),
      r.e0TestMaxDD.toFixed(2), r.cohortReproducesE0, r.cohortMismatches,
    ].join(","));
  }
  fs.writeFileSync(path.join(AUDIT_DIR, "exit_r1_wfo_folds.csv"), csvLines.join("\n"));

  // CSV: OOS trades E1 vs E0 (path-dependent)
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
  fs.writeFileSync(path.join(AUDIT_DIR, "FIXED_COHORT_E0_VS_E1.csv"), cohortE0E1Rows.join("\n"));
  fs.writeFileSync(path.join(AUDIT_DIR, "PATH_DEPENDENT_RESULTS.csv"), [tHeader, ...tRows].join("\n"));
  fs.writeFileSync(path.join(AUDIT_DIR, "PRODUCTION_030_RESULTS.csv"), prodRows.join("\n"));

  writeProgress("done", {
    folds: foldResults.length,
    e1OosNet: e1M.net, e1OosPf: e1M.pf,
    e0OosNet: e0M.net, e0OosPf: e0M.pf,
    cohortGateAllPass: agg.cohortGateAllPass,
  });

  console.log("\nWFO_DONE");
  console.log(`E1_OOS: trades=${e1M.n} net=${e1M.net.toFixed(2)} pf=${e1M.pf.toFixed(3)} dd=${e1M.dd.toFixed(2)} exp=${e1M.exp.toFixed(3)} wr=${e1M.wr.toFixed(1)}% capMean=${e1M.captureMean.toFixed(3)}(n=${e1M.captureN}) gbMean=${e1M.givebackMean.toFixed(3)}`);
  console.log(`E0_OOS: trades=${e0M.n} net=${e0M.net.toFixed(2)} pf=${e0M.pf.toFixed(3)} dd=${e0M.dd.toFixed(2)} exp=${e0M.exp.toFixed(3)} wr=${e0M.wr.toFixed(1)}% capMean=${e0M.captureMean.toFixed(3)}(n=${e0M.captureN}) gbMean=${e0M.givebackMean.toFixed(3)}`);
  console.log(`COHORT_GATE=${agg.cohortGateAllPass ? "ALL_PASS" : "FAIL"}`);
  console.log(`FIXED_E0_NET=${fxE0.net.toFixed(2)} FIXED_E1_NET=${fxE1.net.toFixed(2)} FIXED_DELTA_NET=${(fxE1.net - fxE0.net).toFixed(2)}`);
  console.log(`FIXED_E0_PF=${fxE0.pf.toFixed(3)} FIXED_E1_PF=${fxE1.pf.toFixed(3)}`);
  console.log(`FIXED_E0_CAPTURE=${fxE0.captureMean.toFixed(3)} FIXED_E1_CAPTURE=${fxE1.captureMean.toFixed(3)}`);
  console.log(`FIXED_E0_GIVEBACK=${fxE0.givebackMean.toFixed(3)} FIXED_E1_GIVEBACK=${fxE1.givebackMean.toFixed(3)}`);
  console.log(`OUTPUT_DIR=${AUDIT_DIR}`);
}

// ─── Entry guard: only run when invoked as a script (not on test import) ─────

const invokedDirectly = !!process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch(e => { console.error(e); process.exit(1); });
}
