/**
 * IdcaDistanceResolver — Resolver único de distancia para IDCA.
 *
 * Sprint 1a: Unifica el cálculo de distancia requerida para TODOS los tipos de compra:
 *   - initial_entry
 *   - trailing_buy_entry
 *   - safety_buy
 *   - recovery
 *   - reentry
 *
 * Modos soportados:
 *   - assisted_entry (default): parte de sliders (entryPatienceLevel → curva estática).
 *     Sprint 1a: smartAdjustmentEnabled=false → comportamiento 100% equivalente al actual.
 *   - dynamic_intelligent_entry: calcula distancia desde ATR, agresividad, penalizaciones.
 *     Reutiliza computeDynamicDistance() para la lógica existente.
 *   - legacy: alias backward-compat de assisted_entry.
 *
 * REGLA CONSERVADORA para safety_buy/recovery:
 *   effectiveNextBuyPrice = min(existingNextBuyPrice, proposedNextBuyPrice)
 *   La distancia SOLO puede alejar el trigger, NUNCA acercarlo.
 *
 * Sprint 1b añadirá: smart adjustment asistido, motor de confluencia, confidence score.
 */

import type {
  IdcaEntryMode,
  IdcaDistanceResolverInput,
  IdcaDistanceResolverResult,
  DynamicDistanceConfig,
} from "./IdcaTypes";
import { getEffectiveEntryConfig } from "./IdcaSliderConfig";
import { computeDynamicDistance } from "./IdcaDynamicDistanceService";

const TAG = "[IDCA]";

// ─── Resolver principal ────────────────────────────────────────────────────

/**
 * Resuelve la distancia requerida para un tipo de compra dado, según el modo activo.
 *
 * @param input  Contexto completo del resolver (par, modo, precios, configs, ciclo)
 * @returns      Resultado con requiredDistancePct, source, breakdown y effectiveNextBuyPrice
 */
export function resolveIdcaRequiredDistance(
  input: IdcaDistanceResolverInput,
): IdcaDistanceResolverResult {
  const {
    pair, usedFor, activeEntryMode, referencePrice, atrPct,
    entryGlobalConfig, dynamicDistanceConfig, buyCount,
    marketScore, candleCount, capitalUsedUsd, capitalReservedUsd,
    existingNextBuyPrice,
  } = input;

  // ── Safety_buy / recovery: lógica especial con regla conservadora ──────────
  if (usedFor === "safety_buy" || usedFor === "recovery") {
    return _resolveSafetyBuyDistance(input);
  }

  // ── initial_entry / trailing_buy_entry / reentry ───────────────────────────
  switch (activeEntryMode) {
    case "dynamic_intelligent_entry":
      return _resolveDynamicEntryDistance(input);

    case "legacy":
    case "assisted_entry":
    default:
      return _resolveAssistedEntryDistance(input);
  }
}

// ─── Modo: assisted_entry (default Sprint 1a) ────────────────────────────────

function _resolveAssistedEntryDistance(
  input: IdcaDistanceResolverInput,
): IdcaDistanceResolverResult {
  const { pair, usedFor, activeEntryMode, entryGlobalConfig } = input;
  const isLegacy = activeEntryMode === "legacy";

  // Derivar desde sliders (entryPatienceLevel → curva estática por par)
  const derived = getEffectiveEntryConfig(entryGlobalConfig, pair);
  const sliderBasePct = derived.effectiveMinDipPct;

  // Sprint 1a: smartAdjustmentEnabled=false → no hay ajuste inteligente adicional
  const finalRequiredDistancePct = sliderBasePct;

  return {
    requiredDistancePct: finalRequiredDistancePct,
    mode: activeEntryMode,
    source: isLegacy ? "legacy_entry_patience" : "assisted_entry_sliders",
    legacyUsed: isLegacy,
    usedFor,
    breakdown: {
      sliderBasePct,
      finalRequiredDistancePct,
    },
  };
}

// ─── Modo: dynamic_intelligent_entry ────────────────────────────────────────

function _resolveDynamicEntryDistance(
  input: IdcaDistanceResolverInput,
): IdcaDistanceResolverResult {
  const {
    pair, usedFor, atrPct, referencePrice,
    entryGlobalConfig, dynamicDistanceConfig,
    buyCount, marketScore, candleCount, capitalUsedUsd, capitalReservedUsd,
  } = input;

  const ddResult = computeDynamicDistance({
    config: dynamicDistanceConfig,
    pair,
    cycleType: "main",
    buyCount,
    avgEntryPrice: referencePrice,
    lastBuyPrice: null,  // entrada nueva → no hay lastBuy
    existingNextBuyPrice: null,  // para entry/TB, no aplica regla min()
    atrPct,
    marketScore,
    candleCount,
    capitalUsedUsd,
    capitalReservedUsd,
  });

  // Fallback a sliders si datos insuficientes
  if (ddResult.blocked) {
    const derived = getEffectiveEntryConfig(entryGlobalConfig, pair);
    console.log(
      `${TAG}[DISTANCE_RESOLVER] pair=${pair} usedFor=${usedFor}` +
      ` mode=dynamic_intelligent_entry blocked=true reason=${ddResult.blockReason}` +
      ` fallback=assisted_entry_sliders sliderBasePct=${derived.effectiveMinDipPct.toFixed(2)}%`
    );
    return {
      requiredDistancePct: derived.effectiveMinDipPct,
      mode: "dynamic_intelligent_entry",
      source: "assisted_entry_sliders",
      legacyUsed: true,
      usedFor,
      breakdown: {
        sliderBasePct: derived.effectiveMinDipPct,
        finalRequiredDistancePct: derived.effectiveMinDipPct,
      },
    };
  }

  const appliedDistancePct = ddResult.appliedDistancePct ?? dynamicDistanceConfig.minDistancePct;
  const c = ddResult.components;

  return {
    requiredDistancePct: appliedDistancePct,
    mode: "dynamic_intelligent_entry",
    source: "dynamic_distance",
    legacyUsed: false,
    usedFor,
    breakdown: {
      atrPct,
      atrMultiplier: dynamicDistanceConfig.atrMultiplier,
      atrComponent: c?.atrDistance,
      aggressiveness: dynamicDistanceConfig.aggressiveness,
      aggressivenessFactor: c?.aggressivenessFactor,
      feeFloor: c?.feeFloor,
      userMinDistancePct: dynamicDistanceConfig.minDistancePct,
      userMaxDistancePct: dynamicDistanceConfig.maxDistancePct,
      marketRegimePenalty: c?.regimePenalty,
      cyclePressurePenalty: c?.cyclePressure,
      exposurePenalty: c?.exposurePenalty,
      dataQualityPenalty: c?.dataHealthPenalty,
      suggestedDistancePct: ddResult.suggestedDistancePct,
      finalRequiredDistancePct: appliedDistancePct,
    },
  };
}

// ─── Safety buy / recovery: regla conservadora ───────────────────────────────

function _resolveSafetyBuyDistance(
  input: IdcaDistanceResolverInput,
): IdcaDistanceResolverResult {
  const {
    pair, usedFor, activeEntryMode, referencePrice, atrPct,
    entryGlobalConfig, dynamicDistanceConfig,
    buyCount, marketScore, candleCount, capitalUsedUsd, capitalReservedUsd,
    existingNextBuyPrice,
  } = input;

  // ── Determinar si aplica cálculo dinámico ──────────────────────────────────
  // assisted_entry + dynamic_hybrid → aplicar dinámica (backward compat)
  // dynamic_intelligent_entry       → siempre aplicar dinámica
  // assisted_entry + manual         → sin efecto (retornar sin precio efectivo)
  const shouldApplyDynamic =
    activeEntryMode === "dynamic_intelligent_entry" ||
    (activeEntryMode === "assisted_entry" && dynamicDistanceConfig.mode === "dynamic_hybrid") ||
    (activeEntryMode === "legacy" && dynamicDistanceConfig.mode === "dynamic_hybrid");

  if (!shouldApplyDynamic) {
    return {
      requiredDistancePct: 0,
      mode: activeEntryMode,
      source: "assisted_entry_sliders",
      legacyUsed: activeEntryMode === "legacy",
      usedFor,
      effectiveNextBuyPrice: undefined,
      breakdown: { finalRequiredDistancePct: 0 },
    };
  }

  // ── Calcular distancia dinámica con regla conservadora ────────────────────
  const ddResult = computeDynamicDistance({
    config: dynamicDistanceConfig,
    pair,
    cycleType: "main",
    buyCount,
    avgEntryPrice: referencePrice,
    lastBuyPrice: null,
    existingNextBuyPrice: existingNextBuyPrice ?? null,
    atrPct,
    marketScore,
    candleCount,
    capitalUsedUsd,
    capitalReservedUsd,
  });

  if (ddResult.blocked) {
    return {
      requiredDistancePct: 0,
      mode: activeEntryMode,
      source: "dynamic_distance",
      legacyUsed: false,
      usedFor,
      effectiveNextBuyPrice: undefined,
      breakdown: { finalRequiredDistancePct: 0 },
    };
  }

  const appliedDistancePct = ddResult.appliedDistancePct ?? 0;
  const c = ddResult.components;

  return {
    requiredDistancePct: appliedDistancePct,
    mode: activeEntryMode,
    source: "dynamic_distance",
    legacyUsed: false,
    usedFor,
    effectiveNextBuyPrice: ddResult.effectiveNextBuyPrice,
    breakdown: {
      atrPct,
      atrMultiplier: dynamicDistanceConfig.atrMultiplier,
      atrComponent: c?.atrDistance,
      aggressiveness: dynamicDistanceConfig.aggressiveness,
      aggressivenessFactor: c?.aggressivenessFactor,
      feeFloor: c?.feeFloor,
      userMinDistancePct: dynamicDistanceConfig.minDistancePct,
      userMaxDistancePct: dynamicDistanceConfig.maxDistancePct,
      marketRegimePenalty: c?.regimePenalty,
      cyclePressurePenalty: c?.cyclePressure,
      exposurePenalty: c?.exposurePenalty,
      dataQualityPenalty: c?.dataHealthPenalty,
      suggestedDistancePct: ddResult.suggestedDistancePct,
      finalRequiredDistancePct: appliedDistancePct,
    },
  };
}

// ─── Log helper ───────────────────────────────────────────────────────────────

/**
 * Emite el log [IDCA][DISTANCE_RESOLUTION] con el resultado del resolver.
 * Llamar después de cada invocación a resolveIdcaRequiredDistance().
 */
export function logDistanceResolution(
  tag: string,
  pair: string,
  result: IdcaDistanceResolverResult,
  context?: {
    referencePrice?: number;
    currentPrice?: number;
    drawdownFromReferencePct?: number;
    trailingBuyWillArm?: boolean;
  },
): void {
  const b = result.breakdown;
  const parts: string[] = [
    `${tag}[DISTANCE_RESOLUTION] pair=${pair}`,
    `usedFor=${result.usedFor}`,
    `mode=${result.mode}`,
    `source=${result.source}`,
    `legacyUsed=${result.legacyUsed}`,
    `requiredDistancePct=${result.requiredDistancePct.toFixed(2)}%`,
  ];

  if (b.sliderBasePct != null)         parts.push(`sliderBasePct=${b.sliderBasePct.toFixed(2)}%`);
  if (b.atrMultiplier != null)         parts.push(`atrMultiplier=${b.atrMultiplier}x`);
  if (b.atrComponent != null)          parts.push(`atrComponent=${b.atrComponent.toFixed(3)}%`);
  if (b.aggressiveness != null)        parts.push(`aggressiveness=${b.aggressiveness}`);
  if (b.aggressivenessFactor != null)  parts.push(`aggressivenessFactor=${b.aggressivenessFactor.toFixed(3)}`);
  if (b.feeFloor != null)              parts.push(`feeFloor=${b.feeFloor.toFixed(2)}%`);
  if (b.userMinDistancePct != null)    parts.push(`minClamp=${b.userMinDistancePct.toFixed(2)}%`);
  if (b.userMaxDistancePct != null)    parts.push(`maxClamp=${b.userMaxDistancePct.toFixed(2)}%`);
  if (b.marketRegimePenalty != null)   parts.push(`regimePenalty=${b.marketRegimePenalty.toFixed(3)}`);
  if (b.cyclePressurePenalty != null)  parts.push(`cyclePressure=${b.cyclePressurePenalty.toFixed(3)}`);
  if (b.exposurePenalty != null)       parts.push(`exposurePenalty=${b.exposurePenalty.toFixed(3)}`);
  if (b.dataQualityPenalty != null)    parts.push(`dataQualityPenalty=${b.dataQualityPenalty.toFixed(3)}`);
  if (b.suggestedDistancePct != null)  parts.push(`suggestedDistancePct=${b.suggestedDistancePct.toFixed(3)}%`);

  if (context?.referencePrice != null)          parts.push(`referencePrice=${context.referencePrice.toFixed(2)}`);
  if (context?.currentPrice != null)            parts.push(`currentPrice=${context.currentPrice.toFixed(2)}`);
  if (context?.drawdownFromReferencePct != null) parts.push(`drawdownFromReferencePct=${context.drawdownFromReferencePct.toFixed(2)}%`);
  if (context?.trailingBuyWillArm != null)      parts.push(`trailingBuyWillArm=${context.trailingBuyWillArm}`);

  console.log(parts.join(" "));
}
