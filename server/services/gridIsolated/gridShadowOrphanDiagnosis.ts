import type { GridCycle, GridLevel } from "./gridIsolatedTypes";
import { OPEN_POSITION_GRID_CYCLE_STATUSES } from "./gridIsolatedTypes";

export interface ShadowOrphanCycleDiagnosis {
  id: string;
  cycleNumber: number;
  status: string;
  rangeVersionId: string;
  buyPrice: number | null;
  sellPrice: number | null;
  targetSellPrice: number | null;
  currentPrice: number | null;
  wouldCloseNow: boolean;
  reasonNotClosed: string;
  safeToArchive: boolean;
  buyLevelId: string | null;
  sellLevelId: string | null;
  targetSellLevelId: string | null;
  hasResolvedTarget: boolean;
  targetResolvableByRange: boolean;
}

export interface ShadowOrphanDiagnosisResult {
  mode: string;
  activeRangeVersionId: string | null;
  currentPrice: number | null;
  cyclesOrphanCount: number;
  cyclesWithoutResolvedTarget: number;
  cyclesWithTargetResolutionPossible: number;
  cyclesEligibleForSimulatedClose: number;
  realOrdersAffected: false;
  readOnly: true;
  recommendation: string;
  orphanCycles: ShadowOrphanCycleDiagnosis[];
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

function isCycleOpen(c: GridCycle): boolean {
  return OPEN_POSITION_GRID_CYCLE_STATUSES.includes(c.status as any);
}

function levelHasRealOrder(level: GridLevel | undefined): boolean {
  if (!level) return false;
  return level.exchangeOrderId != null && level.exchangeOrderId !== "";
}

function findLevel(levels: GridLevel[], id: string | null): GridLevel | undefined {
  if (!id) return undefined;
  return levels.find(l => l.id === id);
}

/**
 * Diagnoses orphan/historical SHADOW cycles without any side effects.
 *
 * An orphan cycle is an open cycle whose rangeVersionId does not match the
 * active range. In SHADOW mode these cycles are intentionally NOT closed
 * automatically because the active range has changed and the levels that
 * would trigger the exit are no longer managed by the current strategy.
 *
 * This helper is read-only and safe to call from diagnostics endpoints.
 */
export function diagnoseShadowOrphanCycles(
  cycles: GridCycle[],
  levels: GridLevel[],
  activeRangeVersionId: string | null,
  currentPrice: number | null,
  mode: string = "SHADOW"
): ShadowOrphanDiagnosisResult {
  const orphanCycles = cycles.filter(c =>
    isCycleOpen(c) &&
    (activeRangeVersionId == null || c.rangeVersionId !== activeRangeVersionId)
  );

  const cyclesWithTargetResolutionPossible = orphanCycles.filter(cycle =>
    levels.some(l =>
      l.rangeVersionId === cycle.rangeVersionId &&
      l.side === "SELL" &&
      l.price > (toNum(cycle.buyPrice) ?? 0) &&
      l.quantity > 0
    )
  ).length;

  const orphanDetails: ShadowOrphanCycleDiagnosis[] = orphanCycles.map(cycle => {
    const buyLevel = findLevel(levels, cycle.buyLevelId);
    const sellLevel = findLevel(levels, cycle.sellLevelId);
    const targetSellLevel = findLevel(levels, cycle.targetSellLevelId);
    const buyPrice = toNum(cycle.buyPrice) ?? toNum(buyLevel?.price);
    const sellPrice = toNum(cycle.sellPrice) ?? toNum(sellLevel?.price) ?? toNum(cycle.targetSellPrice) ?? toNum(targetSellLevel?.price);
    const targetSellPrice = toNum(cycle.targetSellPrice) ?? toNum(targetSellLevel?.price);

    const wouldCloseNow = Boolean(
      currentPrice != null &&
      targetSellPrice != null &&
      buyPrice != null &&
      cycle.status === "buy_filled" &&
      currentPrice >= targetSellPrice
    );

    let reasonNotClosed = "Ciclo fuera del rango activo; no se cierra automáticamente sin rango vigente.";
    if (mode !== "SHADOW") {
      reasonNotClosed = "Solo se procesan cierres simulados en modo SHADOW.";
    } else if (activeRangeVersionId == null) {
      reasonNotClosed = "No hay rango activo cargado en runtime; el motor no puede emparejar una venta SHADOW con este ciclo.";
    } else if (cycle.rangeVersionId !== activeRangeVersionId) {
      reasonNotClosed = `El ciclo pertenece al rango ${cycle.rangeVersionId.slice(0, 8)}..., no al rango activo ${activeRangeVersionId.slice(0, 8)}...; se ignoran fills de niveles históricos.`;
    }

    const safeToArchive = !levelHasRealOrder(buyLevel) && !levelHasRealOrder(sellLevel);
    const targetResolvableByRange = levels.some(l =>
      l.rangeVersionId === cycle.rangeVersionId &&
      l.side === "SELL" &&
      l.price > (buyPrice ?? 0) &&
      l.quantity > 0
    );

    return {
      id: cycle.id,
      cycleNumber: cycle.cycleNumber,
      status: cycle.status,
      rangeVersionId: cycle.rangeVersionId,
      buyPrice,
      sellPrice,
      targetSellPrice,
      currentPrice,
      wouldCloseNow,
      reasonNotClosed,
      safeToArchive,
      buyLevelId: cycle.buyLevelId,
      sellLevelId: cycle.sellLevelId,
      targetSellLevelId: cycle.targetSellLevelId,
      hasResolvedTarget: targetSellLevel != null || targetSellPrice != null,
      targetResolvableByRange,
    };
  });

  const cyclesWithoutResolvedTarget = orphanDetails.filter(c => c.hasResolvedTarget === false).length;

  const eligibleCount = orphanDetails.filter(c => c.wouldCloseNow).length;

  const recommendation = activeRangeVersionId == null
    ? `Hay ${orphanCycles.length} ciclos orphan/históricos abiertos (${cyclesWithoutResolvedTarget} sin target SELL resuelto). No se procesarán cierres SHADOW hasta que se active un rango. Considere reconciliación manual o archivado controlado.`
    : `Hay ${orphanCycles.length} ciclos orphan/históricos abiertos (${cyclesWithoutResolvedTarget} sin target SELL resuelto, ${cyclesWithTargetResolutionPossible} con SELL candidata en su rango). El motor solo cierra ciclos del rango activo; estos ciclos requieren reconciliación o archivado controlado.`;

  return {
    mode,
    activeRangeVersionId,
    currentPrice,
    cyclesOrphanCount: orphanCycles.length,
    cyclesWithoutResolvedTarget,
    cyclesWithTargetResolutionPossible,
    cyclesEligibleForSimulatedClose: eligibleCount,
    realOrdersAffected: false,
    readOnly: true,
    recommendation,
    orphanCycles: orphanDetails,
  };
}
