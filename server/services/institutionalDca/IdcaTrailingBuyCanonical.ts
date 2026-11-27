/**
 * Fuente canónica de parámetros del trailing buy IDCA.
 *
 * Los parámetros se calculan una sola vez al armar y el estado los reutiliza al
 * seguir, disparar y revalidar. El modo static conserva el trailing porcentual
 * clásico; el modo dynamic delega el cálculo de rebote en
 * resolveIdcaDynamicRebound y congela el resultado en el estado armado.
 */
import { resolveIdcaDynamicRebound } from "./IdcaDynamicReboundResolver";
import type { IdcaEntryMode, IdcaTbPath } from "./IdcaTypes";

export interface TrailingBuyCanonicalParams {
  minPrice: number;
  effectiveThresholdPct: number;
  mode: "static" | "dynamic";
  reference: {
    price: number;
    type: string;
  };
  maxExecutablePrice: number;
  validUntil: number;
  reason: string;
}

export interface ResolveTrailingBuyCanonicalInput {
  pair: string;
  referencePrice: number;
  referenceType: string;
  activationPrice: number;
  currentPrice: number;
  localLow?: number;
  staticTrailingPct: number;
  entryMode: IdcaEntryMode;
  requiredDistancePct: number;
  drawdownFromReferencePct: number;
  atrPct: number;
  dynamicReboundConfig?: any;
  confidenceScore?: number;
  marketRegime?: string;
  vwapZone?: string;
  tbPath?: IdcaTbPath;
  maxDurationMs: number;
  maxExecutablePrice?: number;
  forceStatic?: boolean;
  nowMs: number;
  reason: string;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function resolveTrailingBuyCanonicalParams(
  input: ResolveTrailingBuyCanonicalInput,
): TrailingBuyCanonicalParams {
  if (!positiveFinite(input.referencePrice) || !positiveFinite(input.activationPrice) || !positiveFinite(input.currentPrice)) {
    throw new Error("invalid_trailing_buy_reference");
  }
  if (!Number.isFinite(input.staticTrailingPct) || input.staticTrailingPct < 0) {
    throw new Error("invalid_trailing_buy_threshold");
  }
  if (!Number.isFinite(input.maxDurationMs) || input.maxDurationMs <= 0) {
    throw new Error("invalid_trailing_buy_duration");
  }
  if (input.maxExecutablePrice != null && !positiveFinite(input.maxExecutablePrice)) {
    throw new Error("invalid_trailing_buy_max_executable");
  }

  const minPrice = positiveFinite(input.localLow ?? NaN) ? input.localLow as number : input.currentPrice;
  const useDynamic = input.forceStatic !== true && input.entryMode === "dynamic_intelligent_entry" && input.dynamicReboundConfig?.enabled === true;

  if (useDynamic) {
    const rebound = resolveIdcaDynamicRebound({
      pair: input.pair,
      usedFor: "trailing_buy_entry",
      entryMode: input.entryMode,
      localLowPrice: minPrice,
      currentPrice: input.currentPrice,
      referencePrice: input.referencePrice,
      requiredDistancePct: input.requiredDistancePct,
      drawdownFromReferencePct: input.drawdownFromReferencePct,
      atrPct: input.atrPct,
      confidenceScore: input.confidenceScore,
      marketRegime: input.marketRegime as any,
      vwapZone: input.vwapZone,
      dynamicReboundConfig: input.dynamicReboundConfig,
      tbPath: input.tbPath,
    });
    if (!positiveFinite(rebound.reboundPct) || !positiveFinite(rebound.maxExecutionPrice)) {
      throw new Error("invalid_dynamic_trailing_buy_parameters");
    }
    return {
      minPrice,
      effectiveThresholdPct: rebound.reboundPct,
      mode: "dynamic",
      reference: { price: input.referencePrice, type: input.referenceType },
      maxExecutablePrice: rebound.maxExecutionPrice,
      validUntil: input.nowMs + input.maxDurationMs,
      reason: input.reason,
    };
  }

  return {
    minPrice,
    effectiveThresholdPct: input.staticTrailingPct,
    mode: "static",
    reference: { price: input.referencePrice, type: input.referenceType },
    maxExecutablePrice: input.maxExecutablePrice ?? input.activationPrice * (1 + input.staticTrailingPct / 100),
    validUntil: input.nowMs + input.maxDurationMs,
    reason: input.reason,
  };
}

export function canonicalReboundTriggerPrice(params: TrailingBuyCanonicalParams, localLow: number): number {
  return localLow * (1 + params.effectiveThresholdPct / 100);
}

export function isCanonicalTrailingBuyExpired(params: TrailingBuyCanonicalParams, nowMs: number): boolean {
  return nowMs >= params.validUntil;
}
