// ============================================================
// BinanceFuturesProvider.ts
// Proveedor de métricas de derivados vía Binance Futures API (gratis, sin key)
// Alternativa a CoinGlass cuando no hay COINGLASS_API_KEY
// Métricas: open_interest (USD), funding_rate (%)
// ============================================================

import { log } from "../../../utils/logger";
import type { IMetricsProvider, ProviderFetchResult, RawMetricRecord } from "./IMetricsProvider";

const BINANCE_FUTURES_BASE = "https://fapi.binance.com/fapi/v1";
const BINANCE_FUTURES_DATA  = "https://fapi.binance.com/futures/data";
const FETCH_TIMEOUT_MS = 12_000;
const SOURCE = "binance";

const TRACKED_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"];
const SYMBOL_TO_ASSET: Record<string, string> = {
  BTCUSDT: "BTC",
  ETHUSDT: "ETH",
  SOLUSDT: "SOL",
  XRPUSDT: "XRP",
};

export class BinanceFuturesProvider implements IMetricsProvider {
  readonly name = "binance";
  readonly enabled = true;
  readonly optional = false;

  async fetch(): Promise<ProviderFetchResult> {
    try {
      const records: RawMetricRecord[] = [];
      const now = new Date();

      await Promise.all([
        this.fetchOpenInterest(records, now),
        this.fetchFundingRate(records, now),
      ]);

      if (records.length === 0) {
        return { records: [], error: "No se obtuvieron datos de Binance Futures", unavailable: true };
      }

      log(`[Binance] Obtenidas ${records.length} métricas de derivados`, "trading");
      return { records };
    } catch (err: any) {
      const msg = err?.name === "AbortError" ? "Timeout" : (err?.message ?? String(err));
      log(`[Binance] Error fetch: ${msg}`, "trading");
      return { records: [], error: msg, unavailable: true };
    }
  }

  private async doFetch(url: string): Promise<any | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { "Accept": "application/json" },
      });
      if (!resp.ok) {
        log(`[Binance] HTTP ${resp.status} for ${url}`, "trading");
        return null;
      }
      return await resp.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  // Open Interest en USD via openInterestHist endpoint (sumOpenInterestValue = USDT)
  private async fetchOpenInterest(records: RawMetricRecord[], now: Date): Promise<void> {
    for (const symbol of TRACKED_SYMBOLS) {
      try {
        const url = `${BINANCE_FUTURES_DATA}/openInterestHist?symbol=${symbol}&period=5m&limit=1`;
        const data = await this.doFetch(url);
        if (!Array.isArray(data) || data.length === 0) continue;

        const row = data[0];
        const oiUsd = parseFloat(row.sumOpenInterestValue ?? "0");
        if (oiUsd > 0) {
          records.push({
            source: SOURCE,
            metric: "open_interest",
            asset: SYMBOL_TO_ASSET[symbol] ?? symbol,
            pair: null,
            value: parseFloat(oiUsd.toFixed(2)),
            tsProvider: row.timestamp ? new Date(row.timestamp) : now,
            meta: { symbol, sumOpenInterest: row.sumOpenInterest },
          });
        }
      } catch (e: any) {
        log(`[Binance] OI error for ${symbol}: ${e.message}`, "trading");
      }
    }
  }

  // Funding Rate (%) — último rate conocido por símbolo
  private async fetchFundingRate(records: RawMetricRecord[], now: Date): Promise<void> {
    for (const symbol of TRACKED_SYMBOLS) {
      try {
        const url = `${BINANCE_FUTURES_BASE}/fundingRate?symbol=${symbol}&limit=1`;
        const data = await this.doFetch(url);
        if (!Array.isArray(data) || data.length === 0) continue;

        const row = data[0];
        const rate = parseFloat(row.fundingRate ?? "0");
        records.push({
          source: SOURCE,
          metric: "funding_rate",
          asset: SYMBOL_TO_ASSET[symbol] ?? symbol,
          pair: null,
          value: parseFloat((rate * 100).toFixed(6)), // convertir a %
          tsProvider: row.fundingTime ? new Date(Number(row.fundingTime)) : now,
          meta: { symbol, markPrice: row.markPrice },
        });
      } catch (e: any) {
        log(`[Binance] Funding error for ${symbol}: ${e.message}`, "trading");
      }
    }
  }
}

export const binanceFuturesProvider = new BinanceFuturesProvider();
