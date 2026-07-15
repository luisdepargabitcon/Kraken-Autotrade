export type GridLevelFilterKey =
  | "rango-activo"
  | "activos"
  | "planificados"
  | "historicos"
  | "reemplazados"
  | "ejecutados"
  | "cancelados"
  | "todos";

export function filterGridLevels(
  levels: any[],
  filter: GridLevelFilterKey,
  activeRangeId?: string | null
): any[] {
  if (!Array.isArray(levels) || levels.length === 0) return [];

  switch (filter) {
    case "rango-activo":
      return activeRangeId
        ? levels.filter(level => level?.rangeVersionId === activeRangeId)
        : [];
    case "activos":
      return levels.filter(level =>
        level?.rangeVersionId === activeRangeId &&
        level?.exchangeOrderId != null &&
        !["filled", "cancelled", "replaced", "expired"].includes(level?.status)
      );
    case "planificados":
      return levels.filter(level =>
        level?.rangeVersionId === activeRangeId &&
        level?.status === "planned" &&
        level?.exchangeOrderId == null
      );
    case "historicos":
      return levels.filter(level =>
        level?.rangeVersionId !== activeRangeId || level?.status === "replaced"
      );
    case "reemplazados":
      return levels.filter(level => level?.status === "replaced");
    case "ejecutados":
      return levels.filter(level => level?.status === "filled" || level?.filledAt != null);
    case "cancelados":
      return levels.filter(level => ["cancelled", "expired"].includes(level?.status));
    default:
      return levels;
  }
}

export function isHistoricalLegacyGridLevel(level: any, activeRangeId?: string | null): boolean {
  return level?.rangeVersionId !== activeRangeId && level?.status === "filled";
}

export function gridLevelOperationalLabel(level: any, activeRangeId?: string | null): string {
  if (!activeRangeId) return "Histórico / no ejecutable — sin rango activo";
  if (level?.rangeVersionId === activeRangeId) return "Activo";
  if (level?.status === "planned") return "Planificado histórico / no ejecutable";
  if (isHistoricalLegacyGridLevel(level, activeRangeId)) return "Histórico legacy / no ejecutable / no afecta PnL";
  return "Histórico / no ejecutable";
}
