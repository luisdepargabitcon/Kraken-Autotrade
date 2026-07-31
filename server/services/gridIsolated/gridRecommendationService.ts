/**
 * gridRecommendationService.ts
 *
 * Server-side recommendation engine for Grid Isolated configuration.
 * Uses EXCLUSIVELY canonical functions from gridNetCalculator and gridSpacingCalculator.
 * No duplicate financial formulas. No trading logic. No DB access. Pure functions.
 *
 * Changes in Rev-C11 Phase 4E Correction 2:
 *  - Separated configFingerprint and marketFingerprint
 *  - referencePrice stored separately for drift validation
 *  - crypto.randomUUID() for recommendation IDs
 *  - Alternative A: blocked when no changedFields (no-op)
 *  - Alternative B: requires actual improvement in total levels
 *  - Alternative C: iterative search instead of linear formula
 *  - Data insufficiency blocks recommendation generation
 *  - recommendationMaxPriceDriftPct = 0.25% for price drift validation
 */

import crypto from "crypto";
import { computeGrossTargetFromNet } from "./gridNetCalculator";
import {
  calculateEntrySpacingPct,
  calculateMinSpacingPctReal,
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
export const RECOMMENDATION_MAX_PRICE_DRIFT_PCT = 0.25; // 0.25%
const ABSOLUTE_GRID_RANGE_MAX_PCT = 20.0;
const ABSOLUTE_NET_PROFIT_MAX_PCT = 20.0;
const MAX_LEVELS_PER_SIDE = 50;
const MIN_LEVELS_FOR_VIABLE_GRID = 4;

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

/**
 * Build a fingerprint from configuration fields only.
 * Does NOT include market price, band data or activeRangeVersionId.
 */
export function buildConfigFingerprint(input: RecommendationServiceInput): string {
  const cfg = input.config ?? {};
  const parts = [
    input.pair,
    input.mode,
    toNum(cfg.netProfitTargetPct)?.toFixed(4) ?? "null",
    toNum(cfg.buyFeePct)?.toFixed(4) ?? "null",
    toNum(cfg.sellFeePct)?.toFixed(4) ?? "null",
    toNum(cfg.taxReservePct)?.toFixed(4) ?? "null",
    toNum(cfg.gridRangeMaxPct)?.toFixed(4) ?? "null",
    cfg.enforceCompactRange ?? "null",
    toNum(cfg.gridStepAtrMultiplier)?.toFixed(4) ?? "null",
    toNum(cfg.gridStepMinPct)?.toFixed(4) ?? "null",
    toNum(cfg.gridStepMaxPct)?.toFixed(4) ?? "null",
    toNum(cfg.bandPeriod)?.toString() ?? "null",
    toNum(cfg.bandStdDevMultiplier)?.toFixed(4) ?? "null",
    toNum(cfg.atrPeriod)?.toString() ?? "null",
    cfg.atrTimeframe ?? "null",
    cfg.adaptiveRangeProfile ?? "null",
    toNum(cfg.adaptiveRangeNormalMaxPct)?.toFixed(4) ?? "null",
    toNum(cfg.adaptiveRangeMaxPct)?.toFixed(4) ?? "null",
  ];
  return parts.join("|");
}

export function buildActiveRangeFingerprint(activeRangeVersionId: string | null | undefined): string {
  return activeRangeVersionId ?? "null";
}

/**
 * Build a fingerprint from market band data only.
 * Does NOT include config fields or exact price.
 * NOTE: this is a legacy deterministic fingerprint. Prefer compareRecommendationMarketContext
 * for validation with explicit tolerances.
 */
export function buildMarketFingerprint(input: RecommendationServiceInput): string {
  const band = input.marketContext?.band ?? {};
  const parts = [
    toNum(band.lower)?.toFixed(2) ?? "null",
    toNum(band.center)?.toFixed(2) ?? "null",
    toNum(band.upper)?.toFixed(2) ?? "null",
    toNum(band.widthPct)?.toFixed(4) ?? "null",
    toNum(input.marketContext?.atrPct ?? band.atrPct)?.toFixed(4) ?? "null",
    band.source ?? input.marketContext?.bandSource ?? "null",
    input.marketContext?.regime ?? "null",
  ];
  return parts.join("|");
}

export interface MarketContextComparison {
  valid: boolean;
  missingFields: string[];
  changedFields: string[];
  comparisons: Record<string, { stored: any; current: any; diff: number | null; passed: boolean }>;
}

export function compareRecommendationMarketContext(stored: any, current: any): MarketContextComparison {
  const comparisons: MarketContextComparison["comparisons"] = {};
  const changedFields: string[] = [];
  const missingFields: string[] = [];

  function isMissing(a: unknown, b: unknown) {
    return a == null || b == null;
  }

  function cmp(
    key: string,
    a: unknown,
    b: unknown,
    test: (a: any, b: any) => boolean,
    diff: (a: any, b: any) => number | null,
    required = true,
  ) {
    const missing = isMissing(a, b);
    const passed = missing ? !required : test(a, b);
    comparisons[key] = { stored: a, current: b, diff: diff(a, b), passed };
    if (missing) {
      if (required) missingFields.push(key);
    } else if (!passed) {
      changedFields.push(key);
    }
  }

  const exactKeys = ["regime", "bandSource", "bandPeriod", "bandStdDevMultiplier", "atrPeriod", "atrTimeframe"];
  for (const key of exactKeys) {
    cmp(
      key,
      stored?.[key],
      current?.[key],
      (a, b) => a === b,
      () => null,
      true,
    );
  }

  const priceDiff = (a: any, b: any) => {
    if (a == null || b == null || a === 0) return null;
    return Math.abs((b - a) / a) * 100;
  };
  cmp(
    "referencePrice",
    stored?.referencePrice,
    current?.currentPrice,
    (a, b) => (priceDiff(a, b) ?? Infinity) <= RECOMMENDATION_MAX_PRICE_DRIFT_PCT,
    priceDiff,
    true,
  );

  const bandBoundsDiff = (a: any, b: any) => {
    if (a == null || b == null || a === 0) return null;
    return Math.abs((b - a) / a) * 100;
  };
  for (const key of ["bandLower", "bandCenter", "bandUpper"]) {
    cmp(
      key,
      stored?.[key],
      current?.band?.[key.replace("band", "").toLowerCase()] ?? current?.[key],
      (a, b) => (bandBoundsDiff(a, b) ?? Infinity) <= 0.05,
      bandBoundsDiff,
      true,
    );
  }

  const pctPointDiff = (a: any, b: any) => (a == null || b == null ? null : Math.abs(b - a));
  cmp(
    "bandWidthPct",
    stored?.bandWidthPct,
    current?.band?.widthPct,
    (a, b) => (pctPointDiff(a, b) ?? Infinity) <= 0.02,
    pctPointDiff,
    true,
  );

  cmp(
    "atrPct",
    stored?.atrPct,
    current?.atrPct ?? current?.band?.atrPct,
    (a, b) => (pctPointDiff(a, b) ?? Infinity) <= 0.02,
    pctPointDiff,
    true,
  );

  const valid = changedFields.length === 0 && missingFields.length === 0;
  return { valid, missingFields, changedFields, comparisons };
}

/**
 * Check if all required market data is available for a safe recommendation.
 */
function checkDataSufficiency(input: RecommendationServiceInput): { sufficient: boolean; reason: string | null } {
  const config = input.config;
  const marketContext = input.marketContext;

  const currentPrice = toNum(marketContext?.currentPrice);
  if (currentPrice == null || currentPrice <= 0) {
    return { sufficient: false, reason: "Falta precio válido" };
  }

  const band = marketContext?.band ?? {};
  if (band.available === false) {
    return { sufficient: false, reason: "Banda de mercado no disponible" };
  }
  if (band.internallyConsistent === false) {
    return { sufficient: false, reason: "Banda de mercado inconsistente" };
  }

  const bandLower = toNum(band.lower);
  const bandUpper = toNum(band.upper);
  const bandCenter = toNum(band.center);
  const bandWidthPct = toNum(band.widthPct);

  if (bandLower == null || bandUpper == null || bandCenter == null) {
    return { sufficient: false, reason: "Falta banda de mercado actual coherente" };
  }

  if (bandWidthPct == null || bandWidthPct <= 0) {
    return { sufficient: false, reason: "Falta anchura de banda válida" };
  }

  const atrPct = toNum(marketContext?.atrPct ?? band.atrPct);
  if (atrPct == null || atrPct <= 0) {
    return { sufficient: false, reason: "Falta ATR% válido" };
  }

  const regime = marketContext?.regime ?? input.adaptiveDecision?.regimeLabel ?? null;
  if (!regime) {
    return { sufficient: false, reason: "Falta régimen de mercado" };
  }

  const netProfitTargetPct = toNum(config?.netProfitTargetPct);
  if (netProfitTargetPct == null || netProfitTargetPct <= 0) {
    return { sufficient: false, reason: "Falta configuración de objetivo neto" };
  }

  const gridRangeMaxPct = toNum(config?.gridRangeMaxPct);
  if (gridRangeMaxPct == null || gridRangeMaxPct <= 0) {
    return { sufficient: false, reason: "Falta límite de rango configurado" };
  }

  return { sufficient: true, reason: null };
}

export function calculatePriceDriftPct(currentPrice: number, referencePrice: number): number {
  if (referencePrice == null || referencePrice === 0) return Infinity;
  return Math.abs((currentPrice - referencePrice) / referencePrice) * 100;
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
  gridStepMinPct: number,
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

  const spacingResult = calculateEntrySpacingPct({
    atrPct,
    gridStepAtrMultiplier,
    gridStepMinPct,
    gridStepMaxPct,
  });

  const viableResult = countViableLevelsIterative({
    centerPrice,
    operationalLower,
    operationalUpper,
    spacingPct: spacingResult.entrySpacingPct ?? gridStepMinPct,
    configuredBuyLevels,
    configuredSellLevels,
  });

  return {
    grossTargetPct: minSpacingResult.grossTargetPct,
    minSpacingPctReal: minSpacingResult.minSpacingPctReal,
    spacingPct: spacingResult.entrySpacingPct ?? gridStepMinPct,
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

export function getRegimeMaxPct(adaptiveDecision: any, config: any): number {
  return toNum(adaptiveDecision?.regimeMaxPct) ??
    toNum(config?.adaptiveRangeMaxPct) ??
    toNum(config?.adaptiveRangeNormalMaxPct) ??
    5.0;
}

export function resolveCurrentRegimeMaxPctStrict(
  currentRegime: string | null | undefined,
  config: any,
  adaptiveDecision: any,
): number | null {
  const regime = typeof currentRegime === "string" ? currentRegime.trim().toUpperCase() : null;
  if (!regime) return null;

  let specificMax: number | null = null;
  const cfg = config ?? {};

  if (regime === "LOW" || regime === "LOW_VOLATILITY") {
    specificMax = toNum(cfg.adaptiveRangeLowVolMaxPct);
  } else if (regime === "NORMAL" || regime === "RANGE" || regime === "RANGING" || regime === "LATERAL") {
    specificMax = toNum(cfg.adaptiveRangeNormalMaxPct);
  } else if (regime === "HIGH" || regime === "HIGH_VOLATILITY" || regime === "VOLATILE") {
    specificMax = toNum(cfg.adaptiveRangeHighVolMaxPct);
  }

  if (specificMax == null) return null;

  const hardMax = toNum(cfg.adaptiveRangeMaxPct);
  const absoluteMax = ABSOLUTE_GRID_RANGE_MAX_PCT;

  const candidates = [specificMax];
  if (hardMax != null) candidates.push(hardMax);
  candidates.push(absoluteMax);

  return Math.min(...candidates);
}

function getGridStepParams(config: any): { atrMultiplier: number; maxPct: number } {
  return {
    atrMultiplier: toNum(config?.gridStepAtrMultiplier) ?? 1.5,
    maxPct: toNum(config?.gridStepMaxPct) ?? 3.0,
  };
}

function resolveRequestedLevels(input: RecommendationServiceInput): { buyLevels: number; sellLevels: number } | null {
  const pg = input.professionalGenerator;
  if (pg?.requestedBuyLevels != null && pg?.requestedSellLevels != null) {
    return { buyLevels: Math.max(1, Math.floor(toNum(pg.requestedBuyLevels) ?? 1)), sellLevels: Math.max(1, Math.floor(toNum(pg.requestedSellLevels) ?? 1)) };
  }
  const rr = input.resolvedRange;
  if (rr?.requestedBuyLevels != null && rr?.requestedSellLevels != null) {
    return { buyLevels: Math.max(1, Math.floor(toNum(rr.requestedBuyLevels) ?? 1)), sellLevels: Math.max(1, Math.floor(toNum(rr.requestedSellLevels) ?? 1)) };
  }
  const st = input.status;
  if (st?.requestedBuyLevels != null && st?.requestedSellLevels != null) {
    return { buyLevels: Math.max(1, Math.floor(toNum(st.requestedBuyLevels) ?? 1)), sellLevels: Math.max(1, Math.floor(toNum(st.requestedSellLevels) ?? 1)) };
  }
  // No canonical source for requested levels — cannot generate recommendations
  return null;
}

function buildCurrentConfigSummary(config: any): Record<string, any> {
  if (!config) return {};
  return {
    netProfitTargetPct: config.netProfitTargetPct,
    buyFeePct: config.buyFeePct,
    sellFeePct: config.sellFeePct,
    taxReservePct: config.taxReservePct,
    gridRangeMaxPct: config.gridRangeMaxPct,
    enforceCompactRange: config.enforceCompactRange,
    gridStepAtrMultiplier: config.gridStepAtrMultiplier,
    gridStepMinPct: config.gridStepMinPct,
    gridStepMaxPct: config.gridStepMaxPct,
  };
}

function buildRecommendationContext(input: RecommendationServiceInput, regimeMaxPct: number): any {
  const band = input.marketContext?.band ?? {};
  const adaptiveDecision = input.adaptiveDecision;
  return {
    pair: input.pair,
    mode: input.mode,
    activeRangeVersionId: input.resolvedRange?.activeRangeVersionId ?? input.status?.activeRangeVersionId ?? null,
    regime: input.marketContext?.regime ?? adaptiveDecision?.regimeLabel ?? null,
    regimeMaxPct,
    bandPeriod: toNum(band.period ?? input.config?.bandPeriod),
    bandStdDevMultiplier: toNum(band.stdDevMultiplier ?? input.config?.bandStdDevMultiplier),
    atrPeriod: toNum(input.config?.atrPeriod),
    atrTimeframe: input.config?.atrTimeframe ?? null,
    bandSource: band.source ?? input.marketContext?.bandSource ?? null,
    bandLower: toNum(band.lower),
    bandCenter: toNum(band.center),
    bandUpper: toNum(band.upper),
    bandWidthPct: toNum(band.widthPct),
    atrPct: toNum(input.marketContext?.atrPct ?? band.atrPct),
    referencePrice: toNum(input.marketContext?.currentPrice),
  };
}

function isConfigOptimal(input: RecommendationServiceInput): boolean {
  const actualLevels = input.levels
    ? input.levels.filter((l: any) =>
        l?.rangeVersionId === (input.resolvedRange?.activeRangeVersionId ?? input.status?.activeRangeVersionId) &&
        l?.status !== "cancelled" && l?.status !== "replaced"
      ).length
    : 0;
  const resolved = resolveRequestedLevels(input);
  if (!resolved) return false;
  return actualLevels >= resolved.buyLevels + resolved.sellLevels && (resolved.buyLevels + resolved.sellLevels) > 0;
}

export function buildConfigurationRecommendation(input: RecommendationServiceInput): ConfigurationRecommendation | null {
  if (input.mode !== "SHADOW") return null;

  // Check data sufficiency first — block if anything is missing
  const sufficiency = checkDataSufficiency(input);
  if (!sufficiency.sufficient) {
    const activeRangeVersionId = input.resolvedRange?.activeRangeVersionId ?? input.status?.activeRangeVersionId ?? null;
    const band = input.marketContext?.band ?? {};
    return {
      id: `rec-blocked-${crypto.randomUUID()}-${input.pair}`,
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS).toISOString(),
      snapshotFingerprint: "blocked",
      configFingerprint: "blocked",
      marketFingerprint: "blocked",
      activeRangeFingerprint: buildActiveRangeFingerprint(activeRangeVersionId),
      context: {
        pair: input.pair,
        mode: input.mode,
        activeRangeVersionId,
        regime: input.marketContext?.regime ?? input.adaptiveDecision?.regimeLabel ?? null,
        regimeMaxPct: getRegimeMaxPct(input.adaptiveDecision, input.config),
        bandPeriod: toNum(band.period ?? input.config?.bandPeriod),
        bandStdDevMultiplier: toNum(band.stdDevMultiplier ?? input.config?.bandStdDevMultiplier),
        atrPeriod: toNum(input.config?.atrPeriod),
        atrTimeframe: input.config?.atrTimeframe ?? null,
        bandSource: band.source ?? input.marketContext?.bandSource ?? null,
        bandLower: toNum(band.lower),
        bandCenter: toNum(band.center),
        bandUpper: toNum(band.upper),
        bandWidthPct: toNum(band.widthPct),
        atrPct: toNum(input.marketContext?.atrPct ?? band.atrPct),
        referencePrice: toNum(input.marketContext?.currentPrice),
      },
      referencePrice: toNum(input.marketContext?.currentPrice),
      fresh: false,
      confidence: 0,
      title: "Datos insuficientes",
      explanation: sufficiency.reason ?? "Faltan datos de mercado suficientes para generar una configuración segura.",
      currentConfig: {},
      alternatives: [],
      recommendedAlternativeId: "A",
      warnings: [sufficiency.reason ?? "Faltan datos de mercado suficientes para generar una configuración segura."],
      safeToApply: false,
      blockingReason: "Faltan datos de mercado suficientes para generar una configuración segura.",
    };
  }

  if (isConfigOptimal(input)) return null;

  const config = input.config;
  const marketContext = input.marketContext;
  const adaptiveDecision = input.adaptiveDecision;
  const resolvedRange = input.resolvedRange;

  const netProfitTargetPct = toNum(config?.netProfitTargetPct) ?? 0.8;
  const { buyFeePct, sellFeePct, taxReservePct } = getConfigFees(config);
  const gridRangeMaxPct = toNum(config?.gridRangeMaxPct) ?? 2.5;
  const enforceCompactRange = config?.enforceCompactRange ?? true;

  // Resolve requested levels from canonical sources; do not use config.buyLevels / config.sellLevels
  const resolvedRequested = resolveRequestedLevels(input);
  if (resolvedRequested == null) {
    return {
      id: `rec-insufficient-${crypto.randomUUID()}-${input.pair}`,
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS).toISOString(),
      snapshotFingerprint: "insufficient",
      configFingerprint: "insufficient",
      marketFingerprint: "insufficient",
      activeRangeFingerprint: buildActiveRangeFingerprint(input.resolvedRange?.activeRangeVersionId ?? input.status?.activeRangeVersionId ?? null),
      context: buildRecommendationContext(input, getRegimeMaxPct(input.adaptiveDecision, config)),
      referencePrice: toNum(marketContext?.currentPrice) ?? null,
      fresh: false,
      confidence: 0,
      title: "Datos insuficientes",
      explanation: "No se puede resolver el número de niveles solicitados. Falta professionalGenerator, resolvedRange o proyección canónica.",
      currentConfig: buildCurrentConfigSummary(config),
      alternatives: [],
      recommendedAlternativeId: null,
      warnings: ["No se dispone del contexto de niveles canónico."],
      safeToApply: false,
      blockingReason: "Falta el contexto de niveles canónico del allocator o del generador profesional.",
    };
  }
  const configuredBuyLevels = resolvedRequested.buyLevels;
  const configuredSellLevels = resolvedRequested.sellLevels;

  const centerPrice = toNum(marketContext?.currentPrice) ??
    toNum(marketContext?.band?.center) ??
    toNum(resolvedRange?.centerPrice) ?? 0;
  if (centerPrice <= 0) return null;

  const bandWidthPct = toNum(marketContext?.band?.widthPct) ?? 0;
  if (bandWidthPct <= 0) return null;

  const atrPct = toNum(marketContext?.atrPct ?? marketContext?.band?.atrPct) ?? 0;
  if (atrPct <= 0) return null;
  const { atrMultiplier, maxPct } = getGridStepParams(config);
  const minPct = toNum(config?.gridStepMinPct) ?? 0.15;
  const regimeMaxPct = getRegimeMaxPct(adaptiveDecision, config);

  const effectiveRangePct = getEffectiveRangePct(bandWidthPct, gridRangeMaxPct, enforceCompactRange);
  const currentBounds = computeOperationalBounds(centerPrice, effectiveRangePct);

  const currentCalc = computeSpacingAndLevels(
    netProfitTargetPct, buyFeePct, sellFeePct, taxReservePct,
    centerPrice, currentBounds.lower, currentBounds.upper,
    configuredBuyLevels, configuredSellLevels,
    atrPct, atrMultiplier, minPct, maxPct,
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

  // ─── Alternative A: Informational only (allocator controls requested levels) ───
  {
    const aBlockingReason = `Diagnóstico: caben ${currentCalc.buyLevels} BUY + ${currentCalc.sellLevels} SELL (${currentCalc.totalLevels} total). El motor exige al menos ${MIN_LEVELS_FOR_VIABLE_GRID} niveles. El allocator es la única fuente del número solicitado de niveles. No existe ningún parámetro buyLevels/sellLevels aplicable. El Grid no creará un rango mientras el resultado sea compact.`;

    alternatives.push({
      id: "A",
      title: "Esperar condiciones compatibles con el Grid estricto",
      explanation: aBlockingReason,
      proposedConfig: {},
      changedFields: [],
      expectedBefore,
      expectedAfter: {
        levels: currentCalc.totalLevels,
        spacingPct: currentCalc.spacingPct ?? minPct,
        rangePct: effectiveRangePct,
        netProfitPct: netProfitTargetPct,
      },
      warnings: [],
      safeToApply: false,
      blockingReason: aBlockingReason,
    });
  }

  // ─── Alternative B: Maintain cycle target, adjust entry density ───
  {
    const newAtrMultiplier = Math.max(0.1, Math.min(atrMultiplier * 0.8, atrMultiplier - 0.05));
    const bCalc = computeSpacingAndLevels(
      netProfitTargetPct, buyFeePct, sellFeePct, taxReservePct,
      centerPrice, currentBounds.lower, currentBounds.upper,
      configuredBuyLevels, configuredSellLevels,
      atrPct, newAtrMultiplier, minPct, maxPct,
    );
    const hasRealChange = newAtrMultiplier !== atrMultiplier;
    const hasImprovement = bCalc.totalLevels > currentCalc.totalLevels;
    const isViable = bCalc.totalLevels >= MIN_LEVELS_FOR_VIABLE_GRID;
    const bSafeToApply = hasRealChange && hasImprovement && isViable;
    let bBlockingReason: string | null = null;
    if (!hasRealChange) {
      bBlockingReason = "La configuración ya coincide con esta alternativa.";
    } else if (!hasImprovement) {
      bBlockingReason = "Ajustar la densidad no mejora el número de entradas dentro del rango actual.";
    } else if (!isViable) {
      bBlockingReason = `La proyección da ${bCalc.totalLevels} niveles, menos del mínimo ${MIN_LEVELS_FOR_VIABLE_GRID} exigido.`;
    }
    alternatives.push({
      id: "B",
      title: `Ajustar densidad de entradas (ATR × ${newAtrMultiplier.toFixed(2)})`,
      explanation: "La densidad de entradas y el beneficio por ciclo son parámetros independientes. Mantiene el objetivo neto y ajusta solo la sensibilidad ATR de las entradas.",
      proposedConfig: { gridStepAtrMultiplier: newAtrMultiplier },
      changedFields: ["gridStepAtrMultiplier"],
      expectedBefore,
      expectedAfter: {
        levels: bCalc.totalLevels,
        spacingPct: bCalc.spacingPct ?? minPct,
        rangePct: effectiveRangePct,
        netProfitPct: netProfitTargetPct,
      },
      warnings: [],
      safeToApply: bSafeToApply,
      blockingReason: bBlockingReason,
    });
  }

  // ─── Alternative C: Expand range (iterative search) ───
  {
    // Find the minimum totalWidthPct that fits ALL requested buy and sell levels
    let bestWidth = effectiveRangePct;
    let bestCalc = currentCalc;
    const requestedTotal = configuredBuyLevels + configuredSellLevels;
    const step = 0.05; // 0.05% increments
    const absoluteMaxWidth = 20.0; // server absolute ceiling
    const maxWidth = Math.min(regimeMaxPct, bandWidthPct, absoluteMaxWidth);
    let foundFullFit = false;

    for (let testWidth = effectiveRangePct + step; testWidth <= maxWidth + 1e-9; testWidth += step) {
      const testBounds = computeOperationalBounds(centerPrice, testWidth);
      const testCalc = computeSpacingAndLevels(
        netProfitTargetPct, buyFeePct, sellFeePct, taxReservePct,
        centerPrice, testBounds.lower, testBounds.upper,
        configuredBuyLevels, configuredSellLevels,
        atrPct, atrMultiplier, minPct, maxPct,
      );
      if (testCalc.totalLevels > bestCalc.totalLevels) {
        bestWidth = testWidth;
        bestCalc = testCalc;
      }
      if (testCalc.buyLevels >= configuredBuyLevels && testCalc.sellLevels >= configuredSellLevels) {
        foundFullFit = true;
        break;
      }
    }

    const cWidthImproved = bestWidth > effectiveRangePct;
    const proposedGridRangeMaxPct = cWidthImproved ? Math.min(bestWidth, bandWidthPct) : gridRangeMaxPct;
    const cHasChanges = proposedGridRangeMaxPct !== gridRangeMaxPct;
    const cChangedFields = cHasChanges ? ["gridRangeMaxPct"] : [];
    const cExceedsRegime = bestWidth > regimeMaxPct;
    const cExceedsAbsolute = bestWidth > absoluteMaxWidth;
    const cCompactPreserved = enforceCompactRange;
    const cIsViable = bestCalc.totalLevels >= MIN_LEVELS_FOR_VIABLE_GRID;
    const cSafeToApply = foundFullFit && cIsViable && !cExceedsRegime && !cExceedsAbsolute && cWidthImproved && cHasChanges && cCompactPreserved;

    let cBlockingReason: string | null = null;
    if (!foundFullFit) {
      cBlockingReason = `No se puede ajustar el rango para albergar ${requestedTotal} niveles solicitados dentro del régimen actual.`;
    } else if (!cIsViable) {
      cBlockingReason = `La proyección ampliada da ${bestCalc.totalLevels} niveles, menos del mínimo ${MIN_LEVELS_FOR_VIABLE_GRID} exigido.`;
    } else if (cExceedsRegime) {
      cBlockingReason = `Anchura necesaria (${bestWidth.toFixed(2)}%) supera regimeMaxPct (${regimeMaxPct.toFixed(2)}%)`;
    } else if (cExceedsAbsolute) {
      cBlockingReason = `Anchura necesaria (${bestWidth.toFixed(2)}%) supera el máximo absoluto permitido (${absoluteMaxWidth.toFixed(2)}%)`;
    } else if (!cWidthImproved) {
      cBlockingReason = "No se puede ampliar el rango dentro de los límites del régimen actual.";
    } else if (!cHasChanges) {
      cBlockingReason = "La configuración ya coincide con esta alternativa.";
    }

    const cWarnings: string[] = [];
    if (cHasChanges && !foundFullFit) {
      cWarnings.push(`Mejora parcial: ${bestCalc.totalLevels} niveles de ${requestedTotal} solicitados.`);
    }

    alternatives.push({
      id: "C",
      title: cHasChanges
        ? `Ampliar rango a ${bestWidth.toFixed(2)}% (límite régimen: ${regimeMaxPct.toFixed(2)}%)`
        : `No caben ${requestedTotal} niveles ampliando el rango`,
      explanation: `Mantiene el objetivo neto. Amplía el rango mediante búsqueda iterativa hasta regimeMaxPct. Mantiene enforceCompactRange si sigue siendo la política vigente.`,
      proposedConfig: cHasChanges ? { gridRangeMaxPct: proposedGridRangeMaxPct } : {},
      changedFields: cChangedFields,
      expectedBefore,
      expectedAfter: {
        levels: bestCalc.totalLevels,
        spacingPct: bestCalc.spacingPct ?? minPct,
        rangePct: cHasChanges ? bestWidth : effectiveRangePct,
        netProfitPct: netProfitTargetPct,
      },
      warnings: cWarnings,
      safeToApply: cSafeToApply,
      blockingReason: cBlockingReason,
    });
  }

  // ─── Select recommended alternative by priority ───
  const safeAlts = alternatives.filter(a => a.safeToApply);
  let recommendedId: "A" | "B" | "C" | null = null;

  if (safeAlts.length > 0) {
    const a = alternatives.find(a => a.id === "A")!;
    const b = alternatives.find(a => a.id === "B")!;
    const c = alternatives.find(a => a.id === "C")!;

    if (b.safeToApply) {
      recommendedId = "B";
    } else if (c.safeToApply) {
      recommendedId = "C";
    } else if (a.safeToApply) {
      recommendedId = "A";
    }
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + RECOMMENDATION_TTL_MS);
  const configFingerprint = buildConfigFingerprint(input);
  const marketFingerprint = buildMarketFingerprint(input);
  const activeRangeVersionId = resolvedRange?.activeRangeVersionId ?? input.status?.activeRangeVersionId ?? null;
  const activeRangeFingerprint = buildActiveRangeFingerprint(activeRangeVersionId);
  const referencePrice = toNum(marketContext?.currentPrice);
  const context = buildRecommendationContext(input, regimeMaxPct);
  const uuid = crypto.randomUUID();
  const anySafe = safeAlts.length > 0;

  return {
    id: `rec-${uuid}-${input.pair}`,
    generatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    snapshotFingerprint: `${configFingerprint}||${activeRangeFingerprint}||${marketFingerprint}`,
    configFingerprint,
    marketFingerprint,
    activeRangeFingerprint,
    context,
    referencePrice,
    fresh: true,
    confidence: anySafe ? 0.85 : 0.5,
    title: anySafe ? "Recomendación de configuración" : "No hay ajuste seguro aplicable",
    explanation: anySafe
      ? `El diagnóstico actual indica ${currentCalc.totalLevels} niveles viables de ${configuredBuyLevels + configuredSellLevels} solicitados. Revisa las alternativas para futuros análisis.`
      : `El diagnóstico actual indica ${currentCalc.totalLevels} niveles viables, menos del mínimo ${MIN_LEVELS_FOR_VIABLE_GRID} que exige el motor estricto. No se ofrece ninguna alternativa aplicable.`,
    currentConfig: buildCurrentConfigSummary(config),
    alternatives,
    recommendedAlternativeId: recommendedId,
    warnings,
    safeToApply: anySafe,
    blockingReason: anySafe ? null : `Ninguna alternativa produce un Grid viable (mínimo ${MIN_LEVELS_FOR_VIABLE_GRID} niveles).`,
  };
}

// Validation helpers for recommendation apply payload values

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.prototype.toString.call(v) === "[object Object]";
}

function validateFieldType(key: string, value: unknown): { ok: true } | { ok: false; reason: string } {
  if (value === null || value === undefined) {
    return { ok: false, reason: `${key} no puede ser null o undefined` };
  }
  if (typeof value === "boolean") {
    return { ok: true };
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { ok: false, reason: `${key} no puede ser NaN` };
    if (!Number.isFinite(value)) return { ok: false, reason: `${key} no puede ser Infinity` };
    return { ok: true };
  }
  if (typeof value === "string") {
    const n = Number(value);
    if (!Number.isFinite(n)) return { ok: false, reason: `${key} es string no numérico` };
    return { ok: false, reason: `${key} debe ser número, no string` };
  }
  if (Array.isArray(value)) return { ok: false, reason: `${key} no puede ser un array` };
  if (isPlainObject(value)) return { ok: false, reason: `${key} no puede ser un objeto` };
  return { ok: false, reason: `${key} tiene tipo no permitido` };
}

function validateIntegerInRange(key: string, value: unknown, min: number, max: number): { ok: true; value: number } | { ok: false; reason: string } {
  const t = validateFieldType(key, value);
  if (!t.ok) return { ok: false, reason: t.reason };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, reason: `${key} debe ser un número finito` };
  }
  if (!Number.isInteger(value)) {
    return { ok: false, reason: `${key} debe ser un entero` };
  }
  if (value < min || value > max) {
    return { ok: false, reason: `${key} debe estar entre ${min} y ${max}` };
  }
  return { ok: true, value };
}

function validatePositiveFiniteNumber(key: string, value: unknown, max: number): { ok: true; value: number } | { ok: false; reason: string } {
  const t = validateFieldType(key, value);
  if (!t.ok) return { ok: false, reason: t.reason };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, reason: `${key} debe ser un número finito` };
  }
  if (value <= 0) {
    return { ok: false, reason: `${key} debe ser mayor que 0` };
  }
  if (value > max) {
    return { ok: false, reason: `${key} no puede superar ${max}` };
  }
  return { ok: true, value };
}

function validateBoolean(key: string, value: unknown): { ok: true; value: boolean } | { ok: false; reason: string } {
  if (typeof value !== "boolean") {
    return { ok: false, reason: `${key} debe ser boolean` };
  }
  return { ok: true, value };
}

export type ApplyValidationErrorCode =
  | "CONFIG_CHANGED"
  | "ACTIVE_RANGE_CHANGED"
  | "MARKET_SNAPSHOT_CHANGED"
  | "MARKET_DATA_UNAVAILABLE"
  | "MARKET_SNAPSHOT_INCOMPLETE"
  | "MARKET_SNAPSHOT_INCONSISTENT"
  | "PRICE_DRIFT_EXCEEDED"
  | "RECOMMENDATION_EXPIRED"
  | "RECOMMENDATION_ALREADY_USED"
  | "INVALID_VALUE"
  | "NOT_SHADOW"
  | "MISSING_CONFIRMATION"
  | "ALTERNATIVE_NOT_FOUND"
  | "ALTERNATIVE_BLOCKED"
  | "NO_CHANGED_FIELDS"
  | "FIELD_NOT_ALLOWED"
  | "REGIME_LIMIT_UNAVAILABLE"
  | "ROLLBACK_FAILED"
  | "APPLY_FAILED";

export interface ApplyValidationResult {
  valid: boolean;
  reason: string | null;
  code?: ApplyValidationErrorCode;
}

export const RECOMMENDATION_APPLY_ALLOWLIST = [
  "netProfitTargetPct",
  "gridStepAtrMultiplier",
  "gridStepMinPct",
  "gridStepMaxPct",
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

export function validateProposedValues(
  proposedConfig: Record<string, any>,
  regimeMaxPct: number | null,
): ApplyValidationResult {
  const keys = Object.keys(proposedConfig);

  for (const key of keys) {
    if (!RECOMMENDATION_APPLY_ALLOWLIST.includes(key as any)) {
      return { valid: false, reason: `Campo fuera de allowlist: ${key}`, code: "FIELD_NOT_ALLOWED" };
    }
  }

  for (const blocked of RECOMMENDATION_APPLY_BLOCKLIST) {
    if (blocked in proposedConfig) {
      return { valid: false, reason: `Campo bloqueado detectado en proposedConfig: ${blocked}`, code: "FIELD_NOT_ALLOWED" };
    }
  }

  for (const [key, value] of Object.entries(proposedConfig)) {
    if (key === "netProfitTargetPct") {
      const r = validatePositiveFiniteNumber(key, value, ABSOLUTE_NET_PROFIT_MAX_PCT);
      if (!r.ok) return { valid: false, reason: r.reason, code: "INVALID_VALUE" };
    } else if (key === "gridStepAtrMultiplier" || key === "gridStepMinPct" || key === "gridStepMaxPct") {
      const r = validatePositiveFiniteNumber(key, value, 20);
      if (!r.ok) return { valid: false, reason: r.reason, code: "INVALID_VALUE" };
    } else if (key === "gridRangeMaxPct") {
      const r = validatePositiveFiniteNumber(key, value, ABSOLUTE_GRID_RANGE_MAX_PCT);
      if (!r.ok) return { valid: false, reason: r.reason, code: "INVALID_VALUE" };
      if (regimeMaxPct == null) {
        return { valid: false, reason: "No se puede determinar el límite máximo del régimen para ampliar el rango", code: "REGIME_LIMIT_UNAVAILABLE" };
      }
      if ((value as number) > regimeMaxPct + 1e-9) {
        return { valid: false, reason: `${key} no puede superar el máximo del régimen (${regimeMaxPct.toFixed(2)}%)`, code: "INVALID_VALUE" };
      }
    } else if (key === "enforceCompactRange") {
      const r = validateBoolean(key, value);
      if (!r.ok) return { valid: false, reason: r.reason, code: "INVALID_VALUE" };
    } else {
      return { valid: false, reason: `Campo inesperado en proposedConfig: ${key}`, code: "FIELD_NOT_ALLOWED" };
    }
  }

  return { valid: true, reason: null };
}

export function validateApplyPayload(
  payload: any,
  recommendation: ConfigurationRecommendation,
  currentMode: string,
): ApplyValidationResult {
  if (currentMode !== "SHADOW") {
    return { valid: false, reason: "Solo se puede aplicar en modo SHADOW", code: "NOT_SHADOW" };
  }

  if (!payload || payload.confirmed !== true) {
    return { valid: false, reason: "Se requiere confirmación explícita", code: "MISSING_CONFIRMATION" };
  }

  if (payload.recommendationId !== recommendation.id) {
    return { valid: false, reason: "recommendationId no coincide", code: "ALTERNATIVE_NOT_FOUND" };
  }

  const now = new Date();
  const expiresAt = new Date(recommendation.expiresAt);
  if (now > expiresAt) {
    return { valid: false, reason: "La recomendación ha caducado", code: "RECOMMENDATION_EXPIRED" };
  }

  const alt = recommendation.alternatives.find(a => a.id === payload.alternativeId);
  if (!alt) {
    return { valid: false, reason: "alternativeId no encontrado en la recomendación", code: "ALTERNATIVE_NOT_FOUND" };
  }

  if (!alt.safeToApply) {
    return { valid: false, reason: alt.blockingReason ?? "La alternativa no es safeToApply", code: "ALTERNATIVE_BLOCKED" };
  }

  if (alt.changedFields.length === 0) {
    return { valid: false, reason: "La alternativa no tiene campos a modificar", code: "NO_CHANGED_FIELDS" };
  }

  return { valid: true, reason: null };
}

export interface ApplyRecommendationResult {
  success: boolean;
  appliedFields: string[];
  beforeValues: Record<string, any>;
  afterValues: Record<string, any>;
  error?: string;
  errorCode?: ApplyValidationErrorCode;
}

export async function applyRecommendationPatchAtomically(
  currentConfig: Record<string, any>,
  alt: RecommendationAlternative,
  saveConfig: () => Promise<void>,
  regimeMaxPct: number | null,
): Promise<ApplyRecommendationResult> {
  if (!alt || !alt.proposedConfig) {
    return { success: false, appliedFields: [], beforeValues: {}, afterValues: {}, error: "Alternativa sin proposedConfig", errorCode: "NO_CHANGED_FIELDS" };
  }

  const patchKeys = Object.keys(alt.proposedConfig);

  if (patchKeys.length === 0) {
    return { success: false, appliedFields: [], beforeValues: {}, afterValues: {}, error: "La alternativa no tiene campos a modificar", errorCode: "NO_CHANGED_FIELDS" };
  }

  const sortedPatchKeys = [...patchKeys].sort();
  const sortedChangedFields = [...alt.changedFields].sort();
  if (sortedPatchKeys.length !== sortedChangedFields.length || sortedPatchKeys.some((k, i) => k !== sortedChangedFields[i])) {
    return { success: false, appliedFields: [], beforeValues: {}, afterValues: {}, error: "changedFields no coincide con proposedConfig", errorCode: "INVALID_VALUE" };
  }

  const uniquePatchKeys = new Set(patchKeys);
  if (uniquePatchKeys.size !== patchKeys.length) {
    return { success: false, appliedFields: [], beforeValues: {}, afterValues: {}, error: "Campos duplicados en proposedConfig", errorCode: "INVALID_VALUE" };
  }

  for (const key of patchKeys) {
    if (!RECOMMENDATION_APPLY_ALLOWLIST.includes(key as any)) {
      return { success: false, appliedFields: [], beforeValues: {}, afterValues: {}, error: `Campo fuera de allowlist: ${key}`, errorCode: "FIELD_NOT_ALLOWED" };
    }
  }

  // 1. Capture before values from patchKeys
  const beforeValues: Record<string, any> = {};
  for (const key of patchKeys) {
    beforeValues[key] = currentConfig[key] ?? null;
  }

  // 2. Validate proposed values server-side
  const valueValidation = validateProposedValues(alt.proposedConfig, regimeMaxPct);
  if (!valueValidation.valid) {
    return { success: false, appliedFields: [], beforeValues, afterValues: beforeValues, error: valueValidation.reason ?? "Valor inválido", errorCode: valueValidation.code };
  }

  // 3. Apply temporarily to runtime config using patchKeys
  const appliedFields: string[] = [];
  for (const key of patchKeys) {
    currentConfig[key] = alt.proposedConfig[key];
    appliedFields.push(key);
  }

  // 4. Persist
  try {
    await saveConfig();
  } catch (saveError) {
    // 5. Rollback: restore all beforeValues using patchKeys
    for (const key of patchKeys) {
      currentConfig[key] = beforeValues[key];
    }

    // 6. Verify runtime restored
    let restored = true;
    for (const key of patchKeys) {
      if (!Object.is(currentConfig[key], beforeValues[key])) {
        restored = false;
      }
    }

    if (!restored) {
      return { success: false, appliedFields: [], beforeValues, afterValues: beforeValues, error: "ROLLBACK_FAILED", errorCode: "ROLLBACK_FAILED" };
    }

    return {
      success: false,
      appliedFields: [],
      beforeValues,
      afterValues: beforeValues,
      error: `Error al guardar configuración: ${String(saveError)}`,
      errorCode: "APPLY_FAILED",
    };
  }

  // 7. Confirm after values using patchKeys
  const afterValues: Record<string, any> = {};
  for (const key of patchKeys) {
    afterValues[key] = currentConfig[key] ?? null;
  }

  return { success: true, appliedFields, beforeValues, afterValues };
}
