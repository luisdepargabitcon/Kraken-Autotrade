/**
 * IdcaDynamicDistanceService — Cálculo de Distancia Dinámica entre compras IDCA
 *
 * Modo manual (default): sin efecto — respeta 100% la config existente.
 * Modo dynamic_hybrid:   calcula una distancia mínima basada en:
 *   - ATR% × multiplicador (volatilidad de mercado)
 *   - Penalización por régimen (marketScore < 60)
 *   - Penalización por presión de ciclo (buyCount alto)
 *   - Penalización por exposición (capital usado > 60%)
 *   - Penalización por salud del dato (pocas velas disponibles)
 *
 * Regla de aplicación (server-side, autoritativa):
 *   effectiveNextBuyPrice = min(existingNextBuyPrice, referencePrice * (1 - appliedDistancePct / 100))
 *
 * La distancia dinámica solo puede alejar el nextBuyPrice del precio actual (más conservador).
 * NUNCA puede acercar el nextBuyPrice al precio actual.
 *
 * Referencia de precio:
 *   - Primer candidato: lastBuyPrice (precio real de la última compra ejecutada)
 *   - Fallback: avgEntryPrice (precio promedio del ciclo)
 */

import type {
  DynamicDistanceConfig,
  DynamicDistanceInput,
  DynamicDistanceResult,
  DynamicDistanceComponents,
} from "./IdcaTypes";

// Threshold de velas mínimas para considerar datos "saludables"
const MIN_CANDLES_OK = 14;
const MIN_CANDLES_READY = 5;

/**
 * Parsea y valida la config de distancia dinámica desde JSON arbitrario.
 * Garantiza que todos los campos tienen valores seguros aunque el JSON esté incompleto.
 */
export function parseDynamicDistanceConfig(raw: unknown): DynamicDistanceConfig {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    mode:               (src.mode === "dynamic_hybrid" ? "dynamic_hybrid" : "manual"),
    atrMultiplier:      typeof src.atrMultiplier === "number" ? src.atrMultiplier : 1.0,
    aggressiveness:     typeof src.aggressiveness === "number"
                          ? Math.max(0, Math.min(100, src.aggressiveness)) : 50,
    minDistancePct:     typeof src.minDistancePct === "number" ? src.minDistancePct : 0.80,
    maxDistancePct:     typeof src.maxDistancePct === "number" ? src.maxDistancePct : 12.0,
    feeFloorPct:        typeof src.feeFloorPct === "number" ? src.feeFloorPct : 0.60,
    useMarketRegime:    src.useMarketRegime !== false,
    useCyclePressure:   src.useCyclePressure !== false,
    useExposurePenalty: src.useExposurePenalty !== false,
    useDataHealthPenalty: src.useDataHealthPenalty !== false,
  };
}

/**
 * Calcula la distancia dinámica entre compras.
 *
 * @returns DynamicDistanceResult con effectiveNextBuyPrice listo para persistir.
 */
export function computeDynamicDistance(input: DynamicDistanceInput): DynamicDistanceResult {
  const { config, buyCount, avgEntryPrice, lastBuyPrice, existingNextBuyPrice,
          atrPct, marketScore, candleCount, capitalUsedUsd, capitalReservedUsd } = input;

  // ─── Modo manual: sin efecto ──────────────────────────────────────────────
  if (config.mode === "manual") {
    return {
      mode: "manual",
      blocked: false,
    };
  }

  // ─── Verificar salud del dato ─────────────────────────────────────────────
  if (candleCount < MIN_CANDLES_READY) {
    return {
      mode: "dynamic_hybrid",
      blocked: true,
      blockReason: "data_not_ready",
    };
  }

  // ─── Referencia de precio: lastBuyPrice > avgEntryPrice ───────────────────
  const referencePrice = (lastBuyPrice != null && lastBuyPrice > 0)
    ? lastBuyPrice
    : avgEntryPrice;

  // ─── Fee floor ────────────────────────────────────────────────────────────
  const feeFloor = config.feeFloorPct;

  // ─── ATR distance ─────────────────────────────────────────────────────────
  // atrPct ya es un porcentaje (ej: 1.8 = 1.8%). Multiplicamos por el factor.
  const atrDistance = atrPct * config.atrMultiplier;

  // ─── Penalización por régimen de mercado (additive sobre ATR) ────────────
  const regimePenalty = config.useMarketRegime
    ? (marketScore < 40 ? 1.0 : marketScore < 60 ? 0.5 : 0.0)
    : 0.0;

  // ─── Penalización por presión de ciclo (additive) ─────────────────────────
  // buyCount=1 (solo compra base): 0% | buyCount=2: +0.30% | buyCount>=3: +0.60%
  const cyclePressure = config.useCyclePressure
    ? (buyCount >= 3 ? 0.60 : buyCount === 2 ? 0.30 : 0.0)
    : 0.0;

  // ─── Penalización por exposición (additive) ───────────────────────────────
  const exposurePct = capitalReservedUsd > 0
    ? (capitalUsedUsd / capitalReservedUsd) * 100
    : 0;
  const exposurePenalty = config.useExposurePenalty
    ? (exposurePct > 80 ? 1.0 : exposurePct > 60 ? 0.5 : 0.0)
    : 0.0;

  // ─── Penalización por salud del dato (additive) ───────────────────────────
  const dataHealthPenalty = config.useDataHealthPenalty && candleCount < MIN_CANDLES_OK
    ? 0.50
    : 0.0;

  // ─── Fórmula: raw = max(feeFloor, atrDistance + todas las penalizaciones) ─
  const penaltiesSum = atrDistance + regimePenalty + cyclePressure + exposurePenalty + dataHealthPenalty;
  const raw = Math.max(feeFloor, penaltiesSum);

  // ─── Factor de agresividad ────────────────────────────────────────────────
  // aggressiveness=0 → ×1.20 (20% más distancia/conservador)
  // aggressiveness=50 → ×1.00 (neutro)
  // aggressiveness=100 → ×0.80 (20% más agresivo/cercano)
  const aggressivenessFactor = 1.0 + (50 - config.aggressiveness) / 250;

  // ─── Distancia sugerida y clamp ───────────────────────────────────────────
  const suggestedDistancePct = raw * aggressivenessFactor;
  const appliedDistancePct = Math.max(
    config.minDistancePct,
    Math.min(config.maxDistancePct, suggestedDistancePct)
  );
  const clamped = suggestedDistancePct !== appliedDistancePct;

  // ─── Precio propuesto: referencePrice * (1 - appliedDistancePct / 100) ────
  const proposedNextBuyPrice = referencePrice * (1 - appliedDistancePct / 100);

  // ─── Precio efectivo: min(existingNextBuyPrice, proposedNextBuyPrice) ─────
  // La distancia dinámica SOLO puede alejar el trigger (más conservador).
  // NUNCA puede acercar el nextBuyPrice al precio actual.
  let effectiveNextBuyPrice: number;
  let changedFrom: number | null = null;

  if (existingNextBuyPrice != null && existingNextBuyPrice > 0) {
    effectiveNextBuyPrice = Math.min(existingNextBuyPrice, proposedNextBuyPrice);
    if (effectiveNextBuyPrice < existingNextBuyPrice) {
      changedFrom = existingNextBuyPrice;
    }
  } else {
    effectiveNextBuyPrice = proposedNextBuyPrice;
  }

  const components: DynamicDistanceComponents = {
    feeFloor,
    atrDistance,
    regimePenalty,
    cyclePressure,
    exposurePenalty,
    dataHealthPenalty,
    raw,
    aggressivenessFactor,
    clamped,
  };

  return {
    mode: "dynamic_hybrid",
    blocked: false,
    appliedDistancePct,
    suggestedDistancePct,
    referencePrice,
    proposedNextBuyPrice,
    effectiveNextBuyPrice,
    changedFrom,
    components,
  };
}

export const idcaDynamicDistanceService = { computeDynamicDistance, parseDynamicDistanceConfig };
