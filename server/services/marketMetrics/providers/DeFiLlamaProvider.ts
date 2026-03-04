// ============================================================
// DeFiLlamaProvider.ts
// Proveedor de métricas de liquidez/stablecoins vía DeFiLlama (gratis, sin key)
// ============================================================

import { log } from "../../../utils/logger";
import type { IMetricsProvider, ProviderFetchResult, RawMetricRecord } from "./IMetricsProvider";

const DEFILLAMA_STABLECOINS_URL = "https://stablecoins.llama.fi/stablecoins?includePrices=false";
const FETCH_TIMEOUT_MS = 10_000;
const SOURCE = "defillama";

// Stablecoins relevantes para medir liquidez del mercado crypto
const TRACKED_STABLECOINS = ["USDT", "USDC", "DAI", "FRAX", "BUSD", "TUSD", "USDP", "GUSD"];

export class DeFiLlamaProvider implements IMetricsProvider {
  readonly name = "defillama";
  readonly enabled = true;

  async fetch(): Promise<ProviderFetchResult> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      let resp: Response;
      try {
        resp = await fetch(DEFILLAMA_STABLECOINS_URL, {
          signal: controller.signal,
          headers: { "Accept": "application/json" },
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!resp.ok) {
        return { records: [], error: `HTTP ${resp.status}`, unavailable: true };
      }

      const data = await resp.json() as any;
      const peggedAssets: any[] = data?.peggedAssets ?? [];

      if (!peggedAssets.length) {
        return { records: [], error: "No peggedAssets in response", unavailable: true };
      }

      const records: RawMetricRecord[] = [];
      const now = new Date();

      let totalCirc24hAgo = 0;
      let totalCircNow = 0;

      for (const asset of peggedAssets) {
        const symbol: string = (asset.symbol ?? "").toUpperCase();
        if (!TRACKED_STABLECOINS.includes(symbol)) continue;

        const circNow: number = asset.circulating?.peggedUSD ?? 0;
        const circ24h: number = asset.circulatingPrevDay?.peggedUSD ?? 0;
        const circ7d: number = asset.circulatingPrevWeek?.peggedUSD ?? 0;

        totalCircNow += circNow;
        totalCirc24hAgo += circ24h > 0 ? circ24h : circNow;

        if (circNow > 0 && circ24h > 0) {
          const delta24h = ((circNow - circ24h) / circ24h) * 100;
          records.push({
            source: SOURCE,
            metric: "stablecoin_supply_delta_24h",
            asset: symbol,
            pair: null,
            value: parseFloat(delta24h.toFixed(4)),
            tsProvider: now,
            meta: { circNow, circ24h, circ7d },
          });
        }

        if (circNow > 0 && circ7d > 0) {
          const delta7d = ((circNow - circ7d) / circ7d) * 100;
          records.push({
            source: SOURCE,
            metric: "stablecoin_supply_delta_7d",
            asset: symbol,
            pair: null,
            value: parseFloat(delta7d.toFixed(4)),
            tsProvider: now,
            meta: { circNow, circ7d },
          });
        }
      }

      // Métrica agregada: delta total del mercado de stablecoins
      if (totalCircNow > 0 && totalCirc24hAgo > 0) {
        const totalDelta24h = ((totalCircNow - totalCirc24hAgo) / totalCirc24hAgo) * 100;
        records.push({
          source: SOURCE,
          metric: "stablecoin_supply_delta_24h",
          asset: "ALL",
          pair: null,
          value: parseFloat(totalDelta24h.toFixed(4)),
          tsProvider: now,
          meta: { totalCircNow, totalCirc24hAgo, trackedCount: TRACKED_STABLECOINS.length },
        });
      }

      log(`[DeFiLlama] Obtenidas ${records.length} métricas de stablecoins`, "trading");
      return { records };
    } catch (err: any) {
      const msg = err?.name === "AbortError" ? "Timeout" : (err?.message ?? String(err));
      log(`[DeFiLlama] Error fetch: ${msg}`, "trading");
      return { records: [], error: msg, unavailable: true };
    }
  }
}

export const deFiLlamaProvider = new DeFiLlamaProvider();
