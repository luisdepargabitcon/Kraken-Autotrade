/**
 * runExitR1Forensic.ts — Exit R1 forensic runner for baseline E0.
 *
 * Runs the PATH-DEPENDENT replay with the frozen E0 exit policy
 * (DEFAULT_SPOT_EXIT_CONFIG, production evaluateExit) over the full
 * historical dataset, capturing per-trade forensic metrics:
 *
 *   - MFE / MAE (USD and R), profit capture %, giveback (MFE - exit R)
 *   - R-multiple at fixed horizons after entry (15m/30m/1h/2h/6h)
 *   - timeSinceLastMfe at exit (post-processed from 5m candles)
 *   - grouped breakdowns: pair, exit reason, regime, setupTag, capture class
 *
 * Outputs CSVs + JSON summary into docs/auditoria/2026-09-20-exit-position-management-r1/.
 *
 * Usage: npx tsx server/services/spot/research/runExitR1Forensic.ts [--smoke]
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { SpotCandle, SpotPosition } from "../spotTypes";
import { type ReplayConfig, type ReplayTrade } from "../spotReplayEngine";
import { precomputeFrames, fastReplay, type PrecomputedData, type FastReplayOpts } from "./fastResearchReplay";
import { type FeeModel } from "../feeModel";
import { DEFAULT_ENTRY_V3_CONFIG, type EntryV3Config } from "../spotEntryV3";
import { DEFAULT_SPOT_EXIT_CONFIG } from "../spotExitPolicy";
import {
  PAIR_MAPPINGS,
  loadAllCached,
  DATA_ROOT,
  type KrakenOHLCRow,
} from "./krakenHistoricalLoader";

// ─── Constants ──────────────────────────────────────────────────────────────

const HISTORICAL_FEE_MODEL: FeeModel = {
  exchange: "revolutx",
  takerFeePct: 0.09,
  makerFeePct: 0.00,
  quality: "ESTIMATED",
};

const V3_ENABLED: EntryV3Config = { ...DEFAULT_ENTRY_V3_CONFIG, enabled: true };
const V4_THRESHOLD = 0.30; // production Entry V4 threshold (frozen)

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIT_DIR = path.join(
  path.dirname(path.dirname(path.dirname(path.dirname(__dirname)))),
  "docs", "auditoria", "2026-09-20-exit-position-management-r1",
);

const ALL_PAIRS = PAIR_MAPPINGS.map(m => m.requested);
const HORIZONS_MIN = [15, 30, 60, 120, 360];

// ─── Types ──────────────────────────────────────────────────────────────────

interface PairData {
  pair: string;
  all5m: SpotCandle[];
  all15m: SpotCandle[];
  all1h: SpotCandle[];
  all4h: SpotCandle[];
}

export interface ForensicTrade {
  pair: string;
  lotId: string;
  signalId: string;
  setupTag: string;
  regimeAtEntry: string;
  directionAtEntry: string;
  entryPrice: number;
  exitPrice: number;
  volume: number;
  entryFeeUsd: number;
  exitFeeUsd: number;
  grossPnlUsd: number;
  netPnlUsd: number;
  rMultiple: number;
  exitReason: string;
  openedAtMs: number;
  closedAtMs: number;
  holdTimeMinutes: number;
  mfeUsd: number;
  maeUsd: number;
  mfeR: number;
  maeR: number;
  profitCapturePct: number | null;
  profitCaptureClass: string;
  givebackR: number;           // mfeR - rMultiple (positive = gave back)
  timeSinceLastMfeMin: number; // minutes between last new-high and exit
  rAt15m: number | null;
  rAt30m: number | null;
  rAt60m: number | null;
  rAt120m: number | null;
  rAt360m: number | null;
  // Frozen entry snapshot (for fixed-cohort replay)
  initialStopPrice: number;
  initialStopDistanceUsd: number;
  riskUsd: number;
  notionalUsd: number;
  entryFee: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toSpotCandle(row: KrakenOHLCRow): SpotCandle {
  return { time: row.timestamp, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume };
}

function netPF(trades: { netPnlUsd: number }[]): number {
  const netWin = trades.filter(t => t.netPnlUsd > 0).reduce((s, t) => s + t.netPnlUsd, 0);
  const netLoss = Math.abs(trades.filter(t => t.netPnlUsd <= 0).reduce((s, t) => s + t.netPnlUsd, 0));
  return netLoss > 0 ? netWin / netLoss : netWin > 0 ? Infinity : 0;
}

function maxDrawdown(trades: { netPnlUsd: number }[], initialCapital = 10000): number {
  let equity = initialCapital, peak = initialCapital, maxDD = 0;
  for (const t of trades) {
    equity += t.netPnlUsd;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
  }
  return maxDD;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function avg(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Post-process a closed trade against 5m candles: R at horizons + time since last MFE. */
function enrichTrade(
  trade: ReplayTrade,
  pos: SpotPosition,
  candles5m: SpotCandle[],
): Pick<ForensicTrade, "rAt15m" | "rAt30m" | "rAt60m" | "rAt120m" | "rAt360m" | "timeSinceLastMfeMin" | "givebackR" | "maeR"> {
  const risk = pos.initialStopDistanceUsd;
  const rOf = (price: number) => risk > 0 ? (price - pos.entryPrice) / risk : 0;

  const horizons: (number | null)[] = HORIZONS_MIN.map(min => {
    const target = pos.openedAt + min * 60000;
    // last closed 5m candle at or before target
    let price: number | null = null;
    for (const c of candles5m) {
      if (c.time > target) break;
      if (c.time >= pos.openedAt) price = c.close;
    }
    return price !== null ? rOf(price) : null;
  });

  // time since last MFE: scan candles in [openedAt, closedAt], track running max close
  let maxPrice = pos.entryPrice;
  let lastMfeAt = pos.openedAt;
  let minPrice = pos.entryPrice;
  for (const c of candles5m) {
    if (c.time < pos.openedAt) continue;
    if (c.time > trade.closedAtMs) break;
    if (c.high > maxPrice) { maxPrice = c.high; lastMfeAt = c.time; }
    if (c.low < minPrice) minPrice = c.low;
  }

  const mfeR = trade.mfeR;
  return {
    rAt15m: horizons[0], rAt30m: horizons[1], rAt60m: horizons[2],
    rAt120m: horizons[3], rAt360m: horizons[4],
    timeSinceLastMfeMin: (trade.closedAtMs - lastMfeAt) / 60000,
    givebackR: mfeR - trade.rMultiple,
    maeR: risk > 0 ? (minPrice - pos.entryPrice) / risk : 0,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const smoke = process.argv.includes("--smoke");
  if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });

  const datasets = loadAllCached();
  const forensic: ForensicTrade[] = [];
  const pairSummaries: Record<string, any>[] = [];

  for (const pair of ALL_PAIRS) {
    const c5 = datasets.get(`${pair}_5m`);
    const c15 = datasets.get(`${pair}_15m`);
    const c60 = datasets.get(`${pair}_60m`);
    const c240 = datasets.get(`${pair}_240m`);
    if (!c5 || !c15 || !c60 || !c240) { console.error(`Missing datasets for ${pair}`); continue; }

    const pd: PairData = {
      pair,
      all5m: c5.rows.map(toSpotCandle),
      all15m: c15.rows.map(toSpotCandle),
      all1h: c60.rows.map(toSpotCandle),
      all4h: c240.rows.map(toSpotCandle),
    };

    // Smoke: last 60 days only
    const evalStart = smoke ? pd.all5m[pd.all5m.length - 1].time - 60 * 86400000 : undefined;

    const precomputed: PrecomputedData = precomputeFrames(
      pair,
      { pair, candles5m: pd.all5m, candles15m: pd.all15m, candles1h: pd.all1h, candles4h: pd.all4h },
      V3_ENABLED,
    );

    const posByLot = new Map<string, SpotPosition>();
    const opts: FastReplayOpts = {
      onTradeClosed: (pos, trade, metrics) => {
        posByLot.set(pos.lotId, pos);
      },
    };

    const config: ReplayConfig = {
      pair,
      availableCapitalUsd: 10000,
      exitConfig: DEFAULT_SPOT_EXIT_CONFIG, // E0 frozen
      entryV3Config: V3_ENABLED,
      v4MinQualityScore: V4_THRESHOLD,
      feeModel: HISTORICAL_FEE_MODEL,
      evaluationStartMs: evalStart,
      maxConcurrentPositions: 2,
    };

    const t0 = Date.now();
    const result = fastReplay(precomputed, config, undefined, opts);
    console.log(`[${pair}] E0 replay: ${result.trades.length} trades in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    for (const trade of result.trades) {
      const pos = posByLot.get(trade.lotId);
      if (!pos) continue;
      const extra = enrichTrade(trade, pos, pd.all5m);
      forensic.push({
        pair: trade.pair, lotId: trade.lotId, signalId: trade.signalId,
        setupTag: trade.setupTag, regimeAtEntry: trade.regimeAtEntry,
        directionAtEntry: trade.directionAtEntry,
        entryPrice: trade.entryPrice, exitPrice: trade.exitPrice,
        volume: trade.volume,
        entryFeeUsd: trade.entryFeeUsd, exitFeeUsd: trade.exitFeeUsd,
        grossPnlUsd: trade.grossPnlUsd, netPnlUsd: trade.netPnlUsd,
        rMultiple: trade.rMultiple, exitReason: trade.exitReason,
        openedAtMs: trade.openedAtMs, closedAtMs: trade.closedAtMs,
        holdTimeMinutes: trade.holdTimeMinutes,
        mfeUsd: trade.mfeUsd, maeUsd: trade.maeUsd, mfeR: trade.mfeR,
        maeR: extra.maeR,
        profitCapturePct: trade.profitCapturePct,
        profitCaptureClass: trade.profitCaptureClass,
        givebackR: extra.givebackR,
        timeSinceLastMfeMin: extra.timeSinceLastMfeMin,
        rAt15m: extra.rAt15m, rAt30m: extra.rAt30m, rAt60m: extra.rAt60m,
        rAt120m: extra.rAt120m, rAt360m: extra.rAt360m,
        initialStopPrice: pos.initialStopPrice,
        initialStopDistanceUsd: pos.initialStopDistanceUsd,
        riskUsd: pos.riskUsd, notionalUsd: pos.notionalUsd,
        entryFee: pos.entryFee,
      });
    }

    pairSummaries.push({
      pair, trades: result.trades.length,
      netPnl: result.stats.netPnlUsd, pf: result.stats.profitFactor,
      winRate: result.stats.winRate, maxDD: result.stats.maxDrawdownUsd,
    });
  }

  // ─── CSV: per-trade forensic ──
  const header = "pair,lotId,signalId,setupTag,regimeAtEntry,directionAtEntry,entryPrice,exitPrice,volume,entryFeeUsd,exitFeeUsd,grossPnlUsd,netPnlUsd,rMultiple,exitReason,openedAtMs,closedAtMs,holdTimeMinutes,mfeUsd,maeUsd,mfeR,maeR,profitCapturePct,profitCaptureClass,givebackR,timeSinceLastMfeMin,rAt15m,rAt30m,rAt60m,rAt120m,rAt360m,initialStopPrice,initialStopDistanceUsd,riskUsd,notionalUsd,entryFee";
  const rows = forensic.map(t => [
    t.pair, t.lotId, t.signalId, t.setupTag, t.regimeAtEntry, t.directionAtEntry,
    t.entryPrice, t.exitPrice, t.volume, t.entryFeeUsd, t.exitFeeUsd,
    t.grossPnlUsd, t.netPnlUsd, t.rMultiple, t.exitReason,
    t.openedAtMs, t.closedAtMs, t.holdTimeMinutes,
    t.mfeUsd, t.maeUsd, t.mfeR, t.maeR,
    t.profitCapturePct ?? "", t.profitCaptureClass, t.givebackR,
    t.timeSinceLastMfeMin.toFixed(1),
    t.rAt15m ?? "", t.rAt30m ?? "", t.rAt60m ?? "", t.rAt120m ?? "", t.rAt360m ?? "",
    t.initialStopPrice, t.initialStopDistanceUsd, t.riskUsd, t.notionalUsd, t.entryFee,
  ].join(","));
  fs.writeFileSync(path.join(AUDIT_DIR, "e0_forensic_trades.csv"), [header, ...rows].join("\n"));

  // ─── Grouped breakdowns ──
  const groups: Record<string, (t: ForensicTrade) => string> = {
    by_pair: t => t.pair,
    by_exit_reason: t => t.exitReason,
    by_regime: t => t.regimeAtEntry,
    by_setup: t => t.setupTag,
    by_capture_class: t => t.profitCaptureClass,
  };
  const groupLines: string[] = ["group,key,trades,netPnl,pf,winRate,avgR,medianR,avgMfeR,avgGivebackR,avgCapturePct,avgHoldMin,avgStaleMin"];
  for (const [gname, keyFn] of Object.entries(groups)) {
    const buckets = new Map<string, ForensicTrade[]>();
    for (const t of forensic) {
      const k = keyFn(t);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(t);
    }
    for (const [k, ts] of [...buckets.entries()].sort()) {
      const wins = ts.filter(t => t.netPnlUsd > 0).length;
      groupLines.push([
        gname, k, ts.length,
        ts.reduce((s, t) => s + t.netPnlUsd, 0).toFixed(2),
        netPF(ts).toFixed(3),
        (wins / ts.length * 100).toFixed(1),
        avg(ts.map(t => t.rMultiple)).toFixed(3),
        median(ts.map(t => t.rMultiple)).toFixed(3),
        avg(ts.map(t => t.mfeR)).toFixed(3),
        avg(ts.map(t => t.givebackR)).toFixed(3),
        avg(ts.map(t => t.profitCapturePct ?? 0)).toFixed(1),
        avg(ts.map(t => t.holdTimeMinutes)).toFixed(0),
        avg(ts.map(t => t.timeSinceLastMfeMin)).toFixed(0),
      ].join(","));
    }
  }
  fs.writeFileSync(path.join(AUDIT_DIR, "e0_forensic_groups.csv"), groupLines.join("\n"));

  // ─── JSON summary ──
  const summary = {
    generatedAt: new Date().toISOString(),
    policy: "E0 (DEFAULT_SPOT_EXIT_CONFIG, production evaluateExit)",
    v4Threshold: V4_THRESHOLD,
    feeModel: HISTORICAL_FEE_MODEL,
    smoke,
    totalTrades: forensic.length,
    netPnl: forensic.reduce((s, t) => s + t.netPnlUsd, 0),
    pf: netPF(forensic),
    maxDD: maxDrawdown(forensic),
    avgGivebackR: avg(forensic.map(t => t.givebackR)),
    avgMfeR: avg(forensic.map(t => t.mfeR)),
    avgCapturePct: avg(forensic.map(t => t.profitCapturePct ?? 0)),
    pairSummaries,
  };
  fs.writeFileSync(path.join(AUDIT_DIR, "e0_forensic_summary.json"), JSON.stringify(summary, null, 2));

  console.log(`FORENSIC_DONE trades=${forensic.length} netPnl=${summary.netPnl.toFixed(2)} pf=${summary.pf.toFixed(3)} avgGivebackR=${summary.avgGivebackR.toFixed(3)}`);
  console.log(`OUTPUT_DIR=${AUDIT_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
