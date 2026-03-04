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
  METRIC_NAMES,
  SCORE_THRESHOLDS,
  SENSITIVITY_MULTIPLIERS,
  makePassthroughDecision,
} from "./MarketMetricsTypes";

// ---- Umbrales base (aplica multiplicador de sensibilidad) ----
const BASE_THRESHOLDS = {
  // Flujo neto hacia exchanges muy alto (USD): señal de presión de venta
  netflowHighBtc:     300_000_000,   // $300M/día BTC hacia exchanges = alerta
  netflowMedBtc:      150_000_000,   // $150M/día = moderado

  // Contracción de stablecoins 24h: liquidez saliendo
  stableContractPct:  -0.5,          // más de -0.5% en 24h = contracción significativa

  // Whale inflow a exchanges (USD en 2h)
  whaleInflowHighUsd: 200_000_000,   // $200M en 2h = alerta alta
  whaleInflowMedUsd:  80_000_000,    // $80M en 2h = moderado

  // Open Interest (% cambio 24h): apalancamiento creciente
  oiChangePct:        15,            // +15% en 24h = elevado

  // Funding rate: mercado muy cargado (%)
  fundingRateHigh:    0.1,           // 0.1% = muy alto (equivale ~3x diario)
  fundingRateMed:     0.05,          // 0.05% = moderado

  // Liquidaciones 1h (USD): mercado inestable
  liquidationsHighUsd: 150_000_000,  // $150M en 1h = muy alto
  liquidationsMedUsd:  50_000_000,   // $50M en 1h = moderado
} as const;

export class MarketMetricsEngine {

  evaluate(
    context: MetricsEvalContext,
    latestMetrics: Record<string, number | null>,
    config: MarketMetricsConfig,
    stalenessMs: Record<string, number>
  ): MarketMetricsDecision {

    // --- Passthrough: módulo desactivado ---
    if (!config.enabled) {
      return makePassthroughDecision(false, config.mode);
    }

    // --- Passthrough: lado no aplicable ---
    if (context.side === "buy" && !config.applyToBuy) {
      return makePassthroughDecision(true, config.mode, "Métricas no aplicadas a compras (configuración)");
    }
    if (context.side === "sell" && !config.applyToSell) {
      return makePassthroughDecision(true, config.mode, "Métricas no aplicadas a ventas (configuración)");
    }

    // --- Passthrough: sin datos disponibles ---
    const hasAnyData = Object.values(latestMetrics).some(v => v !== null && Number.isFinite(v));
    if (!hasAnyData) {
      return makePassthroughDecision(true, config.mode, "Sin datos de métricas disponibles");
    }

    const mult = SENSITIVITY_MULTIPLIERS[config.sensitivity] ?? 1.0;
    const breakdown: ScoreBreakdown[] = [];
    let totalScore = 0;

    // ---- 1. Flujo neto hacia exchanges (CoinMetrics) ----
    this.evalNetflow(context, latestMetrics, stalenessMs, config, mult, breakdown);

    // ---- 2. Whale inflow a exchanges (WhaleAlert) ----
    this.evalWhaleInflow(context, latestMetrics, stalenessMs, config, mult, breakdown);

    // ---- 3. Contracción de stablecoins (DeFiLlama) ----
    this.evalStablecoins(context, latestMetrics, stalenessMs, config, mult, breakdown);

    // ---- 4. Open Interest (CoinGlass) ----
    this.evalOpenInterest(context, latestMetrics, stalenessMs, config, mult, breakdown);

    // ---- 5. Funding Rate (CoinGlass) ----
    this.evalFundingRate(context, latestMetrics, stalenessMs, config, mult, breakdown);

    // ---- 6. Liquidaciones 1h (CoinGlass) ----
    this.evalLiquidations(context, latestMetrics, stalenessMs, config, mult, breakdown);

    // Sumar puntos del breakdown
    for (const b of breakdown) totalScore += b.points;

    // Aplicar multiplicador de sensibilidad al score total
    const finalScore = Math.round(totalScore * mult);

    const riskLevel = this.scoreToRiskLevel(finalScore);
    const bias = this.computeBias(latestMetrics, breakdown);
    const action = this.riskToAction(riskLevel, context, config);

    // Construir razones en castellano natural (máx 3)
    const reasons = this.buildReasons(breakdown, riskLevel, action);

    // Ajustes si acción = AJUSTAR
    const adjustments = action === "AJUSTAR"
      ? this.computeAdjustments(riskLevel, finalScore, config)
      : undefined;

    log(
      `[MarketMetrics] ${context.pair} ${context.side.toUpperCase()}: score=${finalScore} risk=${riskLevel} bias=${bias} action=${action} reasons=[${reasons.join(" | ")}]`,
      "trading"
    );

    return {
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
        thresholds: {
          netflowHighBtc:     BASE_THRESHOLDS.netflowHighBtc,
          stableContractPct:  BASE_THRESHOLDS.stableContractPct,
          whaleInflowHighUsd: BASE_THRESHOLDS.whaleInflowHighUsd,
          oiChangePct:        BASE_THRESHOLDS.oiChangePct,
          fundingRateHigh:    BASE_THRESHOLDS.fundingRateHigh,
          liquidationsHighUsd: BASE_THRESHOLDS.liquidationsHighUsd,
        },
        stalenessMs,
        scoreBreakdown: breakdown,
      },
    };
  }

  // ---- Evaluaciones individuales ----

  private evalNetflow(
    ctx: MetricsEvalContext,
    metrics: Record<string, number | null>,
    stale: Record<string, number>,
    config: MarketMetricsConfig,
    mult: number,
    breakdown: ScoreBreakdown[]
  ): void {
    const asset = this.extractAsset(ctx.pair);
    const key = `${METRIC_NAMES.EXCHANGE_NETFLOW}:${asset}`;
    const val = metrics[key] ?? metrics[`${METRIC_NAMES.EXCHANGE_NETFLOW}:BTC`] ?? null;
    if (val === null) return;

    const staleMs = stale[key] ?? 0;
    if (staleMs > config.stalenessMaxMs.netflow) {
      breakdown.push({ metric: "exchange_netflow", value: val, points: 0, reason: "Dato de flujos desactualizado" });
      return;
    }

    if (val >= BASE_THRESHOLDS.netflowHighBtc) {
      breakdown.push({ metric: "exchange_netflow", value: val, points: 2, reason: "Flujo neto muy alto hacia exchanges" });
    } else if (val >= BASE_THRESHOLDS.netflowMedBtc) {
      breakdown.push({ metric: "exchange_netflow", value: val, points: 1, reason: "Flujo neto moderado hacia exchanges" });
    } else {
      breakdown.push({ metric: "exchange_netflow", value: val, points: 0, reason: "Flujo neto en rango normal" });
    }
  }

  private evalWhaleInflow(
    ctx: MetricsEvalContext,
    metrics: Record<string, number | null>,
    stale: Record<string, number>,
    config: MarketMetricsConfig,
    mult: number,
    breakdown: ScoreBreakdown[]
  ): void {
    const key = `${METRIC_NAMES.WHALE_INFLOW_USD}:ALL`;
    const val = metrics[key] ?? null;
    if (val === null) return;

    const staleMs = stale[key] ?? 0;
    if (staleMs > config.stalenessMaxMs.whaleActivity) {
      breakdown.push({ metric: "whale_inflow_usd", value: val, points: 0, reason: "Dato de ballenas desactualizado" });
      return;
    }

    if (val >= BASE_THRESHOLDS.whaleInflowHighUsd) {
      breakdown.push({ metric: "whale_inflow_usd", value: val, points: 2, reason: "Grandes inversores enviando masivamente a exchanges" });
    } else if (val >= BASE_THRESHOLDS.whaleInflowMedUsd) {
      breakdown.push({ metric: "whale_inflow_usd", value: val, points: 1, reason: "Actividad de ballenas hacia exchanges elevada" });
    } else {
      breakdown.push({ metric: "whale_inflow_usd", value: val, points: 0, reason: "Actividad de ballenas en niveles normales" });
    }
  }

  private evalStablecoins(
    ctx: MetricsEvalContext,
    metrics: Record<string, number | null>,
    stale: Record<string, number>,
    config: MarketMetricsConfig,
    mult: number,
    breakdown: ScoreBreakdown[]
  ): void {
    const key = `${METRIC_NAMES.STABLECOIN_SUPPLY_DELTA_24H}:ALL`;
    const val = metrics[key] ?? null;
    if (val === null) return;

    const staleMs = stale[key] ?? 0;
    if (staleMs > config.stalenessMaxMs.stablecoins) {
      breakdown.push({ metric: "stablecoin_supply_delta_24h", value: val, points: 0, reason: "Dato de stablecoins desactualizado" });
      return;
    }

    if (val <= BASE_THRESHOLDS.stableContractPct * 2) {
      breakdown.push({ metric: "stablecoin_supply_delta_24h", value: val, points: 2, reason: "Fuerte contracción de liquidez (stablecoins)" });
    } else if (val <= BASE_THRESHOLDS.stableContractPct) {
      breakdown.push({ metric: "stablecoin_supply_delta_24h", value: val, points: 1, reason: "Ligera contracción de liquidez" });
    } else {
      breakdown.push({ metric: "stablecoin_supply_delta_24h", value: val, points: 0, reason: "Liquidez estable o expansiva" });
    }
  }

  private evalOpenInterest(
    ctx: MetricsEvalContext,
    metrics: Record<string, number | null>,
    stale: Record<string, number>,
    config: MarketMetricsConfig,
    mult: number,
    breakdown: ScoreBreakdown[]
  ): void {
    const asset = this.extractAsset(ctx.pair);
    const key = `${METRIC_NAMES.OPEN_INTEREST}:${asset}`;
    const val = metrics[key] ?? null;
    if (val === null) return;

    const staleMs = stale[key] ?? 0;
    if (staleMs > config.stalenessMaxMs.derivatives) {
      breakdown.push({ metric: "open_interest", value: val, points: 0, reason: "Dato de apalancamiento desactualizado" });
      return;
    }

    // val aquí es % cambio 24h si disponible, o valor absoluto
    if (val >= BASE_THRESHOLDS.oiChangePct) {
      breakdown.push({ metric: "open_interest", value: val, points: 1, reason: "Apalancamiento del mercado aumentando" });
    } else {
      breakdown.push({ metric: "open_interest", value: val, points: 0, reason: "Apalancamiento en niveles normales" });
    }
  }

  private evalFundingRate(
    ctx: MetricsEvalContext,
    metrics: Record<string, number | null>,
    stale: Record<string, number>,
    config: MarketMetricsConfig,
    mult: number,
    breakdown: ScoreBreakdown[]
  ): void {
    const asset = this.extractAsset(ctx.pair);
    const key = `${METRIC_NAMES.FUNDING_RATE}:${asset}`;
    const val = metrics[key] ?? metrics[`${METRIC_NAMES.FUNDING_RATE}:BTC`] ?? null;
    if (val === null) return;

    const staleMs = stale[key] ?? 0;
    if (staleMs > config.stalenessMaxMs.derivatives) {
      breakdown.push({ metric: "funding_rate", value: val, points: 0, reason: "Dato de funding desactualizado" });
      return;
    }

    const absVal = Math.abs(val);
    if (absVal >= BASE_THRESHOLDS.fundingRateHigh) {
      breakdown.push({ metric: "funding_rate", value: val, points: 2, reason: "Financiación de futuros extrema (mercado muy cargado)" });
    } else if (absVal >= BASE_THRESHOLDS.fundingRateMed) {
      breakdown.push({ metric: "funding_rate", value: val, points: 1, reason: "Financiación de futuros elevada" });
    } else {
      breakdown.push({ metric: "funding_rate", value: val, points: 0, reason: "Financiación de futuros normal" });
    }
  }

  private evalLiquidations(
    ctx: MetricsEvalContext,
    metrics: Record<string, number | null>,
    stale: Record<string, number>,
    config: MarketMetricsConfig,
    mult: number,
    breakdown: ScoreBreakdown[]
  ): void {
    const key = `${METRIC_NAMES.LIQUIDATIONS_1H_USD}:BTC`;
    const val = metrics[key] ?? null;
    if (val === null) return;

    const staleMs = stale[key] ?? 0;
    if (staleMs > config.stalenessMaxMs.derivatives) {
      breakdown.push({ metric: "liquidations_1h_usd", value: val, points: 0, reason: "Dato de liquidaciones desactualizado" });
      return;
    }

    if (val >= BASE_THRESHOLDS.liquidationsHighUsd) {
      breakdown.push({ metric: "liquidations_1h_usd", value: val, points: 2, reason: "Liquidaciones masivas en la última hora (mercado inestable)" });
    } else if (val >= BASE_THRESHOLDS.liquidationsMedUsd) {
      breakdown.push({ metric: "liquidations_1h_usd", value: val, points: 1, reason: "Liquidaciones elevadas recientes" });
    } else {
      breakdown.push({ metric: "liquidations_1h_usd", value: val, points: 0, reason: "Liquidaciones en niveles normales" });
    }
  }

  // ---- Helpers ----

  private extractAsset(pair: string): string {
    return (pair.split("/")[0] ?? pair).toUpperCase();
  }

  private scoreToRiskLevel(score: number): RiskLevel {
    if (score <= SCORE_THRESHOLDS.LOW.max) return "BAJO";
    if (score <= SCORE_THRESHOLDS.MEDIUM.max) return "MEDIO";
    return "ALTO";
  }

  private computeBias(
    metrics: Record<string, number | null>,
    breakdown: ScoreBreakdown[]
  ): Bias {
    const bearishPoints = breakdown.reduce((sum, b) => sum + b.points, 0);
    if (bearishPoints >= 4) return "BAJISTA";
    if (bearishPoints >= 2) return "NEUTRAL";
    const netflow = metrics[`${METRIC_NAMES.EXCHANGE_NETFLOW}:BTC`] ?? 0;
    if ((netflow ?? 0) < -50_000_000) return "ALCISTA";
    return "NEUTRAL";
  }

  private riskToAction(
    riskLevel: RiskLevel,
    ctx: MetricsEvalContext,
    config: MarketMetricsConfig
  ): MetricsAction {
    // En modo observación: nunca bloquear ni ajustar
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
    riskLevel: RiskLevel,
    action: MetricsAction
  ): string[] {
    const relevant = breakdown
      .filter(b => b.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 3);

    const reasons = relevant.map(b => b.reason);

    if (reasons.length === 0) {
      if (action === "PERMITIR") reasons.push("Condiciones de mercado favorables");
      else reasons.push("Datos de mercado insuficientes para evaluar");
    }

    return reasons;
  }
}

export const marketMetricsEngine = new MarketMetricsEngine();
