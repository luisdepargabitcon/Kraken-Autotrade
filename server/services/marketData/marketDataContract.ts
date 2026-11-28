import { normalizeEpochToMs } from "./epochNormalizer";

export const CONTRACT_VERSION = "market-data/1.0.0";

export type MarketDataValidity = "valid" | "stale" | "invalid" | "unknown";
export type MarketDataQualityLevel = "good" | "degraded" | "poor" | "unknown";
export type MarketDataOrigin = "live" | "db_fallback" | "cache";

export interface MarketDataQuality {
  validity: MarketDataValidity;
  reason: string;
  dataQuality: MarketDataQualityLevel;
  ageMs: number | null;
  missing: string[];
}

export interface CandlePoint {
  pair: string;
  base: string;
  quote: string;
  source: string;
  venue: string;
  timeframe: string;
  openTime: number;
  closeTime: number;
  providerTs: number | null;
  receivedAt: number | null;
  cachedAt: number | null;
  isClosed: boolean;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  origin: MarketDataOrigin;
}

export interface CandleSeries {
  contractVersion: string;
  pair: string;
  base: string;
  quote: string;
  source: string;
  venue: string;
  timeframe: string;
  timeframeMs: number;
  candles: CandlePoint[];
  quality: MarketDataQuality;
  gaps: number;
  duplicates: number;
  referenceCount: number;
  lastClosedTime: number | null;
  providerTs: number | null;
  receivedAt: number | null;
  cachedAt: number | null;
  origin: MarketDataOrigin;
}

export interface PricePoint {
  contractVersion: string;
  pair: string;
  base: string;
  quote: string;
  source: string;
  venue: string;
  price: number | null;
  providerTs: number | null;
  receivedAt: number | null;
  cachedAt: number | null;
  ageMs: number | null;
  validity: MarketDataValidity;
  reason: string;
  dataQuality: MarketDataQualityLevel;
  origin: MarketDataOrigin;
}

export interface ValidateCandleSeriesOptions {
  timeframeMs: number;
  nowMs: number;
  source: string;
  venue: string;
  pair: string;
  timeframe: string;
  minCandles?: number;
  staleAfterMs?: number;
  origin?: MarketDataOrigin;
  receivedAt?: number | null;
  cachedAt?: number | null;
}

function splitPair(pair: string): [string, string] {
  const [base, quote] = pair.split("/");
  return [base ?? "", quote ?? ""];
}

function normalizeOptionalMs(value: unknown, nowMs: number): number | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const normalized = normalizeEpochToMs(Number(value), { nowMs });
  return normalized.ok ? normalized.ms : null;
}

function isTradableCandleShape(open: number, high: number, low: number, close: number): boolean {
  return [open, high, low, close].every(Number.isFinite)
    && open > 0
    && high > 0
    && low > 0
    && close > 0
    && low <= Math.min(open, close)
    && high >= Math.max(open, close);
}

/**
 * Validates and normalizes one provider/pair/timeframe candle series.
 *
 * Time semantics are deliberately separated:
 * - providerTs: timestamp supplied by the market-data provider for the candle;
 * - receivedAt: when this process originally received/persisted that candle;
 * - cachedAt: when the in-memory cache entry was created;
 * - quality.ageMs: age since the expected close of the last closed candle.
 *
 * The validator never fabricates missing timestamps or prices.
 */
export function validateCandleSeries(raw: any[], options: ValidateCandleSeriesOptions): CandleSeries {
  const [base, quote] = splitPair(options.pair);
  const origin = options.origin ?? "live";
  const missing: string[] = [];
  const seen = new Map<number, string>();
  const rows: any[] = [];
  let duplicates = 0;
  let gaps = 0;

  for (const input of Array.isArray(raw) ? raw : []) {
    const openTime = normalizeEpochToMs(input?.time ?? input?.timestamp, { nowMs: options.nowMs });
    if (!openTime.ok) {
      duplicates++;
      continue;
    }

    const open = Number(input.open);
    const high = Number(input.high);
    const low = Number(input.low);
    const close = Number(input.close);
    const volume = input.volume == null ? null : Number(input.volume);

    if (!isTradableCandleShape(open, high, low, close)
      || (volume != null && (!Number.isFinite(volume) || volume < 0))) {
      duplicates++;
      continue;
    }

    const fingerprint = JSON.stringify([open, high, low, close, volume]);
    if (seen.has(openTime.ms)) {
      if (seen.get(openTime.ms) !== fingerprint) duplicates++;
      continue;
    }

    seen.set(openTime.ms, fingerprint);
    rows.push({
      ...input,
      openTimeMs: openTime.ms,
      providerTsMs: input.providerTs == null ? openTime.ms : normalizeOptionalMs(input.providerTs, options.nowMs),
      receivedAtMs: input.receivedAt == null
        ? normalizeOptionalMs(options.receivedAt, options.nowMs)
        : normalizeOptionalMs(input.receivedAt, options.nowMs),
      open,
      high,
      low,
      close,
      volume,
    });
  }

  rows.sort((a, b) => a.openTimeMs - b.openTimeMs);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].openTimeMs - rows[i - 1].openTimeMs !== options.timeframeMs) gaps++;
  }

  const cachedAt = normalizeOptionalMs(options.cachedAt, options.nowMs);
  const candles: CandlePoint[] = rows.map((row) => ({
    pair: options.pair,
    base,
    quote,
    source: options.source,
    venue: options.venue,
    timeframe: options.timeframe,
    openTime: row.openTimeMs,
    closeTime: row.openTimeMs + options.timeframeMs,
    providerTs: row.providerTsMs,
    receivedAt: row.receivedAtMs,
    cachedAt,
    isClosed: row.openTimeMs + options.timeframeMs <= options.nowMs,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    origin,
  }));

  const closed = candles.filter((candle) => candle.isClosed);
  const lastClosed = closed.at(-1) ?? null;
  const ageMs = lastClosed ? options.nowMs - lastClosed.closeTime : null;
  const minimum = options.minCandles ?? 1;

  if (closed.length < minimum) missing.push("warmup");
  if (gaps > 0) missing.push("gaps");
  if (duplicates > 0) missing.push("duplicates_or_invalid");

  const staleAfterMs = options.staleAfterMs ?? options.timeframeMs * 2;
  const validity: MarketDataValidity = missing.includes("duplicates_or_invalid")
    ? "invalid"
    : ageMs != null && ageMs > staleAfterMs
      ? "stale"
      : closed.length >= minimum
        ? "valid"
        : "unknown";

  const quality: MarketDataQuality = {
    validity,
    reason: missing[0] ?? (validity === "stale" ? "stale_after_expected_close" : "ok"),
    dataQuality: validity === "valid" ? "good" : validity === "stale" ? "degraded" : validity === "invalid" ? "poor" : "unknown",
    ageMs,
    missing,
  };

  const latest = candles.at(-1) ?? null;
  return {
    contractVersion: CONTRACT_VERSION,
    pair: options.pair,
    base,
    quote,
    source: options.source,
    venue: options.venue,
    timeframe: options.timeframe,
    timeframeMs: options.timeframeMs,
    candles,
    quality,
    gaps,
    duplicates,
    referenceCount: closed.length,
    lastClosedTime: lastClosed?.openTime ?? null,
    providerTs: latest?.providerTs ?? null,
    receivedAt: latest?.receivedAt ?? null,
    cachedAt,
    origin,
  };
}
