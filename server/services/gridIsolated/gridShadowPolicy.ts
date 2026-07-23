import type { GridLevel, PumpDumpState } from "./gridIsolatedTypes";

export interface CrossedShadowLevelsResult {
  levels: GridLevel[];
  ordering: "SELL_FIRST" | "BUY_FIRST" | "DISTANCE_TO_EXECUTION_PRICE";
}

export interface ShadowPumpGuardPolicy {
  active: boolean;
  blockNewRangeGeneration: boolean;
  blockRangeRebuild: boolean;
  allowBuyFill: boolean;
  allowExistingCycleSellExit: boolean;
  allowSellWithoutOpenCycle: boolean;
}

export function getShadowPumpGuardPolicy(state: PumpDumpState): ShadowPumpGuardPolicy {
  const active = state !== "normal";
  return {
    active,
    blockNewRangeGeneration: active,
    blockRangeRebuild: active,
    allowBuyFill: !active,
    allowExistingCycleSellExit: true,
    allowSellWithoutOpenCycle: false,
  };
}

export function getCrossedShadowLevels(
  levels: GridLevel[],
  executionPrice: number,
  activeRangeId: string,
  centerPrice: number | null
): CrossedShadowLevelsResult {
  const buys = levels
    .filter(level =>
      level.rangeVersionId === activeRangeId &&
      (level.status === "planned" || level.status === "open") &&
      level.side === "BUY" &&
      executionPrice <= level.price
    )
    .sort((a, b) => b.price - a.price || a.id.localeCompare(b.id));
  const sells = levels
    .filter(level =>
      level.rangeVersionId === activeRangeId &&
      (level.status === "planned" || level.status === "open") &&
      level.side === "SELL" &&
      executionPrice >= level.price
    )
    .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));

  if (centerPrice != null && Number.isFinite(centerPrice)) {
    if (executionPrice > centerPrice) return { levels: [...sells, ...buys], ordering: "SELL_FIRST" };
    if (executionPrice < centerPrice) return { levels: [...buys, ...sells], ordering: "BUY_FIRST" };
  }

  return {
    levels: [...buys, ...sells].sort((a, b) =>
      Math.abs(a.price - executionPrice) - Math.abs(b.price - executionPrice) ||
      a.id.localeCompare(b.id)
    ),
    ordering: "DISTANCE_TO_EXECUTION_PRICE",
  };
}
