import { normalizeEpochToMs } from "../epochNormalizer";
import { validateCandleSeries, type CandleSeries } from "../marketDataContract";

export const SECONDARY_SOURCE_ENABLED = false;
export const BITSTAMP_REQUEST_COOLDOWN_MS = 5 * 60 * 1000;

const BITSTAMP_MARKETS: Record<string, string> = {
  "BTC/USD": "btcusd",
  "ETH/USD": "ethusd",
};

const TIMEFRAMES: Record<string, { step: number; timeframeMs: number }> = {
  "1h": { step: 3600, timeframeMs: 3_600_000 },
};

export interface BitstampCandleProviderOptions {
  enabled?: boolean;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

interface CacheEntry {
  series: CandleSeries;
  fetchedAtMs: number;
}

interface BitstampOhlcRow {
  timestamp?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
}

export interface SecondaryDivergence {
  alignedCount: number;
  primaryCount: number;
  secondaryCount: number;
  coveragePct: number;
  meanAbsDiffPct: number | null;
  p95AbsDiffPct: number | null;
  maxAbsDiffPct: number | null;
}

export type SecondaryConsumer =
  | "tracking_ui"
  | "protective_exit"
  | "new_entry"
  | "indicator_score";

export interface SecondaryFallbackDecision {
  useSecondary: boolean;
  decision: "allowed_labeled" | "allowed_with_alert" | "denied";
  reason: string;
  requiresLabel: boolean;
  requiresAlert: boolean;
}

function bitstampError(code: string, message: string, status?: number): Error {
  const error = new Error(`[${code}] ${message}`) as Error & { status?: number };
  if (status !== undefined) error.status = status;
  return error;
}

function extractRows(payload: any): BitstampOhlcRow[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data?.ohlc)) return payload.data.ohlc;
  if (Array.isArray(payload?.ohlc)) return payload.ohlc;
  throw bitstampError("BITSTAMP_SHAPE_INVALID", "Respuesta Bitstamp sin data.ohlc");
}

/**
 * Adaptador REST acotado de Bitstamp. Está desactivado por defecto y no se
 * integra automáticamente en ningún consumidor: el llamador debe inyectar
 * enabled=true explícitamente. No usa WebSocket ni credenciales.
 */
export class BitstampCandleProvider {
  private readonly enabled: boolean;
  private readonly fetchImpl?: typeof fetch;
  private readonly nowMs: () => number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<CandleSeries>>();

  constructor(options: BitstampCandleProviderOptions = {}) {
    this.enabled = options.enabled ?? SECONDARY_SOURCE_ENABLED;
    this.fetchImpl = options.fetchImpl;
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  getCacheAgeMs(pair: string, timeframe = "1h"): number | null {
    const entry = this.cache.get(`${pair}:${timeframe}`);
    return entry ? Math.max(0, this.nowMs() - entry.fetchedAtMs) : null;
  }

  async getCandleSeries(pair: string, timeframe = "1h", limit = 720): Promise<CandleSeries> {
    if (!this.enabled) {
      throw bitstampError("SECONDARY_SOURCE_DISABLED", "Bitstamp secondary source está desactivada por defecto");
    }
    const market = BITSTAMP_MARKETS[pair];
    const tf = TIMEFRAMES[timeframe];
    if (!market) throw bitstampError("BITSTAMP_PAIR_UNSUPPORTED", `Par no soportado: ${pair}`);
    if (!tf) throw bitstampError("BITSTAMP_TIMEFRAME_UNSUPPORTED", `Timeframe no soportado: ${timeframe}`);

    const key = `${pair}:${timeframe}`;
    const now = this.nowMs();
    const cached = this.cache.get(key);
    if (cached && now - cached.fetchedAtMs < BITSTAMP_REQUEST_COOLDOWN_MS) {
      return cached.series;
    }
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = this.fetchSeries(pair, market, timeframe, tf.step, tf.timeframeMs, limit)
      .then(result => {
        this.cache.set(key, { series: result, fetchedAtMs: this.nowMs() });
        return result;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, promise);
    return promise;
  }

  private async fetchSeries(
    pair: string,
    market: string,
    timeframe: string,
    step: number,
    timeframeMs: number,
    limit: number,
  ): Promise<CandleSeries> {
    const fetcher = this.fetchImpl ?? globalThis.fetch;
    if (!fetcher) throw bitstampError("BITSTAMP_FETCH_UNAVAILABLE", "fetch no está disponible");

    const boundedLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const url = `https://www.bitstamp.net/api/v2/ohlc/${market}/?step=${step}&limit=${boundedLimit}&exclude_current_candle=true`;
    let response: Response;
    try {
      response = await fetcher(url, { method: "GET" });
    } catch (error) {
      throw bitstampError("BITSTAMP_NETWORK_ERROR", error instanceof Error ? error.message : String(error));
    }
    if (response.status === 429) {
      throw bitstampError("BITSTAMP_HTTP_429", "Bitstamp devolvió HTTP 429", 429);
    }
    if (!response.ok) {
      throw bitstampError("BITSTAMP_HTTP_ERROR", `Bitstamp devolvió HTTP ${response.status}`, response.status);
    }

    let payload: any;
    try {
      payload = await response.json();
    } catch (error) {
      throw bitstampError("BITSTAMP_JSON_INVALID", error instanceof Error ? error.message : String(error));
    }

    const now = this.nowMs();
    const rows = extractRows(payload).map(row => {
      const normalized = normalizeEpochToMs(row.timestamp, { nowMs: now, unitHint: "seconds" });
      return {
        time: normalized.ok ? normalized.ms : NaN,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: row.volume == null ? null : Number(row.volume),
        providerTs: normalized.ok ? normalized.ms : null,
      };
    });

    return validateCandleSeries(rows, {
      timeframeMs,
      nowMs: now,
      source: "bitstamp",
      venue: "bitstamp",
      pair,
      timeframe,
      minCandles: 1,
      origin: "live",
      receivedAt: now,
      cachedAt: now,
    });
  }
}

function percentileNearestRank(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1);
  return sorted[index];
}

/** Compara únicamente cierres de velas alineadas por openTime. No mezcla series. */
export function compareWithPrimary(primarySeries: CandleSeries, secondarySeries: CandleSeries): SecondaryDivergence {
  const secondaryByTime = new Map(secondarySeries.candles.map(candle => [candle.openTime, candle]));
  const diffs: number[] = [];
  for (const primary of primarySeries.candles) {
    const secondary = secondaryByTime.get(primary.openTime);
    if (!secondary || !(primary.close > 0)) continue;
    diffs.push(Math.abs(((secondary.close - primary.close) / primary.close) * 100));
  }
  const denominator = Math.max(primarySeries.candles.length, secondarySeries.candles.length);
  const sum = diffs.reduce((acc, value) => acc + value, 0);
  return {
    alignedCount: diffs.length,
    primaryCount: primarySeries.candles.length,
    secondaryCount: secondarySeries.candles.length,
    coveragePct: denominator > 0 ? (diffs.length / denominator) * 100 : 0,
    meanAbsDiffPct: diffs.length > 0 ? sum / diffs.length : null,
    p95AbsDiffPct: percentileNearestRank(diffs, 95),
    maxAbsDiffPct: diffs.length > 0 ? Math.max(...diffs) : null,
  };
}

const SECONDARY_MAX_FETCH_AGE_MS = BITSTAMP_REQUEST_COOLDOWN_MS;
const PROTECTIVE_MAX_DIVERGENCE_PCT = 0.5;

function denied(reason: string): SecondaryFallbackDecision {
  return { useSecondary: false, decision: "denied", reason, requiresLabel: false, requiresAlert: false };
}

/** Política pura; no activa fallback ni selecciona datos por sí misma. */
export function evaluateSecondaryFallback(
  consumer: SecondaryConsumer,
  divergence: SecondaryDivergence | null,
  ageMs: number,
): SecondaryFallbackDecision {
  if (consumer === "new_entry") {
    return denied("entradas nuevas nunca usan fuente secundaria");
  }
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return denied("edad de fuente secundaria desconocida");
  }
  const stale = ageMs > SECONDARY_MAX_FETCH_AGE_MS;

  if (consumer === "tracking_ui") {
    return {
      useSecondary: true,
      decision: "allowed_labeled",
      reason: stale ? "permitido para seguimiento/UI con etiqueta y dato potencialmente viejo" : "permitido para seguimiento/UI con etiqueta",
      requiresLabel: true,
      requiresAlert: false,
    };
  }

  const maxDiff = divergence?.maxAbsDiffPct;
  const coverage = divergence?.coveragePct ?? 0;
  if (!divergence || divergence.alignedCount === 0 || maxDiff == null) {
    return denied("sin divergencia medida en velas alineadas");
  }

  if (consumer === "protective_exit") {
    if (stale) return denied("salida protectora rechaza fuente secundaria vieja");
    if (maxDiff > PROTECTIVE_MAX_DIVERGENCE_PCT) {
      return denied(`salida protectora rechaza divergencia máxima ${maxDiff.toFixed(3)}% > ${PROTECTIVE_MAX_DIVERGENCE_PCT}%`);
    }
    return {
      useSecondary: true,
      decision: "allowed_with_alert",
      reason: "salida protectora permitida con divergencia máxima ≤0.5% y alerta obligatoria",
      requiresLabel: true,
      requiresAlert: true,
    };
  }

  if (consumer === "indicator_score") {
    if (stale) return denied("indicadores/score rechazan fuente secundaria vieja");
    if (coverage < 100) return denied("indicadores/score exigen serie completa de una única fuente");
    if (maxDiff > PROTECTIVE_MAX_DIVERGENCE_PCT) {
      return denied(`indicadores/score rechazan divergencia máxima ${maxDiff.toFixed(3)}% > ${PROTECTIVE_MAX_DIVERGENCE_PCT}%`);
    }
    return {
      useSecondary: true,
      decision: "allowed_labeled",
      reason: "serie secundaria completa, única y etiquetada; no mezclar con primaria",
      requiresLabel: true,
      requiresAlert: false,
    };
  }

  return denied(`consumidor desconocido: ${String(consumer)}`);
}
