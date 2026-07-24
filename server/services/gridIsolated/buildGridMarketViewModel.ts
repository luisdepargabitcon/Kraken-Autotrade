/**
 * buildGridMarketViewModel.ts
 *
 * Builds the canonical `operational.market` view model consumed by the
 * Grid "Mercado" tab. It is pure: no DB access, no side effects, no trading logic.
 */

import { type ExecutionPolicy, executionPolicyLabel } from "./gridIsolatedTypes";

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
  updatedAt: string | null;
}

export interface GridMarketBand {
  lower: number | null;
  center: number | null;
  upper: number | null;
  widthPct: number | null;
  position: string | null;
  positionPct: number | null; // clamped 0-100 for UI
  rawPositionPct: number | null;
  atrPct: number | null;
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
  spreadPct: number | null;
  regime: GridMarketRegime;
  band: GridMarketBand;
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
  spacingPct: number | null;
  minimumProfitableSpacingPct: number | null;
  netProfitTargetPct: number | null;
  viability: EntryRangeViability;
  reasonCode: string | null;
  reasonLabel: string | null;
  explanation: string | null;
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
  if (c.includes("LATERAL") || c === "RANGE" || c === "LATERAL") return "RANGE";
  if (c.includes("TENDENCIA_ALCISTA") || c.includes("ALCISTA") || c.includes("BULLISH")) return "TREND_UP";
  if (c.includes("TENDENCIA_BAJISTA") || c.includes("BAJISTA") || c.includes("BEARISH")) return "TREND_DOWN";
  if (c.includes("TRANSICION") || c === "TRANSITION") return "TRANSITION";
  if (c.includes("PUMP") || c.includes("DUMP") || c.includes("UNSUITABLE")) return "UNSUITABLE";
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
  const reason =
    adaptiveDecision?.reason ??
    professionalGenerator?.reason ??
    resolvedRange?.naturalReason ??
    status?.lastTickReason ??
    null;
  return {
    code: code === "UNKNOWN" ? null : code,
    label: regimeLabel(code),
    direction: regimeDirection(code),
    confidencePct: marketContext?.regimeConfidencePct ?? adaptiveDecision?.confidencePct ?? null,
    reason,
    updatedAt: toIso(lastProfessionalValidationAt) ?? toIso(status?.lastTickAt) ?? toIso(marketContext?.updatedAt),
  };
}

function buildCurrent(input: BuildGridMarketViewModelInput): GridMarketCurrent {
  const { marketContext, status } = input;
  const currentPrice = toNum(marketContext?.currentPrice ?? status?.currentPrice ?? status?.lastPrice);
  const currentBid = toNum(marketContext?.currentBid ?? marketContext?.bid ?? status?.currentBid);
  const currentAsk = toNum(marketContext?.currentAsk ?? marketContext?.ask ?? status?.currentAsk);
  const spreadPct = toNum(marketContext?.spreadPct);
  const source = marketContext?.priceSource ?? marketContext?.source ?? status?.priceSource ?? status?.currentPriceSource ?? null;
  const fresh = marketContext?.priceFresh ?? status?.priceFresh ?? false;
  const ageMs = toNum(marketContext?.priceAgeMs ?? status?.priceAgeMs);
  const maxAgeMs = toNum(marketContext?.priceMaxAgeMs ?? status?.priceMaxAgeMs);
  const updatedAt = toIso(marketContext?.updatedAt ?? status?.lastTickAt);

  const bandFromContext = marketContext?.band ?? {};
  const bandLower = toNum(bandFromContext.lower ?? input.resolvedRange?.lowerPrice);
  const bandUpper = toNum(bandFromContext.upper ?? input.resolvedRange?.upperPrice);
  const bandCenter = toNum(bandFromContext.center ?? input.resolvedRange?.centerPrice ??
    (bandLower != null && bandUpper != null ? (bandLower + bandUpper) / 2 : null));
  const bandWidthPct = toNum(bandFromContext.widthPct ?? input.resolvedRange?.widthPct ??
    (bandLower != null && bandUpper != null && bandCenter != null && bandCenter > 0
      ? ((bandUpper - bandLower) / bandCenter) * 100
      : null));

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

  return {
    updatedAt,
    fresh,
    ageMs,
    maxAgeMs,
    source,
    price: currentPrice,
    bid: currentBid,
    ask: currentAsk,
    spreadPct,
    regime: resolveRegime(
      marketContext,
      input.adaptiveDecision,
      input.professionalGenerator,
      input.resolvedRange,
      status,
      input.lastProfessionalValidationAt
    ),
    band: {
      lower: bandLower,
      center: bandCenter,
      upper: bandUpper,
      widthPct: bandWidthPct,
      position: translateBandPosition(position),
      positionPct,
      rawPositionPct,
      atrPct: toNum(marketContext?.atrPct ?? status?.bandAtrPct),
    },
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
  const spacingPct = toNum(adaptiveDecision?.spacingPct ?? professionalGenerator?.spacingPct);
  const minimumProfitableSpacingPct = toNum(
    adaptiveDecision?.minSpacingPctReal ?? professionalGenerator?.minSpacingPctReal
  );
  const netProfitTargetPct = toNum(config?.netProfitTargetPct);

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
    spacingPct,
    minimumProfitableSpacingPct,
    netProfitTargetPct,
    viability,
    reasonCode,
    reasonLabel,
    explanation,
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
  return {
    pair: input.pair,
    current: buildCurrent(input),
    entryRange: buildEntryRange(input),
    exitObligationRanges: buildExitObligationRanges(input),
    recommendation: buildRecommendation(input),
  };
}
