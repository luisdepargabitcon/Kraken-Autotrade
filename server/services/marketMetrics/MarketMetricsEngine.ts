// ============================================================
// MarketMetricsEngine.ts
// Motor de evaluación: convierte métricas en decisión PERMITIR/AJUSTAR/BLOQUEAR
// Diseñado para ser plug-in puro: no modifica estado externo, solo evalúa.
// ============================================================

import { log } from "../../utils/logger";
import {
  type MarketMetricsDecision,
  type MetricsEvalContext,
  type MetricsAction,
  type RiskLevel,
  type Bias,
  type ScoreBreakdown,
  type MarketMetricsConfig,
  type MarketMetricDataQuality,
  type MarketMetricObservationMeta,
  METRIC_NAMES,
  SCORE_THRESHOLDS,
  SENSITIVITY_MULTIPLIERS,
  makePassthroughDecision,
} from "./MarketMetricsTypes";

// ---- Umbrales base (aplica multiplicador de sensibilidad) ----
// No se modifican en WP6a. Los umbrales se conservan y solo se analiza alcanzabilidad.
const BASE_THRESHOLDS = {
  netflowHighBtc: 300_000_000,
  netflowMedBtc: 150_000_000,
  stableContractPct: -0.5,
  whaleInflowHighUsd: 200_000_000,
  whaleInflowMedUsd: 80_000_000,
  oiChangePct: 15,
  fundingRateHigh: 0.1,
  fundingRateMed: 0.05,
  liquidationsHighUsd: 150_000_000,
  liquidationsMedUsd: 50_000_000,
} as const;

type MetricValues = Record<string, number | null>;
type MetricMetaMap = Record<string, MarketMetricObservationMeta | undefined>;

interface MetricSpec {
  key: string;
  metric: string;
  ttlMs: number;
  validate?: (value: number) => string | null;
  score: (value: number) => { points: number; reason: string; scope?: string };
}

export class MarketMetricsEngine {
  evaluate(
    context: MetricsEvalContext,
    latestMetrics: MetricValues,
    config: MarketMetricsConfig,
    stalenessMs: Record<string, number>,
    metricMeta: MetricMetaMap = {}
  ): MarketMetricsDecision {
    if (!config.enabled) {
      return makePassthroughDecision(false, config.mode);
    }
    if (context.side === "buy" && !config.applyToBuy) {
      return makePassthroughDecision(true, config.mode, "Métricas no aplicadas a compras (configuración)");
    }
    if (context.side === "sell" && !config.applyToSell) {
      return makePassthroughDecision(true, config.mode, "Métricas no aplicadas a ventas (configuración)");
    }

    const specs = this.buildMetricSpecs(context, config);
    const dataQuality: Record<string, MarketMetricDataQuality> = {};
    const breakdown: ScoreBreakdown[] = [];

    for (const spec of specs) {
      const value = latestMetrics[spec.key];
      const quality = this.assessMetricQuality(
        value,
        stalenessMs[spec.key],
        spec.ttlMs,
        metricMeta[spec.key]?.source ?? null,
        spec.validate
      );
      dataQuality[spec.key] = quality;

      if (quality.state !== "ok") {
        if (quality.state !== "missing") {
          breakdown.push({
            metric: spec.metric,
            value: typeof value === "number" && Number.isFinite(value) ? value : null,
            points: 0,
            reason: quality.reason ?? "Dato no evaluable",
          });
        }
        continue;
      }

      const result = spec.score(value as number);
      breakdown.push({
        metric: spec.metric,
        scope: result.scope,
        value: value as number,
        points: result.points,
        reason: result.reason,
      });
    }

    const okCount = Object.values(dataQuality).filter(q => q.state === "ok").length;
    if (okCount === 0) {
      const decision = makePassthroughDecision(
        true,
        config.mode,
        "Datos de mercado insuficientes (no se evalúa)"
      );
      decision.status = "UNKNOWN";
      decision.dataQuality = dataQuality;
      decision.details.metrics = latestMetrics;
      decision.details.stalenessMs = stalenessMs;
      decision.details.scoreBreakdown = breakdown;
      decision.details.thresholds = this.thresholdsForDetails();
      return decision;
    }

    const mult = SENSITIVITY_MULTIPLIERS[config.sensitivity] ?? 1.0;
    const rawScore = breakdown.reduce((sum, item) => sum + item.points, 0);
    const finalScore = Math.round(rawScore * mult);
    const riskLevel = this.scoreToRiskLevel(finalScore);
    const bias = this.computeBias(context, latestMetrics, breakdown, dataQuality);
    const action = this.riskToAction(riskLevel, context, config);
    const degraded = Object.values(dataQuality).some(q => q.state !== "ok");
    const status = degraded ? "DEGRADED" : "OK";
    const reasons = this.buildReasons(breakdown, action, degraded);
    const adjustments = action === "AJUSTAR"
      ? this.computeAdjustments(riskLevel, finalScore, config)
      : undefined;

    log(
      `[MarketMetrics] ${context.pair} ${context.side.toUpperCase()}: status=${status} score=${finalScore} risk=${riskLevel} bias=${bias} action=${action}`,
      "trading"
    );

    return {
      status,
      dataQuality,
      enabled: true,
      available: true,
      mode: config.mode,
      riskLevel,
      score: finalScore,
      bias,
      action,
      adjustments,
      reasons,
      details: {
        metrics: latestMetrics,
        thresholds: this.thresholdsForDetails(),
        stalenessMs,
        scoreBreakdown: breakdown,
      },
    };
  }

  private buildMetricSpecs(context: MetricsEvalContext, config: MarketMetricsConfig): MetricSpec[] {
    const asset = this.extractAsset(context.pair);
    return [
      {
        key: `${METRIC_NAMES.EXCHANGE_NETFLOW}:${asset}`,
        metric: "exchange_netflow",
        ttlMs: config.stalenessMaxMs.netflow,
        score: value => {
          if (value >= BASE_THRESHOLDS.netflowHighBtc) {
            return { points: 2, reason: "Flujo neto muy alto hacia exchanges" };
          }
          if (value >= BASE_THRESHOLDS.netflowMedBtc) {
            return { points: 1, reason: "Flujo neto moderado hacia exchanges" };
          }
          return { points: 0, reason: "Flujo neto en rango normal" };
        },
      },
      {
        key: `${METRIC_NAMES.WHALE_INFLOW_USD}:ALL`,
        metric: "whale_inflow_usd",
        ttlMs: config.stalenessMaxMs.whaleActivity,
        score: value => {
          if (value >= BASE_THRESHOLDS.whaleInflowHighUsd) {
            return { points: 2, reason: "Grandes inversores enviando masivamente a exchanges" };
          }
          if (value >= BASE_THRESHOLDS.whaleInflowMedUsd) {
            return { points: 1, reason: "Actividad de ballenas hacia exchanges elevada" };
          }
          return { points: 0, reason: "Actividad de ballenas en niveles normales" };
        },
      },
      {
        key: `${METRIC_NAMES.STABLECOIN_SUPPLY_DELTA_24H}:ALL`,
        metric: "stablecoin_supply_delta_24h",
        ttlMs: config.stalenessMaxMs.stablecoins,
        validate: value => Math.abs(value) > 10
          ? "Variación diaria de stablecoins extrema o inconsistente (>10%)"
          : null,
        score: value => {
          if (value <= BASE_THRESHOLDS.stableContractPct * 2) {
            return { points: 2, reason: "Fuerte contracción observada de liquidez agregada en stablecoins" };
          }
          if (value <= BASE_THRESHOLDS.stableContractPct) {
            return { points: 1, reason: "Contracción observada de liquidez agregada en stablecoins" };
          }
          return { points: 0, reason: "Liquidez agregada de stablecoins estable o expansiva" };
        },
      },
      {
        key: `${METRIC_NAMES.OPEN_INTEREST_DELTA_24H_PCT}:${asset}`,
        metric: "open_interest_delta_24h_pct",
        ttlMs: config.stalenessMaxMs.derivatives,
        score: value => {
          if (value >= BASE_THRESHOLDS.oiChangePct) {
            return { points: 1, reason: "Apalancamiento del mercado aumentando en 24h" };
          }
          return { points: 0, reason: "Variación de apalancamiento en niveles normales" };
        },
      },
      {
        key: `${METRIC_NAMES.FUNDING_RATE}:${asset}`,
        metric: "funding_rate",
        ttlMs: config.stalenessMaxMs.funding ?? 9 * 60 * 60 * 1000,
        score: value => {
          const direction = value > 0
            ? "positivo (longs pagan)"
            : value < 0
              ? "negativo (shorts pagan)"
              : "neutro";
          const absValue = Math.abs(value);
          if (absValue >= BASE_THRESHOLDS.fundingRateHigh) {
            return { points: 2, reason: `Funding extremo ${direction}` };
          }
          if (absValue >= BASE_THRESHOLDS.fundingRateMed) {
            return { points: 1, reason: `Funding elevado ${direction}` };
          }
          return { points: 0, reason: `Funding normal ${direction}` };
        },
      },
      {
        key: `${METRIC_NAMES.LIQUIDATIONS_1H_USD}:BTC`,
        metric: "liquidations_1h_usd",
        ttlMs: config.stalenessMaxMs.derivatives,
        score: value => {
          const scope = "BTC_MARKET_CONTEXT";
          if (value >= BASE_THRESHOLDS.liquidationsHighUsd) {
            return {
              points: 2,
              scope,
              reason: "Liquidaciones masivas agregadas de BTC en la última hora (contexto de mercado)",
            };
          }
          if (value >= BASE_THRESHOLDS.liquidationsMedUsd) {
            return {
              points: 1,
              scope,
              reason: "Liquidaciones agregadas de BTC elevadas (contexto de mercado)",
            };
          }
          return {
            points: 0,
            scope,
            reason: "Liquidaciones agregadas de BTC en niveles normales (contexto de mercado)",
          };
        },
      },
    ];
  }

  private assessMetricQuality(
    value: number | null | undefined,
    ageMs: number | undefined,
    ttlMs: number,
    source: string | null,
    validate?: (value: number) => string | null
  ): MarketMetricDataQuality {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return {
        state: "missing",
        ageMs: null,
        source,
        reason: "Métrica ausente o no numérica",
      };
    }
    const invalidReason = validate?.(value) ?? null;
    if (invalidReason) {
      return {
        state: "invalid",
        ageMs: null,
        source,
        reason: invalidReason,
      };
    }
    if (ageMs === undefined || ageMs === null || !Number.isFinite(ageMs)) {
      return {
        state: "unknown_age",
        ageMs: null,
        source,
        reason: "Frescura desconocida: falta timestamp de proveedor",
      };
    }
    const normalizedAgeMs = Math.max(0, ageMs);
    if (normalizedAgeMs > ttlMs) {
      return {
        state: "stale",
        ageMs: normalizedAgeMs,
        source,
        reason: `Dato caducado (${Math.round(normalizedAgeMs / 1000)}s > ${Math.round(ttlMs / 1000)}s)`,
      };
    }
    return { state: "ok", ageMs: normalizedAgeMs, source };
  }

  private thresholdsForDetails(): Record<string, number> {
    return {
      netflowHighBtc: BASE_THRESHOLDS.netflowHighBtc,
      stableContractPct: BASE_THRESHOLDS.stableContractPct,
      whaleInflowHighUsd: BASE_THRESHOLDS.whaleInflowHighUsd,
      oiChangePct: BASE_THRESHOLDS.oiChangePct,
      fundingRateHigh: BASE_THRESHOLDS.fundingRateHigh,
      liquidationsHighUsd: BASE_THRESHOLDS.liquidationsHighUsd,
    };
  }

  private extractAsset(pair: string): string {
    return (pair.split("/")[0] ?? pair).toUpperCase();
  }

  private scoreToRiskLevel(score: number): RiskLevel {
    if (score <= SCORE_THRESHOLDS.LOW.max) return "BAJO";
    if (score <= SCORE_THRESHOLDS.MEDIUM.max) return "MEDIO";
    return "ALTO";
  }

  private computeBias(
    context: MetricsEvalContext,
    metrics: MetricValues,
    breakdown: ScoreBreakdown[],
    dataQuality: Record<string, MarketMetricDataQuality>
  ): Bias {
    const bearishPoints = breakdown.reduce((sum, item) => sum + item.points, 0);
    if (bearishPoints >= 4) return "BAJISTA";
    if (bearishPoints >= 2) return "NEUTRAL";
    const asset = this.extractAsset(context.pair);
    const key = `${METRIC_NAMES.EXCHANGE_NETFLOW}:${asset}`;
    const netflow = metrics[key];
    if (dataQuality[key]?.state === "ok" && typeof netflow === "number" && netflow < -50_000_000) {
      return "ALCISTA";
    }
    return "NEUTRAL";
  }

  private riskToAction(
    riskLevel: RiskLevel,
    ctx: MetricsEvalContext,
    config: MarketMetricsConfig
  ): MetricsAction {
    if (config.mode === "observacion") return "PERMITIR";
    if (riskLevel === "ALTO" && ctx.side === "buy") return "BLOQUEAR";
    if (riskLevel === "MEDIO") return "AJUSTAR";
    return "PERMITIR";
  }

  private computeAdjustments(
    riskLevel: RiskLevel,
    score: number,
    config: MarketMetricsConfig
  ): { minSignalsDelta?: number; sizeMultiplier?: number } {
    if (riskLevel === "MEDIO") {
      const sizeMultiplier = config.sensitivity === "agresivo" ? 0.85 : 0.7;
      return { sizeMultiplier, minSignalsDelta: 1 };
    }
    return {};
  }

  private buildReasons(
    breakdown: ScoreBreakdown[],
    action: MetricsAction,
    degraded: boolean
  ): string[] {
    const relevant = breakdown
      .filter(item => item.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 3);
    const reasons = relevant.map(item => item.reason);

    if (reasons.length === 0) {
      reasons.push(degraded
        ? "Métricas disponibles sin riesgo relevante, pero la evaluación está degradada"
        : "Condiciones de mercado favorables en las métricas evaluadas");
    }
    if (degraded) {
      reasons.push("Evaluación degradada: una o más métricas no están en estado ok");
    }
    if (action !== "PERMITIR" && reasons.length === 0) {
      reasons.push("Datos de mercado insuficientes para evaluar");
    }
    return reasons.slice(0, 4);
  }
}

export const marketMetricsEngine = new MarketMetricsEngine();
