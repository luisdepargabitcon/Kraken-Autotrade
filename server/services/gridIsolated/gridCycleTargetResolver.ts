/**
 * GridCycleTargetResolver — Pure service for BUY→SELL target association.
 *
 * Rules:
 *   - Same original rangeVersionId as the cycle.
 *   - Range pair must match cycle pair.
 *   - SELL side only.
 *   - SELL price must be strictly greater than cycle buyPrice.
 *   - Quantity must match within a strict BTC tolerance.
 *   - SELL must not already be claimed as target by another open cycle.
 *   - Exactly one candidate must remain after filtering; otherwise review is required.
 *
 * This module is PURE: no side effects, no DB, no exchange calls, no clock.
 */

import type { GridCycle, GridLevel, GridRangeVersion } from "./gridIsolatedTypes";

export interface TargetSellResolution {
  resolved: boolean;
  uniqueMatch: boolean;
  candidateCount: number;
  targetSellLevelId: string | null;
  targetSellPrice: number | null;
  targetSellQuantity: number | null;
  reason: string;
  requiresReview: boolean;
}

export interface ResolveTargetSellInput {
  cycle: GridCycle;
  levels: GridLevel[];
  rangeVersions: GridRangeVersion[];
  alreadyClaimedSellIds?: ReadonlySet<string>;
}

// Strict quantity tolerance for BTC-sized quantities.
const QUANTITY_TOLERANCE = 0.000000015;

export function resolveTargetSellForCycle(input: ResolveTargetSellInput): TargetSellResolution {
  const { cycle, levels, rangeVersions, alreadyClaimedSellIds = new Set() } = input;

  if (!cycle.buyPrice || cycle.buyPrice <= 0 || cycle.quantity <= 0) {
    return {
      resolved: false,
      uniqueMatch: false,
      candidateCount: 0,
      targetSellLevelId: null,
      targetSellPrice: null,
      targetSellQuantity: null,
      reason: "Ciclo sin precio de compra o cantidad válidos.",
      requiresReview: true,
    };
  }

  const rangeVersion = rangeVersions.find(rv => rv.id === cycle.rangeVersionId);
  if (!rangeVersion) {
    return {
      resolved: false,
      uniqueMatch: false,
      candidateCount: 0,
      targetSellLevelId: null,
      targetSellPrice: null,
      targetSellQuantity: null,
      reason: `No se encontró la versión de rango ${cycle.rangeVersionId} del ciclo.`,
      requiresReview: true,
    };
  }

  if (rangeVersion.pair !== cycle.pair) {
    return {
      resolved: false,
      uniqueMatch: false,
      candidateCount: 0,
      targetSellLevelId: null,
      targetSellPrice: null,
      targetSellQuantity: null,
      reason: `Par del rango (${rangeVersion.pair}) no coincide con el par del ciclo (${cycle.pair}).`,
      requiresReview: true,
    };
  }

  const candidates = levels.filter(level => {
    if (level.rangeVersionId !== cycle.rangeVersionId) return false;
    if (level.side !== "SELL") return false;
    if (level.price <= cycle.buyPrice!) return false;
    if (alreadyClaimedSellIds.has(level.id)) return false;

    const levelQty = level.quantity;
    const cycleQty = cycle.quantity;
    if (!Number.isFinite(levelQty) || !Number.isFinite(cycleQty)) return false;
    return Math.abs(levelQty - cycleQty) <= QUANTITY_TOLERANCE;
  });

  if (candidates.length === 0) {
    return {
      resolved: false,
      uniqueMatch: false,
      candidateCount: 0,
      targetSellLevelId: null,
      targetSellPrice: null,
      targetSellQuantity: null,
      reason: "No existe ninguna SELL del rango con quantity compatible y precio superior al BUY.",
      requiresReview: true,
    };
  }

  if (candidates.length > 1) {
    return {
      resolved: false,
      uniqueMatch: false,
      candidateCount: candidates.length,
      targetSellLevelId: null,
      targetSellPrice: null,
      targetSellQuantity: null,
      reason: `Existen ${candidates.length} SELL candidatas compatibles. Se requiere revisión manual para evitar asociación ambigua.`,
      requiresReview: true,
    };
  }

  const chosen = candidates[0];
  return {
    resolved: true,
    uniqueMatch: true,
    candidateCount: 1,
    targetSellLevelId: chosen.id,
    targetSellPrice: chosen.price,
    targetSellQuantity: chosen.quantity,
    reason: "Asociación BUY→SELL objetivo única y compatible.",
    requiresReview: false,
  };
}

/**
 * Build a Set of level IDs already claimed as targetSellLevelId by other open cycles.
 */
export function buildClaimedSellIds(
  cycles: readonly GridCycle[],
  excludeCycleId?: string
): Set<string> {
  const ids = new Set<string>();
  for (const cycle of cycles) {
    if (excludeCycleId && cycle.id === excludeCycleId) continue;
    if (cycle.targetSellLevelId) {
      ids.add(cycle.targetSellLevelId);
    }
  }
  return ids;
}
