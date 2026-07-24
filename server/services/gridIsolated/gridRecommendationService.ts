/**
 * gridRecommendationService.ts
 *
 * Server-side recommendation engine for Grid Isolated configuration.
 * Uses EXCLUSIVELY canonical functions from gridNetCalculator and gridSpacingCalculator.
 * No duplicate financial formulas. No trading logic. No DB access. Pure functions.
 */

import { computeGrossTargetFromNet } from "./gridNetCalculator";
import {
  calculateMinSpacingPctReal,
  calculateSpacingPct,
  countViableLevelsIterative,
} from "./gridSpacingCalculator";
import { FEE_BUFFER_BUY_PCT, FEE_BUFFER_SELL_PCT, TAX_RESERVE_PCT } from "./gridIsolatedTypes";
import type {
  ConfigurationRecommendation,
  RecommendationAlternative,
} from "@shared/gridRecommendationHelper";

export interface RecommendationServiceInput {
  mode: string;
  pair: string;
  config: any;
  marketContext: any;
  resolvedRange: any;
  adaptiveDecision: any;
  professionalGenerator: any;
  levels: any[];
  status: any;
  lastProfessionalValidationAt?: Date | string | null;
}

const SPREAD_BUFFER_PCT = 0.01;
const SAFETY_BUFFER_PCT = 0.10;
const RECOMMENDATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  try {
    const d = new Date(v as string | number | Date);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

function buildFingerprint(input: RecommendationServiceInput): string {
  const parts = [
    input.pair,
    toNum(input.config?.netProfitTargetPct)?.toFixed(4) ?? "null",
    toNum(input.config?.buyFeePct)?.toFixed(4) ?? "null",
    toNum(input.config?.sellFeePct)?.toFixed(4) ?? "null",
    toNum(input.config?.gridRangeMaxPct)?.toFixed(4) ?? "null",
    input.config?.enforceCompactRange ?? "null",
    toNum(input.config?.buyLevels)?.toString() ?? "null",
    toNum(input.config?.sellLevels)?.toString() ?? "null",
    toNum(input.marketContext?.currentPrice)?.toFixed(2) ?? "null",
    toNum(input.marketContext?.band?.lower)?.toFixed(2) ?? "null",
    toNum(input.marketContext?.band?.upper)?.toFixed(2) ?? "null",
    toNum(input.marketContext?.band?.widthPct)?.toFixed(4) ?? "null",
    toNum(input.marketContext?.atrPct)?.toFixed(4) ?? "null",
    input.resolvedRange?.activeRangeVersionId ?? "null",
  ];
  return parts.join("|");
}

function getConfigFees(config: any) {
  return {
    buyFeePct: toNum(config?.buyFeePct) ?? FEE_BUFFER_BUY_PCT,
    sellFeePct: toNum(config?.sellFeePct) ?? FEE_BUFFER_SELL_PCT,
    taxReservePct: toNum(config?.taxReservePct) ?? TAX_RESERVE_PCT,
  };
}

function computeSpacingAndLevels(
  netProfitTargetPct: number,
  buyFeePct: number,
  sellFeePct: number,
  taxReservePct: number,
  centerPrice: number,
  operationalLower: number,
  operationalUpper: number,
  configuredBuyLevels: number,
  configuredSellLevels: number,
  atrPct: number,
  gridStepAtrMultiplier: number,
  gridStepMaxPct: number,
) {
  const minSpacingResult = calculateMinSpacingPctReal({
    netProfitTargetPct,
    spreadBufferPct: SPREAD_BUFFER_PCT,
    safetyBufferPct: SAFETY_BUFFER_PCT,
    buyFeePct,
    sellFeePct,
    taxReservePct,
  });

  const spacingResult = calculateSpacingPct({
    atrPct,
    gridStepAtrMultiplier,
    minSpacingPctReal: minSpacingResult.minSpacingPctReal,
    gridStepMaxPct,
  });

  const viableResult = countViableLevelsIterative({
    centerPrice,
    operationalLower,
    operationalUpper,
    spacingPct: spacingResult.spacingPct,
    configuredBuyLevels,
    configuredSellLevels,
  });

  return {
    grossTargetPct: minSpacingResult.grossTargetPct,
    minSpacingPctReal: minSpacingResult.minSpacingPctReal,
    spacingPct: spacingResult.spacingPct,
    buyLevels: viableResult.maxBuyLevels,
    sellLevels: viableResult.maxSellLevels,
    totalLevels: viableResult.totalViableLevels,
  };
}

function computeOperationalBounds(
  centerPrice: number,
  totalWidthPct: number,
): { lower: number; upper: number } {
  const semiRangePct = totalWidthPct / 2;
  return {
    lower: centerPrice * (1 - semiRangePct / 100),
    upper: centerPrice * (1 + semiRangePct / 100),
  };
}

function getEffectiveRangePct(
  bandWidthPct: number,
  gridRangeMaxPct: number,
  enforceCompactRange: boolean,
): number {
  if (enforceCompactRange) {
    return Math.min(bandWidthPct, gridRangeMaxPct);
  }
  return bandWidthPct;
}

function getRegimeMaxPct(adaptiveDecision: any, config: any): number {
  return toNum(adaptiveDecision?.regimeMaxPct) ??
    toNum(config?.adaptiveRangeMaxPct) ??
    toNum(config?.adaptiveRangeNormalMaxPct) ??
    5.0;
}

function getGridStepParams(config: any): { atrMultiplier: number; maxPct: number } {
  return {
    atrMultiplier: toNum(config?.gridStepAtrMultiplier) ?? 1.5,
    maxPct: toNum(config?.gridStepMaxPct) ?? 3.0,
  };
}

function isConfigOptimal(input: RecommendationServiceInput): boolean {
  const actualLevels = input.levels
    ? input.levels.filter((l: any) =>
        l?.rangeVersionId === (input.resolvedRange?.activeRangeVersionId ?? input.status?.activeRangeVersionId) &&
        l?.status !== "cancelled" && l?.status !== "replaced"
      ).length
    : 0;
  const requestedBuy = toNum(input.config?.buyLevels) ?? 0;
  const requestedSell = toNum(input.config?.sellLevels) ?? 0;
  return actualLevels >= requestedBuy + requestedSell && (requestedBuy + requestedSell) > 0;
}

export function buildConfigurationRecommendation(input: RecommendationServiceInput): ConfigurationRecommendation | null {
  if (input.mode !== "SHADOW") return null;
  if (isConfigOptimal(input)) return null;

  const config = input.config;
  const marketContext = input.marketContext;
  const adaptiveDecision = input.adaptiveDecision;
  const resolvedRange = input.resolvedRange;

  const netProfitTargetPct = toNum(config?.netProfitTargetPct) ?? 0.8;
  const { buyFeePct, sellFeePct, taxReservePct } = getConfigFees(config);
  const gridRangeMaxPct = toNum(config?.gridRangeMaxPct) ?? 2.5;
  const enforceCompactRange = config?.enforceCompactRange ?? true;
  const configuredBuyLevels = toNum(config?.buyLevels) ?? 4;
  const configuredSellLevels = toNum(config?.sellLevels) ?? 4;

  const centerPrice = toNum(marketContext?.currentPrice) ??
    toNum(marketContext?.band?.center) ??
    toNum(resolvedRange?.centerPrice) ?? 0;
  if (centerPrice <= 0) return null;

  const bandWidthPct = toNum(marketContext?.band?.widthPct) ?? 0;
  if (bandWidthPct <= 0) return null;

  const atrPct = toNum(marketContext?.atrPct) ?? 0.5;
  const { atrMultiplier, maxPct } = getGridStepParams(config);
  const regimeMaxPct = getRegimeMaxPct(adaptiveDecision, config);

  const effectiveRangePct = getEffectiveRangePct(bandWidthPct, gridRangeMaxPct, enforceCompactRange);
  const currentBounds = computeOperationalBounds(centerPrice, effectiveRangePct);

  const currentCalc = computeSpacingAndLevels(
    netProfitTargetPct, buyFeePct, sellFeePct, taxReservePct,
    centerPrice, currentBounds.lower, currentBounds.upper,
    configuredBuyLevels, configuredSellLevels,
    atrPct, atrMultiplier, maxPct,
  );

  const expectedBefore = {
    levels: currentCalc.totalLevels,
    spacingPct: currentCalc.spacingPct,
    rangePct: effectiveRangePct,
    netProfitPct: netProfitTargetPct,
  };

  const warnings: string[] = [];
  warnings.push("El rango vigente no se modificará. La configuración propuesta se utilizará en futuros análisis y rangos.");

  if (!resolvedRange?.configSnapshot) {
    warnings.push("Configuración original del rango no disponible.");
  }

  const alternatives: RecommendationAlternative[] = [];

  // ─── Alternative A: Maintain profit, accept/reduce levels ───
  {
    const aCalc = computeSpacingAndLevels(
      netProfitTargetPct, buyFeePct, sellFeePct, taxReservePct,
      centerPrice, currentBounds.lower, currentBounds.upper,
      currentCalc.buyLevels, currentCalc.sellLevels,
      atrPct, atrMultiplier, maxPct,
    );
    const changedFields: string[] = [];
    if (currentCalc.buyLevels !== configuredBuyLevels) changedFields.push("buyLevels");
    if (currentCalc.sellLevels !== configuredSellLevels) changedFields.push("sellLevels");

    alternatives.push({
      id: "A",
      title: `Mantener beneficio (${netProfitTargetPct.toFixed(2)}%) y ajustar niveles`,
      explanation: `Mantiene el objetivo neto y el rango seguro. Ajusta buyLevels/sellLevels al número realmente viable (${aCalc.buyLevels} BUY + ${aCalc.sellLevels} SELL). Máxima prioridad de seguridad: no amplía riesgo.`,
      proposedConfig: {
        ...(currentCalc.buyLevels !== configuredBuyLevels && { buyLevels: currentCalc.buyLevels }),
        ...(currentCalc.sellLevels !== configuredSellLevels && { sellLevels: currentCalc.sellLevels }),
      },
      changedFields,
      expectedBefore,
      expectedAfter: {
        levels: aCalc.totalLevels,
        spacingPct: aCalc.spacingPct,
        rangePct: effectiveRangePct,
        netProfitPct: netProfitTargetPct,
      },
      warnings: [],
      safeToApply: true,
      blockingReason: null,
    });
  }

  // ─── Alternative B: Maintain range, reduce target ───
  {
    let newNetProfit = netProfitTargetPct;
    let bCalc = currentCalc;
    let attempts = 0;
    const minNetProfit = 0.3;

    while (bCalc.totalLevels < configuredBuyLevels + configuredSellLevels && newNetProfit > minNetProfit && attempts < 20) {
      newNetProfit = Math.max(minNetProfit, newNetProfit - 0.05);
      bCalc = computeSpacingAndLevels(
        newNetProfit, buyFeePct, sellFeePct, taxReservePct,
        centerPrice, currentBounds.lower, currentBounds.upper,
        configuredBuyLevels, configuredSellLevels,
        atrPct, atrMultiplier, maxPct,
      );
      attempts++;
    }

    const bChangedFields = ["netProfitTargetPct"];
    const bSafeToApply = newNetProfit >= minNetProfit;
    const bBlockingReason = !bSafeToApply ? `Objetivo neto resultante (${newNetProfit.toFixed(2)}%) por debajo del mínimo (${minNetProfit}%)` : null;

    alternatives.push({
      id: "B",
      title: `Mantener rango y reducir objetivo a ${newNetProfit.toFixed(2)}%`,
      explanation: `Mantiene los límites seguros. Reduce netProfitTargetPct solo lo necesario para que quepan más niveles. Recalcula gross target, spacing y niveles usando funciones canónicas. El beneficio neto siempre es positivo.`,
      proposedConfig: { netProfitTargetPct: newNetProfit },
      changedFields: bChangedFields,
      expectedBefore,
      expectedAfter: {
        levels: bCalc.totalLevels,
        spacingPct: bCalc.spacingPct,
        rangePct: effectiveRangePct,
        netProfitPct: newNetProfit,
      },
      warnings: bSafeToApply ? [] : [`Objetivo neto reducido al mínimo de ${minNetProfit}%`],
      safeToApply: bSafeToApply,
      blockingReason: bBlockingReason,
    });
  }

  // ─── Alternative C: Expand range (up to regimeMaxPct) ───
  {
    const newRangeMax = Math.min(regimeMaxPct, bandWidthPct);
    const cEffectiveRange = enforceCompactRange
      ? Math.min(bandWidthPct, newRangeMax)
      : bandWidthPct;
    const cBounds = computeOperationalBounds(centerPrice, cEffectiveRange);

    const cCalc = computeSpacingAndLevels(
      netProfitTargetPct, buyFeePct, sellFeePct, taxReservePct,
      centerPrice, cBounds.lower, cBounds.upper,
      configuredBuyLevels, configuredSellLevels,
      atrPct, atrMultiplier, maxPct,
    );

    const cNeededWidth = netProfitTargetPct > 0
      ? calculateMinSpacingPctReal({
          netProfitTargetPct,
          spreadBufferPct: SPREAD_BUFFER_PCT,
          safetyBufferPct: SAFETY_BUFFER_PCT,
          buyFeePct, sellFeePct, taxReservePct,
        }).minSpacingPctReal * Math.max(configuredBuyLevels, configuredSellLevels) * 2
      : 0;

    const cExceedsRegime = cNeededWidth > regimeMaxPct;
    const cChangedFields = ["gridRangeMaxPct"];
    const cBlockingReason = cExceedsRegime
      ? `Anchura necesaria (~${cNeededWidth.toFixed(2)}%) supera regimeMaxPct (${regimeMaxPct.toFixed(2)}%)`
      : null;

    alternatives.push({
      id: "C",
      title: `Ampliar rango a ${newRangeMax.toFixed(2)}% (límite régimen: ${regimeMaxPct.toFixed(2)}%)`,
      explanation: `Mantiene el objetivo neto. Amplia el rango solo hasta regimeMaxPct. Mantiene enforceCompactRange si sigue siendo la política vigente. ${cExceedsRegime ? "BLOQUEADO: la anchura necesaria supera el límite del régimen." : ""}`,
      proposedConfig: { gridRangeMaxPct: newRangeMax },
      changedFields: cChangedFields,
      expectedBefore,
      expectedAfter: {
        levels: cCalc.totalLevels,
        spacingPct: cCalc.spacingPct,
        rangePct: cEffectiveRange,
        netProfitPct: netProfitTargetPct,
      },
      warnings: cExceedsRegime ? [`Anchura necesaria (~${cNeededWidth.toFixed(2)}%) supera regimeMaxPct (${regimeMaxPct.toFixed(2)}%)`] : [],
      safeToApply: !cExceedsRegime,
      blockingReason: cBlockingReason,
    });
  }

  // ─── Select recommended alternative by priority ───
  // 1. No increase risk  2. Maintain profit  3. Maintain levels  4. Minimize changed fields
  const safeAlts = alternatives.filter(a => a.safeToApply);
  let recommendedId: "A" | "B" | "C" = "A";

  if (safeAlts.length > 0) {
    const a = alternatives.find(a => a.id === "A")!;
    const b = alternatives.find(a => a.id === "B")!;
    const c = alternatives.find(a => a.id === "C")!;

    // Prefer A if it doesn't increase risk (always true by design)
    if (a.safeToApply) {
      recommendedId = "A";
    } else if (b.safeToApply) {
      recommendedId = "B";
    } else if (c.safeToApply) {
      recommendedId = "C";
    }
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + RECOMMENDATION_TTL_MS);
  const fingerprint = buildFingerprint(input);

  return {
    id: `rec-${now.getTime()}-${input.pair}`,
    generatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    snapshotFingerprint: fingerprint,
    fresh: true,
    confidence: 0.85,
    title: "Recomendación de configuración",
    explanation: `El diagnóstico actual indica ${currentCalc.totalLevels} niveles viables de ${configuredBuyLevels + configuredSellLevels} solicitados. Revisa las alternativas para futuros análisis.`,
    currentConfig: {
      netProfitTargetPct,
      buyFeePct,
      sellFeePct,
      taxReservePct,
      gridRangeMaxPct,
      enforceCompactRange,
      buyLevels: configuredBuyLevels,
      sellLevels: configuredSellLevels,
    },
    alternatives,
    recommendedAlternativeId: recommendedId,
    warnings,
    safeToApply: true,
    blockingReason: null,
  };
}

export const RECOMMENDATION_APPLY_ALLOWLIST = [
  "buyLevels",
  "sellLevels",
  "netProfitTargetPct",
  "gridRangeMaxPct",
  "enforceCompactRange",
] as const;

export const RECOMMENDATION_APPLY_BLOCKLIST = [
  "mode",
  "isActive",
  "executionPolicy",
  "takerFallback",
  "takerFallbackEnabled",
  "gridWalletMaxUsd",
  "gridWalletInitialUsd",
  "gridWalletMode",
  "gridMaxCapitalPerCycleUsd",
  "pair",
] as const;

export function validateApplyPayload(
  payload: any,
  recommendation: ConfigurationRecommendation,
  currentMode: string,
): { valid: boolean; reason: string | null } {
  if (currentMode !== "SHADOW") {
    return { valid: false, reason: "Solo se puede aplicar en modo SHADOW" };
  }

  if (!payload || payload.confirmed !== true) {
    return { valid: false, reason: "Se requiere confirmación explícita" };
  }

  if (payload.recommendationId !== recommendation.id) {
    return { valid: false, reason: "recommendationId no coincide" };
  }

  const now = new Date();
  const expiresAt = new Date(recommendation.expiresAt);
  if (now > expiresAt) {
    return { valid: false, reason: "La recomendación ha caducado" };
  }

  if (payload.snapshotFingerprint !== recommendation.snapshotFingerprint) {
    return { valid: false, reason: "Fingerprint no coincide — la configuración o el mercado han cambiado" };
  }

  const alt = recommendation.alternatives.find(a => a.id === payload.alternativeId);
  if (!alt) {
    return { valid: false, reason: "alternativeId no encontrado en la recomendación" };
  }

  if (!alt.safeToApply) {
    return { valid: false, reason: alt.blockingReason ?? "La alternativa no es safeToApply" };
  }

  // Check for blocklisted fields in proposedConfig
  for (const blocked of RECOMMENDATION_APPLY_BLOCKLIST) {
    if (blocked in alt.proposedConfig) {
      return { valid: false, reason: `Campo bloqueado detectado en proposedConfig: ${blocked}` };
    }
  }

  // Verify all proposed fields are in allowlist
  for (const key of Object.keys(alt.proposedConfig)) {
    if (!RECOMMENDATION_APPLY_ALLOWLIST.includes(key as any)) {
      return { valid: false, reason: `Campo fuera de allowlist: ${key}` };
    }
  }

  return { valid: true, reason: null };
}
