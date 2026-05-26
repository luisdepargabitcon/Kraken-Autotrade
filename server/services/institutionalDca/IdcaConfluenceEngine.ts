/**
 * IdcaConfluenceEngine — Motor de Confluencia IDCA (Sprint 1b)
 *
 * Arquitectura jerárquica de decisión:
 *  1. Hard gates         — bloqueo crítico, nada lo compensa
 *  2. Market regime      — clasifica el contexto de mercado
 *  3. Family scores      — valueScore, confirmationScore, riskScore, dataScore, regimeScore
 *  4. Multiplicadores    — risk × data × regime (no suma plana)
 *  5. Confidence final   — sqrt(value×confirmation) × multiplicadores
 *  6. Decision class     — NO_ENTRY / WATCH / ARM_TRAILING / NORMAL_ENTRY / HIGH_CONFIDENCE_ENTRY
 *  7. Smart adjustment   — para assisted_entry con smartAdjustmentEnabled=true
 *  8. Dynamic distance   — para dynamic_intelligent_entry usa confidence para ajustar distancia
 *
 * Sprint 1b default: smartAdjustmentEnabled=false → solo diagnóstico, sin cambio de distancia.
 * NO modifica sizing real, avgEntryPrice, anclas ni fills.
 */

import type {
  IdcaConfluenceInput,
  IdcaConfluenceResult,
  IdcaConfluenceBreakdown,
  IdcaFamilyScores,
  IdcaMarketRegime,
  IdcaDecisionClass,
  IdcaConfidenceGrade,
  IdcaHardBlockerCode,
  IdcaDegradingBlockerCode,
} from "./IdcaTypes";

const TAG = "[IDCA]";

// ─── Constantes ────────────────────────────────────────────────────────────────

const CLAMP_BTC_SMART_ADJ_MIN = -0.30;
const CLAMP_BTC_SMART_ADJ_MAX =  0.70;
const CLAMP_ETH_SMART_ADJ_MIN = -0.50;
const CLAMP_ETH_SMART_ADJ_MAX =  1.00;
const CLAMP_GENERIC_SMART_ADJ_MIN = -0.40;
const CLAMP_GENERIC_SMART_ADJ_MAX =  0.80;

// ─── Market Regime Classifier ─────────────────────────────────────────────────

/**
 * Clasifica el régimen de mercado actual para el par.
 * Orden de prioridad: extreme conditions → positive → neutral/low → unknown.
 */
export function classifyIdcaMarketRegime(input: {
  marketScore: number;
  atrPct: number;
  drawdownFromReferencePct: number;
  vwapZone?: string;
  btcContext?: string;
  reboundConfirmed: boolean;
  candleCount: number;
}): IdcaMarketRegime {
  const { marketScore, atrPct, drawdownFromReferencePct, vwapZone, btcContext, reboundConfirmed, candleCount } = input;

  // Datos insuficientes
  if (candleCount < 7) return "unknown";

  // Volatilidad extrema
  if (atrPct > 3.5) return "high_volatility";

  // BTC breakdown crítico bloquea ETH incluso antes del régimen propio
  if (btcContext === "breakdown") return "bearish_breakdown";

  // Capitulación: score muy bajo + drawdown extremo
  if (marketScore < 25 && drawdownFromReferencePct > 15) return "capitulation_zone";

  // Bearish breakdown: score bajo + zona VWAP muy desfavorable o drawdown grande
  const vwapExtremelyBad = vwapZone === "above_upper2" || vwapZone === "above_upper1";
  if (marketScore < 35 && (drawdownFromReferencePct > 10 || vwapExtremelyBad)) return "bearish_breakdown";

  // Rebound candidate: gran caída + rebote iniciado + contexto razonable
  if (drawdownFromReferencePct > 7 && reboundConfirmed && marketScore >= 38) return "rebound_candidate";

  // Bullish pullback: buen score + caída moderada
  if (marketScore >= 62 && drawdownFromReferencePct >= 2.0) return "bullish_pullback";

  // Low volatility
  if (atrPct < 0.70) return "low_volatility";

  // Neutral range
  if (marketScore >= 40) return "neutral_range";

  // Default bearish
  if (marketScore < 40) return "bearish_breakdown";

  return "unknown";
}

// ─── Family Scores ─────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function computeValueScore(input: IdcaConfluenceInput): {
  score: number; distanceScore: number; vwapZoneScore: number; referenceQualityScore: number;
} {
  const { drawdownFromReferencePct, requiredDistancePct, vwapZone, referenceMethod } = input;

  // 1. distance score
  const distanceScore = clamp(
    requiredDistancePct > 0 ? (drawdownFromReferencePct / requiredDistancePct) * 100 : 0,
    0, 100
  );

  // 2. VWAP zone score
  const vwapZoneScoreMap: Record<string, number> = {
    "below_lower3": 95,
    "below_lower2": 90,
    "below_lower1": 78,
    "between_bands": 55,
    "above_upper1": 30,
    "above_upper2": 15,
  };
  const vwapZoneScore = vwapZone ? (vwapZoneScoreMap[vwapZone] ?? 50) : 50;

  // 3. reference quality score
  let referenceQualityScore: number;
  if (!referenceMethod || referenceMethod === "none") {
    referenceQualityScore = 20;
  } else if (referenceMethod.includes("vwap_anchor") || referenceMethod === "vwap_anchor") {
    referenceQualityScore = 75;
  } else if (referenceMethod.includes("stale")) {
    referenceQualityScore = 45;
  } else if (referenceMethod === "hybrid" || referenceMethod.includes("hybrid")) {
    referenceQualityScore = 70;
  } else {
    referenceQualityScore = 55;
  }

  const score = clamp(
    0.50 * distanceScore + 0.35 * vwapZoneScore + 0.15 * referenceQualityScore,
    0, 100
  );

  return { score, distanceScore, vwapZoneScore, referenceQualityScore };
}

function computeConfirmationScore(input: IdcaConfluenceInput): {
  score: number; reboundScore: number; momentumScore: number; structureScore: number;
} {
  const { reboundConfirmed, requireReboundConfirmation, trailingBuyArmed, priceInActivationZone,
          shortMomentum, hasRecoveryCandle } = input;

  // 1. rebound score
  let reboundScore: number;
  if (reboundConfirmed) {
    reboundScore = 100;
  } else if (trailingBuyArmed) {
    reboundScore = 60;
  } else if (priceInActivationZone) {
    reboundScore = 50;
  } else {
    reboundScore = 30;
  }

  // 2. momentum score
  const momentumScore = shortMomentum === "positive" ? 80
    : shortMomentum === "flat" ? 55
    : shortMomentum === "negative" ? 25
    : 50;

  // 3. structure score
  const structureScore = hasRecoveryCandle === true ? 80
    : hasRecoveryCandle === false ? 35
    : 50;

  const score = clamp(
    0.55 * reboundScore + 0.30 * momentumScore + 0.15 * structureScore,
    0, 100
  );

  return { score, reboundScore, momentumScore, structureScore };
}

function computeRiskScore(input: IdcaConfluenceInput): {
  score: number; exposurePenalty: number; cyclePressurePenalty: number;
  volatilityPenalty: number; btcContextPenalty: number;
} {
  const { capitalUsedUsd, capitalReservedUsd, buyCount, atrPct, btcContext } = input;

  // 1. exposure penalty
  const exposurePct = capitalReservedUsd > 0 ? (capitalUsedUsd / capitalReservedUsd) * 100 : 0;
  const exposurePenalty = exposurePct > 90 ? 75
    : exposurePct > 80 ? 50
    : exposurePct > 75 ? 30
    : exposurePct > 50 ? 15
    : exposurePct > 25 ? 0
    : 0;

  // 2. cycle pressure penalty (number of buys in cycle)
  const cyclePressurePenalty = buyCount >= 5 ? 50
    : buyCount >= 4 ? 30
    : buyCount >= 3 ? 15
    : buyCount >= 2 ? 5
    : 0;

  // 3. volatility penalty
  const volatilityPenalty = atrPct > 3.5 ? 35
    : atrPct > 2.5 ? 15
    : atrPct > 1.8 ? 5
    : 0;

  // 4. BTC context penalty (for ETH)
  const btcContextPenalty = btcContext === "breakdown" ? 999  // triggers hard gate
    : btcContext === "weak" ? 25
    : btcContext === "neutral" ? 10
    : 0;  // supportive

  const rawRisk = 100 - exposurePenalty - cyclePressurePenalty - volatilityPenalty
    - Math.min(25, btcContextPenalty);

  return {
    score: clamp(rawRisk, 0, 100),
    exposurePenalty, cyclePressurePenalty, volatilityPenalty, btcContextPenalty,
  };
}

function computeDataScore(input: IdcaConfluenceInput): {
  score: number; candlesScore: number; freshnessScore: number; sourceScore: number; indicatorScore: number;
} {
  const { candleCount, atrReliable, vwapReliable } = input;

  // 1. candles score
  const candlesScore = candleCount >= 72 ? 100
    : candleCount >= 24 ? 80
    : candleCount >= 14 ? 60
    : candleCount >= 7 ? 40
    : 0;

  // 2. freshness score — assume fresh if we have candles (MDS-managed)
  const freshnessScore = candleCount > 0 ? 100 : 0;

  // 3. source score — assume Kraken/MDS (reliable)
  const sourceScore = 100;

  // 4. indicator reliability
  const indicatorScore = (atrReliable && vwapReliable) ? 100
    : (atrReliable || vwapReliable) ? 70
    : 35;

  const score = clamp(
    0.35 * candlesScore + 0.30 * freshnessScore + 0.20 * sourceScore + 0.15 * indicatorScore,
    0, 100
  );

  return { score, candlesScore, freshnessScore, sourceScore, indicatorScore };
}

function regimeToScore(regime: IdcaMarketRegime): number {
  const map: Record<IdcaMarketRegime, number> = {
    bullish_pullback:   82,
    rebound_candidate:  76,
    neutral_range:      62,
    low_volatility:     68,
    high_volatility:    48,
    capitulation_zone:  55,
    bearish_breakdown:  20,
    unknown:            50,
  };
  return map[regime];
}

// ─── Multiplicadores ──────────────────────────────────────────────────────────

function computeMultipliers(riskScore: number, dataScore: number, regime: IdcaMarketRegime): {
  riskMultiplier: number; dataMultiplier: number; regimeMultiplier: number;
} {
  const riskMultiplier = riskScore >= 85 ? 1.10
    : riskScore >= 70 ? 1.00
    : riskScore >= 55 ? 0.85
    : riskScore >= 40 ? 0.60
    : 0.30;

  const dataMultiplier = dataScore >= 85 ? 1.00
    : dataScore >= 70 ? 0.90
    : dataScore >= 55 ? 0.70
    : dataScore >= 40 ? 0.45
    : 0.00;

  const regimeMap: Record<IdcaMarketRegime, number> = {
    bullish_pullback:   1.10,
    rebound_candidate:  1.05,
    neutral_range:      1.00,
    low_volatility:     1.00,
    high_volatility:    0.80,
    capitulation_zone:  0.75,
    bearish_breakdown:  0.35,
    unknown:            0.85,
  };
  const regimeMultiplier = regimeMap[regime];

  return { riskMultiplier, dataMultiplier, regimeMultiplier };
}

// ─── Hard Gates ────────────────────────────────────────────────────────────────

function evaluateHardGates(input: IdcaConfluenceInput, dataScore: number): IdcaHardBlockerCode[] {
  const blockers: IdcaHardBlockerCode[] = [];

  // data_unusable: dataScore < 30 or zero candles
  if (dataScore < 30 || input.candleCount < 5) {
    blockers.push("data_unusable");
  }

  // overexposed_critical: exposure > 90%
  const exposurePct = input.capitalReservedUsd > 0
    ? (input.capitalUsedUsd / input.capitalReservedUsd) * 100
    : 0;
  if (exposurePct > 90) {
    blockers.push("overexposed_critical");
  }

  // btc_breakdown_blocks_eth
  if (input.btcContext === "breakdown") {
    blockers.push("btc_breakdown_blocks_eth");
  }

  // vwap_zone_extremely_unfavorable: price above upper2 (overvalued)
  if (input.vwapZone === "above_upper2") {
    blockers.push("vwap_zone_extremely_unfavorable");
  }

  return blockers;
}

// ─── Degrading Blockers ───────────────────────────────────────────────────────

function evaluateDegradingBlockers(
  input: IdcaConfluenceInput,
  regime: IdcaMarketRegime,
  familyScores: IdcaFamilyScores,
): IdcaDegradingBlockerCode[] {
  const blockers: IdcaDegradingBlockerCode[] = [];

  if (familyScores.dataScore < 55) blockers.push("data_degraded");
  if (input.marketScore < 45) blockers.push("market_score_weak");
  if (familyScores.riskScore < 45) blockers.push("risk_elevated");
  if (input.atrPct > 2.5) blockers.push("high_volatility_warn");

  if (input.requireReboundConfirmation && !input.reboundConfirmed) {
    blockers.push("no_rebound_when_required");
  }

  const unfavorableVwapZones = ["above_upper1", "between_bands"];
  if (input.vwapZone && unfavorableVwapZones.includes(input.vwapZone)) {
    blockers.push("vwap_zone_unfavorable");
  }

  const exposurePct = input.capitalReservedUsd > 0
    ? (input.capitalUsedUsd / input.capitalReservedUsd) * 100 : 0;
  if (exposurePct > 50 && exposurePct <= 90) blockers.push("exposure_medium_high");

  if (input.buyCount >= 3) blockers.push("cycle_pressure_high");

  return blockers;
}

// ─── Decision Class ────────────────────────────────────────────────────────────

function classifyDecision(
  confidenceScore: number,
  hardBlocked: boolean,
  degrading: IdcaDegradingBlockerCode[],
  input: IdcaConfluenceInput,
  regime: IdcaMarketRegime,
  familyScores: IdcaFamilyScores,
): IdcaDecisionClass {
  if (hardBlocked) return "NO_ENTRY";
  if (confidenceScore < 45) return "NO_ENTRY";

  // Limitadores
  const maxByData     = familyScores.dataScore < 55 ? "WATCH" : null;
  const maxByRisk     = familyScores.riskScore < 45 ? "WATCH" : null;
  const maxByRegime   = regime === "bearish_breakdown" ? "WATCH" : null;
  const maxByRebound  = (input.requireReboundConfirmation && !input.reboundConfirmed)
    ? "ARM_TRAILING" : null;

  // Defensive safety buy
  if (input.usedFor === "safety_buy" && familyScores.riskScore < 45) {
    return "DEFENSIVE_SAFETY_BUY";
  }

  // Base decision class from confidence
  let base: IdcaDecisionClass;
  if (confidenceScore >= 82)      base = "HIGH_CONFIDENCE_ENTRY";
  else if (confidenceScore >= 70) base = "NORMAL_ENTRY";
  else if (confidenceScore >= 60) base = "ARM_TRAILING";
  else                            base = "WATCH";

  // Apply limiters (pick most restrictive)
  const decisionOrder: IdcaDecisionClass[] = [
    "NO_ENTRY", "WATCH", "ARM_TRAILING", "NORMAL_ENTRY", "HIGH_CONFIDENCE_ENTRY", "DEFENSIVE_SAFETY_BUY"
  ];
  const rawLimiters: (IdcaDecisionClass | null)[] = [maxByData, maxByRisk, maxByRegime, maxByRebound];
  const limiters: IdcaDecisionClass[] = rawLimiters.filter((l): l is IdcaDecisionClass => l !== null);
  let decision: IdcaDecisionClass = base;
  for (const limiter of limiters) {
    const limitIdx = decisionOrder.indexOf(limiter);
    const baseIdx  = decisionOrder.indexOf(decision);
    if (limitIdx < baseIdx) decision = limiter;
  }

  return decision;
}

// ─── Smart Adjustment (assisted_entry) ───────────────────────────────────────

function computeSmartAdjustment(
  input: IdcaConfluenceInput,
  regime: IdcaMarketRegime,
  familyScores: IdcaFamilyScores,
  confidenceScore: number,
): {
  smartAdjustmentPct: number;
  raw: number;
  riskAdjustment: number;
  dataAdjustment: number;
  regimeAdjustment: number;
  vwapAdjustment: number;
  confidenceDiscount: number;
} {
  if (!input.smartAdjustmentEnabled) {
    return { smartAdjustmentPct: 0, raw: 0, riskAdjustment: 0, dataAdjustment: 0,
             regimeAdjustment: 0, vwapAdjustment: 0, confidenceDiscount: 0 };
  }

  const { riskScore, dataScore } = familyScores;
  const { vwapZone, pair } = input;

  const riskAdjustment = riskScore < 45 ? +0.45
    : riskScore < 60 ? +0.25
    : riskScore > 85 ? -0.05
    : 0;

  const dataAdjustment = dataScore < 55 ? +0.30
    : dataScore < 70 ? +0.15
    : dataScore > 90 ? -0.05
    : 0;

  const regimeAdjustment = regime === "bearish_breakdown" ? +0.60
    : regime === "high_volatility" ? +0.30
    : regime === "capitulation_zone" ? +0.25
    : regime === "bullish_pullback" ? -0.15
    : regime === "rebound_candidate" ? -0.10
    : 0;

  const favorableZones = ["below_lower2", "below_lower3"];
  const unfavorableZones = ["above_upper1", "between_bands"];
  const vwapAdjustment = vwapZone && favorableZones.includes(vwapZone) ? -0.10
    : vwapZone && unfavorableZones.includes(vwapZone) ? +0.25
    : 0;

  const confidenceDiscount = confidenceScore >= 85 ? 0.20
    : confidenceScore >= 75 ? 0.10
    : 0;

  const raw = riskAdjustment + dataAdjustment + regimeAdjustment + vwapAdjustment - confidenceDiscount;

  // Clamp by pair
  const isBtc = pair === "BTC/USD";
  const isEth = pair === "ETH/USD";
  const adjMin = isBtc ? CLAMP_BTC_SMART_ADJ_MIN : isEth ? CLAMP_ETH_SMART_ADJ_MIN : CLAMP_GENERIC_SMART_ADJ_MIN;
  const adjMax = isBtc ? CLAMP_BTC_SMART_ADJ_MAX : isEth ? CLAMP_ETH_SMART_ADJ_MAX : CLAMP_GENERIC_SMART_ADJ_MAX;

  const smartAdjustmentPct = clamp(raw, adjMin, adjMax);

  return { smartAdjustmentPct, raw, riskAdjustment, dataAdjustment, regimeAdjustment, vwapAdjustment, confidenceDiscount };
}

// ─── Dynamic Intelligent Entry with Confidence ───────────────────────────────

function computeDynamicWithConfidence(
  input: IdcaConfluenceInput,
  familyScores: IdcaFamilyScores,
  confidenceScore: number,
): {
  finalRequiredDistancePct: number;
  confidenceAdjustmentPct: number;
  breakdown: Pick<IdcaConfluenceBreakdown,
    "dynamicConfidenceDiscount" | "dynamicConfidencePenalty" | "dynamicRiskPenaltiesPct" | "candidateDistancePct">;
} {
  const rawDist = input.dynamicRawDistancePct ?? input.requiredDistancePct;
  const { riskScore } = familyScores;
  const minDist = input.userMinEntryDistancePct ?? 0.50;
  const maxDist = input.userMaxEntryDistancePct ?? 12.0;

  const confidenceDiscount = confidenceScore >= 85 ? 0.35
    : confidenceScore >= 75 ? 0.20
    : confidenceScore >= 65 ? 0.10
    : 0;

  const confidencePenalty = confidenceScore < 45 ? +0.50
    : confidenceScore < 60 ? +0.25
    : 0;

  const riskPenaltiesPct = riskScore < 45 ? +0.50
    : riskScore < 60 ? +0.25
    : 0;

  const candidateDistancePct = rawDist + confidencePenalty + riskPenaltiesPct - confidenceDiscount;
  const finalRequiredDistancePct = clamp(candidateDistancePct, minDist, maxDist);
  const confidenceAdjustmentPct = finalRequiredDistancePct - rawDist;

  return {
    finalRequiredDistancePct,
    confidenceAdjustmentPct,
    breakdown: {
      dynamicConfidenceDiscount: confidenceDiscount,
      dynamicConfidencePenalty:  confidencePenalty,
      dynamicRiskPenaltiesPct:   riskPenaltiesPct,
      candidateDistancePct,
    },
  };
}

// ─── Confidence Grade ──────────────────────────────────────────────────────────

function gradeConfidence(score: number): IdcaConfidenceGrade {
  if (score >= 82) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 45) return "D";
  return "F";
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

/**
 * Evalúa la confluencia de condiciones para una decisión de entrada IDCA.
 * Retorna decisionClass, confidenceScore, familyScores, smart adjustment y diagnóstico completo.
 *
 * Sprint 1b:
 *  - smartAdjustmentEnabled=false (default) → solo diagnóstico, finalRequiredDistancePct = input.requiredDistancePct
 *  - smartAdjustmentEnabled=true → ajusta finalRequiredDistancePct con smart adjustment
 *  - confluenceProfile=full → dynamic_intelligent_entry: usa confidence para ajustar distancia
 */
export function evaluateIdcaEntryConfluence(input: IdcaConfluenceInput): IdcaConfluenceResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  // ── Step 1: Data score (needed for hard gates) ─────────────────────────────
  const { score: dataScore, candlesScore, freshnessScore, sourceScore, indicatorScore } =
    computeDataScore(input);

  // ── Step 2: Hard gates ─────────────────────────────────────────────────────
  const hardBlockers = evaluateHardGates(input, dataScore);
  const hardBlocked = hardBlockers.length > 0;

  if (hardBlocked) {
    reasons.push(...hardBlockers.map(hb => `hard_gate:${hb}`));
  }

  // ── Step 3: Market regime ──────────────────────────────────────────────────
  const marketRegime = classifyIdcaMarketRegime({
    marketScore: input.marketScore,
    atrPct: input.atrPct,
    drawdownFromReferencePct: input.drawdownFromReferencePct,
    vwapZone: input.vwapZone,
    btcContext: input.btcContext,
    reboundConfirmed: input.reboundConfirmed,
    candleCount: input.candleCount,
  });

  // ── Step 4: Family scores ──────────────────────────────────────────────────
  const { score: valueScore, distanceScore, vwapZoneScore, referenceQualityScore } =
    computeValueScore(input);

  const { score: confirmationScore, reboundScore, momentumScore, structureScore } =
    computeConfirmationScore(input);

  const { score: riskScore, exposurePenalty, cyclePressurePenalty, volatilityPenalty, btcContextPenalty } =
    computeRiskScore(input);

  const regimeScore = regimeToScore(marketRegime);

  const familyScores: IdcaFamilyScores = {
    valueScore, confirmationScore, riskScore, dataScore, regimeScore,
  };

  // ── Step 5: Degrading blockers ─────────────────────────────────────────────
  const degradingBlockers = evaluateDegradingBlockers(input, marketRegime, familyScores);

  if (degradingBlockers.length > 0) {
    warnings.push(...degradingBlockers.map(db => `degrading:${db}`));
  }

  // ── Step 6: Multiplicators ────────────────────────────────────────────────
  const { riskMultiplier, dataMultiplier, regimeMultiplier } =
    computeMultipliers(riskScore, dataScore, marketRegime);

  // ── Step 7: Confidence score ──────────────────────────────────────────────
  let confidenceScore: number;
  if (hardBlocked) {
    confidenceScore = 0;
  } else {
    const baseOpportunity = Math.sqrt(Math.max(0, valueScore) * Math.max(0, confirmationScore));
    confidenceScore = clamp(baseOpportunity * riskMultiplier * dataMultiplier * regimeMultiplier, 0, 100);
  }

  const confidenceGrade = gradeConfidence(confidenceScore);
  const baseOpportunity = hardBlocked ? 0 :
    Math.sqrt(Math.max(0, valueScore) * Math.max(0, confirmationScore));

  // ── Step 8: Decision class ────────────────────────────────────────────────
  const decisionClass = classifyDecision(confidenceScore, hardBlocked, degradingBlockers, input, marketRegime, familyScores);

  // ── Step 9: canArmTrailingBuy ─────────────────────────────────────────────
  const minConfScore = input.minConfidenceScore ?? 45;
  const canArmTrailingBuy = !hardBlocked
    && input.priceInActivationZone
    && confidenceScore >= minConfScore;

  // ── Step 10: Final distance & adjustments ─────────────────────────────────
  let smartAdjustmentPct = 0;
  let finalRequiredDistancePct = input.requiredDistancePct;
  let confidenceAdjustmentPct = 0;
  let smartBreakdown: Partial<IdcaConfluenceBreakdown> = {};
  let dynamicBreakdown: Partial<IdcaConfluenceBreakdown> = {};

  if (input.confluenceProfile === "assisted") {
    const adj = computeSmartAdjustment(input, marketRegime, familyScores, confidenceScore);
    smartAdjustmentPct = adj.smartAdjustmentPct;
    smartBreakdown = {
      smartAdjustmentRaw:  adj.raw,
      smartAdjustmentPct:  adj.smartAdjustmentPct,
      riskAdjustment:      adj.riskAdjustment,
      dataAdjustment:      adj.dataAdjustment,
      regimeAdjustment:    adj.regimeAdjustment,
      vwapAdjustment:      adj.vwapAdjustment,
      confidenceDiscount:  adj.confidenceDiscount,
    };
    const sliderBase = input.sliderBasePct ?? input.requiredDistancePct;
    finalRequiredDistancePct = sliderBase + smartAdjustmentPct;
    // Hard floor: never go below 50% of original distance
    finalRequiredDistancePct = Math.max(finalRequiredDistancePct, sliderBase * 0.50);

  } else if (input.confluenceProfile === "full") {
    const dynResult = computeDynamicWithConfidence(input, familyScores, confidenceScore);
    finalRequiredDistancePct = dynResult.finalRequiredDistancePct;
    confidenceAdjustmentPct = dynResult.confidenceAdjustmentPct;
    dynamicBreakdown = dynResult.breakdown;
  }

  // Safety: if hardBlocked, preserve original distance (no smart reduction)
  if (hardBlocked) {
    finalRequiredDistancePct = Math.max(finalRequiredDistancePct, input.requiredDistancePct);
  }

  // ── Build result ──────────────────────────────────────────────────────────
  const breakdown: IdcaConfluenceBreakdown = {
    distanceScore, vwapZoneScore, referenceQualityScore,
    reboundScore, momentumScore, structureScore,
    exposurePenalty, cyclePressurePenalty, volatilityPenalty, btcContextPenalty,
    candlesScore, freshnessScore, sourceScore, indicatorScore,
    riskMultiplier, dataMultiplier, regimeMultiplier,
    baseOpportunity,
    ...smartBreakdown,
    ...dynamicBreakdown,
  };

  return {
    decisionClass,
    confidenceScore: +confidenceScore.toFixed(1),
    confidenceGrade,
    marketRegime,
    hardBlocked,
    hardBlockers,
    degradingBlockers,
    familyScores: {
      valueScore: +valueScore.toFixed(1),
      confirmationScore: +confirmationScore.toFixed(1),
      riskScore: +riskScore.toFixed(1),
      dataScore: +dataScore.toFixed(1),
      regimeScore,
    },
    canArmTrailingBuy,
    smartAdjustmentPct: +smartAdjustmentPct.toFixed(3),
    finalRequiredDistancePct: +finalRequiredDistancePct.toFixed(3),
    confidenceAdjustmentPct: +confidenceAdjustmentPct.toFixed(3),
    breakdown,
    reasons,
    warnings,
  };
}

// ─── Log Helper ────────────────────────────────────────────────────────────────

/**
 * Emite log [IDCA][CONFLUENCE] con el resultado completo de evaluación.
 */
export function logIdcaConfluence(tag: string, pair: string, result: IdcaConfluenceResult): void {
  const { familyScores: fs, breakdown: b } = result;

  const parts = [
    `${tag}[CONFLUENCE] pair=${pair}`,
    `decisionClass=${result.decisionClass}`,
    `confidenceScore=${result.confidenceScore}`,
    `confidenceGrade=${result.confidenceGrade}`,
    `marketRegime=${result.marketRegime}`,
    `hardBlocked=${result.hardBlocked}`,
  ];

  if (result.hardBlockers.length > 0) parts.push(`hardBlockers=${result.hardBlockers.join(",")}`);
  if (result.degradingBlockers.length > 0) parts.push(`degrading=${result.degradingBlockers.join(",")}`);

  parts.push(
    `valueScore=${fs.valueScore}`,
    `confirmationScore=${fs.confirmationScore}`,
    `riskScore=${fs.riskScore}`,
    `dataScore=${fs.dataScore}`,
    `regimeScore=${fs.regimeScore}`,
    `riskMult=${b.riskMultiplier.toFixed(2)}`,
    `dataMult=${b.dataMultiplier.toFixed(2)}`,
    `regimeMult=${b.regimeMultiplier.toFixed(2)}`,
    `baseOpportunity=${b.baseOpportunity.toFixed(1)}`,
    `finalDistancePct=${result.finalRequiredDistancePct.toFixed(2)}%`,
    `canArmTB=${result.canArmTrailingBuy}`,
  );

  if (b.smartAdjustmentPct != null) parts.push(`smartAdj=${b.smartAdjustmentPct.toFixed(3)}%`);
  if (result.confidenceAdjustmentPct != null && result.confidenceAdjustmentPct !== 0) {
    parts.push(`confidenceAdj=${result.confidenceAdjustmentPct.toFixed(3)}%`);
  }
  if (result.reasons.length > 0)  parts.push(`reasons=${result.reasons.join("|")}`);
  if (result.warnings.length > 0) parts.push(`warnings=${result.warnings.join("|")}`);

  console.log(parts.join(" "));
}
