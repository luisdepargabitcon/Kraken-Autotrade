/**
 * runRiskR1Wfo.ts — Risk R1 walk-forward optimization (risk-sizing only).
 *
 * Entry V4 FROZEN (historical thresholds [0.50, 0.30, 0.30] per fold).
 * Exit E0 FROZEN. Initial stop FROZEN. Only effectiveRiskUsd varies:
 *
 *   effectiveRiskUsd = baseRiskUsd × riskMultiplier, 0 < m <= 1.0
 *
 * Policies compared under identical conditions:
 *   R0  — production sizing (multiplier 1.0)
 *   R1  — adaptive reduction (params selected on TRAIN)
 *   U75 — uniform control: every trade × 0.75
 *   U50 — uniform control: every trade × 0.50
 *
 * Fixed-cohort: same entries/exits frozen from the R0 run; only size scales
 * (net scales linearly with volume under pure taker fees — verified by the
 * FIXED_COHORT tests). Path-dependent: full replay per policy where smaller
 * size can change capital/lot availability for later entries.
 *
 * Selection (TRAIN): netToDD = net / max(maxDD, 10) — risk-adjusted, NOT raw PnL.
 *
 * Usage: npx tsx server/services/spot/research/runRiskR1Wfo.ts [--smoke] [--max-combos N]
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { SpotCandle } from "../spotTypes";
import { type ReplayTrade } from "../spotReplayEngine";
import { precomputeFrames, fastReplay, type PrecomputedData, type EntrySnapshot, type RiskScalerInput } from "./fastResearchReplay";
import { type FeeModel } from "../feeModel";
import { DEFAULT_ENTRY_V3_CONFIG, type EntryV3Config } from "../spotEntryV3";
import { DEFAULT_SPOT_EXIT_CONFIG } from "../spotExitPolicy";
import { createRiskScalerR1, uniformScaler, type SpotRiskR1Config } from "./spotAdaptiveRiskR1";
import {
  PAIR_MAPPINGS, loadAllCached, DATA_ROOT, type KrakenOHLCRow,
} from "./krakenHistoricalLoader";

// ─── Constants ──────────────────────────────────────────────────────────────

const HISTORICAL_FEE_MODEL: FeeModel = {
  exchange: "revolutx", takerFeePct: 0.09, makerFeePct: 0.00, quality: "ESTIMATED",
};

const V3_ENABLED: EntryV3Config = { ...DEFAULT_ENTRY_V3_CONFIG, enabled: true };

/** Historical entry threshold per fold (frozen V4 decisions). */
export const HISTORICAL_ENTRY_THRESHOLDS = [0.50, 0.30, 0.30] as const;
export const PRODUCTION_030_THRESHOLDS = [0.30, 0.30, 0.30] as const;
export const EXPECTED_GRID_SIZE = 24;

const DAY_MS = 24 * 60 * 60 * 1000;
const TRAIN_DAYS = 90;
const TEST_DAYS = 30;
const STEP_DAYS = 30;
const MAX_COMBOS_PER_FOLD = 64;
const DD_FLOOR = 10;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIT_DIR = path.join(
  path.dirname(path.dirname(path.dirname(path.dirname(__dirname)))),
  "docs", "auditoria", "2026-09-22-spot-risk-r1",
);
const RESULTS_DIR = path.join(DATA_ROOT, "results");

const ALL_PAIRS = PAIR_MAPPINGS.map(m => m.requested);

// ─── Progress ───────────────────────────────────────────────────────────────

const PROGRESS_PATH = path.join(AUDIT_DIR, "progress.json");
const T_START = Date.now();

function writeProgress(stage: string, extra: Record<string, unknown> = {}): void {
  try {
    fs.writeFileSync(PROGRESS_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(), stage,
      elapsedSec: Math.round((Date.now() - T_START) / 1000), ...extra,
    }, null, 2));
  } catch { /* non-fatal */ }
}

// ─── R1 grid — 24 combos, justified by R0 forensic ──────────────────────────
// Forensic: quality 0.45-0.55 net -268 (PF 0.148); atrPct>=3 net -111 (n=2).
// Factors: A) low quality, B) high volatility. Exposure NOT justified (0 vs 1
// open positions identical PF) — excluded.

interface GridCombo extends SpotRiskR1Config { label: string }

export function buildGrid(): GridCombo[] {
  const grid: GridCombo[] = [];
  const lowQ = [0.45, 0.55];
  const lowQM = [0.5, 0.75];
  const hiAtr = [2.0, 2.5, 3.0];
  const hiVolM = [0.5, 0.75];

  for (const lq of lowQ)
    for (const lqm of lowQM)
      for (const ha of hiAtr)
        for (const hvm of hiVolM)
          grid.push({
            label: `lq${lq}@${lqm}_hv${ha}@${hvm}`,
            lowQualityBelow: lq, lowQualityMult: lqm,
            highAtrPctAbove: ha, highVolMult: hvm,
          });
  if (grid.length !== EXPECTED_GRID_SIZE) {
    throw new Error(`Risk grid must be exactly ${EXPECTED_GRID_SIZE}, got ${grid.length}`);
  }
  return grid;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface PairData {
  pair: string;
  all5m: SpotCandle[]; all15m: SpotCandle[];
  all1h: SpotCandle[]; all4h: SpotCandle[];
}

interface FoldWindow { trainStart: number; trainEnd: number; testStart: number; testEnd: number }

/** Frozen same-entry record: entry context + E0 outcome, for cohort rescale. */
interface FrozenRiskEntry {
  lotId: string; pair: string;
  snapshot: EntrySnapshot;
  e0Net: number; e0R: number; e0MfeR: number; e0MaeR: number;
  e0ExitReason: string; e0ClosedAtMs: number; e0ExitPrice: number;
  e0RiskUsd: number; e0Notional: number; e0Fees: number;
}

interface PolicyMetrics {
  n: number; net: number; pf: number; exp: number; dd: number; netToDD: number;
  wr: number; fees: number; riskDeployed: number; avgRisk: number;
  worstTrade: number; maeMean: number; maeWorst: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toSpotCandle(row: KrakenOHLCRow): SpotCandle {
  return { time: row.timestamp, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume };
}

function iso(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }

function policyMetrics(trades: { netPnlUsd: number; rMultiple: number; mfeR: number; maeR: number; entryFeeUsd: number; exitFeeUsd: number; riskUsd: number; closedAtMs: number }[]): PolicyMetrics {
  const n = trades.length;
  const net = trades.reduce((s, t) => s + t.netPnlUsd, 0);
  const w = trades.filter(t => t.netPnlUsd > 0).reduce((s, t) => s + t.netPnlUsd, 0);
  const l = Math.abs(trades.filter(t => t.netPnlUsd <= 0).reduce((s, t) => s + t.netPnlUsd, 0));
  const sorted = [...trades].sort((a, b) => a.closedAtMs - b.closedAtMs);
  let eq = 10000, peak = 10000, dd = 0;
  for (const t of sorted) { eq += t.netPnlUsd; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const maes = trades.map(t => t.maeR);
  return {
    n, net,
    pf: l > 0 ? w / l : w > 0 ? Infinity : 0,
    exp: n > 0 ? net / n : 0,
    dd, netToDD: net / Math.max(dd, DD_FLOOR),
    wr: n > 0 ? trades.filter(t => t.netPnlUsd > 0).length / n * 100 : 0,
    fees: trades.reduce((s, t) => s + t.entryFeeUsd + t.exitFeeUsd, 0),
    riskDeployed: trades.reduce((s, t) => s + t.riskUsd, 0),
    avgRisk: n > 0 ? trades.reduce((s, t) => s + t.riskUsd, 0) / n : 0,
    worstTrade: n > 0 ? Math.min(...trades.map(t => t.netPnlUsd)) : 0,
    maeMean: n > 0 ? maes.reduce((s, x) => s + x, 0) / n : 0,
    maeWorst: n > 0 ? Math.max(...maes) : 0,
  };
}

/** ReplayTrade extended with riskUsd (from position at entry). */
interface RiskTrade extends ReplayTrade { riskUsd: number; maeR: number }

function replayArgs(pair: string, threshold: number, startMs: number, endMs: number) {
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

/** Run one policy on one pair/window; returns trades with riskUsd + maeR + entry snapshots. */
function runPolicy(
  pre: PrecomputedData, pair: string, threshold: number,
  startMs: number, endMs: number,
  scaler?: (input: RiskScalerInput) => number,
): { trades: RiskTrade[]; entries: Map<string, EntrySnapshot> } {
  const entries = new Map<string, EntrySnapshot>();
  const riskByLot = new Map<string, number>();
  const trades: RiskTrade[] = [];
  fastReplay(pre, replayArgs(pair, threshold, startMs, endMs), undefined, {
    riskScaler: scaler,
    onEntry: (info) => { entries.set(info.lotId, info); riskByLot.set(info.lotId, info.effectiveRiskUsd); },
    onTradeClosed: (pos, trade, metrics) => {
      trades.push({ ...trade, riskUsd: riskByLot.get(pos.lotId) ?? pos.riskUsd, maeR: metrics?.maeR ?? 0 });
    },
  });
  return { trades, entries };
}

// ─── WFO ────────────────────────────────────────────────────────────────────

async function main() {
  const smoke = process.argv.includes("--smoke");
  const maxCombosArg = process.argv.find(a => a.startsWith("--max-combos="));
  const maxCombos = maxCombosArg ? parseInt(maxCombosArg.split("=")[1], 10) : MAX_COMBOS_PER_FOLD;

  if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const datasets = loadAllCached();
  const precomputedMap = new Map<string, PrecomputedData>();
  const pairDataMap = new Map<string, PairData>();
  let intersectEnd = Infinity;
  let intersectStart = -Infinity;

  for (const pair of ALL_PAIRS) {
    const c5 = datasets.get(`${pair}_5m`);
    const c15 = datasets.get(`${pair}_15m`);
    const c60 = datasets.get(`${pair}_60m`);
    const c240 = datasets.get(`${pair}_240m`);
    if (!c5 || !c15 || !c60 || !c240) { console.error(`Missing datasets for ${pair}`); continue; }
    pairDataMap.set(pair, {
      pair,
      all5m: c5.rows.map(toSpotCandle), all15m: c15.rows.map(toSpotCandle),
      all1h: c60.rows.map(toSpotCandle), all4h: c240.rows.map(toSpotCandle),
    });
    intersectStart = Math.max(intersectStart, c5.firstTimestamp);
    intersectEnd = Math.min(intersectEnd, c5.lastTimestamp);
    const t0 = Date.now();
    writeProgress("precompute", { pair });
    precomputedMap.set(pair, precomputeFrames(pair, {
      pair, candles5m: pairDataMap.get(pair)!.all5m, candles15m: pairDataMap.get(pair)!.all15m,
      candles1h: pairDataMap.get(pair)!.all1h, candles4h: pairDataMap.get(pair)!.all4h,
    }, V3_ENABLED));
    console.log(`[${pair}] precomputed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  if (precomputedMap.size === 0) { console.error("No datasets"); process.exit(1); }

  const grid = buildGrid().slice(0, maxCombos);
  console.log(`GRID=${grid.length} risk combos/fold (balanced ${EXPECTED_GRID_SIZE}, cap ${MAX_COMBOS_PER_FOLD})`);
  console.log(`HISTORICAL_ENTRY_THRESHOLDS=${HISTORICAL_ENTRY_THRESHOLDS.join(",")}`);

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
  folds.reverse();

  const gridRows: string[] = ["fold,entryThreshold,combo,trainTrades,trainNet,trainPF,trainDD,trainNetToDD,isBest"];
  const foldRows: string[] = ["fold,entryThreshold,trainStart,trainEnd,testStart,testEnd,bestCombo,trainNetToDD,trainTrades,r0Trades,r0Net,r0PF,r0DD,r0NetToDD,r1Trades,r1Net,r1PF,r1DD,r1NetToDD,u75Trades,u75Net,u75PF,u75DD,u75NetToDD,u50Trades,u50Net,u50PF,u50DD,u50NetToDD"];
  const pathRows: string[] = ["policy,fold,pair,lotId,exitReason,entryPrice,exitPrice,volume,riskUsd,grossPnlUsd,entryFeeUsd,exitFeeUsd,netPnlUsd,rMultiple,mfeR,maeR,holdTimeMinutes,openedAtMs,closedAtMs"];
  const fixedRows: string[] = ["fold,pair,lotId,entryTime,entryPrice,stopDistanceUsd,r0RiskUsd,r1Multiplier,r1RiskUsd,r0Net,r1Net,u75Net,u50Net,rMultiple,mfeR,maeR,e0ExitReason"];
  const uniformRows: string[] = ["policy,fold,pair,trades,net,pf,expectancy,maxDD,netToDD,fees,riskDeployed,avgRisk,worstTrade"];
  const prodRows: string[] = ["policy,fold,pair,trades,net,pf,expectancy,maxDD,netToDD,fees,riskDeployed,avgRisk,worstTrade"];

  const allByPolicy: Record<"R0" | "R1" | "U75" | "U50", RiskTrade[]> = { R0: [], R1: [], U75: [], U50: [] };
  const fixedAll: { pol: string; net: number; closedAtMs: number; rMultiple: number; mfeR: number; maeR: number; riskUsd: number; fees: number }[] = [];
  const selectedByFold: GridCombo[] = [];
  let foldCohortOk = true;

  const totalComboRuns = folds.length * grid.length;
  let combosDone = 0;

  for (let f = 0; f < folds.length; f++) {
    const fw = folds[f];
    const thr = HISTORICAL_ENTRY_THRESHOLDS[f] ?? 0.30;
    console.log(`\n=== FOLD ${f}: ENTRY_THRESHOLD=${thr} | train ${iso(fw.trainStart)}→${iso(fw.trainEnd)} | test ${iso(fw.testStart)}→${iso(fw.testEnd)} ===`);

    // ── TRAIN: grid search on risk params only ──
    let bestScore = -Infinity, bestCombo: GridCombo = grid[0], bestTrainN = 0;
    const foldGrid: string[] = [];
    for (const combo of grid) {
      const scaler = createRiskScalerR1(combo);
      const trainTrades: RiskTrade[] = [];
      for (const pair of ALL_PAIRS) {
        const pre = precomputedMap.get(pair);
        if (!pre) continue;
        trainTrades.push(...runPolicy(pre, pair, thr, fw.trainStart, fw.trainEnd, scaler).trades);
      }
      const m = policyMetrics(trainTrades);
      const score = m.n > 0 ? m.netToDD : -Infinity;
      if (score > bestScore) { bestScore = score; bestCombo = combo; bestTrainN = m.n; }
      foldGrid.push(`${f},${thr},${combo.label},${m.n},${m.net.toFixed(2)},${m.pf.toFixed(3)},${m.dd.toFixed(2)},${m.netToDD.toFixed(3)},BESTFLAG`);
      combosDone++;
      const elapsedSec = (Date.now() - T_START) / 1000;
      const etaSec = combosDone > 0 ? Math.round(elapsedSec / combosDone * (totalComboRuns - combosDone)) : null;
      writeProgress("grid", { fold: f, entryThreshold: thr, combination: combosDone % grid.length || grid.length, foldCombos: grid.length, combosDone, totalComboRuns, etaSec, bestCombo: bestCombo.label, bestScore });
    }
    console.log(`BEST=${bestCombo.label} netToDD=${bestScore.toFixed(3)}`);
    for (const row of foldGrid) gridRows.push(row.replace("BESTFLAG", row.startsWith(`${f},${thr},${bestCombo.label},`) ? "1" : "0"));
    selectedByFold.push(bestCombo);

    // ── TEST: 4 policies, same window ──
    writeProgress("test", { fold: f, bestCombo: bestCombo.label });
    const policyTrades: Record<"R0" | "R1" | "U75" | "U50", RiskTrade[]> = { R0: [], R1: [], U75: [], U50: [] };

    for (const pair of ALL_PAIRS) {
      const pre = precomputedMap.get(pair);
      if (!pre) continue;

      const r0 = runPolicy(pre, pair, thr, fw.testStart, fw.testEnd);
      const r1 = runPolicy(pre, pair, thr, fw.testStart, fw.testEnd, createRiskScalerR1(bestCombo));
      const u75 = runPolicy(pre, pair, thr, fw.testStart, fw.testEnd, uniformScaler(0.75));
      const u50 = runPolicy(pre, pair, thr, fw.testStart, fw.testEnd, uniformScaler(0.50));
      policyTrades.R0.push(...r0.trades); policyTrades.R1.push(...r1.trades);
      policyTrades.U75.push(...u75.trades); policyTrades.U50.push(...u50.trades);

      // path-dependent trade rows
      for (const [pol, tt] of [["R0", r0.trades], ["R1", r1.trades], ["U75", u75.trades], ["U50", u50.trades]] as const) {
        for (const t of tt) {
          pathRows.push([pol, f, pair, t.lotId, t.exitReason, t.entryPrice, t.exitPrice, t.volume,
            t.riskUsd, t.grossPnlUsd, t.entryFeeUsd, t.exitFeeUsd, t.netPnlUsd,
            t.rMultiple, t.mfeR, t.maeR, t.holdTimeMinutes, t.openedAtMs, t.closedAtMs].join(","));
        }
      }

      // ── FIXED COHORT: frozen R0 entries; rescale only ──
      for (const t of r0.trades) {
        const snap = r0.entries.get(t.lotId);
        if (!snap) { foldCohortOk = false; console.warn(`missing snapshot ${t.lotId}`); continue; }
        const m1 = Math.min(1, Math.max(0, createRiskScalerR1(bestCombo)(snap)));
        const r1Net = t.netPnlUsd * m1;
        fixedRows.push([f, pair, t.lotId, t.openedAtMs, t.entryPrice, snap.stopDistanceUsd,
          snap.effectiveRiskUsd, m1.toFixed(3), (snap.effectiveRiskUsd * m1).toFixed(2),
          t.netPnlUsd.toFixed(2), r1Net.toFixed(2), (t.netPnlUsd * 0.75).toFixed(2), (t.netPnlUsd * 0.5).toFixed(2),
          t.rMultiple, t.mfeR, t.maeR, t.exitReason].join(","));
        const base = { closedAtMs: t.closedAtMs, rMultiple: t.rMultiple, mfeR: t.mfeR, maeR: t.maeR };
        fixedAll.push({ pol: "R0", net: t.netPnlUsd, riskUsd: snap.effectiveRiskUsd, fees: t.entryFeeUsd + t.exitFeeUsd, ...base });
        fixedAll.push({ pol: "R1", net: r1Net, riskUsd: snap.effectiveRiskUsd * m1, fees: (t.entryFeeUsd + t.exitFeeUsd) * m1, ...base });
        fixedAll.push({ pol: "U75", net: t.netPnlUsd * 0.75, riskUsd: snap.effectiveRiskUsd * 0.75, fees: (t.entryFeeUsd + t.exitFeeUsd) * 0.75, ...base });
        fixedAll.push({ pol: "U50", net: t.netPnlUsd * 0.5, riskUsd: snap.effectiveRiskUsd * 0.5, fees: (t.entryFeeUsd + t.exitFeeUsd) * 0.5, ...base });
      }
    }

    for (const pol of ["R0", "R1", "U75", "U50"] as const) allByPolicy[pol].push(...policyTrades[pol]);

    const mR0 = policyMetrics(policyTrades.R0), mR1 = policyMetrics(policyTrades.R1);
    const mU75 = policyMetrics(policyTrades.U75), mU50 = policyMetrics(policyTrades.U50);
    foldRows.push([f, thr, iso(fw.trainStart), iso(fw.trainEnd), iso(fw.testStart), iso(fw.testEnd),
      bestCombo.label, bestScore.toFixed(3), bestTrainN,
      mR0.n, mR0.net.toFixed(2), mR0.pf.toFixed(3), mR0.dd.toFixed(2), mR0.netToDD.toFixed(3),
      mR1.n, mR1.net.toFixed(2), mR1.pf.toFixed(3), mR1.dd.toFixed(2), mR1.netToDD.toFixed(3),
      mU75.n, mU75.net.toFixed(2), mU75.pf.toFixed(3), mU75.dd.toFixed(2), mU75.netToDD.toFixed(3),
      mU50.n, mU50.net.toFixed(2), mU50.pf.toFixed(3), mU50.dd.toFixed(2), mU50.netToDD.toFixed(3),
    ].join(","));

    console.log(`FOLD ${f} TEST: R0=${mR0.net.toFixed(2)}/${mR0.pf.toFixed(2)} R1=${mR1.net.toFixed(2)}/${mR1.pf.toFixed(2)} U75=${mU75.net.toFixed(2)} U50=${mU50.net.toFixed(2)}`);

    // uniform controls per pair (this fold)
    for (const [pol, tt] of [["U75", policyTrades.U75], ["U50", policyTrades.U50]] as const) {
      for (const pair of ALL_PAIRS) {
        const pt = tt.filter(t => t.pair === pair);
        if (pt.length === 0) continue;
        const m = policyMetrics(pt);
        uniformRows.push([pol, f, pair, m.n, m.net.toFixed(2), m.pf.toFixed(3), m.exp.toFixed(3), m.dd.toFixed(2), m.netToDD.toFixed(3), m.fees.toFixed(2), m.riskDeployed.toFixed(2), m.avgRisk.toFixed(2), m.worstTrade.toFixed(2)].join(","));
      }
    }
  }

  // ─── PRODUCTION_FIXED_030: secondary, params from historical WFO ──
  if (!smoke) {
    writeProgress("production030");
    const prodAll: Record<string, RiskTrade[]> = { R0: [], R1: [], U75: [], U50: [] };
    for (let f = 0; f < folds.length; f++) {
      const fw = folds[f];
      const combo = selectedByFold[f];
      for (const pair of ALL_PAIRS) {
        const pre = precomputedMap.get(pair);
        if (!pre) continue;
        const r0 = runPolicy(pre, pair, 0.30, fw.testStart, fw.testEnd);
        const r1 = runPolicy(pre, pair, 0.30, fw.testStart, fw.testEnd, createRiskScalerR1(combo));
        const u75 = runPolicy(pre, pair, 0.30, fw.testStart, fw.testEnd, uniformScaler(0.75));
        const u50 = runPolicy(pre, pair, 0.30, fw.testStart, fw.testEnd, uniformScaler(0.50));
        for (const [pol, tt] of [["R0", r0.trades], ["R1", r1.trades], ["U75", u75.trades], ["U50", u50.trades]] as const) {
          prodAll[pol].push(...tt);
          const m = policyMetrics(tt);
          prodRows.push([pol, f, pair, m.n, m.net.toFixed(2), m.pf.toFixed(3), m.exp.toFixed(3), m.dd.toFixed(2), m.netToDD.toFixed(3), m.fees.toFixed(2), m.riskDeployed.toFixed(2), m.avgRisk.toFixed(2), m.worstTrade.toFixed(2)].join(","));
        }
      }
    }
    for (const pol of ["R0", "R1", "U75", "U50"]) {
      const m = policyMetrics(prodAll[pol]);
      prodRows.push([pol, "ALL", "ALL", m.n, m.net.toFixed(2), m.pf.toFixed(3), m.exp.toFixed(3), m.dd.toFixed(2), m.netToDD.toFixed(3), m.fees.toFixed(2), m.riskDeployed.toFixed(2), m.avgRisk.toFixed(2), m.worstTrade.toFixed(2)].join(","));
      console.log(`PRODUCTION_030_${pol}_NET=${m.net.toFixed(2)} PF=${m.pf.toFixed(3)} DD=${m.dd.toFixed(2)} NET_DD=${m.netToDD.toFixed(3)}`);
    }
  }

  // ─── Aggregates ──
  const aggM: Record<string, PolicyMetrics> = {};
  for (const pol of ["R0", "R1", "U75", "U50"] as const) {
    aggM[pol] = policyMetrics(allByPolicy[pol]);
    console.log(`${pol}_OOS: trades=${aggM[pol].n} net=${aggM[pol].net.toFixed(2)} pf=${aggM[pol].pf.toFixed(3)} dd=${aggM[pol].dd.toFixed(2)} netDD=${aggM[pol].netToDD.toFixed(3)} risk=${aggM[pol].riskDeployed.toFixed(0)} avgRisk=${aggM[pol].avgRisk.toFixed(2)} worst=${aggM[pol].worstTrade.toFixed(2)} maeMean=${aggM[pol].maeMean.toFixed(3)}`);
  }
  for (const pol of ["R0", "R1", "U75", "U50"]) {
    const rows = fixedAll.filter(r => r.pol === pol);
    const net = rows.reduce((s, r) => s + r.net, 0);
    const risk = rows.reduce((s, r) => s + r.riskUsd, 0);
    console.log(`FIXED_${pol}_NET=${net.toFixed(2)} RISK=${risk.toFixed(2)}`);
  }
  console.log(`FIXED_COHORT_PASS=${foldCohortOk ? "YES" : "NO"}`);

  // avg multiplier for R1 (fixed cohort)
  const r1Mults = fixedRows.slice(1).map(r => parseFloat(r.split(",")[7]));
  const avgMult = r1Mults.length ? r1Mults.reduce((a, b) => a + b, 0) / r1Mults.length : 1;
  console.log(`R1_AVG_RISK_MULTIPLIER=${avgMult.toFixed(3)}`);

  fs.writeFileSync(path.join(RESULTS_DIR, "risk-r1-wfo.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    historicalEntryThresholds: [...HISTORICAL_ENTRY_THRESHOLDS],
    gridSize: grid.length, smoke,
    selectedByFold: selectedByFold.map(c => c.label),
    oos: Object.fromEntries(Object.entries(aggM).map(([k, m]) => [k, m])),
    r1AvgMultiplier: avgMult,
    fixedCohortPass: foldCohortOk,
  }, null, 2));

  fs.writeFileSync(path.join(AUDIT_DIR, "R1_GRID_RESULTS.csv"), gridRows.join("\n"));
  fs.writeFileSync(path.join(AUDIT_DIR, "R1_WFO_RESULTS.csv"), foldRows.join("\n"));
  fs.writeFileSync(path.join(AUDIT_DIR, "FIXED_COHORT_RISK_RESULTS.csv"), fixedRows.join("\n"));
  fs.writeFileSync(path.join(AUDIT_DIR, "PATH_DEPENDENT_RISK_RESULTS.csv"), pathRows.join("\n"));
  fs.writeFileSync(path.join(AUDIT_DIR, "UNIFORM_RISK_CONTROLS.csv"), uniformRows.join("\n"));
  fs.writeFileSync(path.join(AUDIT_DIR, "PRODUCTION_030_RISK_RESULTS.csv"), prodRows.join("\n"));

  writeProgress("done", { folds: folds.length, r1AvgMultiplier: avgMult, r0Net: aggM.R0.net, r1Net: aggM.R1.net });
  console.log("\nWFO_DONE");
  console.log(`OUTPUT_DIR=${AUDIT_DIR}`);
}

const invokedDirectly = !!process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch(e => { console.error(e); process.exit(1); });
}
