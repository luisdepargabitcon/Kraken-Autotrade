// ============================================================
// CoinMetricsProvider.ts
// Proveedor de flujos netos hacia exchanges vía CoinMetrics (gratis con límites)
// ============================================================

import { log } from "../../../utils/logger";
import type { IMetricsProvider, ProviderFetchResult, RawMetricRecord } from "./IMetricsProvider";

const COINMETRICS_BASE = "https://community-api.coinmetrics.io/v4";
const FETCH_TIMEOUT_MS = 12_000;
const SOURCE = "coinmetrics";

// Assets que el bot puede operar (mapeados a tickers de CoinMetrics)
const TRACKED_ASSETS: Record<string, string> = {
  BTC: "btc",
  ETH: "eth",
  SOL: "sol",
  XRP: "xrp",
};

export class CoinMetricsProvider implements IMetricsProvider {
  readonly name = "coinmetrics";
  readonly enabled = true;

  async fetch(): Promise<ProviderFetchResult> {
    try {
      const records: RawMetricRecord[] = [];
      const now = new Date();
      const errors: string[] = [];

      // CoinMetrics Community API: asset metrics endpoint
      // Métricas disponibles gratis: FlowInExUSD, FlowOutExUSD, FlowNetInExUSD
      const assets = Object.keys(TRACKED_ASSETS);
      const assetList = Object.values(TRACKED_ASSETS).join(",");
      const metrics = "FlowInExUSD,FlowOutExUSD,FlowNetInExUSD";

      // Fecha de ayer (los datos community tienen 1d lag)
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const startDate = yesterday.toISOString().split("T")[0];
      const endDate = new Date().toISOString().split("T")[0];

      const url = `${COINMETRICS_BASE}/timeseries/asset-metrics?assets=${assetList}&metrics=${metrics}&start_time=${startDate}&end_time=${endDate}&page_size=10`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      let resp: Response;
      try {
        resp = await fetch(url, {
          signal: controller.signal,
          headers: { "Accept": "application/json" },
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!resp.ok) {
        if (resp.status === 429) {
          return { records: [], error: "Rate limit (429)", unavailable: true };
        }
        return { records: [], error: `HTTP ${resp.status}`, unavailable: true };
      }

      const data = await resp.json() as any;
      const dataPoints: any[] = data?.data ?? [];

      for (const point of dataPoints) {
        const cmAsset: string = (point.asset ?? "").toLowerCase();
        const symbol = Object.entries(TRACKED_ASSETS)
          .find(([, cm]) => cm === cmAsset)?.[0] ?? cmAsset.toUpperCase();

        const tsProvider = point.time ? new Date(point.time) : now;

        const netflow = parseFloat(point.FlowNetInExUSD ?? "");
        const inflow  = parseFloat(point.FlowInExUSD ?? "");
        const outflow = parseFloat(point.FlowOutExUSD ?? "");

        if (Number.isFinite(netflow)) {
          records.push({
            source: SOURCE,
            metric: "exchange_netflow",
            asset: symbol,
            pair: null,
            value: parseFloat(netflow.toFixed(2)),
            tsProvider,
            meta: { inflow, outflow, date: point.time },
          });
        }

        if (Number.isFinite(inflow)) {
          records.push({
            source: SOURCE,
            metric: "exchange_inflow_usd",
            asset: symbol,
            pair: null,
            value: parseFloat(inflow.toFixed(2)),
            tsProvider,
            meta: { date: point.time },
          });
        }
      }

      if (errors.length) {
        log(`[CoinMetrics] Parcial: ${errors.join("; ")}`, "trading");
      }

      log(`[CoinMetrics] Obtenidas ${records.length} métricas de flujos`, "trading");
      return { records };
    } catch (err: any) {
      const msg = err?.name === "AbortError" ? "Timeout" : (err?.message ?? String(err));
      log(`[CoinMetrics] Error fetch: ${msg}`, "trading");
      return { records: [], error: msg, unavailable: true };
    }
  }
}

export const coinMetricsProvider = new CoinMetricsProvider();
