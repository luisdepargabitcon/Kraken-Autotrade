// ============================================================
// MarketMetricsService.ts
// Orquesta la ingesta periódica de datos de todos los providers
// y almacena en DB. Expone método para leer datos frescos.
// ============================================================

import { log } from "../../utils/logger";
import { storage } from "../../storage";
import { deFiLlamaProvider } from "./providers/DeFiLlamaProvider";
import { coinMetricsProvider } from "./providers/CoinMetricsProvider";
import { whaleAlertProvider } from "./providers/WhaleAlertProvider";
import { coinGlassProvider } from "./providers/CoinGlassProvider";
import { binanceFuturesProvider } from "./providers/BinanceFuturesProvider";
import type { IMetricsProvider } from "./providers/IMetricsProvider";
import {
  type MarketMetricsConfig,
  type MetricSnapshot,
  DEFAULT_METRICS_CONFIG,
} from "./MarketMetricsTypes";

// Estado del último fetch por proveedor
interface ProviderStatus {
  lastFetch: Date | null;
  lastError: string | null;
  available: boolean;
  recordCount: number;
  configured: boolean;  // tiene API key configurada o es gratuito
  optional: boolean;    // true = requiere API key (no bloquea si falta)
}

class MarketMetricsService {
  private providerStatus: Map<string, ProviderStatus> = new Map();
  private isRefreshing = false;

  private readonly providers: IMetricsProvider[] = [
    deFiLlamaProvider,
    coinMetricsProvider,
    whaleAlertProvider,
    // BinanceFutures: proveedor gratuito de OI y funding rate (sin API key)
    // CoinGlass queda como alternativa de pago si hay COINGLASS_API_KEY
    ...(process.env.COINGLASS_API_KEY ? [coinGlassProvider] : [binanceFuturesProvider]),
  ];

  // ---- Configuración (cargada desde bot_config o DEFAULT) ----
  async getConfig(): Promise<MarketMetricsConfig> {
    try {
      const botConfig = await storage.getBotConfig();
      const raw = (botConfig as any)?.marketMetricsConfig;
      if (raw && typeof raw === "object") {
        return { ...DEFAULT_METRICS_CONFIG, ...raw } as MarketMetricsConfig;
      }
    } catch (e: any) {
      log(`[MarketMetrics] Error cargando config: ${e.message}`, "trading");
    }
    return { ...DEFAULT_METRICS_CONFIG };
  }

  // ---- Refresh forzado (manual desde UI) — ignora enabled flag ----
  async refreshForced(): Promise<void> {
    return this.runRefresh();
  }

  // ---- Ingestar datos de todos los providers activos (automático por cron) ----
  async refresh(): Promise<void> {
    const config = await this.getConfig();
    if (!config.enabled) return;
    return this.runRefresh();
  }

  private async runRefresh(): Promise<void> {
    if (this.isRefreshing) {
      log("[MarketMetrics] Refresh ya en progreso, saltando", "trading");
      return;
    }
    this.isRefreshing = true;

    log("[MarketMetrics] Iniciando refresh de métricas...", "trading");

    for (const provider of this.providers) {
      if (!provider.enabled) {
        this.setProviderStatus(provider.name, { available: false, lastError: "Provider no habilitado (falta API key?)", recordCount: 0 });
        continue;
      }

      try {
        const result = await provider.fetch();

        if (result.unavailable || result.error) {
          log(`[MarketMetrics] Provider ${provider.name}: no disponible (${result.error ?? "unavailable"})`, "trading");
          this.setProviderStatus(provider.name, {
            available: false,
            lastError: result.error ?? "unavailable",
            recordCount: 0,
          });
          continue;
        }

        // Persistir en DB
        let saved = 0;
        for (const rec of result.records) {
          try {
            await storage.saveMarketMetricSnapshot({
              source: rec.source,
              metric: rec.metric,
              asset: rec.asset,
              pair: rec.pair,
              value: rec.value,
              tsProvider: rec.tsProvider,
              tsIngested: new Date(),
              meta: rec.meta,
            });
            saved++;
          } catch (dbErr: any) {
            log(`[MarketMetrics] DB save error (${provider.name}/${rec.metric}): ${dbErr.message}`, "trading");
          }
        }

        this.setProviderStatus(provider.name, {
          available: true,
          lastError: null,
          recordCount: saved,
        });
        log(`[MarketMetrics] Provider ${provider.name}: ${saved} registros guardados`, "trading");
      } catch (err: any) {
        log(`[MarketMetrics] Error en provider ${provider.name}: ${err.message}`, "trading");
        this.setProviderStatus(provider.name, {
          available: false,
          lastError: err.message,
          recordCount: 0,
        });
      }
    }

    this.isRefreshing = false;
    log("[MarketMetrics] Refresh completado", "trading");
  }

  // ---- Obtener las métricas más recientes para evaluación ----
  // Devuelve un mapa: "metric:asset" → valor (o null si stale)
  async getLatestMetrics(
    config: MarketMetricsConfig
  ): Promise<{ metrics: Record<string, number | null>; stalenessMs: Record<string, number> }> {
    const metrics: Record<string, number | null> = {};
    const stalenessMs: Record<string, number> = {};
    const now = Date.now();

    try {
      const snapshots = await storage.getLatestMarketMetrics();
      for (const snap of snapshots) {
        const key = `${snap.metric}:${snap.asset ?? "ALL"}`;
        const ageMs = now - snap.tsIngested.getTime();
        stalenessMs[key] = ageMs;
        metrics[key] = snap.value;
      }
    } catch (e: any) {
      log(`[MarketMetrics] Error leyendo métricas de DB: ${e.message}`, "trading");
    }

    return { metrics, stalenessMs };
  }

  // ---- Estado de los proveedores para UI ----
  getProviderStatuses(): Record<string, ProviderStatus & { name: string }> {
    const result: Record<string, ProviderStatus & { name: string }> = {};
    for (const provider of this.providers) {
      const status = this.providerStatus.get(provider.name) ?? {
        lastFetch: null,
        lastError: null,
        available: false,
        recordCount: 0,
        configured: provider.enabled,
        optional: provider.optional,
      };
      result[provider.name] = {
        ...status,
        name: provider.name,
        configured: provider.enabled,
        optional: provider.optional,
      };
    }
    return result;
  }

  private setProviderStatus(name: string, partial: Partial<ProviderStatus>): void {
    const provider = this.providers.find(p => p.name === name);
    const prev = this.providerStatus.get(name) ?? {
      lastFetch: null,
      lastError: null,
      available: false,
      recordCount: 0,
      configured: provider?.enabled ?? false,
      optional: provider?.optional ?? false,
    };
    this.providerStatus.set(name, {
      ...prev,
      ...partial,
      lastFetch: new Date(),
    });
  }
}

export const marketMetricsService = new MarketMetricsService();
