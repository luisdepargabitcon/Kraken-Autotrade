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

export interface ShadowOpenCycleDiagnosisItem {
  id: string;
  cycleNumber: number;
  status: GridCycleStatus;
  pair: string;
  rangeVersionId: string;
  buyPrice: number | null;
  quantity: number;
  buyFilledAt: Date | null;
  targetSellLevelId: string | null;
  targetSellPrice: number | null;
  targetSellQuantity: number | null;
  targetSource: "range" | "external" | "missing" | null;
  levelStatus: "active" | "historical" | "missing";
  currentBid: number | null;
  currentAsk: number | null;
  wouldCloseNow: boolean;
  eligibleToClose: boolean;
  reason: string;
  requiresReview: boolean;
  targetResolutionReason: string | null;
}

export interface ShadowOpenCycleDiagnosisResult {
  mode: string;
  activeRangeVersionId: string | null;
  currentPrice: number | null;
  currentBid: number | null;
  currentAsk: number | null;
  priceSource: string;
  totalOpen: number;
  eligibleToClose: number;
  wouldCloseNow: number;
  missingTarget: number;
  inHodlRecovery: number;
  requiresReview: number;
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

function levelStatus(
  targetLevelId: string | null,
  levels: GridLevel[],
  activeRangeVersionId: string | null
): "active" | "historical" | "missing" {
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
 * @param activeRangeVersionId currently active range version id, or null
 * @param priceResult current SHADOW execution price (bid/ask/source)
 * @param mode current engine mode
 * @param rangeVersion active range version (used to resolve missing targets), or null
 */
export function diagnoseShadowOpenCycles(
  cycles: GridCycle[],
  levels: GridLevel[],
  activeRangeVersionId: string | null,
  priceResult: GridShadowExecutionPriceResult,
  mode: string,
  rangeVersion?: GridRangeVersion | null
): ShadowOpenCycleDiagnosisResult {
  const currentBid = priceResult.bid ?? null;
  const currentAsk = priceResult.ask ?? null;
  const currentPrice = priceResult.price ?? currentBid;
  const priceSource = priceResult.source ?? "unknown";

  const openCycles = cycles.filter((c) =>
    OPEN_POSITION_GRID_CYCLE_STATUSES.includes(c.status as any)
  );

  const claimedIds = buildClaimedSellIds(cycles);
  const rangeVersions = rangeVersion ? [rangeVersion] : activeRangeVersionId
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
    let targetSource: "range" | "external" | "missing" | null = targetLevelId
      ? isTargetFromRange(cycle, targetLevelId, levels)
        ? "range"
        : "external"
      : "missing";
    let targetResolutionReason: string | null = null;

    // If target not persisted, try to resolve from the active range for diagnostics only
    if (!targetLevelId || targetPrice == null || targetQty == null) {
      const resolution = resolveTargetSellForCycle({
        cycle,
        levels,
        rangeVersions,
        alreadyClaimedSellIds: claimedIds,
      });
      targetResolutionReason = resolution.reason;
      if (resolution.resolved && !resolution.requiresReview) {
        targetLevelId = resolution.targetSellLevelId;
        targetPrice = resolution.targetSellPrice;
        targetQty = resolution.targetSellQuantity;
        targetSource = "range";
        if (targetLevelId) claimedIds.add(targetLevelId);
      }
    }

    const hasTarget = targetLevelId != null && targetPrice != null && targetQty != null;
    if (!hasTarget) missingTarget++;

    const eligible =
      mode === "SHADOW" &&
      isClosableStatus &&
      hasTarget &&
      !isHodl;

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
      mode !== "SHADOW";

    if (itemRequiresReview) requiresReview++;

    details.push({
      id: cycle.id,
      cycleNumber: cycle.cycleNumber,
      status: cycle.status,
      pair: cycle.pair,
      rangeVersionId: cycle.rangeVersionId,
      buyPrice: cycle.buyPrice ?? null,
      quantity: cycle.quantity,
      buyFilledAt: cycle.buyFilledAt ?? null,
      targetSellLevelId: targetLevelId,
      targetSellPrice: targetPrice,
      targetSellQuantity: targetQty,
      targetSource,
      levelStatus: levelStatus(targetLevelId, levels, activeRangeVersionId),
      currentBid,
      currentAsk,
      wouldCloseNow: wouldClose,
      eligibleToClose: eligible,
      reason,
      requiresReview: itemRequiresReview,
      targetResolutionReason,
    });
  }

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
    totalOpen: openCycles.length,
    eligibleToClose,
    wouldCloseNow,
    missingTarget,
    inHodlRecovery,
    requiresReview,
    realOrdersAffected: false,
    readOnly: true,
    recommendation,
    cycles: details,
  };
}
