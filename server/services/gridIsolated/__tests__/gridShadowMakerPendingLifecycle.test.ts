import { describe, expect, it } from "vitest";
import { getCrossedShadowLevels } from "../gridShadowPolicy";
import type { GridLevel } from "../gridIsolatedTypes";

function makeLevel(overrides: Partial<GridLevel> & { id: string; price: number; side: "BUY" | "SELL"; status: string; rangeVersionId: string }): GridLevel {
  return {
    levelIndex: 0,
    notionalUsd: 100,
    quantity: 0.001,
    filledQuantity: 0,
    filledPrice: null,
    clientOrderId: "test-" + overrides.id,
    exchangeOrderId: null,
    postOnlyAttempts: 0,
    usedTakerFallback: false,
    netProfitTargetUsd: null,
    feeEstimateUsd: null,
    taxReserveUsd: null,
    buyMakerPendingAt: null,
    buyMakerPendingTickId: null,
    buyMakerRequestedPrice: null,
    createdAt: new Date(),
    placedAt: null,
    filledAt: null,
    cancelledAt: null,
    ...overrides,
  } as GridLevel;
}

const RANGE_ID = "range-1";
const CENTER = 64000;

describe("getCrossedShadowLevels — maker pending lifecycle", () => {
  it("incluye buy_maker_pending cuando executionPrice <= buyMakerRequestedPrice", () => {
    const levels: GridLevel[] = [
      makeLevel({ id: "b1", price: 63000, side: "BUY", status: "buy_maker_pending", rangeVersionId: RANGE_ID, buyMakerRequestedPrice: 62999.9 }),
    ];
    const result = getCrossedShadowLevels(levels, 62999.9, RANGE_ID, CENTER);
    expect(result.levels.length).toBe(1);
    expect(result.levels[0].id).toBe("b1");
  });

  it("excluye buy_maker_pending cuando executionPrice > buyMakerRequestedPrice", () => {
    const levels: GridLevel[] = [
      makeLevel({ id: "b1", price: 63000, side: "BUY", status: "buy_maker_pending", rangeVersionId: RANGE_ID, buyMakerRequestedPrice: 62999.9 }),
    ];
    const result = getCrossedShadowLevels(levels, 63000.1, RANGE_ID, CENTER);
    expect(result.levels.length).toBe(0);
  });

  it("no incluye estados terminales (buy_filled, cancelled, sold)", () => {
    const levels: GridLevel[] = [
      makeLevel({ id: "b1", price: 63000, side: "BUY", status: "buy_filled", rangeVersionId: RANGE_ID }),
      makeLevel({ id: "b2", price: 63000, side: "BUY", status: "cancelled", rangeVersionId: RANGE_ID }),
      makeLevel({ id: "b3", price: 63000, side: "BUY", status: "sold", rangeVersionId: RANGE_ID }),
    ];
    const result = getCrossedShadowLevels(levels, 62000, RANGE_ID, CENTER);
    expect(result.levels.length).toBe(0);
  });

  it("no incluye SELL en estado buy_maker_pending", () => {
    const levels: GridLevel[] = [
      makeLevel({ id: "s1", price: 65000, side: "SELL", status: "buy_maker_pending" as any, rangeVersionId: RANGE_ID }),
    ];
    const result = getCrossedShadowLevels(levels, 66000, RANGE_ID, CENTER);
    expect(result.levels.length).toBe(0);
  });

  it("fallback a level.price cuando buyMakerRequestedPrice es null", () => {
    const levels: GridLevel[] = [
      makeLevel({ id: "b1", price: 63000, side: "BUY", status: "buy_maker_pending", rangeVersionId: RANGE_ID, buyMakerRequestedPrice: null }),
    ];
    const result = getCrossedShadowLevels(levels, 63000, RANGE_ID, CENTER);
    expect(result.levels.length).toBe(1);
    expect(result.levels[0].id).toBe("b1");
  });

  it("mezcla planned, open y buy_maker_pending correctamente", () => {
    const levels: GridLevel[] = [
      makeLevel({ id: "b1", price: 63500, side: "BUY", status: "planned", rangeVersionId: RANGE_ID }),
      makeLevel({ id: "b2", price: 63000, side: "BUY", status: "open", rangeVersionId: RANGE_ID }),
      makeLevel({ id: "b3", price: 62500, side: "BUY", status: "buy_maker_pending", rangeVersionId: RANGE_ID, buyMakerRequestedPrice: 62499.9 }),
    ];
    const result = getCrossedShadowLevels(levels, 62499.9, RANGE_ID, CENTER);
    expect(result.levels.length).toBe(3);
    const ids = result.levels.map(l => l.id);
    expect(ids).toContain("b1");
    expect(ids).toContain("b2");
    expect(ids).toContain("b3");
  });
});
