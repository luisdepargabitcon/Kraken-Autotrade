/**
 * IdcaDynamicReboundResolver — Intelligent rebound calculation for IDCA trailing buy.
 *
 * In dynamic_intelligent_entry mode, the rebound is calculated from ATR, confluence,
 * market regime, and VWAP context, with protection against over-extended rebounds.
 *
 * Key protection: maxExecutionPrice must retain at least requiredDistancePct by default.
 */

import type {
  IdcaDynamicReboundInput,
  IdcaDynamicReboundResult,
  IdcaDynamicReboundBreakdown,
  DynamicReboundConfig,
  IdcaReboundSource,
  IdcaReboundBlocker,
  IdcaReboundState,
  IdcaTbPath,
} from "./IdcaTypes";

const TAG = "[IDCA][DYNAMIC_REBOUND]";

/**
 * Resolve dynamic rebound for trailing buy entry.
 */
export function resolveIdcaDynamicRebound(
  input: IdcaDynamicReboundInput,
): IdcaDynamicReboundResult {
  const {
    pair,
    usedFor,
    entryMode,
    localLowPrice,
    currentPrice,
    referencePrice,
    requiredDistancePct,
    drawdownFromReferencePct,
    atrPct,
    confidenceScore = 75,
    marketRegime = "neutral_range",
    vwapZone = "between_bands",
    confluenceResult,
    dynamicReboundConfig,
    tbPath = "unknown",
  } = input;

  // ─── 1. Determine source based on entry mode ─────────────────────────────
  let source: IdcaReboundSource;
  if (entryMode === "dynamic_intelligent_entry" && dynamicReboundConfig.enabled) {
    source = "dynamic_rebound";
  } else if (entryMode === "assisted_entry") {
    source = "assisted_rebound";
  } else {
    source = "legacy_rebound";
  }

  // ─── 2. Legacy/assisted fallback (no dynamic calculation) ─────────────────
  if (source !== "dynamic_rebound") {
    return {
      reboundPct: 0,
      reboundTriggerPrice: localLowPrice,
      maxExecutionPrice: referencePrice,
      retainedDropPct: requiredDistancePct,
      retainedRequiredDropPct: requiredDistancePct,
      retainedActualDropPct: drawdownFromReferencePct,
      canExecuteTrailingBuy: false,
      source,
      blocker: "none",
      state: "inactive",
      tbPath,
      breakdown: {
        atrPct,
        atrComponent: 0,
        confidenceScore,
        confidenceFactor: 1,
        regimeFactor: 1,
        vwapFactor: 1,
        minReboundPct: 0,
        maxReboundPct: 0,
        drawdownFromReferencePct,
        requiredDistancePct,
        retainedRequiredDropPct: requiredDistancePct,
        retainedActualDropPct: drawdownFromReferencePct,
        retainedDropPct: requiredDistancePct,
        finalReboundPct: 0,
        finalReboundTriggerPrice: localLowPrice,
        finalMaxExecutionPrice: referencePrice,
      },
    };
  }

  // ─── 3. Dynamic rebound calculation ─────────────────────────────────────
  const cfg = dynamicReboundConfig;

  // Base rebound from ATR
  const atrComponent = atrPct * cfg.reboundAtrMultiplier;

  // Confidence factor (higher confidence = lower rebound = tighter entry)
  const confidenceFactor =
    confidenceScore >= 90 ? 0.70 :
    confidenceScore >= 85 ? 0.75 :
    confidenceScore >= 75 ? 0.85 :
    confidenceScore >= 65 ? 1.00 :
    confidenceScore >= 55 ? 1.15 :
    1.30;

  // Regime factor (higher volatility = higher rebound = looser entry)
  const regimeFactor =
    marketRegime === "low_volatility" ? 0.80 :
    marketRegime === "bullish_pullback" ? 0.90 :
    marketRegime === "rebound_candidate" ? 0.95 :
    marketRegime === "neutral_range" ? 1.00 :
    marketRegime === "high_volatility" ? 1.25 :
    marketRegime === "bearish_breakdown" ? 1.40 :
    marketRegime === "capitulation_zone" ? 1.30 :
    1.00;

  // VWAP factor (below bands = lower rebound, above bands = higher rebound)
  const vwapFactor =
    vwapZone === "below_lower2" || vwapZone === "below_lower3" ? 0.90 :
    vwapZone === "below_lower1" ? 0.95 :
    vwapZone === "between_bands" ? 1.05 :
    vwapZone === "above_upper1" ? 1.20 :
    vwapZone === "above_upper2" || vwapZone === "above_upper3" ? 1.40 :
    1.00;

  // Candidate rebound
  const candidateReboundPct = atrComponent * confidenceFactor * regimeFactor * vwapFactor;

  // Clamp to user bounds
  const finalReboundPct = Math.max(
    cfg.minReboundPct,
    Math.min(cfg.maxReboundPct, candidateReboundPct)
  );

  // ─── 4. Calculate trigger and execution prices ─────────────────────────
  const reboundTriggerPrice = localLowPrice * (1 + finalReboundPct / 100);

  // ─── 5. Anti-over-extended protection ───────────────────────────────────
  const retainedRequiredDropPct = requiredDistancePct * cfg.minRequiredDropRetentionRatio;
  const retainedActualDropPct = drawdownFromReferencePct * cfg.minActualDrawdownRetentionRatio;
  const retainedDropPct = Math.max(
    retainedRequiredDropPct,
    retainedActualDropPct,
    requiredDistancePct
  );

  const maxExecutionPrice = referencePrice * (1 - retainedDropPct / 100);

  // ─── 6. Determine state and blocker ─────────────────────────────────────
  let state: IdcaReboundState = "watching_rebound";
  let blocker: IdcaReboundBlocker = "none";
  let canExecuteTrailingBuy = false;

  // Check confluence hard block
  if (confluenceResult?.hardBlocked) {
    state = "blocked";
    blocker = "confluence_hard_blocked";
    canExecuteTrailingBuy = false;
  }
  // Check if price exceeded max execution price
  else if (currentPrice > maxExecutionPrice && cfg.antiOverextendedEnabled) {
    state = "overextended";
    blocker = "max_execution_price_exceeded";
    canExecuteTrailingBuy = false;
  }
  // Check if rebound trigger reached
  else if (currentPrice >= reboundTriggerPrice) {
    state = "confirmed";
    blocker = "none";
    canExecuteTrailingBuy = true;
  }
  // Still waiting for rebound
  else {
    state = "watching_rebound";
    blocker = "rebound_trigger_not_reached";
    canExecuteTrailingBuy = false;
  }

  // ─── 7. Build breakdown ───────────────────────────────────────────────
  const breakdown: IdcaDynamicReboundBreakdown = {
    atrPct,
    atrComponent,
    confidenceScore,
    confidenceFactor,
    regimeFactor,
    vwapFactor,
    minReboundPct: cfg.minReboundPct,
    maxReboundPct: cfg.maxReboundPct,
    drawdownFromReferencePct,
    requiredDistancePct,
    retainedRequiredDropPct,
    retainedActualDropPct,
    retainedDropPct,
    finalReboundPct,
    finalReboundTriggerPrice: reboundTriggerPrice,
    finalMaxExecutionPrice: maxExecutionPrice,
  };

  // ─── 8. Log result ───────────────────────────────────────────────────────
  console.log(
    `${TAG} pair=${pair} usedFor=${usedFor} entryMode=${entryMode} source=${source}` +
    ` localLowPrice=$${localLowPrice.toFixed(2)} referencePrice=$${referencePrice.toFixed(2)}` +
    ` currentPrice=$${currentPrice.toFixed(2)} requiredDistancePct=${requiredDistancePct.toFixed(2)}%` +
    ` drawdownFromReferencePct=${drawdownFromReferencePct.toFixed(2)}% atrPct=${atrPct.toFixed(3)}%` +
    ` confidenceScore=${confidenceScore} marketRegime=${marketRegime} vwapZone=${vwapZone}` +
    ` reboundPct=${finalReboundPct.toFixed(3)}% reboundTriggerPrice=$${reboundTriggerPrice.toFixed(2)}` +
    ` retainedDropPct=${retainedDropPct.toFixed(3)}% maxExecutionPrice=$${maxExecutionPrice.toFixed(2)}` +
    ` canExecuteTrailingBuy=${canExecuteTrailingBuy} blocker=${blocker} state=${state} tbPath=${tbPath}`
  );

  return {
    reboundPct: finalReboundPct,
    reboundTriggerPrice,
    maxExecutionPrice,
    retainedDropPct,
    retainedRequiredDropPct,
    retainedActualDropPct,
    canExecuteTrailingBuy,
    source,
    blocker,
    state,
    tbPath,
    breakdown,
  };
}

/**
 * Get default dynamic rebound config for a pair.
 */
export function getDefaultDynamicReboundConfig(pair: string): DynamicReboundConfig {
  if (pair.includes("ETH")) {
    return {
      enabled: true,
      minReboundPct: 0.15,
      maxReboundPct: 1.20,
      reboundAtrMultiplier: 0.50,
      minRequiredDropRetentionRatio: 1.00,
      minActualDrawdownRetentionRatio: 0.50,
      antiOverextendedEnabled: true,
    };
  }
  // BTC default
  return {
    enabled: true,
    minReboundPct: 0.10,
    maxReboundPct: 0.80,
    reboundAtrMultiplier: 0.40,
    minRequiredDropRetentionRatio: 1.00,
    minActualDrawdownRetentionRatio: 0.50,
    antiOverextendedEnabled: true,
  };
}
