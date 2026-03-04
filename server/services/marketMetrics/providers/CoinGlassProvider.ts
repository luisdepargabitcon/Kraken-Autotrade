// ============================================================
// CoinGlassProvider.ts
// Proveedor de derivados: open interest, funding rate, liquidaciones
// Requiere COINGLASS_API_KEY en ENV. Si no hay key → unavailable, NO bloquea.
// ============================================================

import { log } from "../../../utils/logger";
import type { IMetricsProvider, ProviderFetchResult, RawMetricRecord } from "./IMetricsProvider";

const COINGLASS_BASE = "https://open-api.coinglass.com/public/v2";
const FETCH_TIMEOUT_MS = 10_000;
const SOURCE = "coinglass";

const TRACKED_SYMBOLS = ["BTC", "ETH", "SOL", "XRP"];

export class CoinGlassProvider implements IMetricsProvider {
  readonly name = "coinglass";

  get enabled(): boolean {
    return !!process.env.COINGLASS_API_KEY;
  }

  async fetch(): Promise<ProviderFetchResult> {
    const apiKey = process.env.COINGLASS_API_KEY;
    if (!apiKey) {
      return { records: [], unavailable: true, error: "COINGLASS_API_KEY no configurada" };
    }

    try {
      const records: RawMetricRecord[] = [];
      const now = new Date();

      await Promise.all([
        this.fetchOpenInterest(apiKey, records, now),
        this.fetchFundingRate(apiKey, records, now),
        this.fetchLiquidations(apiKey, records, now),
      ]);

      log(`[CoinGlass] Obtenidas ${records.length} métricas de derivados`, "trading");
      return { records };
    } catch (err: any) {
      const msg = err?.name === "AbortError" ? "Timeout" : (err?.message ?? String(err));
      log(`[CoinGlass] Error fetch: ${msg}`, "trading");
      return { records: [], error: msg, unavailable: true };
    }
  }

  private async fetchOpenInterest(apiKey: string, records: RawMetricRecord[], now: Date): Promise<void> {
    try {
      const url = `${COINGLASS_BASE}/open_interest?symbol=${TRACKED_SYMBOLS.join(",")}`;
      const data = await this.doFetch(url, apiKey);
      if (!data) return;

      const items: any[] = data?.data ?? [];
      for (const item of items) {
        const symbol = (item.symbol ?? "").toUpperCase();
        if (!TRACKED_SYMBOLS.includes(symbol)) continue;
        const oiUsd: number = item.openInterest ?? 0;
        if (oiUsd > 0) {
          records.push({
            source: SOURCE,
            metric: "open_interest",
            asset: symbol,
            pair: null,
            value: parseFloat(oiUsd.toFixed(2)),
            tsProvider: now,
            meta: { changePercent24h: item.openInterestChangePercent24h },
          });
        }
      }
    } catch (e: any) {
      log(`[CoinGlass] OI fetch error: ${e.message}`, "trading");
    }
  }

  private async fetchFundingRate(apiKey: string, records: RawMetricRecord[], now: Date): Promise<void> {
    try {
      const url = `${COINGLASS_BASE}/funding_rate?symbol=${TRACKED_SYMBOLS.join(",")}`;
      const data = await this.doFetch(url, apiKey);
      if (!data) return;

      const items: any[] = data?.data ?? [];
      for (const item of items) {
        const symbol = (item.symbol ?? "").toUpperCase();
        if (!TRACKED_SYMBOLS.includes(symbol)) continue;
        const rate: number = item.fundingRate ?? 0;
        records.push({
          source: SOURCE,
          metric: "funding_rate",
          asset: symbol,
          pair: null,
          value: parseFloat((rate * 100).toFixed(6)), // en %
          tsProvider: now,
          meta: { raw: rate },
        });
      }
    } catch (e: any) {
      log(`[CoinGlass] Funding fetch error: ${e.message}`, "trading");
    }
  }

  private async fetchLiquidations(apiKey: string, records: RawMetricRecord[], now: Date): Promise<void> {
    try {
      // Liquidaciones de la última hora
      const url = `${COINGLASS_BASE}/liquidation_chart?symbol=BTC&interval=1h&limit=2`;
      const data = await this.doFetch(url, apiKey);
      if (!data) return;

      const items: any[] = data?.data ?? [];
      if (items.length === 0) return;

      const latest = items[items.length - 1];
      const liquidationsUsd: number = (latest?.longLiquidationUsd ?? 0) + (latest?.shortLiquidationUsd ?? 0);
      if (liquidationsUsd > 0) {
        records.push({
          source: SOURCE,
          metric: "liquidations_1h_usd",
          asset: "BTC",
          pair: null,
          value: parseFloat(liquidationsUsd.toFixed(2)),
          tsProvider: now,
          meta: { long: latest?.longLiquidationUsd, short: latest?.shortLiquidationUsd },
        });
      }
    } catch (e: any) {
      log(`[CoinGlass] Liquidations fetch error: ${e.message}`, "trading");
    }
  }

  private async doFetch(url: string, apiKey: string): Promise<any | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { "coinglassSecret": apiKey, "Accept": "application/json" },
      });
      if (!resp.ok) return null;
      return await resp.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const coinGlassProvider = new CoinGlassProvider();
