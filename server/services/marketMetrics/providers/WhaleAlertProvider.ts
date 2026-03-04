// ============================================================
// WhaleAlertProvider.ts
// Proveedor de alertas de ballenas (requiere WHALE_ALERT_API_KEY en ENV)
// Si no hay key o falla → unavailable, NO bloquea el bot
// ============================================================

import { log } from "../../../utils/logger";
import type { IMetricsProvider, ProviderFetchResult, RawMetricRecord } from "./IMetricsProvider";

const WHALE_ALERT_BASE = "https://api.whale-alert.io/v1";
const FETCH_TIMEOUT_MS = 10_000;
const SOURCE = "whalealert";
const MIN_VALUE_USD = 1_000_000; // Solo transferencias >= $1M
const LOOKBACK_HOURS = 2;

// Símbolos que el bot opera (para filtrar transferencias relevantes)
const TRACKED_SYMBOLS = new Set(["btc", "eth", "sol", "xrp", "ton", "usdt", "usdc"]);

export class WhaleAlertProvider implements IMetricsProvider {
  readonly name = "whalealert";

  get enabled(): boolean {
    return !!process.env.WHALE_ALERT_API_KEY;
  }

  async fetch(): Promise<ProviderFetchResult> {
    const apiKey = process.env.WHALE_ALERT_API_KEY;
    if (!apiKey) {
      return { records: [], unavailable: true, error: "WHALE_ALERT_API_KEY no configurada" };
    }

    try {
      const now = new Date();
      const fromTs = Math.floor(Date.now() / 1000) - LOOKBACK_HOURS * 3600;

      const url = `${WHALE_ALERT_BASE}/transactions?api_key=${apiKey}&start=${fromTs}&min_value=${MIN_VALUE_USD}&cursor=0&limit=100`;

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
        if (resp.status === 401 || resp.status === 403) {
          return { records: [], error: "API key inválida o sin permisos", unavailable: true };
        }
        if (resp.status === 429) {
          return { records: [], error: "Rate limit (429)", unavailable: true };
        }
        return { records: [], error: `HTTP ${resp.status}`, unavailable: true };
      }

      const data = await resp.json() as any;
      const transactions: any[] = data?.transactions ?? [];

      // Agrupar: calcular inflow a exchanges por símbolo
      const inflowBySymbol: Record<string, number> = {};
      let totalInflowUsd = 0;
      let txCount = 0;

      for (const tx of transactions) {
        const symbol: string = (tx.symbol ?? "").toLowerCase();
        if (!TRACKED_SYMBOLS.has(symbol)) continue;

        // Solo transacciones hacia exchanges (to.owner_type === "exchange")
        const toType = tx.to?.owner_type ?? "";
        const fromType = tx.from?.owner_type ?? "";
        const isExchangeInflow = toType === "exchange";

        if (!isExchangeInflow) continue;

        const valueUsd: number = tx.amount_usd ?? 0;
        if (valueUsd < MIN_VALUE_USD) continue;

        inflowBySymbol[symbol] = (inflowBySymbol[symbol] ?? 0) + valueUsd;
        totalInflowUsd += valueUsd;
        txCount++;
      }

      const records: RawMetricRecord[] = [];

      // Métricas por símbolo
      for (const [symbol, inflowUsd] of Object.entries(inflowBySymbol)) {
        records.push({
          source: SOURCE,
          metric: "whale_inflow_usd",
          asset: symbol.toUpperCase(),
          pair: null,
          value: parseFloat(inflowUsd.toFixed(2)),
          tsProvider: now,
          meta: { lookbackHours: LOOKBACK_HOURS, minValueUsd: MIN_VALUE_USD },
        });
      }

      // Métrica agregada total
      if (txCount > 0) {
        records.push({
          source: SOURCE,
          metric: "whale_inflow_usd",
          asset: "ALL",
          pair: null,
          value: parseFloat(totalInflowUsd.toFixed(2)),
          tsProvider: now,
          meta: { txCount, lookbackHours: LOOKBACK_HOURS, minValueUsd: MIN_VALUE_USD },
        });
      }

      log(`[WhaleAlert] Obtenidas ${records.length} métricas de ballenas (${txCount} txs a exchanges)`, "trading");
      return { records };
    } catch (err: any) {
      const msg = err?.name === "AbortError" ? "Timeout" : (err?.message ?? String(err));
      log(`[WhaleAlert] Error fetch: ${msg}`, "trading");
      return { records: [], error: msg, unavailable: true };
    }
  }
}

export const whaleAlertProvider = new WhaleAlertProvider();
