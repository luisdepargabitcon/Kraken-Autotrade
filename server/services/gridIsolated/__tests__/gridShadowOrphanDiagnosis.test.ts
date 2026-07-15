import { describe, it, expect } from "vitest";
import { diagnoseShadowOrphanCycles } from "../gridShadowOrphanDiagnosis";
import type { GridCycle, GridLevel } from "../gridIsolatedTypes";

function makeCycle(partial: Partial<GridCycle>): GridCycle {
  return {
    id: "cycle-1",
    rangeVersionId: "range-old",
    cycleNumber: 1,
    pair: "BTC/USD",
    status: "buy_filled",
    buyLevelId: "buy-level-1",
    sellLevelId: null,
    buyPrice: 60000,
    sellPrice: null,
    quantity: 0.01,
    grossPnlUsd: 0,
    feeTotalUsd: 0,
    taxReserveUsd: 0,
    netPnlUsd: 0,
    netPnlPct: 0,
    buyClientOrderId: null,
    sellClientOrderId: null,
    buyFilledAt: new Date(),
    sellFilledAt: null,
    holdTimeMinutes: null,
    createdAt: new Date(),
    completedAt: null,
    ...partial,
  } as GridCycle;
}

function makeLevel(partial: Partial<GridLevel>): GridLevel {
  return {
    id: "level-1",
    rangeVersionId: "range-old",
    levelIndex: 0,
    side: "BUY",
    price: 60000,
    notionalUsd: 600,
    quantity: 0.01,
    status: "filled",
    filledQuantity: 0.01,
    filledPrice: 60000,
    clientOrderId: "client-1",
    exchangeOrderId: null,
    postOnlyAttempts: 0,
    usedTakerFallback: false,
    netProfitTargetUsd: 4.8,
    feeEstimateUsd: 0,
    taxReserveUsd: 0,
    createdAt: new Date(),
    placedAt: null,
    filledAt: new Date(),
    cancelledAt: null,
    ...partial,
  } as GridLevel;
}

describe("diagnoseShadowOrphanCycles", () => {
  it("returns empty result when there are no open cycles", () => {
    const cycle: GridCycle = makeCycle({ status: "completed" });
    const result = diagnoseShadowOrphanCycles([cycle], [], null, 65000, "SHADOW");
    expect(result.cyclesOrphanCount).toBe(0);
    expect(result.cyclesEligibleForSimulatedClose).toBe(0);
    expect(result.readOnly).toBe(true);
    expect(result.realOrdersAffected).toBe(false);
  });

  it("counts orphan cycles when activeRangeVersionId is null", () => {
    const cycle = makeCycle({ sellLevelId: "sell-level-1" });
    const sellLevel = makeLevel({ id: "sell-level-1", side: "SELL", price: 61000, status: "planned" });
    const result = diagnoseShadowOrphanCycles([cycle], [sellLevel], null, 65000, "SHADOW");
    expect(result.cyclesOrphanCount).toBe(1);
    expect(result.orphanCycles[0].wouldCloseNow).toBe(true);
    expect(result.cyclesEligibleForSimulatedClose).toBe(1);
    expect(result.realOrdersAffected).toBe(false);
    expect(result.readOnly).toBe(true);
  });

  it("does not count active-range cycles as orphan", () => {
    const activeCycle = makeCycle({ rangeVersionId: "range-active", status: "buy_filled" });
    const orphanCycle = makeCycle({ rangeVersionId: "range-old", status: "buy_filled" });
    const result = diagnoseShadowOrphanCycles(
      [activeCycle, orphanCycle],
      [],
      "range-active",
      65000,
      "SHADOW"
    );
    expect(result.cyclesOrphanCount).toBe(1);
    expect(result.orphanCycles[0].id).toBe("cycle-1");
    expect(result.orphanCycles[0].rangeVersionId).toBe("range-old");
  });

  it("marks wouldCloseNow=false when current price is below sell level", () => {
    const cycle = makeCycle({ sellLevelId: "sell-level-1" });
    const sellLevel = makeLevel({ id: "sell-level-1", side: "SELL", price: 70000, status: "planned" });
    const result = diagnoseShadowOrphanCycles([cycle], [sellLevel], null, 65000, "SHADOW");
    expect(result.orphanCycles[0].wouldCloseNow).toBe(false);
    expect(result.cyclesEligibleForSimulatedClose).toBe(0);
  });

  it("marks safeToArchive=false when a level has a real exchange order id", () => {
    const cycle = makeCycle({});
    const buyLevel = makeLevel({ id: "buy-level-1", exchangeOrderId: "real-order-123" });
    const result = diagnoseShadowOrphanCycles([cycle], [buyLevel], null, 65000, "SHADOW");
    expect(result.orphanCycles[0].safeToArchive).toBe(false);
  });

  it("marks safeToArchive=true when no real orders are attached", () => {
    const cycle = makeCycle({});
    const buyLevel = makeLevel({ id: "buy-level-1", exchangeOrderId: null });
    const result = diagnoseShadowOrphanCycles([cycle], [buyLevel], null, 65000, "SHADOW");
    expect(result.orphanCycles[0].safeToArchive).toBe(true);
  });

  it("provides reason why the cycle was not closed", () => {
    const cycle = makeCycle({});
    const result = diagnoseShadowOrphanCycles([cycle], [], null, 65000, "SHADOW");
    expect(result.orphanCycles[0].reasonNotClosed).toContain("No hay rango activo cargado");
    expect(result.recommendation).toContain("No se procesarán cierres SHADOW");
  });

  it("is read-only and never reports real orders affected", () => {
    const cycle = makeCycle({});
    const buyLevel = makeLevel({ id: "buy-level-1", exchangeOrderId: "real-123" });
    const result = diagnoseShadowOrphanCycles([cycle], [buyLevel], null, 65000, "SHADOW");
    expect(result.realOrdersAffected).toBe(false);
    expect(result.readOnly).toBe(true);
    // Even with a real order attached to a historical level, the diagnosis does not touch it.
    expect(result.orphanCycles[0].safeToArchive).toBe(false);
  });
});
