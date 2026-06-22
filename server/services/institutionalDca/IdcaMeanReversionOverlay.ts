/**
 * IdcaMeanReversionOverlay — Mean Reversion filter for IDCA Hybrid.
 *
 * NOT a strategy. A filter layer that sits BEFORE checkEntry() and decides:
 *   allow_buy   — price is sufficiently below VWAP/mean without bearish breakout
 *   block_buy   — bear trend, high volatility, or data quality too poor for real mode
 *   reduce_size — mild signal, buy is allowed but with reduced capital
 *   hold        — no meaningful deviation; let legacy IDCA decide
 *   neutral     — hybrid is off or no opinion
 *
 * Uses indicators from IdcaSmartLayer (no duplication) and context from IdcaRegimeAdapter.
 */

import type { IdcaRegimeSnapshot } from "./IdcaRegimeAdapter";

export type MeanReversionAction =
  | "allow_buy"
  | "block_buy"
  | "reduce_size"
  | "hold"
  | "neutral";

export type MeanReversionState =
  | "confirmed"
  | "blocked_by_bear_trend"
  | "blocked_by_insufficient_deviation"
  | "blocked_by_high_volatility"
  | "blocked_by_data_quality"
  | "neutral";

export interface MeanReversionDecision {
  allowed: boolean;
  action: MeanReversionAction;
  score: number;              // 0–100
  state: MeanReversionState;
  reason: string;
  naturalReason: string;
  metrics: {
    zScore: number | null;
    atrPct: number | null;
    vwap: number | null;
    price: number;
    deviationPct: number | null;
  };
}

export interface MeanReversionConfig {
  meanReversionEnabled: boolean;
  bearTrendBlockEnabled: boolean;
  dynamicVolatilityEnabled: boolean;
  dataQualityBlockEnabled: boolean;
  profile: "conservative" | "balanced" | "aggressive";
}

// ── Profile multipliers ──────────────────────────────────────────────────
// Deviation needed to allow_buy (in z-score units)
const PROFILE_CONFIRM_ZSCORE: Record<string, number> = {
  conservative: -1.8,   // price must be 1.8 ATR below VWAP
  balanced:     -1.2,
  aggressive:   -0.8,
};
// Deviation for reduce_size
const PROFILE_REDUCE_ZSCORE: Record<string, number> = {
  conservative: -0.8,
  balanced:     -0.5,
  aggressive:   -0.3,
};

export function evaluateMeanReversion(
  regimeSnapshot: IdcaRegimeSnapshot,
  config: MeanReversionConfig
): MeanReversionDecision {
  const noOpinion = (): MeanReversionDecision => ({
    allowed: true,
    action: "neutral",
    score: 50,
    state: "neutral",
    reason: "hybrid_off_or_mean_reversion_disabled",
    naturalReason: "Reversión a la media desactivada. La lógica IDCA estándar decide.",
    metrics: {
      zScore: regimeSnapshot.zScore,
      atrPct: regimeSnapshot.atrPct,
      vwap: regimeSnapshot.vwap,
      price: regimeSnapshot.price,
      deviationPct: null,
    },
  });

  if (!config.meanReversionEnabled) return noOpinion();

  const { regime, zScore, atrPct, vwap, price, dataQuality } = regimeSnapshot;

  const deviationPct = vwap && vwap > 0
    ? ((vwap - price) / vwap) * 100   // positive = price BELOW vwap (dip)
    : null;

  const metrics = { zScore, atrPct, vwap, price, deviationPct };

  // ── 1. Data quality block ──────────────────────────────────────────────
  if (config.dataQualityBlockEnabled && (dataQuality === "insufficient" || regime === "insufficient_data" || regime === "unknown")) {
    return {
      allowed: false,
      action: "block_buy",
      score: 0,
      state: "blocked_by_data_quality",
      reason: `dataQuality=${dataQuality} regime=${regime}`,
      naturalReason: "Datos insuficientes para evaluar reversión a la media. No se ejecuta compra en modo real.",
      metrics,
    };
  }

  // ── 2. Bear trend block ────────────────────────────────────────────────
  if (config.bearTrendBlockEnabled && regime === "bearish") {
    return {
      allowed: false,
      action: "block_buy",
      score: 5,
      state: "blocked_by_bear_trend",
      reason: `regime=bearish zScore=${zScore?.toFixed(2)}`,
      naturalReason: "Tendencia bajista activa. No se compra: el riesgo de continuar cayendo es alto.",
      metrics,
    };
  }

  // ── 3. High volatility block ───────────────────────────────────────────
  if (config.dynamicVolatilityEnabled && regime === "high_volatility") {
    return {
      allowed: false,
      action: "block_buy",
      score: 10,
      state: "blocked_by_high_volatility",
      reason: `regime=high_volatility atrPct=${atrPct?.toFixed(2)}`,
      naturalReason: `Volatilidad elevada (ATRP ${atrPct?.toFixed(1)}%). No es momento seguro para entrada por reversión.`,
      metrics,
    };
  }

  // ── 4. Z-score deviation check ─────────────────────────────────────────
  const confirmThresh = PROFILE_CONFIRM_ZSCORE[config.profile] ?? -1.5;
  const reduceThresh  = PROFILE_REDUCE_ZSCORE[config.profile] ?? -0.7;

  if (zScore !== null) {
    if (zScore <= confirmThresh) {
      const score = Math.min(100, Math.round(Math.abs(zScore) * 25 + 40));
      return {
        allowed: true,
        action: "allow_buy",
        score,
        state: "confirmed",
        reason: `zScore=${zScore.toFixed(2)} <= confirmThresh=${confirmThresh} regime=${regime} profile=${config.profile}`,
        naturalReason: `Reversión a la media confirmada. Precio ${deviationPct?.toFixed(1)}% por debajo del VWAP sin ruptura bajista.`,
        metrics,
      };
    }

    if (zScore <= reduceThresh) {
      const score = Math.min(80, Math.round(Math.abs(zScore) * 20 + 20));
      return {
        allowed: true,
        action: "reduce_size",
        score,
        state: "confirmed",
        reason: `zScore=${zScore.toFixed(2)} between reduceThresh=${reduceThresh} and confirmThresh=${confirmThresh}`,
        naturalReason: `Señal de reversión débil. Se permite entrada con tamaño reducido (${score < 50 ? "conservador" : "moderado"}).`,
        metrics,
      };
    }

    // zScore > reduceThresh — insufficient deviation
    return {
      allowed: true,
      action: "hold",
      score: 30,
      state: "blocked_by_insufficient_deviation",
      reason: `zScore=${zScore.toFixed(2)} > reduceThresh=${reduceThresh} — insufficient deviation`,
      naturalReason: `El precio no está suficientemente alejado de su media. Sin señal clara de reversión.`,
      metrics,
    };
  }

  // No z-score available — defer to legacy
  return {
    allowed: true,
    action: "hold",
    score: 40,
    state: "neutral",
    reason: "no_zscore_available — defer to legacy",
    naturalReason: "Sin datos suficientes para calcular desviación. La lógica IDCA estándar decide.",
    metrics,
  };
}
