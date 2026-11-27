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
import type { IMetricsProvider, RawMetricRecord } from "./providers/IMetricsProvider";
import { computeOpenInterestDelta24hPct } from "./openInterestDelta";
import {
  type MarketMetricsConfig,
  type MetricSnapshot,
  type MarketMetricObservationMeta,
  METRIC_NAMES,
  DEFAULT_METRICS_CONFIG,
} from "./MarketMetricsTypes";

// Estado del último fetch por proveedor
export type MarketMetricsProviderState = "ok" | "no_credentials" | "no_coverage" | "degraded" | "error";

interface ProviderStatus {
  lastFetch: Date | null;
  lastError: string | null;
  available: boolean;
  recordCount: number;
  configured: boolean;
  optional: boolean;
  state: MarketMetricsProviderState;
  lastObservationTs: Date | null;
  coverage: Record<string, number>;
}

const REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
const STARTUP_SKIP_WINDOW_MS = 3.5 * 60 * 60 * 1000;

class MarketMetricsService {
  private providerStatus: Map<string, ProviderStatus> = new Map();
  private isRefreshing = false;
  private invocationCount = 0;
  private evaluationPersistedCount = 0;
  private readonly consumers = ["SPOT legacy applyMarketMetricsGate", "IDCA entry-diagnostics advisory"];
  sleepMs: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms));
  random: () => number = () => Math.random();

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

  async refreshIfDue(): Promise<void> {
    const config = await this.getConfig();
    if (!config.enabled) return;
    try {
      const snapshots = await storage.getLatestMarketMetrics();
      const newestMs = Math.max(0, ...snapshots.map(snap => snap.tsIngested.getTime()));
      if (newestMs > 0 && Date.now() - newestMs < STARTUP_SKIP_WINDOW_MS) {
        log("[MarketMetrics] Refresh de arranque omitido: snapshots recientes", "trading");
        return;
      }
    } catch (e: any) {
      log(`[MarketMetrics] No se pudo comprobar refresh previo: ${e.message}`, "trading");
    }
    return this.runRefresh();
  }

  private async runRefresh(): Promise<void> {
    if (this.isRefreshing) {
      log("[MarketMetrics] Refresh ya en progreso, saltando", "trading");
      return;
    }
    this.isRefreshing = true;

    log("[MarketMetrics] Iniciando refresh de métricas...", "trading");

    let providerIndex = 0;
    for (const provider of this.providers) {
      if (providerIndex > 0) {
        const jitterMs = Math.floor(250 + this.random() * 500);
        await this.sleepMs(jitterMs);
      }
      providerIndex++;
      if (!provider.enabled) {
        this.setProviderStatus(provider.name, {
          available: false,
          lastError: "Provider no habilitado (falta API key?)",
          recordCount: 0,
          state: provider.optional ? "no_credentials" : "no_coverage",
        });
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
            state: this.classifyFetchFailure(provider, result.error),
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
          state: "ok",
          lastObservationTs: this.latestObservationTs(result.records),
          coverage: this.coverageOf(result.records),
        });
        log(`[MarketMetrics] Provider ${provider.name}: ${saved} registros guardados`, "trading");
      } catch (err: any) {
        log(`[MarketMetrics] Error en provider ${provider.name}: ${err.message}`, "trading");
        this.setProviderStatus(provider.name, {
          available: false,
          lastError: err.message,
          recordCount: 0,
          state: "error",
        });
      }
    }

    this.isRefreshing = false;
    log("[MarketMetrics] Refresh completado", "trading");
  }

  // ---- Obtener las métricas más recientes para evaluación ----
  // Devuelve "metric:asset" → valor. La frescura usa tsProvider; si no existe,
  // la clave no aparece en stalenessMs y el motor la clasifica como unknown_age.
  async getLatestMetrics(
    config: MarketMetricsConfig
  ): Promise<{
    metrics: Record<string, number | null>;
    stalenessMs: Record<string, number>;
    metricMeta: Record<string, MarketMetricObservationMeta>;
  }> {
    const metrics: Record<string, number | null> = {};
    const stalenessMs: Record<string, number> = {};
    const metricMeta: Record<string, MarketMetricObservationMeta> = {};
    const nowMs = Date.now();

    try {
      const snapshots = await storage.getLatestMarketMetrics();
      for (const snap of snapshots) {
        const key = `${snap.metric}:${snap.asset ?? "ALL"}`;
        metrics[key] = snap.value;
        metricMeta[key] = {
          source: snap.source ?? null,
          tsProviderMs: snap.tsProvider?.getTime() ?? null,
          tsIngestedMs: snap.tsIngested?.getTime() ?? null,
        };
        if (snap.tsProvider) {
          stalenessMs[key] = Math.max(0, nowMs - snap.tsProvider.getTime());
        }
      }
      await this.addOpenInterestDeltaMetrics(snapshots as any[], metrics, stalenessMs, metricMeta, nowMs);
    } catch (e: any) {
      log(`[MarketMetrics] Error leyendo métricas de DB: ${e.message}`, "trading");
    }

    return { metrics, stalenessMs, metricMeta };
  }

  private async addOpenInterestDeltaMetrics(
    snapshots: Array<{
      source: string;
      metric: string;
      asset: string | null;
      value: number;
      tsProvider: Date | null;
      tsIngested: Date;
      meta: Record<string, unknown>;
    }>,
    metrics: Record<string, number | null>,
    stalenessMs: Record<string, number>,
    metricMeta: Record<string, MarketMetricObservationMeta>,
    nowMs: number
  ): Promise<void> {
    const openInterestSnapshots = snapshots.filter(snap => snap.metric === METRIC_NAMES.OPEN_INTEREST && snap.asset);
    for (const snap of openInterestSnapshots) {
      const asset = String(snap.asset).toUpperCase();
      const key = `${METRIC_NAMES.OPEN_INTEREST_DELTA_24H_PCT}:${asset}`;
      if (metrics[key] !== undefined) continue;

      const providerDelta = Number(snap.meta?.changePercent24h);
      if (Number.isFinite(providerDelta)) {
        metrics[key] = providerDelta;
        if (snap.tsProvider) stalenessMs[key] = Math.max(0, nowMs - snap.tsProvider.getTime());
        metricMeta[key] = {
          source: snap.source,
          tsProviderMs: snap.tsProvider?.getTime() ?? null,
          tsIngestedMs: snap.tsIngested?.getTime() ?? null,
        };
        continue;
      }

      const currentTsMs = snap.tsProvider?.getTime() ?? snap.tsIngested.getTime();
      if (!snap.tsProvider || !Number.isFinite(snap.value) || snap.value <= 0) continue;
      try {
        const history = await storage.getMarketMetricSnapshots({
          source: snap.source,
          metric: METRIC_NAMES.OPEN_INTEREST,
          asset: snap.asset,
          since: new Date(nowMs - 27 * 60 * 60 * 1000),
          limit: 200,
        });
        const series = history
          .map(item => ({
            value: item.value,
            tsProviderMs: item.tsProvider?.getTime() ?? item.tsIngested.getTime(),
            source: item.source,
            asset: String(item.asset ?? "").toUpperCase(),
            unit: String(item.meta?.unit ?? "USD"),
          }))
          .filter(item => Number.isFinite(item.tsProviderMs));
        if (!series.some(item => item.tsProviderMs === currentTsMs)) {
          series.push({
            value: snap.value,
            tsProviderMs: currentTsMs,
            source: snap.source,
            asset,
            unit: String(snap.meta?.unit ?? "USD"),
          });
        }
        const delta = computeOpenInterestDelta24hPct(series, {
          nowMs,
          source: snap.source,
          asset,
          unit: String(snap.meta?.unit ?? "USD"),
        });
        if (delta.state === "ok" && delta.deltaPct !== null) {
          metrics[key] = delta.deltaPct;
          stalenessMs[key] = Math.max(0, nowMs - currentTsMs);
          metricMeta[key] = {
            source: snap.source,
            tsProviderMs: currentTsMs,
            tsIngestedMs: snap.tsIngested?.getTime() ?? null,
          };
        }
      } catch (e: any) {
        log(`[MarketMetrics] OI delta ${asset}: ${e.message}`, "trading");
      }
    }
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
        state: provider.enabled ? "no_coverage" : "no_credentials",
        lastObservationTs: null,
        coverage: {},
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

  private latestObservationTs(records: RawMetricRecord[]): Date | null {
    const newest = Math.max(0, ...records.map(rec => rec.tsProvider?.getTime() ?? 0));
    return newest > 0 ? new Date(newest) : null;
  }

  private coverageOf(records: RawMetricRecord[]): Record<string, number> {
    const coverage: Record<string, number> = {};
    for (const rec of records) {
      coverage[rec.metric] = (coverage[rec.metric] ?? 0) + 1;
    }
    return coverage;
  }

  private classifyFetchFailure(provider: IMetricsProvider, error?: string): MarketMetricsProviderState {
    const text = (error ?? "").toLowerCase();
    if (text.includes("key") || text.includes("credential") || text.includes("no configurada")) {
      return "no_credentials";
    }
    if (text.includes("no disponible") || text.includes("not available") || text.includes("coverage")) {
      return "no_coverage";
    }
    if (provider.optional) return "degraded";
    return "error";
  }

  recordEvaluationInvocation(): void {
    this.invocationCount++;
  }

  recordEvaluationPersisted(): void {
    this.evaluationPersistedCount++;
  }

  getConsumptionStats(): {
    invocations: number;
    evaluationsPersisted: number;
    consumers: string[];
  } {
    return {
      invocations: this.invocationCount,
      evaluationsPersisted: this.evaluationPersistedCount,
      consumers: [...this.consumers],
    };
  }

  async getDiagnostics(): Promise<Record<string, unknown>> {
    const providers = this.getProviderStatuses();
    let snapshots: any[] = [];
    try {
      snapshots = await storage.getLatestMarketMetrics();
    } catch {
      snapshots = [];
    }
    for (const snap of snapshots) {
      const status = providers[snap.source] as any;
      if (!status) continue;
      const ts = snap.tsProvider ?? snap.tsIngested;
      if (!status.lastObservationTs || ts > status.lastObservationTs) {
        status.lastObservationTs = ts;
      }
    }
    const now = Date.now();
    const serialized: Record<string, unknown> = {};
    for (const [name, status] of Object.entries(providers)) {
      serialized[name] = {
        ...status,
        lastObservationAgeMs: status.lastObservationTs
          ? Math.max(0, now - status.lastObservationTs.getTime())
          : null,
      };
    }
    return {
      providers: serialized,
      consumption: this.getConsumptionStats(),
    };
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
      state: provider?.enabled ? "no_coverage" : "no_credentials",
      lastObservationTs: null,
      coverage: {},
    };
    this.providerStatus.set(name, {
      ...prev,
      ...partial,
      lastFetch: new Date(),
    });
  }
}

export const marketMetricsService = new MarketMetricsService();
