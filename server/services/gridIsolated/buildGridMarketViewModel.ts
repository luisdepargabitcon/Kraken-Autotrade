/**
 * buildGridMarketViewModel.ts
 *
 * Builds the canonical `operational.market` view model consumed by the
 * Grid "Mercado" tab. It is pure: no DB access, no side effects, no trading logic.
 */

import { type ExecutionPolicy, executionPolicyLabel, isLegacyExecutionPolicy, TAX_RESERVE_PCT, FEE_BUFFER_BUY_PCT, FEE_BUFFER_SELL_PCT } from "./gridIsolatedTypes";
import { computeGrossTargetFromNet } from "./gridNetCalculator";
import { calculateMinSpacingPctReal, calculateSpacingPct, countViableLevelsIterative } from "./gridSpacingCalculator";
import { buildConfigurationRecommendation } from "./gridRecommendationService";
import { splitSymmetricLevels } from "./gridProfessionalProjectionContext";
import type {
  MarketBand as MarketBandType,
  OperationalRange as OperationalRangeType,
  ActiveRangeSnapshot as ActiveRangeSnapshotType,
  CurrentConfigurationProjection as CurrentConfigurationProjectionType,
  ConfigurationRecommendation as ConfigurationRecommendationType,
} from "@shared/gridRecommendationHelper";

export type RangeMode = "MANUAL" | "ADAPTIVE" | null;

export type EntryRangeViability =
  | "ACTIVE"
  | "VIABLE"
  | "REJECTED"
  | "PENDING"
  | "STALE"
  | "INSUFFICIENT_DATA"
  | null;

export interface GridMarketRegime {
  code: string | null;
  label: string;
  direction: string | null;
  confidencePct: number | null;
  reason: string | null;
  humanReason: string | null;
  technicalReason: string | null;
  updatedAt: string | null;
}

export interface GridMarketBand {
  lower: number | null;
  center: number | null;
  upper: number | null;
  widthPct: number | null;
  position: string | null;
  positionPct: number | null;
  rawPositionPct: number | null;
  atrPct: number | null;
  period: number | null;
  stdDevMultiplier: number | null;
  timeframe: string | null;
  source: string | null;
  calculatedAt: string | null;
  available: boolean;
  internallyConsistent: boolean;
  inconsistencyReason: string | null;
  status: string;
}

export interface GridMarketDataSourceInfo {
  marketDataSourceLabel: string;
  executionVenueLabel: string;
  executionPolicyLabel: string;
  takerFallbackLabel: string;
  constraintsSourceLabel: string;
  infoText: string;
}

export interface GridMarketCurrent {
  updatedAt: string | null;
  fresh: boolean;
  ageMs: number | null;
  maxAgeMs: number | null;
  source: string | null;
  price: number | null;
  bid: number | null;
  ask: number | null;
  spreadUsd: number | null;
  spreadPct: number | null;
  regime: GridMarketRegime;
  band: GridMarketBand;
  marketBand: MarketBandType;
  operationalRange: OperationalRangeType;
  activeRangeSnapshot: ActiveRangeSnapshotType;
  currentConfigurationProjection: CurrentConfigurationProjectionType | null;
  configurationRecommendation: ConfigurationRecommendationType | null;
  // REV-C12A: Real Revolut X execution gate (always present, never null)
  executionGate: ExecutionGateType;
  // REV-C12E: explicit data source / execution venue labels for UX (server-derived, not deduced in React)
  dataSourceInfo: GridMarketDataSourceInfo;
}

export interface LevelDiagnostic {
  bandWidthPct: number | null;
  operationalRangeMaxPct: number | null;
  effectiveRangePct: number | null;
  minSpacingPct: number | null;
  maxLevelsPerSide: number | null;
  maxTotalLevels: number | null;
  requestedPerSide: number | null;
  reason: string;
}

export interface GridMarketEntryRange {
  mode: RangeMode;
  active: boolean;
  activeRangeVersionId: string | null;
  configuredLower: number | null;
  configuredUpper: number | null;
  calculatedLower: number | null;
  calculatedUpper: number | null;
  calculatedWidthPct: number | null;
  requestedLevels: number | null;
  viableLevels: number | null;
  actualLevels: number | null;
  spacingPct: number | null;
  minimumProfitableSpacingPct: number | null;
  netProfitTargetPct: number | null;
  buyFeePct: number | null;
  sellFeePct: number | null;
  taxReservePct: number | null;
  gridRangeMaxPct: number | null;
  enforceCompactRange: boolean | null;
  viability: EntryRangeViability;
  reasonCode: string | null;
  reasonLabel: string | null;
  explanation: string | null;
  levelCountExplanation: string | null;
  levelDiagnostic: LevelDiagnostic | null;
  calculatedAt: string | null;
}

export interface GridMarketExitCycle {
  cycleId: number | string;
  buyPrice: number;
  targetSellPrice: number;
  quantity: number;
  currentPrice: number | null;
  progressPct: number | null;
  distanceUsd: number | null;
  distancePct: number | null;
  estimatedGrossPnlUsd: number | null;
  estimatedNetPnlUsd: number | null;
  status: string;
}

export interface GridMarketReferenceBandSnapshot {
  available: boolean;
  lower: number | null;
  center: number | null;
  upper: number | null;
  widthPct: number | null;
  regime: string | null;
  atrPct: number | null;
  calculatedAt: string | null;
}

export interface GridMarketExitObligationRange {
  rangeVersionId: string;
  shortLabel: string;
  rangeMode: string | null;
  createdAt: string | null;
  lowerPrice: number | null;
  upperPrice: number | null;
  openCyclesCount: number;
  capitalCommittedUsd: number;
  lowestBuyPrice: number | null;
  highestBuyPrice: number | null;
  lowestTargetSellPrice: number | null;
  highestTargetSellPrice: number | null;
  cycles: GridMarketExitCycle[];
  referenceBandSnapshot: GridMarketReferenceBandSnapshot | null;
}

export interface GridMarketRecommendation {
  title: string;
  explanation: string | null;
  consequence: string | null;
  action: string | null;
  suggestedLevels: number | null;
  suggestedLower: number | null;
  suggestedUpper: number | null;
  repetitionCount: number | null;
  lastDetectedAt: string | null;
  technicalCode: string | null;
}

export interface GridMarketViewModel {
  pair: string;
  current: GridMarketCurrent;
  entryRange: GridMarketEntryRange;
  exitObligationRanges: GridMarketExitObligationRange[];
  recommendation: GridMarketRecommendation | null;
  configurationRecommendation: ConfigurationRecommendationType | null;
  // REV-C12A: Real Revolut X execution gate (always present)
  executionGate: ExecutionGateType;
}

/** REV-C12A/REV-C12B: Real Revolut X execution gate type (in-memory, not persisted). */
export interface ExecutionGateType {
  canCreateRange: boolean;
  status: "VERIFIED" | "BLOCKED" | "NO_RECENT_EVALUATION";
  evaluatedAt: string | null;
  ageMs: number | null;
  maxAgeMs: number | null;
  validUntil: string | null;
  executionMarketSnapshot: {
    available: boolean;
    verified: boolean;
    fresh: boolean;
    pair: string | null;
    executionVenue: string | null;
    source: string | null;
    reasonCode: string | null;
    explanation: string | null;
  };
  pairConstraints: {
    available: boolean;
    verified: boolean;
    fresh: boolean | null;
    pair: string | null;
    source: string | null;
    reasonCode: string | null;
    explanation: string | null;
  };
  blockers: string[];
  allowCycleExits: boolean;
}

export interface BuildGridMarketViewModelInput {
  pair: string;
  mode: string;
  config: any;
  status: any;
  marketContext: any;
  resolvedRange: any;
  adaptiveDecision: any;
  professionalGenerator: any;
  currentOperationalState: any;
  recommendations: any[];
  openCycles: any[]; // operational open cycle objects
  levels: any[]; // raw levels for historical range envelope calculation
  lastProfessionalValidationAt?: Date | string | null;
  lastShadowValidationAt?: Date | string | null;
  // REV-C12A: Real execution gate + microstructure + allocation for canonical projection
  executionGate?: any | null;
  executionMarketSnapshot?: any | null;
  pairConstraints?: any | null;
  allocation?: any | null;
}

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

function translateBandPosition(pos: string | null): string | null {
  switch (pos) {
    case "below": return "por debajo";
    case "above": return "por encima";
    case "lower": return "zona baja";
    case "middle": return "zona media";
    case "upper": return "zona alta";
    case "unknown": return "desconocida";
    default: return pos;
  }
}

function clamp01Pct(pct: number | null): number | null {
  if (pct == null) return null;
  return Math.max(0, Math.min(100, pct));
}

function fmtDateShort(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function translateRegimeCode(code: string | null | undefined): string {
  const c = (code ?? "").toString().toUpperCase().replace(/\s+/g, "_");
  if (c.includes("LATERAL") || c === "RANGE" || c === "LATERAL" || c === "RANGING" || c === "NORMAL_LATERAL") return "RANGE";
  if (c.includes("TENDENCIA_ALCISTA") || c.includes("ALCISTA") || c.includes("BULLISH")) return "TREND_UP";
  if (c.includes("TENDENCIA_BAJISTA") || c.includes("BAJISTA") || c.includes("BEARISH")) return "TREND_DOWN";
  if (c.includes("TRANSICION") || c === "TRANSITION") return "TRANSITION";
  if (c.includes("PUMP") || c.includes("DUMP") || c.includes("UNSUITABLE")) return "UNSUITABLE";
  if (c === "LOW_VOLATILITY") return "LOW_VOLATILITY";
  if (c === "HIGH_VOLATILITY") return "HIGH_VOLATILITY";
  if (c === "COMPRESSED") return "COMPRESSED";
  if (c === "MODERATE") return "MODERATE";
  return c || "UNKNOWN";
}

function regimeLabel(code: string | null): string {
  const mapped = translateRegimeCode(code);
  switch (mapped) {
    case "RANGE":
    case "LATERAL":
      return "Mercado lateral";
    case "TREND_UP":
      return "Tendencia alcista";
    case "TREND_DOWN":
      return "Tendencia bajista";
    case "TREND":
      return "Tendencia";
    case "TRANSITION":
      return "Transición";
    case "UNSUITABLE":
      return "Mercado no apto";
    case "LOW_VOLATILITY":
      return "Volatilidad baja";
    case "HIGH_VOLATILITY":
      return "Volatilidad alta";
    case "COMPRESSED":
      return "Mercado comprimido";
    case "MODERATE":
      return "Volatilidad moderada";
    default:
      return "Sin datos suficientes";
  }
}

function regimeDirection(code: string | null): string | null {
  const mapped = translateRegimeCode(code);
  if (mapped === "TREND_UP") return "alcista";
  if (mapped === "TREND_DOWN") return "bajista";
  return null;
}

function resolveRegime(
  marketContext: any,
  adaptiveDecision: any,
  professionalGenerator: any,
  resolvedRange: any,
  status: any,
  lastProfessionalValidationAt: Date | string | null | undefined
): GridMarketRegime {
  const codeCandidates = [
    marketContext?.regime,
    adaptiveDecision?.regimeLabel,
    adaptiveDecision?.regimeBucket,
    professionalGenerator?.marketRegime,
    professionalGenerator?.regime,
    resolvedRange?.method,
    resolvedRange?.regime,
    status?.lastTickReason && String(status.lastTickReason).startsWith("Condiciones de mercado no válidas")
      ? "unsuitable"
      : null,
  ];
  const rawCode = codeCandidates.find((c) => c != null && c !== "");
  const code = translateRegimeCode(rawCode);
  const technicalReason =
    adaptiveDecision?.reason ??
    professionalGenerator?.reason ??
    resolvedRange?.naturalReason ??
    status?.lastTickReason ??
    null;
  const humanReason = humanizeRegimeReason(technicalReason);
  return {
    code: code === "UNKNOWN" ? null : code,
    label: regimeLabel(code),
    direction: regimeDirection(code),
    confidencePct: marketContext?.regimeConfidencePct ?? adaptiveDecision?.confidencePct ?? null,
    reason: humanReason ?? technicalReason,
    humanReason,
    technicalReason,
    updatedAt: toIso(lastProfessionalValidationAt) ?? toIso(status?.lastTickAt) ?? toIso(marketContext?.updatedAt),
  };
}

function buildMarketBand(marketContext: any): MarketBandType {
  const band = marketContext?.band ?? {};
  const lower = toNum(band.lower);
  const center = toNum(band.center);
  const upper = toNum(band.upper);
  const widthPct = toNum(band.widthPct);
  const atr = toNum(band.atr ?? marketContext?.atr);
  const atrPct = toNum(band.atrPct ?? marketContext?.atrPct);
  const period = toNum(band.period ?? marketContext?.bandPeriod);
  const stdDevMultiplier = toNum(band.stdDevMultiplier ?? marketContext?.bandStdDevMultiplier);
  const timeframe = band.timeframe ?? marketContext?.bandTimeframe ?? null;
  const source = band.source ?? marketContext?.bandSource ?? null;
  const calculatedAt = toIso(band.calculatedAt ?? marketContext?.bandCalculatedAt);

  const available = lower != null && upper != null && center != null;
  let internallyConsistent = true;
  let inconsistencyReason: string | null = null;
  let calculatedWidthPct: number | null = null;

  if (available && center > 0) {
    calculatedWidthPct = ((upper! - lower!) / center!) * 100;
    if (widthPct != null && Math.abs(calculatedWidthPct - widthPct) > 0.02) {
      internallyConsistent = false;
      inconsistencyReason = `Anchura calculada (${calculatedWidthPct.toFixed(4)}%) no coincide con widthPct reportado (${widthPct.toFixed(4)}%)`;
    }
  } else if (!available) {
    internallyConsistent = false;
    inconsistencyReason = "Banda incompleta: faltan lower, center o upper";
  }

  const status = !available ? "incomplete" : internallyConsistent ? "ok" : "inconsistent";

  return {
    available,
    lower,
    center,
    upper,
    widthPct: available ? (widthPct ?? calculatedWidthPct) : null,
    calculatedWidthPct,
    atr,
    atrPct,
    period,
    stdDevMultiplier,
    timeframe,
    source,
    calculatedAt,
    internallyConsistent,
    inconsistencyReason,
    status,
  };
}

function buildOperationalRange(
  resolvedRange: any,
  adaptiveDecision: any,
  professionalGenerator: any,
  status: any,
): OperationalRangeType {
  const activeRangeVersionId = resolvedRange?.activeRangeVersionId ?? status?.activeRangeVersionId ?? null;

  // Pick one complete source, not a mix
  let source: string | null = null;
  let sourceRangeVersionId: string | null = null;
  let lower: number | null = null;
  let upper: number | null = null;
  let center: number | null = null;
  let totalWidthPct: number | null = null;
  let spacingPct: number | null = null;
  let requestedBuyLevels: number | null = null;
  let requestedSellLevels: number | null = null;
  let generatedBuyLevels: number | null = null;
  let generatedSellLevels: number | null = null;
  let regimeMaxPct: number | null = null;
  let calculatedAt: string | null = null;

  const adVersionId = adaptiveDecision?.rangeVersionId ?? null;
  const pgVersionId = professionalGenerator?.rangeVersionId ?? professionalGenerator?.activeRangeVersionId ?? null;

  if (adaptiveDecision && adVersionId === activeRangeVersionId) {
    source = "adaptive_decision";
    sourceRangeVersionId = adVersionId;
    lower = toNum(adaptiveDecision.operationalLower);
    upper = toNum(adaptiveDecision.operationalUpper);
    center = toNum(adaptiveDecision.centerPrice ?? ((toNum(adaptiveDecision.operationalLower) ?? 0) + (toNum(adaptiveDecision.operationalUpper) ?? 0)) / 2);
    totalWidthPct = toNum(adaptiveDecision.finalRangePct);
    spacingPct = toNum(adaptiveDecision.spacingPct);
    requestedBuyLevels = toNum(adaptiveDecision.requestedBuyLevels);
    requestedSellLevels = toNum(adaptiveDecision.requestedSellLevels);
    generatedBuyLevels = toNum(adaptiveDecision.buyLevelsWouldFit);
    generatedSellLevels = toNum(adaptiveDecision.sellLevelsWouldFit);
    regimeMaxPct = toNum(adaptiveDecision.regimeMaxPct);
    calculatedAt = toIso(adaptiveDecision.calculatedAt ?? adaptiveDecision.createdAt ?? status?.lastTickAt);
  } else if (professionalGenerator && pgVersionId === activeRangeVersionId) {
    source = "professional_generator";
    sourceRangeVersionId = pgVersionId;
    lower = toNum(professionalGenerator.operationalLower);
    upper = toNum(professionalGenerator.operationalUpper);
    center = toNum(professionalGenerator.centerPrice ?? ((toNum(professionalGenerator.operationalLower) ?? 0) + (toNum(professionalGenerator.operationalUpper) ?? 0)) / 2);
    totalWidthPct = toNum(professionalGenerator.operationalBandWidthPct);
    spacingPct = toNum(professionalGenerator.spacingPct);
    requestedBuyLevels = toNum(professionalGenerator.requestedBuyLevels);
    requestedSellLevels = toNum(professionalGenerator.requestedSellLevels);
    generatedBuyLevels = toNum(professionalGenerator.generatedBuyLevels);
    generatedSellLevels = toNum(professionalGenerator.generatedSellLevels);
    regimeMaxPct = toNum(professionalGenerator.regimeMaxPct);
    calculatedAt = toIso(professionalGenerator.eventCreatedAt ?? professionalGenerator.createdAt ?? status?.lastTickAt);
  } else if (resolvedRange) {
    source = "resolved_range";
    sourceRangeVersionId = activeRangeVersionId;
    lower = toNum(resolvedRange.lowerPrice);
    upper = toNum(resolvedRange.upperPrice);
    center = toNum(resolvedRange.centerPrice ?? ((toNum(resolvedRange.lowerPrice) ?? 0) + (toNum(resolvedRange.upperPrice) ?? 0)) / 2);
    totalWidthPct = toNum(resolvedRange.widthPct);
    spacingPct = toNum(resolvedRange.spacingPct);
    requestedBuyLevels = toNum(resolvedRange.requestedBuyLevels);
    requestedSellLevels = toNum(resolvedRange.requestedSellLevels);
    generatedBuyLevels = toNum(resolvedRange.generatedBuyLevels);
    generatedSellLevels = toNum(resolvedRange.generatedSellLevels);
    regimeMaxPct = toNum(resolvedRange.regimeMaxPct);
    calculatedAt = toIso(resolvedRange.createdAt);
  }

  const available = lower != null && upper != null && center != null && center > 0;

  let internallyConsistent = true;
  let inconsistencyReason: string | null = null;
  if (available && totalWidthPct != null) {
    const calculatedWidth = ((upper! - lower!) / center!) * 100;
    if (Math.abs(calculatedWidth - totalWidthPct) > 0.02) {
      internallyConsistent = false;
      inconsistencyReason = `Anchura recalculada (${calculatedWidth.toFixed(4)}%) no coincide con la reportada (${totalWidthPct.toFixed(4)}%)`;
    }
  }

  const semiRangePct = totalWidthPct != null ? totalWidthPct / 2 : null;

  return {
    available,
    rangeVersionId: activeRangeVersionId,
    sourceRangeVersionId,
    source,
    lower,
    center,
    upper,
    totalWidthPct,
    semiRangePct,
    spacingPct,
    requestedBuyLevels,
    requestedSellLevels,
    generatedBuyLevels,
    generatedSellLevels,
    regimeMaxPct,
    internallyConsistent,
    inconsistencyReason,
    calculatedAt,
  };
}

function levelSide(l: any): "buy" | "sell" | null {
  const s = l?.side ? String(l.side).toUpperCase() : null;
  if (s === "BUY" || s === "buy") return "buy";
  if (s === "SELL" || s === "sell") return "sell";
  const price = toNum(l?.price ?? l?.buyPrice ?? l?.sellPrice);
  if (price == null) return null;
  const center = toNum(l?.centerPrice);
  if (center != null) return price < center ? "buy" : "sell";
  return null;
}

function buildActiveRangeSnapshot(
  resolvedRange: any,
  levels: any[],
): ActiveRangeSnapshotType {
  const rangeVersionId = resolvedRange?.activeRangeVersionId ?? null;
  const configSnapshot = resolvedRange?.configSnapshot ?? null;
  const lower = toNum(resolvedRange?.lowerPrice);
  const center = toNum(resolvedRange?.centerPrice);
  const upper = toNum(resolvedRange?.upperPrice);
  const totalWidthPct = toNum(resolvedRange?.widthPct);
  const semiRangePct = totalWidthPct != null ? totalWidthPct / 2 : null;
  const spacingPct = toNum(resolvedRange?.spacingPct ?? configSnapshot?.spacingPct);

  // REV-C12B: configSnapshot.buyLevels/sellLevels are phantom fields — use resolvedRange only.
  const requestedBuyLevels = toNum(resolvedRange?.requestedBuyLevels);
  const requestedSellLevels = toNum(resolvedRange?.requestedSellLevels);

  // Count real levels associated with this rangeVersionId per side
  let generatedBuyLevels: number | null = null;
  let generatedSellLevels: number | null = null;
  if (rangeVersionId != null && Array.isArray(levels)) {
    const rangeLevels = levels.filter((l: any) => l?.rangeVersionId === rangeVersionId && l?.status !== "cancelled" && l?.status !== "replaced");
    generatedBuyLevels = rangeLevels.filter((l: any) => levelSide(l) === "buy").length;
    generatedSellLevels = rangeLevels.filter((l: any) => levelSide(l) === "sell").length;
  }

  const rangeControlMode = configSnapshot?.gridRangeControlMode ?? null;
  const profile = configSnapshot?.adaptiveRangeProfile ?? null;
  const regime = resolvedRange?.regime ?? resolvedRange?.method ?? null;
  const regimeMaxPct = toNum(resolvedRange?.regimeMaxPct);
  const createdAt = toIso(resolvedRange?.createdAt);
  const source = resolvedRange ? "resolved_range" : null;

  return {
    rangeVersionId,
    lower,
    center,
    upper,
    totalWidthPct,
    semiRangePct,
    spacingPct,
    requestedBuyLevels,
    requestedSellLevels,
    generatedBuyLevels,
    generatedSellLevels,
    rangeControlMode,
    profile,
    regime,
    regimeMaxPct,
    configSnapshot,
    createdAt,
    source,
  };
}

function buildCurrentConfigurationProjection(
  config: any,
  marketContext: any,
  allocation?: any | null,
): CurrentConfigurationProjectionType | null {
  const price = toNum(marketContext?.currentPrice);
  const bandLower = toNum(marketContext?.band?.lower);
  const bandUpper = toNum(marketContext?.band?.upper);
  const bandWidthPct = toNum(marketContext?.band?.widthPct);
  const atrPct = toNum(marketContext?.atrPct);

  const netProfitTargetPct = toNum(config?.netProfitTargetPct);
  const buyFeePct = toNum(config?.buyFeePct) ?? FEE_BUFFER_BUY_PCT;
  const sellFeePct = toNum(config?.sellFeePct) ?? FEE_BUFFER_SELL_PCT;
  const taxReservePct = toNum(config?.taxReservePct) ?? TAX_RESERVE_PCT;
  const gridRangeMaxPct = toNum(config?.gridRangeMaxPct);
  const enforceCompactRange = config?.enforceCompactRange ?? true;
  // REV-C12B: buyLevels/sellLevels are NOT real config fields — they are phantom fields.
  // The allocator is the sole source of levelsCount. Use allocation from input when available.
  // REV-C12B: Use canonical symmetric split — no Math.floor, odd totals → null.
  const allocationLevelsCount = toNum(allocation?.levelsCount);
  const split = allocationLevelsCount != null ? splitSymmetricLevels(allocationLevelsCount) : null;
  const buyLevels = split?.ok ? split.buyLevels : null;
  const sellLevels = split?.ok ? split.sellLevels : null;

  if (price == null || price <= 0 || bandWidthPct == null || bandWidthPct <= 0) {
    return {
      currentConfig: {
        netProfitTargetPct,
        buyFeePct,
        sellFeePct,
        taxReservePct,
        gridRangeMaxPct,
        enforceCompactRange,
        buyLevels,
        sellLevels,
      },
      marketSnapshot: { price, bandLower, bandUpper, bandWidthPct, atrPct },
      projectedRange: null,
      projectedSpacing: null,
      projectedLevels: null,
    };
  }

  const effectiveRangePct = enforceCompactRange && gridRangeMaxPct != null
    ? Math.min(bandWidthPct, gridRangeMaxPct)
    : bandWidthPct;

  const semiRangePct = effectiveRangePct / 2;
  const projectedLower = price * (1 - semiRangePct / 100);
  const projectedUpper = price * (1 + semiRangePct / 100);

  const minSpacingResult = calculateMinSpacingPctReal({
    netProfitTargetPct: netProfitTargetPct ?? 0.8,
    spreadBufferPct: 0.01,
    safetyBufferPct: 0.10,
    buyFeePct,
    sellFeePct,
    taxReservePct,
  });

  const atrMult = toNum(config?.gridStepAtrMultiplier) ?? 1.5;
  const stepMax = toNum(config?.gridStepMaxPct) ?? 3.0;
  const spacingResult = calculateSpacingPct({
    atrPct: atrPct ?? 0.5,
    gridStepAtrMultiplier: atrMult,
    minSpacingPctReal: minSpacingResult.minSpacingPctReal,
    gridStepMaxPct: stepMax,
  });

  // REV-C12B: When allocation is not available, buyLevels/sellLevels are null.
  // We cannot run countViableLevelsIterative without configured level counts.
  if (buyLevels == null || sellLevels == null) {
    return {
      currentConfig: {
        netProfitTargetPct,
        buyFeePct,
        sellFeePct,
        taxReservePct,
        gridRangeMaxPct,
        enforceCompactRange,
        buyLevels: null,
        sellLevels: null,
      },
      marketSnapshot: { price, bandLower, bandUpper, bandWidthPct, atrPct },
      projectedRange: {
        lower: projectedLower,
        upper: projectedUpper,
        totalWidthPct: effectiveRangePct,
      },
      projectedSpacing: spacingResult.spacingPct,
      projectedLevels: null,
    };
  }

  const viable = countViableLevelsIterative({
    centerPrice: price,
    operationalLower: projectedLower,
    operationalUpper: projectedUpper,
    spacingPct: spacingResult.spacingPct,
    configuredBuyLevels: buyLevels,
    configuredSellLevels: sellLevels,
  });

  return {
    currentConfig: {
      netProfitTargetPct,
      buyFeePct,
      sellFeePct,
      taxReservePct,
      gridRangeMaxPct,
      enforceCompactRange,
      buyLevels,
      sellLevels,
    },
    marketSnapshot: { price, bandLower, bandUpper, bandWidthPct, atrPct },
    projectedRange: {
      lower: projectedLower,
      upper: projectedUpper,
      totalWidthPct: effectiveRangePct,
    },
    projectedSpacing: spacingResult.spacingPct,
    projectedLevels: viable.totalViableLevels,
  };
}

function humanizeRegimeReason(reason: string | null): string | null {
  if (!reason) return null;
  const r = reason.toLowerCase();
  if (r.includes("market_unsuitable") || r.includes("not_suitable")) return "Las condiciones de mercado no son adecuadas para operar el Grid.";
  if (r.includes("compact") || r.includes("not_viable")) return "El rango calculado es demasiado estrecho para los niveles solicitados.";
  if (r.includes("adaptive_ok")) return "El motor calculó un rango rentable válido.";
  if (r.includes("adaptive_not_ok")) return "La configuración actual no permite un rango rentable.";
  if (r.includes("transition")) return "El mercado está en transición entre regímenes.";
  if (r.includes("low_volatility")) return "La volatilidad es baja, lo que reduce el número de niveles viables.";
  if (r.includes("high_volatility")) return "La volatilidad es alta, lo que amplía el rango operativo.";
  if (r.includes("compressed")) return "El mercado está comprimido, con banda estrecha.";
  if (r.includes("ranging") || r.includes("lateral")) return "El mercado se mueve en rango lateral.";
  if (r.includes("trend_up") || r.includes("bullish")) return "El mercado muestra tendencia alcista.";
  if (r.includes("trend_down") || r.includes("bearish")) return "El mercado muestra tendencia bajista.";
  if (r.includes("pending")) return "Pendiente de evaluación del motor.";
  return null;
}

function buildCurrent(input: BuildGridMarketViewModelInput): GridMarketCurrent {
  const { marketContext, status, config, resolvedRange, adaptiveDecision, professionalGenerator } = input;
  const currentPrice = toNum(marketContext?.currentPrice ?? status?.currentPrice ?? status?.lastPrice);
  const currentBid = toNum(marketContext?.currentBid ?? marketContext?.bid ?? status?.currentBid);
  const currentAsk = toNum(marketContext?.currentAsk ?? marketContext?.ask ?? status?.currentAsk);
  const source = marketContext?.priceSource ?? marketContext?.source ?? status?.priceSource ?? status?.currentPriceSource ?? null;
  const fresh = marketContext?.priceFresh ?? status?.priceFresh ?? false;
  const ageMs = toNum(marketContext?.priceAgeMs ?? status?.priceAgeMs);
  const maxAgeMs = toNum(marketContext?.priceMaxAgeMs ?? status?.priceMaxAgeMs);
  const updatedAt = toIso(marketContext?.updatedAt ?? status?.lastTickAt);

  // Canonical spread calculation
  let spreadUsd: number | null = null;
  let spreadPct: number | null = null;
  if (currentBid != null && currentAsk != null) {
    spreadUsd = currentAsk - currentBid;
    if (currentBid > 0) {
      spreadPct = (spreadUsd / currentBid) * 100;
    }
  }
  if (spreadPct == null) {
    spreadPct = toNum(marketContext?.spreadPct);
  }

  // Atomic marketBand — no resolvedRange fallbacks
  const marketBand = buildMarketBand(marketContext);

  // Use marketBand for band display (no mixing with resolvedRange)
  const bandLower = marketBand.lower;
  const bandUpper = marketBand.upper;
  const bandCenter = marketBand.center;
  const bandWidthPct = marketBand.widthPct;

  let position: string | null = marketContext?.bandPosition ?? "unknown";
  let rawPositionPct: number | null = toNum(marketContext?.bandPositionPct);

  if (currentPrice != null && bandLower != null && bandUpper != null) {
    if (rawPositionPct == null) {
      if (currentPrice < bandLower) {
        position = "below";
        rawPositionPct = ((currentPrice - bandLower) / bandLower) * 100;
      } else if (currentPrice > bandUpper) {
        position = "above";
        rawPositionPct = ((currentPrice - bandUpper) / bandUpper) * 100;
      } else {
        const range = bandUpper - bandLower;
        const p = range > 0 ? (currentPrice - bandLower) / range : 0.5;
        if (p < 0.33) position = "lower";
        else if (p < 0.67) position = "middle";
        else position = "upper";
        rawPositionPct = p * 100;
      }
    }
  }

  const positionPct = clamp01Pct(rawPositionPct);

  // Operational range (separate from market band)
  const operationalRange = buildOperationalRange(resolvedRange, adaptiveDecision, professionalGenerator, status);

  // Active range snapshot (persisted range data only)
  const activeRangeSnapshot = buildActiveRangeSnapshot(resolvedRange, input.levels);

  // Current configuration projection (uses current config + market + allocation)
  const currentConfigurationProjection = buildCurrentConfigurationProjection(config, marketContext, input.allocation);

  // Configuration recommendation from server service
  // REV-C12A: Pass real execution microstructure and allocation for canonical projection.
  const configurationRecommendation = buildConfigurationRecommendation({
    ...input,
    executionMarketSnapshot: input.executionMarketSnapshot ?? null,
    pairConstraints: input.pairConstraints ?? null,
    allocation: input.allocation ?? null,
  });

  // REV-C12A/REV-C12B: Real Revolut X execution gate (always present, never null).
  // When no evaluation exists, the gate shows NO_RECENT_EVALUATION / SIN_EVALUACION_RECIENTE.
  const executionGate: ExecutionGateType = input.executionGate ?? {
    canCreateRange: false,
    status: "NO_RECENT_EVALUATION",
    evaluatedAt: null,
    ageMs: null,
    maxAgeMs: null,
    validUntil: null,
    executionMarketSnapshot: {
      available: false,
      verified: false,
      fresh: false,
      pair: input.pair,
      executionVenue: null,
      source: null,
      reasonCode: "SIN_EVALUACION_RECIENTE",
      explanation: "No existe una evaluación reciente del gate de ejecución.",
    },
    pairConstraints: {
      available: false,
      verified: false,
      fresh: null,
      pair: input.pair,
      source: null,
      reasonCode: "SIN_EVALUACION_RECIENTE",
      explanation: "No existe una evaluación reciente de las constraints del par.",
    },
    blockers: ["SIN_EVALUACION_RECIENTE"],
    allowCycleExits: true,
  };

  // Regime with humanized reason
  const regime = resolveRegime(
    marketContext,
    adaptiveDecision,
    professionalGenerator,
    resolvedRange,
    status,
    input.lastProfessionalValidationAt
  );
  const humanizedReason = humanizeRegimeReason(regime.reason);

  // REV-C12E: explicit, server-derived data source / execution venue labels.
  // Derives from execution gate and config — NOT unconditional constants.
  // When gate data is missing, labels show "—" (No disponible), never invented.
  const dataSourceInfo = buildDataSourceInfo(config, input.executionGate, input.executionMarketSnapshot);

  return {
    updatedAt,
    fresh,
    ageMs,
    maxAgeMs,
    source,
    price: currentPrice,
    bid: currentBid,
    ask: currentAsk,
    spreadUsd,
    spreadPct,
    regime: {
      ...regime,
      reason: humanizedReason ?? regime.reason,
    },
    band: {
      lower: bandLower,
      center: bandCenter,
      upper: bandUpper,
      widthPct: bandWidthPct,
      position: translateBandPosition(position),
      positionPct,
      rawPositionPct,
      atrPct: marketBand.atrPct,
      period: marketBand.period,
      stdDevMultiplier: marketBand.stdDevMultiplier,
      timeframe: marketBand.timeframe,
      source: marketBand.source,
      calculatedAt: marketBand.calculatedAt,
      available: marketBand.available,
      internallyConsistent: marketBand.internallyConsistent,
      inconsistencyReason: marketBand.inconsistencyReason,
      status: marketBand.status,
    },
    marketBand,
    operationalRange,
    activeRangeSnapshot,
    currentConfigurationProjection,
    configurationRecommendation,
    executionGate,
    dataSourceInfo,
  };
}

// REV-C12E: Explicit, server-derived labels for the Kraken-data / Revolut X-execution
// architecture. Values are derived from the execution gate and config — NOT constants.
// When gate data is missing, labels show "—" (No disponible), never invented.
function buildDataSourceInfo(config: any, executionGate?: any, executionMarketSnapshot?: any): GridMarketDataSourceInfo {
  const policy: string = config?.executionPolicy ?? "MAKER_ONLY";
  const isMakerOnly = policy === "MAKER_ONLY";
  const takerFallbackEnabled = config?.takerFallbackEnabled === true;
  const isLegacy = isLegacyExecutionPolicy(policy);

  // Derive market data source from execution market snapshot source, not a constant.
  const snapshotSource = executionMarketSnapshot?.source ?? null;
  const hasKrakenSource = snapshotSource != null && snapshotSource.toUpperCase().includes("KRAKEN");
  const marketDataSourceLabel = hasKrakenSource ? "Kraken" : (snapshotSource ? "No disponible" : "—");

  // Derive execution venue from gate or snapshot.
  const gateVenue = executionGate?.executionVenue ?? executionMarketSnapshot?.executionVenue ?? null;
  const executionVenueLabel = gateVenue === "REVOLUT_X" ? "Revolut X" : (gateVenue ? "No disponible" : "—");

  // Derive policy label from config.
  const policyLabel = isLegacy ? "Bloqueada (legacy)" : (isMakerOnly ? "Maker-only / Post-only" : executionPolicyLabel(policy as ExecutionPolicy));

  // Derive taker fallback label from config — do NOT show "Desactivado" when enabled.
  const takerFallbackLabel = takerFallbackEnabled ? "Habilitado" : "Desactivado";

  // Derive constraints source from gate or snapshot.
  const constraintsSource = executionGate?.constraintsSource ?? executionMarketSnapshot?.source ?? null;
  const constraintsSourceLabel = constraintsSource?.toUpperCase().includes("KRAKEN")
    ? "Kraken"
    : (constraintsSource?.toUpperCase().includes("REVOLUT") ? "Revolut X" : "—");

  const infoText = hasKrakenSource
    ? "Kraken se utiliza como referencia de mercado. La garantía maker definitiva se aplica en Revolut X mediante post_only."
    : "No disponible";

  return {
    marketDataSourceLabel,
    executionVenueLabel,
    executionPolicyLabel: policyLabel,
    takerFallbackLabel,
    constraintsSourceLabel,
    infoText,
  };
}

function inferRangeMode(config: any): RangeMode {
  const controlMode = config?.gridRangeControlMode;
  if (controlMode === "adaptive_smart" || config?.adaptiveRangeEnabled === true) return "ADAPTIVE";
  if (controlMode === "fixed_compact" || controlMode === "legacy_hybrid") return "MANUAL";
  if (config?.adaptiveRangeEnabled === false) return "MANUAL";
  if (config?.adaptiveRangeMinPct != null && config?.adaptiveRangeMaxPct != null) return "ADAPTIVE";
  return null;
}

function requestedLevelsFrom(adaptiveDecision: any, professionalGenerator: any, config: any): number | null {
  const ad = adaptiveDecision;
  if (ad?.requestedBuyLevels != null && ad?.requestedSellLevels != null) {
    return (toNum(ad.requestedBuyLevels) ?? 0) + (toNum(ad.requestedSellLevels) ?? 0);
  }
  if (ad?.minViableLevels != null) return toNum(ad.minViableLevels);
  if (professionalGenerator?.requestedBuyLevels != null && professionalGenerator?.requestedSellLevels != null) {
    return (toNum(professionalGenerator.requestedBuyLevels) ?? 0) + (toNum(professionalGenerator.requestedSellLevels) ?? 0);
  }
  // REV-C12B: config.buyLevels/sellLevels are phantom fields — do NOT use them.
  // Fall back to adaptiveRangeMinViableLevels only (a real config field).
  return toNum(config?.adaptiveRangeMinViableLevels);
}

function viableLevelsFrom(adaptiveDecision: any, professionalGenerator: any): number | null {
  const ad = adaptiveDecision;
  if (ad?.levelsWouldFitAtFinalRange != null) return toNum(ad.levelsWouldFitAtFinalRange);
  if (ad?.buyLevelsWouldFit != null && ad?.sellLevelsWouldFit != null) {
    return (toNum(ad.buyLevelsWouldFit) ?? 0) + (toNum(ad.sellLevelsWouldFit) ?? 0);
  }
  if (professionalGenerator?.generatedBuyLevels != null && professionalGenerator?.generatedSellLevels != null) {
    return (toNum(professionalGenerator.generatedBuyLevels) ?? 0) + (toNum(professionalGenerator.generatedSellLevels) ?? 0);
  }
  return null;
}

function buildEntryRange(input: BuildGridMarketViewModelInput): GridMarketEntryRange {
  const { config, status, marketContext, resolvedRange, adaptiveDecision, professionalGenerator, currentOperationalState, lastProfessionalValidationAt } = input;
  const activeRangeVersionId = status?.activeRangeVersionId ?? resolvedRange?.activeRangeVersionId ?? null;
  const active = !!activeRangeVersionId && resolvedRange?.status !== "sin_rango_activo";
  const mode = inferRangeMode(config);

  const bandLower = toNum(marketContext?.band?.lower ?? status?.bandLower);
  const bandUpper = toNum(marketContext?.band?.upper ?? status?.bandUpper);
  const bandCenter = toNum(marketContext?.band?.center ?? status?.bandMiddle);

  const calculatedLower = toNum(
    adaptiveDecision?.operationalLower ?? professionalGenerator?.operationalLower ?? resolvedRange?.lowerPrice ?? bandLower
  );
  const calculatedUpper = toNum(
    adaptiveDecision?.operationalUpper ?? professionalGenerator?.operationalUpper ?? resolvedRange?.upperPrice ?? bandUpper
  );
  const calculatedCenter = toNum(
    adaptiveDecision?.centerPrice ?? professionalGenerator?.centerPrice ?? resolvedRange?.centerPrice ?? bandCenter
  );
  const calculatedWidthPct = toNum(
    adaptiveDecision?.finalRangePct ?? professionalGenerator?.operationalBandWidthPct ?? resolvedRange?.widthPct ?? marketContext?.band?.widthPct ??
      (calculatedLower != null && calculatedUpper != null && calculatedCenter != null && calculatedCenter > 0
        ? ((calculatedUpper - calculatedLower) / calculatedCenter) * 100
        : null)
  );

  const configuredLower: number | null = null;
  const configuredUpper: number | null = null;

  const requestedLevels = requestedLevelsFrom(adaptiveDecision, professionalGenerator, config);
  const viableLevels = viableLevelsFrom(adaptiveDecision, professionalGenerator);
  const netProfitTargetPct = toNum(config?.netProfitTargetPct);
  const buyFeePct = toNum(config?.buyFeePct);
  const sellFeePct = toNum(config?.sellFeePct);
  const taxReservePct = toNum(config?.taxReservePct) ?? TAX_RESERVE_PCT;
  const gridRangeMaxPct = toNum(config?.gridRangeMaxPct);
  const enforceCompactRange = config?.enforceCompactRange ?? null;

  // Use canonical function instead of duplicate formula
  const minSpacingResult = (netProfitTargetPct != null)
    ? calculateMinSpacingPctReal({
        netProfitTargetPct,
        spreadBufferPct: 0.01,
        safetyBufferPct: 0.10,
        buyFeePct: buyFeePct ?? undefined,
        sellFeePct: sellFeePct ?? undefined,
        taxReservePct: taxReservePct ?? undefined,
      })
    : null;
  const minimumProfitableSpacingPct = toNum(
    adaptiveDecision?.minSpacingPctReal ?? professionalGenerator?.minSpacingPctReal
  ) ?? minSpacingResult?.minSpacingPctReal ?? null;

  const bandWidthPct = toNum(marketContext?.band?.widthPct ?? calculatedWidthPct);
  const operationalRangeMaxPct = gridRangeMaxPct;
  const effectiveRangePct = enforceCompactRange && operationalRangeMaxPct != null && bandWidthPct != null
    ? Math.min(bandWidthPct, operationalRangeMaxPct)
    : bandWidthPct ?? calculatedWidthPct;

  // Use iterative level counting instead of Math.floor
  const centerForCount = calculatedCenter ?? toNum(marketContext?.currentPrice);
  const lowerForCount = calculatedLower;
  const upperForCount = calculatedUpper;
  const spacingForCount = toNum(adaptiveDecision?.spacingPct ?? professionalGenerator?.spacingPct) ?? minimumProfitableSpacingPct;
  // REV-C12B: buyLevels/sellLevels are phantom config fields — use canonical sources only.
  // Priority: professionalGenerator > adaptiveDecision > allocation > adaptiveRangeMinViableLevels
  const cfgBuy = toNum(professionalGenerator?.requestedBuyLevels) ?? toNum(adaptiveDecision?.requestedBuyLevels) ?? null;
  const cfgSell = toNum(professionalGenerator?.requestedSellLevels) ?? toNum(adaptiveDecision?.requestedSellLevels) ?? null;
  const minViable = toNum(config?.adaptiveRangeMinViableLevels) ?? 4;

  let maxLevelsPerSide: number | null = null;
  let maxTotalLevels: number | null = null;
  if (centerForCount != null && centerForCount > 0 && lowerForCount != null && upperForCount != null && spacingForCount != null && spacingForCount > 0) {
    const viable = countViableLevelsIterative({
      centerPrice: centerForCount,
      operationalLower: lowerForCount,
      operationalUpper: upperForCount,
      spacingPct: spacingForCount,
      configuredBuyLevels: cfgBuy ?? minViable,
      configuredSellLevels: cfgSell ?? minViable,
    });
    maxLevelsPerSide = Math.max(viable.maxBuyLevels, viable.maxSellLevels);
    maxTotalLevels = viable.totalViableLevels;
  } else if (effectiveRangePct != null && minimumProfitableSpacingPct != null && minimumProfitableSpacingPct > 0) {
    // Fallback only when we can't do iterative (missing prices)
    const semiRange = effectiveRangePct / 2;
    maxLevelsPerSide = Math.floor(semiRange / minimumProfitableSpacingPct);
    maxTotalLevels = maxLevelsPerSide * 2;
  }
  const requestedPerSide = requestedLevels != null ? Math.ceil(requestedLevels / 2) : null;

  const actualLevels = input.levels
    ? input.levels.filter((l: any) => l?.rangeVersionId === activeRangeVersionId && l?.status !== "cancelled" && l?.status !== "replaced").length
    : null;

  const spacingPct = toNum(adaptiveDecision?.spacingPct ?? professionalGenerator?.spacingPct)
    ?? (effectiveRangePct != null && maxLevelsPerSide != null && maxLevelsPerSide > 0
      ? effectiveRangePct / maxLevelsPerSide
      : null);

  let viability: EntryRangeViability = "INSUFFICIENT_DATA";
  let reasonCode: string | null = null;
  let reasonLabel = "";
  let explanation: string | null = null;

  if (active) {
    viability = "ACTIVE";
    reasonCode = resolvedRange?.status ?? "active";
    reasonLabel = "Rango activo";
    explanation = resolvedRange?.naturalReason ?? "El Grid tiene un rango activo para nuevas entradas.";
  } else if (adaptiveDecision) {
    if (adaptiveDecision.adaptiveRangeOk) {
      viability = "VIABLE";
      reasonCode = adaptiveDecision.reason ?? "adaptive_ok";
      reasonLabel = "Rango viable (no activado)";
      explanation = "El motor calculó un rango rentable, pero no lo activó automáticamente.";
    } else {
      viability = "REJECTED";
      reasonCode = adaptiveDecision.reason ?? "adaptive_not_ok";
      reasonLabel = "Rango no viable";
      const allowed = toNum(adaptiveDecision.regimeMaxPct);
      const needed = toNum(adaptiveDecision.rangeNeededForMinViableLevelsPct ?? adaptiveDecision.rangeNeededForRequestedLevelsPct);
      explanation = "Con la configuración actual el rango no permite niveles rentables.";
      if (allowed != null && needed != null) {
        explanation += ` Se necesita ~${needed.toFixed(2)}% de anchura y la configuración permite ${allowed.toFixed(2)}%.`;
      }
    }
  } else if (professionalGenerator?.available) {
    const viabilityStatus = professionalGenerator.viabilityStatus;
    if (viabilityStatus === "market_unsuitable") {
      viability = "REJECTED";
      reasonCode = professionalGenerator.reason ?? "market_unsuitable";
      reasonLabel = "Mercado no apto";
      explanation = "Las condiciones de mercado no son adecuadas para crear un rango.";
    } else if (viabilityStatus === "not_viable" || viabilityStatus === "compact") {
      viability = "REJECTED";
      reasonCode = professionalGenerator.reason ?? "compact";
      reasonLabel = "Rango muy estrecho";
      explanation = "El rango calculado es demasiado estrecho para los niveles solicitados.";
    } else {
      viability = "PENDING";
      reasonCode = professionalGenerator.reason ?? "pending";
      reasonLabel = "Rango calculado";
      explanation = "El motor calculó un rango; esperando activación o confirmación.";
    }
  } else if (currentOperationalState?.status === "shadow_compact_not_viable") {
    viability = "REJECTED";
    reasonCode = "shadow_compact_not_viable";
    reasonLabel = "Rango no viable";
    explanation = currentOperationalState.plainProblem ?? "La configuración actual no permite un rango rentable.";
  } else if (currentOperationalState?.status === "shadow_market_unsuitable") {
    viability = "REJECTED";
    reasonCode = "market_unsuitable";
    reasonLabel = "Mercado no apto";
    explanation = currentOperationalState.plainProblem ?? "Las condiciones de mercado no son adecuadas.";
  } else if (currentOperationalState?.canGenerateSimulatedRange) {
    viability = "PENDING";
    reasonCode = "pending_evaluation";
    reasonLabel = "Pendiente de evaluación";
    explanation = "Pulsa \"Analizar mercado ahora\" para generar un diagnóstico.";
  }

  const calculatedAt = toIso(lastProfessionalValidationAt) ?? toIso(professionalGenerator?.eventCreatedAt) ?? toIso(resolvedRange?.createdAt) ?? toIso(status?.lastTickAt);

  const levelDiagnostic: LevelDiagnostic | null = {
    bandWidthPct,
    operationalRangeMaxPct,
    effectiveRangePct,
    minSpacingPct: minimumProfitableSpacingPct,
    maxLevelsPerSide,
    maxTotalLevels,
    requestedPerSide,
    reason: maxLevelsPerSide != null && requestedPerSide != null && maxLevelsPerSide < requestedPerSide
      ? `El rango efectivo (${effectiveRangePct?.toFixed(2)}%) solo permite ${maxLevelsPerSide} niveles por lado, pero se solicitaron ${requestedPerSide}.`
      : "Los niveles solicitados caben en el rango efectivo.",
  };

  let levelCountExplanation: string | null = null;
  if (bandWidthPct != null && effectiveRangePct != null && minimumProfitableSpacingPct != null && maxLevelsPerSide != null) {
    const parts: string[] = [];
    parts.push(`La banda de Bollinger tiene ${bandWidthPct.toFixed(2)}% de anchura.`);
    if (enforceCompactRange && operationalRangeMaxPct != null && operationalRangeMaxPct < bandWidthPct) {
      parts.push(`Con rango compacto activado, el rango operativo se limita a ${operationalRangeMaxPct.toFixed(2)}%.`);
    }
    parts.push(`La separación mínima rentable es ${minimumProfitableSpacingPct.toFixed(2)}% (calculada con función canónica: gross target + spread buffer + safety buffer).`);
    parts.push(`En ${effectiveRangePct.toFixed(2)}% caben ${maxLevelsPerSide} niveles por lado (${maxLevelsPerSide} BUY + ${maxLevelsPerSide} SELL = ${maxLevelsPerSide * 2} totales).`);
    if (requestedLevels != null && requestedLevels > maxLevelsPerSide * 2) {
      parts.push(`Se solicitaron ${requestedLevels} niveles pero solo caben ${maxLevelsPerSide * 2}.`);
    }
    levelCountExplanation = parts.join(" ");
  }

  return {
    mode,
    active,
    activeRangeVersionId,
    configuredLower,
    configuredUpper,
    calculatedLower,
    calculatedUpper,
    calculatedWidthPct,
    requestedLevels,
    viableLevels,
    actualLevels,
    spacingPct,
    minimumProfitableSpacingPct,
    netProfitTargetPct,
    buyFeePct,
    sellFeePct,
    taxReservePct,
    gridRangeMaxPct,
    enforceCompactRange,
    viability,
    reasonCode,
    reasonLabel,
    explanation,
    levelCountExplanation,
    levelDiagnostic,
    calculatedAt,
  };
}

function rangeEnvelopeFromLevels(levels: any[], rangeVersionId: string): { lower: number | null; upper: number | null } {
  const prices: number[] = [];
  for (const l of levels || []) {
    if (l?.rangeVersionId !== rangeVersionId) continue;
    const p = toNum(l.price ?? l.buyPrice ?? l.sellPrice);
    if (p != null && p > 0) prices.push(p);
  }
  if (prices.length === 0) return { lower: null, upper: null };
  return { lower: Math.min(...prices), upper: Math.max(...prices) };
}

function rangeModeForGroup(
  rangeVersionId: string,
  activeRangeVersionId: string | null,
  resolvedRange: any,
  professionalGenerator: any
): string | null {
  if (rangeVersionId === activeRangeVersionId && resolvedRange?.method) return resolvedRange.method;
  if (professionalGenerator?.rangeVersionId === rangeVersionId) return professionalGenerator.mode ?? professionalGenerator.regime ?? null;
  return null;
}

function referenceBandSnapshotForGroup(
  rangeVersionId: string,
  activeRangeVersionId: string | null,
  resolvedRange: any,
  levels: any[]
): GridMarketReferenceBandSnapshot | null {
  // Active range band is current, not historical, so no persisted snapshot
  if (rangeVersionId !== activeRangeVersionId) {
    return null;
  }
  const lower = toNum(resolvedRange?.bandLower);
  const center = toNum(resolvedRange?.bandMiddle);
  const upper = toNum(resolvedRange?.bandUpper);
  const widthPct = toNum(resolvedRange?.bandWidthPct);
  const regime = resolvedRange?.regime ?? resolvedRange?.method ?? null;
  const atrPct = toNum(resolvedRange?.atrPct);
  const calculatedAt = toIso(resolvedRange?.createdAt);
  if (lower == null && center == null && upper == null && widthPct == null && atrPct == null) return null;
  return {
    available: true,
    lower,
    center,
    upper,
    widthPct,
    regime,
    atrPct,
    calculatedAt,
  };
}

function buildExitObligationRanges(input: BuildGridMarketViewModelInput): GridMarketExitObligationRange[] {
  const { openCycles, levels, status, resolvedRange } = input;
  const activeRangeVersionId = status?.activeRangeVersionId ?? resolvedRange?.activeRangeVersionId ?? null;
  const groups = new Map<string, any[]>();
  for (const c of openCycles || []) {
    const rvId = c?.rangeVersionId ?? "unknown";
    const list = groups.get(rvId) || [];
    list.push(c);
    groups.set(rvId, list);
  }

  const result: GridMarketExitObligationRange[] = [];
  for (const [rangeVersionId, cycles] of groups.entries()) {
    const isActive = rangeVersionId === activeRangeVersionId;
    const buyPrices = cycles.map((c) => toNum(c.buyPrice)).filter((n) => n != null) as number[];
    const targetPrices = cycles.map((c) => toNum(c.targetSellPrice)).filter((n) => n != null) as number[];

    let lowerPrice: number | null = null;
    let upperPrice: number | null = null;
    if (isActive && resolvedRange) {
      lowerPrice = toNum(resolvedRange.lowerPrice);
      upperPrice = toNum(resolvedRange.upperPrice);
    } else {
      const envelope = rangeEnvelopeFromLevels(levels, rangeVersionId);
      lowerPrice = envelope.lower;
      upperPrice = envelope.upper;
      if (lowerPrice == null && buyPrices.length > 0) lowerPrice = Math.min(...buyPrices);
      if (upperPrice == null && targetPrices.length > 0) upperPrice = Math.max(...targetPrices);
    }

    const capitalCommitted = cycles.reduce((sum, c) => {
      const buy = toNum(c.buyPrice) ?? 0;
      const qty = toNum(c.quantity) ?? 0;
      return sum + buy * qty;
    }, 0);

    const lowestBuy = buyPrices.length > 0 ? Math.min(...buyPrices) : null;
    const highestBuy = buyPrices.length > 0 ? Math.max(...buyPrices) : null;
    const lowestTarget = targetPrices.length > 0 ? Math.min(...targetPrices) : null;
    const highestTarget = targetPrices.length > 0 ? Math.max(...targetPrices) : null;

    const createdAts = cycles.map((c) => toIso(c.openedAt ?? c.createdAt)).filter(Boolean) as string[];
    const createdAt = createdAts.length > 0 ? createdAts.sort()[0] : null;

    const rangeCycles: GridMarketExitCycle[] = cycles.map((c) => ({
      cycleId: c.id ?? c.cycleNumber ?? "?",
      buyPrice: toNum(c.buyPrice) ?? 0,
      targetSellPrice: toNum(c.targetSellPrice) ?? 0,
      quantity: toNum(c.quantity) ?? 0,
      currentPrice: toNum(c.currentPrice ?? c.currentBid),
      progressPct: toNum(c.progressPct),
      distanceUsd: toNum(c.distanceUsd),
      distancePct: toNum(c.distancePct),
      estimatedGrossPnlUsd: toNum(c.estimatedGrossPnl),
      estimatedNetPnlUsd: toNum(c.estimatedNetPnl),
      status: c.statusLabel ?? c.status ?? "open",
    }));

    const shortLabel = isActive
      ? `Rango activo — ${cycles.length} ${cycles.length === 1 ? "operación pendiente" : "operaciones pendientes"}`
      : `Rango anterior — ${cycles.length} ${cycles.length === 1 ? "operación pendiente de venta" : "operaciones pendientes de venta"}`;

    result.push({
      rangeVersionId,
      shortLabel,
      rangeMode: rangeModeForGroup(rangeVersionId, activeRangeVersionId, resolvedRange, input.professionalGenerator),
      createdAt,
      lowerPrice,
      upperPrice,
      openCyclesCount: cycles.length,
      capitalCommittedUsd: capitalCommitted,
      lowestBuyPrice: lowestBuy,
      highestBuyPrice: highestBuy,
      lowestTargetSellPrice: lowestTarget,
      highestTargetSellPrice: highestTarget,
      cycles: rangeCycles,
      referenceBandSnapshot: referenceBandSnapshotForGroup(rangeVersionId, activeRangeVersionId, resolvedRange, levels),
    });
  }

  // Sort: active first, then by createdAt asc
  return result.sort((a, b) => {
    const aActive = a.rangeVersionId === activeRangeVersionId ? 1 : 0;
    const bActive = b.rangeVersionId === activeRangeVersionId ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
  });
}

function buildRecommendation(input: BuildGridMarketViewModelInput): GridMarketRecommendation | null {
  const rec = (input.recommendations ?? [])[0];
  if (!rec) return null;

  const ad = input.adaptiveDecision;
  const pg = input.professionalGenerator;
  const suggestedLevels =
    rec.suggestedLevels ??
    toNum(ad?.levelsWouldFitAtFinalRange) ??
    toNum(ad?.buyLevelsWouldFit && ad?.sellLevelsWouldFit ? ad.buyLevelsWouldFit + ad.sellLevelsWouldFit : null) ??
    toNum(pg?.generatedBuyLevels && pg?.generatedSellLevels ? pg.generatedBuyLevels + pg.generatedSellLevels : null) ??
    null;

  const suggestedLower = toNum(rec.suggestedLower ?? ad?.operationalLower ?? pg?.operationalLower);
  const suggestedUpper = toNum(rec.suggestedUpper ?? ad?.operationalUpper ?? pg?.operationalUpper);

  const repetitionCount =
    rec.repetitionCount ??
    toNum(input.currentOperationalState?.repeatedCompactEventsCount) ??
    toNum(input.status?.repeatedCompactEventsCount) ??
    null;

  const lastDetectedAt =
    toIso(input.lastProfessionalValidationAt) ??
    toIso(input.lastShadowValidationAt) ??
    toIso(rec.lastDetectedAt) ??
    null;

  return {
    title: rec.title ?? rec.id ?? "Recomendación",
    explanation: rec.plainExplanation ?? rec.explanation ?? null,
    consequence: rec.expectedImpact ?? rec.consequence ?? null,
    action: rec.ctaApply ?? rec.action ?? null,
    suggestedLevels,
    suggestedLower,
    suggestedUpper,
    repetitionCount,
    lastDetectedAt,
    technicalCode: rec.id ?? rec.technicalCode ?? input.currentOperationalState?.status ?? null,
  };
}

export function buildGridMarketViewModel(input: BuildGridMarketViewModelInput): GridMarketViewModel {
  const current = buildCurrent(input);
  return {
    pair: input.pair,
    current,
    entryRange: buildEntryRange(input),
    exitObligationRanges: buildExitObligationRanges(input),
    recommendation: buildRecommendation(input),
    configurationRecommendation: current.configurationRecommendation,
    executionGate: current.executionGate,
  };
}
