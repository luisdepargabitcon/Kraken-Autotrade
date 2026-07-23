/**
 * GridShadowOpenCycleDiagnosis — Read-only diagnostic for open SHADOW cycles.
 *
 * This helper mirrors the close eligibility logic used by processOpenCyclesShadow()
 * without mutating state, placing orders, or writing to the DB.
 */

import type { GridCycle, GridCycleStatus, GridLevel, GridRangeVersion } from "./gridIsolatedTypes";
import {
  OPEN_POSITION_GRID_CYCLE_STATUSES,
  POSITION_OPEN_GRID_CYCLE_STATUSES,
  NON_TARGET_SELL_CLOSABLE_STATUSES,
} from "./gridIsolatedTypes";
import { resolveTargetSellForCycle, buildClaimedSellIds } from "./gridCycleTargetResolver";
import type { GridShadowExecutionPriceResult } from "./gridShadowExecutionPrice";
import { evaluateShadowMarketPriceFreshness, GRID_SHADOW_PRICE_MAX_AGE_MS } from "./gridShadowMarketPriceFreshness";

export interface ShadowOpenCycleDiagnosisItem {
  id: string;
  cycleNumber: number;
  status: GridCycleStatus;
  lifecycleState: GridCycleStatus;
  pair: string;
  rangeVersionId: string;
  rangeRelation: "active" | "previous";
  buyPrice: number | null;
  quantity: number;
  buyFilledAt: Date | null;
  targetSellLevelId: string | null;
  targetSellPrice: number | null;
  targetSellQuantity: number | null;
  targetSource: "synthetic" | "persisted_sell" | "external" | "missing" | null;
  levelStatus: "active" | "historical" | "missing" | "not_applicable";
  currentBid: number | null;
  currentAsk: number | null;
  wouldCloseNow: boolean;
  eligibleToClose: boolean;
  reason: string;
  requiresReview: boolean;
  targetResolutionReason: string | null;
  exitPolicyVersion: string | null;
  targetKind: string | null;
  targetRungLevelId: string | null;
  targetStructurallyValid: boolean;
}

export interface ShadowOpenCycleDiagnosisResult {
  mode: string;
  activeRangeVersionId: string | null;
  currentPrice: number | null;
  currentBid: number | null;
  currentAsk: number | null;
  priceSource: string;
  priceTimestamp: string | null;
  priceStale: boolean;
  priceFresh: boolean;
  priceAgeMs: number | null;
  priceMaxAgeMs: number;
  priceStaleReason: string | null;
  totalOpen: number;
  eligibleToClose: number;
  wouldCloseNow: number;
  cyclesEligibleForSimulatedClose: number;
  executableOpenCyclesCount: number;
  waitingSellCyclesCount: number;
  previousRangeOpenCyclesCount: number;
  missingTarget: number;
  inHodlRecovery: number;
  requiresReview: number;
  reviewRequiredCyclesCount: number;
  realOrdersAffected: false;
  readOnly: true;
  recommendation: string;
  cycles: ShadowOpenCycleDiagnosisItem[];
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function findLevel(levels: GridLevel[], id: string | null): GridLevel | undefined {
  if (!id) return undefined;
  return levels.find((l) => l.id === id);
}

function isTargetFromRange(
  cycle: GridCycle,
  targetLevelId: string | null,
  levels: GridLevel[]
): boolean {
  if (!targetLevelId) return false;
  const level = findLevel(levels, targetLevelId);
  if (!level) return false;
  return level.rangeVersionId === cycle.rangeVersionId && level.side === "SELL";
}

function levelStatusFor(
  targetLevelId: string | null,
  levels: GridLevel[],
  activeRangeVersionId: string | null,
  isSyntheticRung: boolean
): "active" | "historical" | "missing" | "not_applicable" {
  if (isSyntheticRung && !targetLevelId) return "not_applicable";
  const level = findLevel(levels, targetLevelId);
  if (!level) return "missing";
  if (activeRangeVersionId && level.rangeVersionId === activeRangeVersionId) return "active";
  return "historical";
}

/**
 * Diagnose all open cycles (including HODL recovery) in a read-only manner.
 *
 * @param cycles all cycles from the engine
 * @param levels all levels from the engine
 * @param priceResult current SHADOW execution price (bid/ask/source)
 * @param mode current engine mode
 * @param activeRangeVersion currently active range version object, or null
 * @param rangeVersions all range versions referenced by open cycles (used to resolve missing targets)
 */
export function diagnoseShadowOpenCycles(
  cycles: GridCycle[],
  levels: GridLevel[],
  activeRangeVersionId: string | null,
  priceResult: GridShadowExecutionPriceResult,
  mode: string,
  activeRangeVersion?: GridRangeVersion | null,
  rangeVersions?: GridRangeVersion[]
): ShadowOpenCycleDiagnosisResult {
  const currentBid = priceResult.bid ?? null;
  const currentAsk = priceResult.ask ?? null;
  const currentPrice = priceResult.price ?? currentBid;
  const priceSource = priceResult.source ?? "unknown";
  const priceTimestamp = priceResult.timestamp ?? null;
  const freshness = evaluateShadowMarketPriceFreshness({
    timestamp: priceTimestamp,
    maxAgeMs: GRID_SHADOW_PRICE_MAX_AGE_MS,
  });
  const priceFresh = freshness.isFresh;
  const priceStale = !freshness.isFresh;
  const priceAgeMs = freshness.ageMs;
  const priceMaxAgeMs = freshness.maxAgeMs;
  const priceStaleReason = freshness.reason;

  const openCycles = cycles.filter((c) =>
    OPEN_POSITION_GRID_CYCLE_STATUSES.includes(c.status as any)
  );

  const claimedIds = buildClaimedSellIds(cycles);
  const effectiveRangeVersions =
    (rangeVersions && rangeVersions.length > 0)
      ? rangeVersions
      : activeRangeVersion
        ? [activeRangeVersion]
        : activeRangeVersionId
          ? [{ id: activeRangeVersionId, pair: cycles[0]?.pair ?? "" } as GridRangeVersion]
          : [];

  const details: ShadowOpenCycleDiagnosisItem[] = [];
  let eligibleToClose = 0;
  let wouldCloseNow = 0;
  let missingTarget = 0;
  let inHodlRecovery = 0;
  let requiresReview = 0;

  for (const cycle of openCycles) {
    const isHodl = cycle.status === "hodl_recovery";
    const isTerminalLike = NON_TARGET_SELL_CLOSABLE_STATUSES.includes(cycle.status as any);
    const isClosableStatus = POSITION_OPEN_GRID_CYCLE_STATUSES.includes(cycle.status as any);

    if (isHodl) inHodlRecovery++;

    // Base target info (persisted)
    let targetLevelId = cycle.targetSellLevelId ?? null;
    let targetPrice = cycle.targetSellPrice ?? null;
    let targetQty = cycle.targetSellQuantity ?? null;

    // Strict classification: a cycle is only synthetic if it is explicitly
    // tagged as SYNTHETIC_RUNG (with null sellLevelId and non-null rungId),
    // or if it is a compatible V2 cycle with no persisted SELL level but a
    // valid rung reference.
    // A SYNTHETIC_RUNG with sellLevelId!=null or rungId==null is incoherent.
    // A legacy PERSISTED_SELL cycle with targetRungLevelId set must NOT be
    // reclassified as synthetic.
    const isInconsistentSynthetic =
      cycle.targetKind === "SYNTHETIC_RUNG" &&
      (cycle.targetSellLevelId != null || cycle.targetRungLevelId == null);
    const isExplicitSynthetic =
      cycle.targetKind === "SYNTHETIC_RUNG" && !isInconsistentSynthetic;
    const isCompatibleV2Synthetic =
      cycle.targetKind == null &&
      cycle.exitPolicyVersion === "FIRST_PROFITABLE_HIGHER_RUNG_V2" &&
      cycle.targetSellLevelId == null &&
      cycle.targetRungLevelId != null;
    const isSyntheticRung = isExplicitSynthetic || isCompatibleV2Synthetic;

    // Detect inconsistent states: PERSISTED_SELL with null targetSellLevelId
    // should not be silently reinterpreted as V2.
    const isInconsistentLegacy =
      cycle.targetKind === "PERSISTED_SELL" && cycle.targetSellLevelId == null;

    let targetSource: "synthetic" | "persisted_sell" | "external" | "missing" | null;
    let targetResolutionReason: string | null = null;

    if (isInconsistentSynthetic) {
      targetSource = "missing";
      if (cycle.targetSellLevelId != null && cycle.targetRungLevelId == null) {
        targetResolutionReason = "SYNTHETIC_RUNG con targetSellLevelId informado y targetRungLevelId=null: estado incoherente";
      } else if (cycle.targetSellLevelId != null) {
        targetResolutionReason = "SYNTHETIC_RUNG con targetSellLevelId informado: estado incoherente";
      } else {
        targetResolutionReason = "SYNTHETIC_RUNG sin targetRungLevelId: estado incoherente";
      }
    } else if (isInconsistentLegacy) {
      targetSource = "missing";
      targetResolutionReason = "PERSISTED_SELL con targetSellLevelId=null: estado inconsistente";
    } else if (isSyntheticRung) {
      targetSource = targetPrice != null && targetQty != null && cycle.targetRungLevelId != null
        ? "synthetic"
        : "missing";
    } else if (targetLevelId) {
      targetSource = isTargetFromRange(cycle, targetLevelId, levels) ? "persisted_sell" : "external";
    } else {
      targetSource = "missing";
    }

    // If target not persisted, try to resolve from the active range for diagnostics only.
    // Skip legacy resolver for V2 SYNTHETIC_RUNG cycles and all inconsistent states.
    if (!isSyntheticRung && !isInconsistentLegacy && !isInconsistentSynthetic && (!targetLevelId || targetPrice == null || targetQty == null)) {
      const resolution = resolveTargetSellForCycle({
        cycle,
        levels,
        rangeVersions: effectiveRangeVersions,
        alreadyClaimedSellIds: claimedIds,
      });
      targetResolutionReason = resolution.reason;
      if (resolution.resolved && !resolution.requiresReview) {
        targetLevelId = resolution.targetSellLevelId;
        targetPrice = resolution.targetSellPrice;
        targetQty = resolution.targetSellQuantity;
        targetSource = "persisted_sell";
        if (targetLevelId) claimedIds.add(targetLevelId);
      }
    }

    const targetStructurallyValid =
      (isSyntheticRung || targetLevelId != null) &&
      targetPrice != null &&
      targetQty != null &&
      !isInconsistentLegacy &&
      !isInconsistentSynthetic;
    const hasTarget = targetStructurallyValid;
    if (!hasTarget) missingTarget++;

    const eligible =
      mode === "SHADOW" &&
      isClosableStatus &&
      hasTarget &&
      !isHodl &&
      priceFresh &&
      (priceResult.pair == null || priceResult.pair === cycle.pair);

    const wouldClose = Boolean(
      eligible &&
      currentBid != null &&
      targetPrice != null &&
      currentBid >= targetPrice
    );

    if (eligible) eligibleToClose++;
    if (wouldClose) wouldCloseNow++;

    let reason = "";
    if (mode !== "SHADOW") {
      reason = "Solo se procesan cierres simulados en modo SHADOW.";
    } else if (isHodl) {
      reason = "Ciclo en HODL_RECOVERY; se excluye del cierre automático y requiere revisión.";
    } else if (!isClosableStatus) {
      reason = `Estado '${cycle.status}' no admite cierre automático por SELL objetivo en esta fase.`;
    } else if (!hasTarget) {
      reason = targetResolutionReason ?? "No se pudo resolver target SELL para este ciclo.";
    } else if (currentBid == null) {
      reason = "No hay bid de mercado disponible; no se puede evaluar cierre.";
    } else if (currentBid < targetPrice!) {
      reason = `Target SELL (${targetPrice}) no alcanzado por bid actual (${currentBid}).`;
    } else {
      reason = `Se cerraría ahora en SHADOW: bid (${currentBid}) >= target SELL (${targetPrice}).`;
    }

    const itemRequiresReview =
      isHodl ||
      !isClosableStatus ||
      !hasTarget ||
      mode !== "SHADOW" ||
      isInconsistentLegacy ||
      isInconsistentSynthetic;

    if (itemRequiresReview) requiresReview++;

    const rangeRelation: "active" | "previous" =
      cycle.rangeVersionId === activeRangeVersionId ? "active" : "previous";

    details.push({
      id: cycle.id,
      cycleNumber: cycle.cycleNumber,
      status: cycle.status,
      lifecycleState: cycle.status,
      pair: cycle.pair,
      rangeVersionId: cycle.rangeVersionId,
      rangeRelation,
      buyPrice: cycle.buyPrice ?? null,
      quantity: cycle.quantity,
      buyFilledAt: cycle.buyFilledAt ?? null,
      targetSellLevelId: targetLevelId,
      targetSellPrice: targetPrice,
      targetSellQuantity: targetQty,
      targetSource,
      levelStatus: levelStatusFor(targetLevelId, levels, activeRangeVersionId, isSyntheticRung),
      currentBid,
      currentAsk,
      wouldCloseNow: wouldClose,
      eligibleToClose: eligible,
      reason,
      requiresReview: itemRequiresReview,
      targetResolutionReason,
      exitPolicyVersion: cycle.exitPolicyVersion ?? null,
      targetKind: cycle.targetKind ?? null,
      targetRungLevelId: cycle.targetRungLevelId ?? null,
      targetStructurallyValid,
    });
  }

  const executableOpenCyclesCount = details.filter(
    (d) => d.targetStructurallyValid && !d.requiresReview
  ).length;
  const waitingSellCyclesCount = openCycles.length;
  const previousRangeOpenCyclesCount = activeRangeVersionId
    ? openCycles.filter((c) => c.rangeVersionId !== activeRangeVersionId).length
    : openCycles.length;
  const reviewRequiredCyclesCount = requiresReview;

  const recommendation =
    mode !== "SHADOW"
      ? "El modo actual no es SHADOW; los cierres simulados están inactivos."
      : wouldCloseNow > 0
      ? `${wouldCloseNow} ciclo(s) se cerrarían ahora en SHADOW. Verificar que el motor esté activo para que processOpenCyclesShadow los cierre transaccionalmente.`
      : requiresReview > 0
      ? `${requiresReview} ciclo(s) requieren revisión antes de poder cerrarse automáticamente.`
      : "No hay ciclos abiertos que requieran atención inmediata.";

  return {
    mode,
    activeRangeVersionId,
    currentPrice,
    currentBid,
    currentAsk,
    priceSource,
    priceTimestamp,
    priceStale,
    priceFresh,
    priceAgeMs,
    priceMaxAgeMs,
    priceStaleReason,
    totalOpen: openCycles.length,
    eligibleToClose,
    wouldCloseNow,
    cyclesEligibleForSimulatedClose: wouldCloseNow,
    executableOpenCyclesCount,
    waitingSellCyclesCount,
    previousRangeOpenCyclesCount,
    missingTarget,
    inHodlRecovery,
    requiresReview,
    reviewRequiredCyclesCount,
    realOrdersAffected: false,
    readOnly: true,
    recommendation,
    cycles: details,
  };
}
