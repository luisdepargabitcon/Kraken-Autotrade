/**
 * downloadTradesData.ts — Downloads historical trades from Kraken REST API
 * and aggregates them into OHLCV candles for 5m/15m/60m/240m simultaneously.
 *
 * Source: https://api.kraken.com/0/public/Trades
 * 
 * Single download per pair produces all 4 TFs.
 * Checkpoint/resume support. Retry/backoff for 429/5xx/network errors.
 * 
 * Run: npx tsx server/services/spot/research/downloadTradesData.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
  PAIR_MAPPINGS,
  TIMEFRAMES,
  DATA_ROOT,
  KRAKEN_TRADES_URL,
  KRAKEN_SOURCE,
  type KrakenDataset,
  type KrakenOHLCRow,
  type PairMapping,
} from "./krakenHistoricalLoader";

// ─── Constants ───────────────────────────────────────────────────────────────

const TF_MS: Record<number, number> = {
  5: 5 * 60 * 1000,
  15: 15 * 60 * 1000,
  60: 60 * 60 * 1000,
  240: 240 * 60 * 1000,
};

const RATE_LIMIT_DELAY_MS = 1200;
const MAX_RETRIES = 5;
const CHECKPOINT_INTERVAL = 50;
const MAX_REQUESTS_PER_PAIR = 200000;

// ─── Types ───────────────────────────────────────────────────────────────────

interface CandleAccum {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

interface CheckpointData {
  pair: string;
  cursor: string;
  tradeCount: number;
  requestCount: number;
  firstTradeTs: number | null;
  lastTradeTs: number | null;
  candles: Record<number, [number, CandleAccum][]>;
  recentTradeIds: number[];
}

interface TradesResponse {
  error: string[];
  result: Record<string, any[]> & { last?: string };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function dataDir(sub: string): string {
  const p = path.join(DATA_ROOT, sub);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
}

function cachePath(pair: string, tf: number): string {
  const safe = pair.replace("/", "_");
  return path.join(dataDir("normalized"), `${safe}_${tf}m.json`);
}

function checkpointPath(pair: string): string {
  const safe = pair.replace("/", "_");
  return path.join(dataDir("checkpoints"), `${safe}_trades.json`);
}

// ─── Fetch with retry ───────────────────────────────────────────────────────

async function fetchTradesPage(
  krakenPair: string,
  since: string,
): Promise<{ trades: any[]; last: string }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const params = new URLSearchParams({ pair: krakenPair, since });
      const url = `${KRAKEN_TRADES_URL}?${params}`;
      const resp = await fetch(url);

      if (resp.status === 429 || resp.status >= 500) {
        const backoff = Math.min(1000 * Math.pow(2, attempt), 30000);
        console.log(`  [Trades] ${resp.status} — retry in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(backoff);
        continue;
      }

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data = (await resp.json()) as TradesResponse;
      if (data.error && data.error.length > 0) {
        throw new Error(`Kraken API: ${data.error.join(", ")}`);
      }

      const resultKey = Object.keys(data.result).find(k => k !== "last");
      if (!resultKey) {
        return { trades: [], last: since };
      }

      const trades = data.result[resultKey] as any[];
      const last = data.result.last ?? since;

      return { trades, last };
    } catch (e) {
      lastError = e as Error;
      const backoff = Math.min(1000 * Math.pow(2, attempt), 30000);
      console.log(`  [Trades] Error: ${(e as Error).message} — retry in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
    }
  }

  throw lastError ?? new Error("Max retries exceeded");
}

// ─── Candle aggregation ─────────────────────────────────────────────────────

function aggregateTrade(
  trade: any[],
  candles: Map<number, Map<number, CandleAccum>>,
): void {
  const price = parseFloat(trade[0]);
  const volume = parseFloat(trade[1]);
  const timeSec = Number(trade[2]);
  const timeMs = Math.floor(timeSec * 1000);

  for (const tf of TIMEFRAMES) {
    const tfMs = TF_MS[tf];
    const candleTs = Math.floor(timeMs / tfMs) * tfMs;
    const tfMap = candles.get(tf)!;

    let candle = tfMap.get(candleTs);
    if (!candle) {
      candle = {
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        trades: 0,
      };
      tfMap.set(candleTs, candle);
    }

    candle.high = Math.max(candle.high, price);
    candle.low = Math.min(candle.low, price);
    candle.close = price;
    candle.volume += volume;
    candle.trades += 1;
  }
}

// ─── Checkpoint ─────────────────────────────────────────────────────────────

function saveCheckpoint(pair: string, data: CheckpointData): void {
  const cp = checkpointPath(pair);
  fs.writeFileSync(cp, JSON.stringify(data));
}

function loadCheckpoint(pair: string): CheckpointData | null {
  const cp = checkpointPath(pair);
  if (!fs.existsSync(cp)) return null;
  return JSON.parse(fs.readFileSync(cp, "utf-8")) as CheckpointData;
}

// ─── Download pair ──────────────────────────────────────────────────────────

async function downloadPairTrades(
  mapping: PairMapping,
  startNs: string,
): Promise<void> {
  const candles = new Map<number, Map<number, CandleAccum>>();
  for (const tf of TIMEFRAMES) {
    candles.set(tf, new Map<number, CandleAccum>());
  }

  let cursor = startNs;
  let tradeCount = 0;
  let requestCount = 0;
  let firstTradeTs: number | null = null;
  let lastTradeTs: number | null = null;
  const recentTradeIds = new Set<number>();

  // Resume from checkpoint
  const checkpoint = loadCheckpoint(mapping.requested);
  if (checkpoint) {
    console.log(`[Trades] Resuming ${mapping.requested} from checkpoint: cursor=${checkpoint.cursor.substring(0, 16)}..., trades=${checkpoint.tradeCount}, requests=${checkpoint.requestCount}`);
    cursor = checkpoint.cursor;
    tradeCount = checkpoint.tradeCount;
    requestCount = checkpoint.requestCount;
    firstTradeTs = checkpoint.firstTradeTs;
    lastTradeTs = checkpoint.lastTradeTs;

    for (const tf of TIMEFRAMES) {
      const tfMap = candles.get(tf)!;
      const saved = checkpoint.candles[tf] ?? [];
      for (const [ts, accum] of saved) {
        tfMap.set(ts, accum);
      }
    }

    for (const id of checkpoint.recentTradeIds) {
      recentTradeIds.add(id);
    }
  }

  const nowMs = Date.now();
  const nowNs = `${nowMs}000000`;

  console.log(`[Trades] Downloading ${mapping.requested} from ${new Date(Number(startNs.substring(0, 13))).toISOString()}`);

  while (requestCount < MAX_REQUESTS_PER_PAIR) {
    const page = await fetchTradesPage(mapping.krakenPair, cursor);

    if (page.trades.length === 0) {
      console.log(`[Trades] ${mapping.requested}: no more trades at cursor`);
      break;
    }

    let newTrades = 0;
    for (const trade of page.trades) {
      const tradeId = Number(trade[6]);
      const timeMs = Math.floor(Number(trade[2]) * 1000);

      if (recentTradeIds.has(tradeId)) continue;
      recentTradeIds.add(tradeId);

      // Keep sliding window of last 2000 IDs
      if (recentTradeIds.size > 2000) {
        const oldest = recentTradeIds.values().next().value;
        if (oldest !== undefined) recentTradeIds.delete(oldest);
      }

      if (firstTradeTs === null) firstTradeTs = timeMs;
      lastTradeTs = timeMs;

      aggregateTrade(trade, candles);
      newTrades++;
      tradeCount++;
    }

    requestCount++;
    cursor = page.last;

    if (requestCount % 10 === 0 || newTrades === 0) {
      const lastDate = lastTradeTs ? new Date(lastTradeTs).toISOString() : "N/A";
      console.log(`  [Trades] ${mapping.requested}: req=${requestCount}, trades=${tradeCount} (+${newTrades}), last=${lastDate}`);
    }

    // Check if we've reached current time
    if (BigInt(page.last) >= BigInt(nowNs)) {
      console.log(`[Trades] ${mapping.requested}: reached current time`);
      break;
    }

    // Checkpoint
    if (requestCount % CHECKPOINT_INTERVAL === 0) {
      const cpData: CheckpointData = {
        pair: mapping.requested,
        cursor,
        tradeCount,
        requestCount,
        firstTradeTs,
        lastTradeTs,
        candles: {},
        recentTradeIds: Array.from(recentTradeIds),
      };
      for (const tf of TIMEFRAMES) {
        cpData.candles[tf] = Array.from(candles.get(tf)!.entries());
      }
      saveCheckpoint(mapping.requested, cpData);
      console.log(`  [Trades] ${mapping.requested}: checkpoint saved (req=${requestCount}, trades=${tradeCount})`);
    }

    await sleep(RATE_LIMIT_DELAY_MS);
  }

  // Final checkpoint
  const cpData: CheckpointData = {
    pair: mapping.requested,
    cursor,
    tradeCount,
    requestCount,
    firstTradeTs,
    lastTradeTs,
    candles: {},
    recentTradeIds: Array.from(recentTradeIds),
  };
  for (const tf of TIMEFRAMES) {
    cpData.candles[tf] = Array.from(candles.get(tf)!.entries());
  }
  saveCheckpoint(mapping.requested, cpData);

  // Build and save datasets, excluding forming candles
  for (const tf of TIMEFRAMES) {
    const tfMs = TF_MS[tf];
    const tfMap = candles.get(tf)!;
    const sortedTs = Array.from(tfMap.keys()).sort((a, b) => a - b);

    // Exclude forming candle (last candle if still open)
    if (sortedTs.length > 0) {
      const lastTs = sortedTs[sortedTs.length - 1];
      if (lastTs + tfMs > nowMs) {
        sortedTs.pop();
      }
    }

    const rows: KrakenOHLCRow[] = sortedTs.map(ts => {
      const c = tfMap.get(ts)!;
      return {
        timestamp: ts,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        vwap: 0,
        volume: c.volume,
        trades: c.trades,
      };
    });

    const dataset: KrakenDataset = {
      pair: mapping.requested,
      krakenPair: mapping.krakenPair,
      krakenResultKey: mapping.resultKey,
      timeframeMinutes: tf,
      rows,
      firstTimestamp: rows.length > 0 ? rows[0].timestamp : 0,
      lastTimestamp: rows.length > 0 ? rows[rows.length - 1].timestamp : 0,
      rowCount: rows.length,
      source: KRAKEN_SOURCE,
      downloadedAtUtc: new Date().toISOString(),
    };

    const cp = cachePath(mapping.requested, tf);
    fs.writeFileSync(cp, JSON.stringify(dataset));

    const days = rows.length > 0 ? (rows[rows.length - 1].timestamp - rows[0].timestamp) / (24 * 3600 * 1000) : 0;
    console.log(`  [Trades] ${mapping.requested} ${tf}m: ${rows.length} candles, ${days.toFixed(1)} days`);
  }

  console.log(`[Trades] ${mapping.requested}: done — ${tradeCount} trades, ${requestCount} requests`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const startUtc = Date.UTC(2026, 2, 14); // 2026-03-14T00:00:00Z
  const startMs = String(startUtc);
  const startNs = `${startMs}000000`;

  console.log(`[Trades] Source: ${KRAKEN_SOURCE}`);
  console.log(`[Trades] Endpoint: ${KRAKEN_TRADES_URL}`);
  console.log(`[Trades] Start: ${new Date(startUtc).toISOString()}`);
  console.log(`[Trades] Pairs: ${PAIR_MAPPINGS.map(p => p.requested).join(", ")}`);
  console.log();

  for (const mapping of PAIR_MAPPINGS) {
    await downloadPairTrades(mapping, startNs);
    console.log();
  }

  console.log("[Trades] All pairs downloaded.");

  // Verify data
  console.log("\n[Trades] Verification:");
  for (const mapping of PAIR_MAPPINGS) {
    for (const tf of TIMEFRAMES) {
      const cp = cachePath(mapping.requested, tf);
      if (!fs.existsSync(cp)) {
        console.log(`  ${mapping.requested} ${tf}m: MISSING`);
        continue;
      }
      const ds = JSON.parse(fs.readFileSync(cp, "utf-8")) as KrakenDataset;
      const days = ds.rowCount > 0 ? (ds.lastTimestamp - ds.firstTimestamp) / (24 * 3600 * 1000) : 0;
      console.log(`  ${mapping.requested} ${tf}m: ${ds.rowCount} candles, ${days.toFixed(1)} days, ${ds.firstTimestamp > 0 ? new Date(ds.firstTimestamp).toISOString() : "N/A"} → ${ds.lastTimestamp > 0 ? new Date(ds.lastTimestamp).toISOString() : "N/A"}`);
    }
  }
}

main().catch(e => {
  console.error("[Trades] Fatal:", e);
  process.exit(1);
});
