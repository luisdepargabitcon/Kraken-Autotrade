/**
 * KrakenHistoricalLoader — Downloads OHLCVT data from the official Kraken API.
 *
 * Source: https://api.kraken.com/0/public/OHLC
 *
 * The Kraken downloadable ZIP (7.3 GB on Google Drive) is rate-limited,
 * so we use the official Kraken REST API as an alternative official source.
 * The API returns up to 720 candles per request; we paginate via the
 * `since` parameter to build a full historical dataset.
 *
 * Data is cached locally outside the repo (BOT_AUTOTRADE_SPOT_ADAPTIVE_V3_DATA/kraken).
 *
 * CSV timestamp = candle OPEN TIME (epoch seconds in API, epoch ms internally).
 */

import * as fs from "fs";
import * as path from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KrakenOHLCRow {
  timestamp: number;  // epoch ms (open time)
  open: number;
  high: number;
  low: number;
  close: number;
  vwap: number;
  volume: number;
  trades: number;
}

export interface KrakenDataset {
  pair: string;          // e.g. "BTC/USD"
  krakenPair: string;    // e.g. "XBTUSD"
  krakenResultKey: string; // e.g. "XXBTZUSD"
  timeframeMinutes: number;
  rows: KrakenOHLCRow[];
  firstTimestamp: number;
  lastTimestamp: number;
  rowCount: number;
  source: string;
  downloadedAtUtc: string;
}

export interface PairMapping {
  requested: string;   // "BTC/USD"
  krakenPair: string;  // "XBTUSD"
  resultKey: string;   // "XXBTZUSD"
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const KRAKEN_API_URL = "https://api.kraken.com/0/public/OHLC";
export const KRAKEN_OFFICIAL_PAGE = "https://support.kraken.com/articles/360047124832-downloadable-historical-ohlcvt-open-high-low-close-volume-trades-data";
export const KRAKEN_SOURCE = "KRAKEN_OFFICIAL_API_OHLC";

export const PAIR_MAPPINGS: PairMapping[] = [
  { requested: "BTC/USD", krakenPair: "XBTUSD", resultKey: "XXBTZUSD" },
  { requested: "ETH/USD", krakenPair: "ETHUSD", resultKey: "XETHZUSD" },
  { requested: "SOL/USD", krakenPair: "SOLUSD", resultKey: "SOLUSD" },
  { requested: "XRP/USD", krakenPair: "XRPUSD", resultKey: "XXRPZUSD" },
];

export const TIMEFRAMES = [5, 15, 60, 240];

export const DATA_ROOT = process.env.KRAKEN_DATA_ROOT
  ?? "C:\\Users\\JSLUI\\Qsync\\BOT_NAS\\BOT_AUTOTRADE_SPOT_ADAPTIVE_V3_DATA\\kraken";

const RATE_LIMIT_DELAY_MS = 1200; // 1.2s between requests
const MAX_CANDLES_PER_REQUEST = 720;

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

// ─── Download ───────────────────────────────────────────────────────────────

interface KrakenAPIResponse {
  error: string[];
  result: Record<string, any[]> & { last?: number };
}

async function fetchOHLCPage(
  krakenPair: string,
  interval: number,
  since?: number,
): Promise<{ rows: any[]; last: number }> {
  const params = new URLSearchParams({
    pair: krakenPair,
    interval: String(interval),
  });
  if (since !== undefined) {
    params.set("since", String(since));
  }

  const url = `${KRAKEN_API_URL}?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Kraken API error: ${resp.status} ${resp.statusText}`);
  }
  const data = (await resp.json()) as KrakenAPIResponse;
  if (data.error && data.error.length > 0) {
    throw new Error(`Kraken API error: ${data.error.join(", ")}`);
  }

  const resultKey = Object.keys(data.result).find(k => k !== "last");
  if (!resultKey) {
    return { rows: [], last: since ?? 0 };
  }

  const rows = data.result[resultKey] as any[];
  const last = data.result.last ?? (rows.length > 0 ? Number(rows[rows.length - 1][0]) : 0);

  return { rows, last };
}

function parseRow(raw: any[]): KrakenOHLCRow {
  return {
    timestamp: Number(raw[0]) * 1000, // seconds → ms
    open: parseFloat(raw[1]),
    high: parseFloat(raw[2]),
    low: parseFloat(raw[3]),
    close: parseFloat(raw[4]),
    vwap: parseFloat(raw[5]),
    volume: parseFloat(raw[6]),
    trades: Number(raw[7]),
  };
}

export async function downloadPairTimeframe(
  mapping: PairMapping,
  timeframeMinutes: number,
  sinceSeconds: number = 0,
  maxRequests: number = 500,
): Promise<KrakenDataset> {
  const allRows: KrakenOHLCRow[] = [];
  let currentSince = sinceSeconds;
  let requestCount = 0;
  let lastTimestamp = 0;

  console.log(`[KrakenLoader] Downloading ${mapping.requested} ${timeframeMinutes}m since=${new Date(sinceSeconds * 1000).toISOString()}`);

  while (requestCount < maxRequests) {
    const page = await fetchOHLCPage(mapping.krakenPair, timeframeMinutes, currentSince);
    if (page.rows.length === 0) break;

    for (const raw of page.rows) {
      const row = parseRow(raw);
      // Skip duplicate timestamps (Kraken sometimes returns overlapping data)
      if (allRows.length > 0 && allRows[allRows.length - 1].timestamp === row.timestamp) {
        continue;
      }
      allRows.push(row);
    }

    lastTimestamp = page.last;
    requestCount++;

    if (page.rows.length < MAX_CANDLES_PER_REQUEST) break;

    // Check if we've reached current time
    const nowSec = Math.floor(Date.now() / 1000);
    if (lastTimestamp >= nowSec) break;

    currentSince = lastTimestamp;
    await sleep(RATE_LIMIT_DELAY_MS);

    if (requestCount % 50 === 0) {
      console.log(`[KrakenLoader] ${mapping.requested} ${timeframeMinutes}m: ${requestCount} requests, ${allRows.length} candles, up to ${new Date(allRows[allRows.length - 1].timestamp).toISOString()}`);
    }
  }

  console.log(`[KrakenLoader] ${mapping.requested} ${timeframeMinutes}m: done ${requestCount} requests, ${allRows.length} candles`);

  const dataset: KrakenDataset = {
    pair: mapping.requested,
    krakenPair: mapping.krakenPair,
    krakenResultKey: mapping.resultKey,
    timeframeMinutes,
    rows: allRows,
    firstTimestamp: allRows.length > 0 ? allRows[0].timestamp : 0,
    lastTimestamp: allRows.length > 0 ? allRows[allRows.length - 1].timestamp : 0,
    rowCount: allRows.length,
    source: KRAKEN_SOURCE,
    downloadedAtUtc: new Date().toISOString(),
  };

  // Cache to disk
  const cp = cachePath(mapping.requested, timeframeMinutes);
  fs.writeFileSync(cp, JSON.stringify(dataset));

  return dataset;
}

export async function downloadAllPairs(
  sinceSeconds: number = 0,
  maxRequests: number = 500,
): Promise<Map<string, KrakenDataset>> {
  const results = new Map<string, KrakenDataset>();

  for (const mapping of PAIR_MAPPINGS) {
    for (const tf of TIMEFRAMES) {
      const key = `${mapping.requested}_${tf}m`;
      try {
        const dataset = await downloadPairTimeframe(mapping, tf, sinceSeconds, maxRequests);
        results.set(key, dataset);
      } catch (e) {
        console.error(`[KrakenLoader] Error downloading ${key}: ${(e as Error).message}`);
      }
    }
  }

  return results;
}

// ─── Load from cache ─────────────────────────────────────────────────────────

export function loadCachedDataset(pair: string, timeframeMinutes: number): KrakenDataset | null {
  const cp = cachePath(pair, timeframeMinutes);
  if (!fs.existsSync(cp)) return null;
  return JSON.parse(fs.readFileSync(cp, "utf-8")) as KrakenDataset;
}

export function loadAllCached(): Map<string, KrakenDataset> {
  const results = new Map<string, KrakenDataset>();
  for (const mapping of PAIR_MAPPINGS) {
    for (const tf of TIMEFRAMES) {
      const key = `${mapping.requested}_${tf}m`;
      const ds = loadCachedDataset(mapping.requested, tf);
      if (ds) results.set(key, ds);
    }
  }
  return results;
}
