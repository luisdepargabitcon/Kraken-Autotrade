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
  readonly optional = true; // Free tier no garantiza todos los assets/métricas

  async fetch(): Promise<ProviderFetchResult> {
    try {
      const records: RawMetricRecord[] = [];
      const now = new Date();

      // Fecha de ayer (datos community tienen 1d lag) — formato YYYY-MM-DD
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const startDate = yesterday.toISOString().split("T")[0];
      const endDate   = new Date().toISOString().split("T")[0];
      const metrics   = "FlowInExUSD,FlowOutExUSD,FlowNetInExUSD";

      // Fetch por asset individual: CoinMetrics Community no siempre tiene
      // métricas de flujo para todos los assets (SOL, XRP pueden dar 400).
      // Saltar silenciosamente si el asset no está disponible en el tier gratuito.
      for (const [symbol, cmAsset] of Object.entries(TRACKED_ASSETS)) {
        try {
          const url = `${COINMETRICS_BASE}/timeseries/asset-metrics?assets=${cmAsset}&metrics=${metrics}&start_time=${startDate}&end_time=${endDate}&page_size=5`;

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

          if (resp.status === 400) {
            // Asset/métrica no disponible en tier gratuito — skip silencioso
            log(`[CoinMetrics] ${symbol}: métricas de flujo no disponibles (tier gratuito)`, "trading");
            continue;
          }
          if (resp.status === 429) {
            log("[CoinMetrics] Rate limit (429), deteniendo fetch", "trading");
            break;
          }
          if (!resp.ok) {
            log(`[CoinMetrics] ${symbol}: HTTP ${resp.status}`, "trading");
            continue;
          }

          const data = await resp.json() as any;
          const dataPoints: any[] = data?.data ?? [];

          for (const point of dataPoints) {
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
        } catch (assetErr: any) {
          const msg = assetErr?.name === "AbortError" ? "Timeout" : (assetErr?.message ?? String(assetErr));
          log(`[CoinMetrics] Error fetching ${symbol}: ${msg}`, "trading");
        }
      }

      if (records.length === 0) {
        return { records: [], error: "Métricas de flujo no disponibles en tier gratuito", unavailable: true };
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
