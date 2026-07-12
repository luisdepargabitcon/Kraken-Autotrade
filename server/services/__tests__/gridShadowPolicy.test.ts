import { describe, it, expect } from "vitest";
import type { GridCycle, GridLevel } from "../gridIsolated/gridIsolatedTypes";
import {
  getCrossedShadowLevels,
  getShadowPumpGuardPolicy,
  selectShadowCycleForSell,
  SHADOW_SELL_PAIRING_POLICY,
} from "../gridIsolated/gridShadowPolicy";

function makeLevel(p: { id: string; side: "BUY" | "SELL"; price: number; rangeVersionId: string; status?: string }): GridLevel {
  return {
    id: p.id,
    rangeVersionId: p.rangeVersionId,
    side: p.side,
    price: p.price,
    status: (p.status || "planned") as any,
    quantity: 0.01,
    notionalUsd: 100,
    feeEstimateUsd: 0.1,
    taxReserveUsd: 0.2,
    netProfitTargetUsd: 0.5,
    clientOrderId: `client-${p.id}`,
    createdAt: new Date(),
  } as any;
}

function makeCycle(p: { id: string; rangeVersionId: string; buyPrice: number; status?: string; buyFilledAt?: Date }): GridCycle {
  return {
    id: p.id,
    rangeVersionId: p.rangeVersionId,
    cycleNumber: 1,
    pair: "BTC/USD",
    status: (p.status || "buy_filled") as any,
    buyLevelId: `buy-${p.id}`,
    sellLevelId: null,
    buyPrice: p.buyPrice,
    sellPrice: null,
    quantity: 0.01,
    grossPnlUsd: 0,
    feeTotalUsd: 0,
    taxReserveUsd: 0,
    netPnlUsd: 0,
    netPnlPct: 0,
    buyClientOrderId: `buy-client-${p.id}`,
    sellClientOrderId: null,
    buyFilledAt: p.buyFilledAt || new Date(),
    sellFilledAt: null,
    holdTimeMinutes: 0,
    createdAt: new Date(),
    completedAt: null,
  } as any;
}

describe("getShadowPumpGuardPolicy", () => {
  it("returns inactive policy for normal state", () => {
    const policy = getShadowPumpGuardPolicy("normal");
    expect(policy.active).toBe(false);
    expect(policy.blockNewRangeGeneration).toBe(false);
    expect(policy.blockRangeRebuild).toBe(false);
    expect(policy.allowBuyFill).toBe(true);
    expect(policy.allowExistingCycleSellExit).toBe(true);
    expect(policy.allowSellWithoutOpenCycle).toBe(false);
  });

  it("returns active blocking policy for pump and dump states", () => {
    for (const state of ["pump_detected", "dump_detected"] as const) {
      const policy = getShadowPumpGuardPolicy(state);
      expect(policy.active).toBe(true);
      expect(policy.blockNewRangeGeneration).toBe(true);
      expect(policy.blockRangeRebuild).toBe(true);
      expect(policy.allowBuyFill).toBe(false);
      expect(policy.allowExistingCycleSellExit).toBe(true);
      expect(policy.allowSellWithoutOpenCycle).toBe(false);
    }
  });
});

describe("getCrossedShadowLevels", () => {
  const rangeId = "range-1";

  it("returns only BUY levels crossed when execution price is at or below the level price", () => {
    const levels: GridLevel[] = [
      makeLevel({ id: "b1", side: "BUY", price: 101_000, rangeVersionId: rangeId }),
      makeLevel({ id: "b2", side: "BUY", price: 99_000, rangeVersionId: rangeId }),
      makeLevel({ id: "s1", side: "SELL", price: 101_500, rangeVersionId: rangeId }),
    ];
    const result = getCrossedShadowLevels(levels, 100_000, rangeId, 100_000);
    expect(result.levels.map(l => l.id)).toEqual(["b1"]);
  });

  it("returns only SELL levels crossed when execution price is at or above the level price", () => {
    const levels: GridLevel[] = [
      makeLevel({ id: "b1", side: "BUY", price: 99_000, rangeVersionId: rangeId }),
      makeLevel({ id: "s1", side: "SELL", price: 101_500, rangeVersionId: rangeId }),
      makeLevel({ id: "s2", side: "SELL", price: 100_500, rangeVersionId: rangeId }),
    ];
    const result = getCrossedShadowLevels(levels, 101_000, rangeId, 100_000);
    expect(result.levels.map(l => l.id)).toEqual(["s2"]);
  });

  it("orders SELL first when execution price is above center", () => {
    const levels: GridLevel[] = [
      makeLevel({ id: "b1", side: "BUY", price: 103_000, rangeVersionId: rangeId }),
      makeLevel({ id: "s1", side: "SELL", price: 101_500, rangeVersionId: rangeId }),
    ];
    const result = getCrossedShadowLevels(levels, 102_000, rangeId, 100_000);
    expect(result.ordering).toBe("SELL_FIRST");
    expect(result.levels.map(l => l.id)).toEqual(["s1", "b1"]);
  });

  it("orders BUY first when execution price is below center", () => {
    const levels: GridLevel[] = [
      makeLevel({ id: "s1", side: "SELL", price: 97_000, rangeVersionId: rangeId }),
      makeLevel({ id: "b1", side: "BUY", price: 99_000, rangeVersionId: rangeId }),
    ];
    const result = getCrossedShadowLevels(levels, 98_000, rangeId, 100_000);
    expect(result.ordering).toBe("BUY_FIRST");
    expect(result.levels.map(l => l.id)).toEqual(["b1", "s1"]);
  });

  it("ignores levels from other ranges or non-planned/open statuses", () => {
    const levels: GridLevel[] = [
      makeLevel({ id: "b1", side: "BUY", price: 100_500, rangeVersionId: rangeId }),
      makeLevel({ id: "b2", side: "BUY", price: 99_500, rangeVersionId: "other-range" }),
      { ...makeLevel({ id: "b3", side: "BUY", price: 99_500, rangeVersionId: rangeId }), status: "filled" } as GridLevel,
    ];
    const result = getCrossedShadowLevels(levels, 100_000, rangeId, 100_000);
    expect(result.levels.map(l => l.id)).toEqual(["b1"]);
  });
});

describe("selectShadowCycleForSell", () => {
  const rangeId = "range-1";
  const sellLevel = makeLevel({ id: "sell-1", side: "SELL", price: 101_000, rangeVersionId: rangeId });

  it("pairs with the oldest profitable buy cycle in the same range", () => {
    const cycles: GridCycle[] = [
      makeCycle({ id: "c2", rangeVersionId: rangeId, buyPrice: 99_500, buyFilledAt: new Date(Date.now() + 1000) }),
      makeCycle({ id: "c1", rangeVersionId: rangeId, buyPrice: 99_800, buyFilledAt: new Date(Date.now() - 1000) }),
    ];
    const matched = selectShadowCycleForSell({ sellLevel, cycles, activeRangeId: rangeId, policy: SHADOW_SELL_PAIRING_POLICY });
    expect(matched?.id).toBe("c1");
  });

  it("rejects cycles that are not profitable", () => {
    const cycles: GridCycle[] = [
      makeCycle({ id: "c1", rangeVersionId: rangeId, buyPrice: 101_500 }),
    ];
    const matched = selectShadowCycleForSell({ sellLevel, cycles, activeRangeId: rangeId, policy: SHADOW_SELL_PAIRING_POLICY });
    expect(matched).toBeNull();
  });

  it("rejects cycles from other ranges", () => {
    const cycles: GridCycle[] = [
      makeCycle({ id: "c1", rangeVersionId: "other-range", buyPrice: 99_000 }),
    ];
    const matched = selectShadowCycleForSell({ sellLevel, cycles, activeRangeId: rangeId, policy: SHADOW_SELL_PAIRING_POLICY });
    expect(matched).toBeNull();
  });

  it("rejects completed cycles", () => {
    const cycles: GridCycle[] = [
      makeCycle({ id: "c1", rangeVersionId: rangeId, buyPrice: 99_000, status: "completed" }),
    ];
    const matched = selectShadowCycleForSell({ sellLevel, cycles, activeRangeId: rangeId, policy: SHADOW_SELL_PAIRING_POLICY });
    expect(matched).toBeNull();
  });
});
