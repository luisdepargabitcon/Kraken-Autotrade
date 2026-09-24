/**
 * runRiskR1Forensic.ts — R0 forensic for Risk R1.
 *
 * Replays the CURRENT baseline (Entry V4 @0.30 + E0 exits + R0 sizing) over the
 * full dataset window and records, per trade, the entry-time risk context and
 * the final outcome. Produces:
 *
 *   R0_FORENSIC.csv       — one row per trade (entry context + outcome)
 *   R0_RISK_BUCKETS.csv   — grouped risk concentration analysis
 *
 * No parameters are modified: this is a pure measurement of R0.
 *
 * Usage: DATABASE_URL=... npx tsx server/services/spot/research/runRiskR1Forensic.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { SpotCandle } from "../spotTypes";
import { type ReplayTrade } from "../spotReplayEngine";
import { precomputeFrames, fastReplay, type EntrySnapshot } from "./fastResearchReplay";
import { type FeeModel } from "../feeModel";
import { DEFAULT_ENTRY_V3_CONFIG, type EntryV3Config } from "../spotEntryV3";
import { DEFAULT_SPOT_EXIT_CONFIG } from "../spotExitPolicy";
import { DEFAULT_SPOT_RISK_CONFIG } from "../spotRiskManager";
import {
  PAIR_MAPPINGS, loadAllCached, type KrakenOHLCRow,
} from "./krakenHistoricalLoader";

const HISTORICAL_FEE_MODEL: FeeModel = {
  exchange: "revolutx", takerFeePct: 0.09, makerFeePct: 0.00, quality: "ESTIMATED",
};
const V3_ENABLED: EntryV3Config = { ...DEFAULT_ENTRY_V3_CONFIG, enabled: true };
const PRODUCTION_V4_THRESHOLD = 0.30;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIT_DIR = path.join(
  path.dirname(path.dirname(path.dirname(path.dirname(__dirname)))),
  "docs", "auditoria", "2026-09-22-spot-risk-r1",
);

const ALL_PAIRS = PAIR_MAPPINGS.map(m => m.requested);

function toSpotCandle(row: KrakenOHLCRow): SpotCandle {
  return { time: row.timestamp, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume };
}

interface ForensicRow extends EntrySnapshot {
  exitReason: string; netPnlUsd: number; rMultiple: number;
  mfeR: number; maeR: number; holdTimeMinutes: number; closedAtMs: number;
}

function bucket(v: number, edges: number[]): string {
  for (const e of edges) if (v < e) return `<${e}`;
  return `>=${edges[edges.length - 1]}`;
}

async function main() {
  if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });

  const datasets = loadAllCached();
  const rows: ForensicRow[] = [];

  for (const pair of ALL_PAIRS) {
    const c5 = datasets.get(`${pair}_5m`);
    const c15 = datasets.get(`${pair}_15m`);
    const c60 = datasets.get(`${pair}_60m`);
    const c240 = datasets.get(`${pair}_240m`);
    if (!c5 || !c15 || !c60 || !c240) { console.error(`Missing datasets for ${pair}`); continue; }

    const pre = precomputeFrames(pair, {
      pair,
      candles5m: c5.rows.map(toSpotCandle), candles15m: c15.rows.map(toSpotCandle),
      candles1h: c60.rows.map(toSpotCandle), candles4h: c240.rows.map(toSpotCandle),
    }, V3_ENABLED);

    const entries = new Map<string, EntrySnapshot>();
    fastReplay(pre, {
      pair, availableCapitalUsd: 10000,
      exitConfig: DEFAULT_SPOT_EXIT_CONFIG,
      entryV3Config: V3_ENABLED,
      v4MinQualityScore: PRODUCTION_V4_THRESHOLD,
      feeModel: HISTORICAL_FEE_MODEL,
      maxConcurrentPositions: 2,
    }, undefined, {
      onEntry: (info) => entries.set(info.lotId, info),
      onTradeClosed: (pos, trade: ReplayTrade, metrics) => {
        const e = entries.get(pos.lotId);
        if (!e) return;
        rows.push({
          ...e,
          exitReason: trade.exitReason, netPnlUsd: trade.netPnlUsd,
          rMultiple: trade.rMultiple, mfeR: trade.mfeR,
          maeR: metrics?.maeR ?? 0, holdTimeMinutes: trade.holdTimeMinutes,
          closedAtMs: trade.closedAtMs,
        });
      },
    });
    console.log(`[${pair}] forensic entries=${entries.size}`);
  }

  // ── R0_FORENSIC.csv ──
  const header = [
    "pair", "openedAtMs", "entryPrice", "baseRiskUsd", "effectiveRiskUsd", "riskMultiplier",
    "notionalUsd", "stopDistanceUsd", "initialStopPrice",
    "v4Quality", "v4Impulse", "v4Retracement", "v4Structure", "v4Reclaim", "v4Resumption",
    "regime", "direction", "adx", "atrPct", "spreadPct", "setupTag",
    "openPositions", "openLotsForPair", "openRiskUsd",
    "exitReason", "netPnlUsd", "rMultiple", "mfeR", "maeR", "holdTimeMinutes", "closedAtMs",
  ];
  const csv = [header.join(",")];
  for (const r of rows) {
    csv.push([
      r.pair, r.evaluationTime, r.entryPrice, r.baseRiskUsd, r.effectiveRiskUsd, r.riskMultiplier,
      r.notionalUsd, r.stopDistanceUsd, r.initialStopPrice,
      r.v4Scores?.qualityScore ?? "", r.v4Scores?.impulseScore ?? "", r.v4Scores?.retracementScore ?? "",
      r.v4Scores?.structureScore ?? "", r.v4Scores?.reclaimScore ?? "", r.v4Scores?.resumptionScore ?? "",
      r.regime, r.direction, r.adx, r.atrPct, r.spreadPct, r.setupTag,
      r.openPositions, r.openLotsForPair, r.openRiskUsd,
      r.exitReason, r.netPnlUsd, r.rMultiple, r.mfeR, r.maeR, r.holdTimeMinutes, r.closedAtMs,
    ].join(","));
  }
  fs.writeFileSync(path.join(AUDIT_DIR, "R0_FORENSIC.csv"), csv.join("\n"));

  // ── R0_RISK_BUCKETS.csv ── grouped concentration analysis
  interface Acc { n: number; net: number; wins: number; losses: number; sumR: number; worst: number; maeTail: number[] }
  const groups = new Map<string, Acc>();
  const add = (dim: string, key: string, r: ForensicRow) => {
    const k = `${dim}|${key}`;
    const a = groups.get(k) ?? { n: 0, net: 0, wins: 0, losses: 0, sumR: 0, worst: 0, maeTail: [] };
    a.n++; a.net += r.netPnlUsd; a.sumR += r.rMultiple;
    if (r.netPnlUsd > 0) a.wins += r.netPnlUsd; else a.losses += Math.abs(r.netPnlUsd);
    a.worst = Math.min(a.worst, r.netPnlUsd);
    a.maeTail.push(r.maeR);
    groups.set(k, a);
  };

  for (const r of rows) {
    const q = r.v4Scores?.qualityScore ?? -1;
    add("qualityBucket", bucket(q, [0.35, 0.45, 0.55, 0.7]), r);
    add("regime", r.regime, r);
    add("direction", r.direction, r);
    add("atrPctBucket", bucket(r.atrPct, [1, 2, 3]), r);
    add("openPositions", String(r.openPositions), r);
    add("openRiskBucket", bucket(r.openRiskUsd, [50, 100]), r);
    add("pair", r.pair, r);
    add("setupTag", r.setupTag, r);
    add("exitReason", r.exitReason, r);
  }

  const bHeader = "dimension,bucket,trades,netPnl,pf,avgR,worstTrade,avgMaeR";
  const bRows = [bHeader];
  for (const [k, a] of [...groups.entries()].sort()) {
    const [dim, key] = k.split("|");
    const pf = a.losses > 0 ? a.wins / a.losses : (a.wins > 0 ? Infinity : 0);
    const avgMae = a.maeTail.length ? a.maeTail.reduce((s, x) => s + x, 0) / a.maeTail.length : 0;
    bRows.push([dim, key, a.n, a.net.toFixed(2), pf === Infinity ? "inf" : pf.toFixed(3),
      (a.sumR / a.n).toFixed(3), a.worst.toFixed(2), avgMae.toFixed(3)].join(","));
  }
  fs.writeFileSync(path.join(AUDIT_DIR, "R0_RISK_BUCKETS.csv"), bRows.join("\n"));

  const net = rows.reduce((s, r) => s + r.netPnlUsd, 0);
  console.log(`FORENSIC_DONE trades=${rows.length} net=${net.toFixed(2)}`);
  console.log(`OUTPUT_DIR=${AUDIT_DIR}`);
}

const invokedDirectly = !!process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch(e => { console.error(e); process.exit(1); });
}
