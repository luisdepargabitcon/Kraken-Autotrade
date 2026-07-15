import type { GridCycle, GridLevel } from "./gridIsolatedTypes";

export interface ShadowOrphanCycleDiagnosis {
  id: string;
  cycleNumber: number;
  status: string;
  rangeVersionId: string;
  buyPrice: number | null;
  sellPrice: number | null;
  currentPrice: number | null;
  wouldCloseNow: boolean;
  reasonNotClosed: string;
  safeToArchive: boolean;
  buyLevelId: string | null;
  sellLevelId: string | null;
}

export interface ShadowOrphanDiagnosisResult {
  mode: string;
  activeRangeVersionId: string | null;
  currentPrice: number | null;
  cyclesOrphanCount: number;
  cyclesEligibleForSimulatedClose: number;
  realOrdersAffected: false;
  readOnly: true;
  recommendation: string;
  orphanCycles: ShadowOrphanCycleDiagnosis[];
}

const OPEN_CYCLE_STATUSES = new Set([
  "open",
  "active",
  "buy_filled",
  "buy_placed",
  "sell_placed",
  "cycle_open",
]);

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
  return OPEN_CYCLE_STATUSES.has(c.status);
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

  const orphanDetails: ShadowOrphanCycleDiagnosis[] = orphanCycles.map(cycle => {
    const buyLevel = findLevel(levels, cycle.buyLevelId);
    const sellLevel = findLevel(levels, cycle.sellLevelId);
    const buyPrice = toNum(cycle.buyPrice) ?? toNum(buyLevel?.price);
    const sellPrice = toNum(cycle.sellPrice) ?? toNum(sellLevel?.price);

    const wouldCloseNow = Boolean(
      currentPrice != null &&
      sellPrice != null &&
      buyPrice != null &&
      cycle.status === "buy_filled" &&
      currentPrice >= sellPrice
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

    return {
      id: cycle.id,
      cycleNumber: cycle.cycleNumber,
      status: cycle.status,
      rangeVersionId: cycle.rangeVersionId,
      buyPrice,
      sellPrice,
      currentPrice,
      wouldCloseNow,
      reasonNotClosed,
      safeToArchive,
      buyLevelId: cycle.buyLevelId,
      sellLevelId: cycle.sellLevelId,
    };
  });

  const eligibleCount = orphanDetails.filter(c => c.wouldCloseNow).length;

  const recommendation = activeRangeVersionId == null
    ? "Hay ciclos orphan/históricos abiertos pero no existe rango activo. No se procesarán cierres SHADOW hasta que se active un rango. Considere reconciliación manual o archivado controlado."
    : `Hay ${orphanCycles.length} ciclos orphan/históricos abiertos. El motor solo cierra ciclos del rango activo; estos ciclos requieren reconciliación o archivado controlado.`;

  return {
    mode,
    activeRangeVersionId,
    currentPrice,
    cyclesOrphanCount: orphanCycles.length,
    cyclesEligibleForSimulatedClose: eligibleCount,
    realOrdersAffected: false,
    readOnly: true,
    recommendation,
    orphanCycles: orphanDetails,
  };
}
