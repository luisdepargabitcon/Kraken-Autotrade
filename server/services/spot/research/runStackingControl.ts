/**
 * runStackingControl.ts — Historical control for same-pair stacking audit.
 * CONTROL ONLY: same frozen Entry V4 + E0 exits + R0 sizing; the ONLY variable
 * is maxLotsPerPair/maxConcurrentPositions = 2 (current) vs 1 (counterfactual).
 * No parameter selection. Outputs MAX1_CERTIFICATION_CONTROL.csv.
 *
 * Usage: DATABASE_URL=... npx tsx server/services/spot/research/runStackingControl.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { SpotCandle } from "../spotTypes";
import { type ReplayTrade } from "../spotReplayEngine";
import { precomputeFrames, fastReplay } from "./fastResearchReplay";
import { type FeeModel } from "../feeModel";
import { DEFAULT_ENTRY_V3_CONFIG, type EntryV3Config } from "../spotEntryV3";
import { DEFAULT_SPOT_EXIT_CONFIG } from "../spotExitPolicy";
import { DEFAULT_SPOT_RISK_CONFIG } from "../spotRiskManager";
import { PAIR_MAPPINGS, loadAllCached, type KrakenOHLCRow } from "./krakenHistoricalLoader";

const HISTORICAL_FEE_MODEL: FeeModel = { exchange: "revolutx", takerFeePct: 0.09, makerFeePct: 0.00, quality: "ESTIMATED" };
const V3_ENABLED: EntryV3Config = { ...DEFAULT_ENTRY_V3_CONFIG, enabled: true };
const HISTORICAL_ENTRY_THRESHOLDS = [0.50, 0.30, 0.30];
const DAY_MS = 86400000, TRAIN_DAYS = 90, TEST_DAYS = 30, STEP_DAYS = 30;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_DIR = path.join(
  path.dirname(path.dirname(path.dirname(path.dirname(__dirname)))),
  "docs", "auditoria", "spot-max1-productizacion",
);
const ALL_PAIRS = PAIR_MAPPINGS.map(m => m.requested);

const toSpotCandle = (r: KrakenOHLCRow): SpotCandle => ({ time: r.timestamp, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume });

interface M { n: number; net: number; pf: number; exp: number; dd: number; fees: number }
function metrics(trades: ReplayTrade[]): M {
  const n = trades.length, net = trades.reduce((s, t) => s + t.netPnlUsd, 0);
  const w = trades.filter(t => t.netPnlUsd > 0).reduce((s, t) => s + t.netPnlUsd, 0);
  const l = Math.abs(trades.filter(t => t.netPnlUsd <= 0).reduce((s, t) => s + t.netPnlUsd, 0));
  let eq = 10000, peak = 10000, dd = 0;
  for (const t of [...trades].sort((a, b) => a.closedAtMs - b.closedAtMs)) { eq += t.netPnlUsd; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  return { n, net, pf: l > 0 ? w / l : w > 0 ? Infinity : 0, exp: n ? net / n : 0, dd, fees: trades.reduce((s, t) => s + t.entryFeeUsd + t.exitFeeUsd, 0) };
}

async function main() {
  const datasets = loadAllCached();
  const pre = new Map<string, ReturnType<typeof precomputeFrames>>();
  let intersectEnd = Infinity;
  for (const pair of ALL_PAIRS) {
    const c5 = datasets.get(`${pair}_5m`), c15 = datasets.get(`${pair}_15m`), c60 = datasets.get(`${pair}_60m`), c240 = datasets.get(`${pair}_240m`);
    if (!c5 || !c15 || !c60 || !c240) continue;
    intersectEnd = Math.min(intersectEnd, c5.lastTimestamp);
    const t0 = Date.now();
    pre.set(pair, precomputeFrames(pair, {
      pair, candles5m: c5.rows.map(toSpotCandle), candles15m: c15.rows.map(toSpotCandle),
      candles1h: c60.rows.map(toSpotCandle), candles4h: c240.rows.map(toSpotCandle),
    }, V3_ENABLED));
    console.log(`[${pair}] precomputed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  const rows: string[] = ["scope,fold,pair,policy,trades,net,pf,expectancy,maxDD,fees"];
  const agg = new Map<string, ReplayTrade[]>();

  for (const [scope, thrs] of [["HISTORICAL", HISTORICAL_ENTRY_THRESHOLDS], ["PRODUCTION_030", [0.30, 0.30, 0.30]]] as const) {
    for (let f = 0; f < 3; f++) {
      const trainStart = intersectEnd - (TRAIN_DAYS + TEST_DAYS) * DAY_MS - (2 - f) * STEP_DAYS * DAY_MS;
      const testStart = trainStart + TRAIN_DAYS * DAY_MS;
      const testEnd = testStart + TEST_DAYS * DAY_MS;
      const thr = thrs[f];
      for (const maxLots of [2, 1] as const) {
        const pol = maxLots === 2 ? "CURRENT_MAX2" : "MAX1";
        const all: ReplayTrade[] = [];
        for (const pair of ALL_PAIRS) {
          const p = pre.get(pair);
          if (!p) continue;
          const { trades } = fastReplay(p, {
            pair, availableCapitalUsd: 10000,
            exitConfig: DEFAULT_SPOT_EXIT_CONFIG,
            entryV3Config: V3_ENABLED,
            v4MinQualityScore: thr,
            feeModel: HISTORICAL_FEE_MODEL,
            evaluationStartMs: testStart, evaluationEndMs: testEnd,
            maxConcurrentPositions: maxLots,
            riskConfig: { ...DEFAULT_SPOT_RISK_CONFIG, maxLotsPerPair: maxLots },
          });
          const m = metrics(trades);
          rows.push([scope, f, pair, pol, m.n, m.net.toFixed(2), m.pf.toFixed(3), m.exp.toFixed(3), m.dd.toFixed(2), m.fees.toFixed(2)].join(","));
          all.push(...trades);
        }
        const key = `${scope}|${pol}`;
        agg.set(key, [...(agg.get(key) ?? []), ...all]);
        const m = metrics(all);
        rows.push([scope, f, "ALL", pol, m.n, m.net.toFixed(2), m.pf.toFixed(3), m.exp.toFixed(3), m.dd.toFixed(2), m.fees.toFixed(2)].join(","));
        console.log(`${scope} fold${f} thr=${thr} ${pol}: n=${m.n} net=${m.net.toFixed(2)} pf=${m.pf.toFixed(3)} dd=${m.dd.toFixed(2)}`);
      }
    }
  }
  for (const [key, tt] of agg) {
    const m = metrics(tt);
    rows.push([key.split("|")[0], "ALL", "ALL", key.split("|")[1], m.n, m.net.toFixed(2), m.pf.toFixed(3), m.exp.toFixed(3), m.dd.toFixed(2), m.fees.toFixed(2)].join(","));
    console.log(`${key} OOS: n=${m.n} net=${m.net.toFixed(2)} pf=${m.pf.toFixed(3)} dd=${m.dd.toFixed(2)}`);
  }
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "MAX1_CERTIFICATION_CONTROL.csv"), rows.join("\n"));
  console.log(`OUT=${path.join(OUT_DIR, "MAX1_CERTIFICATION_CONTROL.csv")}`);
}

const invokedDirectly = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main().catch(e => { console.error(e); process.exit(1); });
