import { describe, expect, it, vi, beforeEach } from "vitest";
import { gridIsolatedCycles, gridIsolatedLevels } from "@shared/schema";

const cycleRows = new Map<string, any>();
const levelRows = new Map<string, any>();
const transactionTrace: Array<{ entity: string; payload: any }> = [];
const committedTrace: Array<{ entity: string; payload: any }> = [];
let rollbackTriggered = false;

function entityName(table: unknown) {
  if (table === gridIsolatedCycles) return "cycles";
  if (table === gridIsolatedLevels) return "levels";
  return "other";
}

function cloneRows(rows: Map<string, any>) {
  return new Map([...rows].map(([id, row]) => [id, { ...row }]));
}

vi.mock("../../../db", () => {
  let transactionalCycles: Map<string, any> | null = null;
  let transactionalLevels: Map<string, any> | null = null;
  const update = (table: unknown) => {
    const entity = entityName(table);
    return {
      set(payload: any) {
        const apply = () => {
          if (transactionalCycles == null && transactionalLevels == null) return [];
          const rows = entity === "cycles" ? transactionalCycles! : entity === "levels" ? transactionalLevels! : new Map();
          const candidates = [...rows.values()].filter((row: any) => {
            if (entity === "cycles") return row.status !== "completed" && row.completedAt == null;
            if (entity === "levels") return row.side === "BUY" && row.status === "filled";
            return false;
          });
          if (candidates.length !== 1) return [];
          Object.assign(candidates[0], payload);
          transactionTrace.push({ entity, payload });
          return [{ id: candidates[0].id }];
        };
        return {
          where() {
            const returning = () => Promise.resolve(apply());
            return { returning, then: (resolve: any, reject: any) => Promise.resolve(apply()).then(resolve, reject) };
          },
        };
      },
    };
  };
  return {
    db: {
      update,
      transaction: async (callback: any) => {
        transactionalCycles = cloneRows(cycleRows); transactionalLevels = cloneRows(levelRows);
        try {
          const result = await callback({ update });
          cycleRows.clear(); transactionalCycles.forEach((row, id) => cycleRows.set(id, row));
          levelRows.clear(); transactionalLevels.forEach((row, id) => levelRows.set(id, row));
          committedTrace.push(...transactionTrace); transactionTrace.push({ entity: "commit", payload: null });
          return result;
        } catch (error) {
          rollbackTriggered = true; transactionTrace.push({ entity: "rollback", payload: null }); throw error;
        } finally {
          transactionalCycles = null; transactionalLevels = null;
        }
      },
    },
  };
});

import { GridIsolatedEngine } from "../gridIsolatedEngine";

function buildValidOpenV3Cycle(engine: any, overrides: Record<string, unknown> = {}) {
  const targetCalculationJson = {
    selected: true, stateVersion: 2, policyVersion: "CYCLE_OWNED_NET_TARGET_V3", targetKind: "CYCLE_OWNED_SYNTHETIC",
    targetSellLevelId: null, targetRungLevelId: null, targetSellPrice: 100, targetSellQuantity: 1,
    grossExitGapPct: 1, actualGrossGapPct: 1, grossPnlUsd: 2, buyFeePct: 0, sellFeePct: 0,
    spreadBufferPct: 0, safetyBufferPct: 0, taxReservePct: 0, buyFeeUsd: 0, sellFeeUsd: 0,
    exchangeFeesUsd: 0, operationalCostsUsd: 0, netBeforeTaxUsd: 2, netBeforeTaxPct: 2,
    taxReserveUsd: 0, availablePnlAfterTaxUsd: 2, availablePnlAfterTaxPct: 2, netProfitTargetPct: 1,
    priceTickSize: 0.5, quantityStep: 0.00001, minOrderBase: 0.00001, minOrderQuote: 1,
    minOrderUsd: 1, maxOrderBase: 100, baseCurrency: "BTC", quoteCurrency: "USD",
    constraintsSource: "test", constraintsFetchedAt: new Date().toISOString(), rejectedCandidates: [], explanation: "V3 test target",
  };
  return {
    id: "cycle-v3", rangeVersionId: "historical-range", cycleNumber: 1, pair: "BTC/USD", status: "buy_filled",
    buyLevelId: "historical-buy", sellLevelId: null, targetSellLevelId: null, targetRungLevelId: null,
    buyPrice: 98, sellPrice: null, targetSellPrice: 100, targetSellQuantity: 1, quantity: 1,
    grossPnlUsd: 0, feeTotalUsd: 0, taxReserveUsd: 0, netPnlUsd: 0, netPnlPct: 0,
    exitPolicyVersion: "CYCLE_OWNED_NET_TARGET_V3", targetKind: "CYCLE_OWNED_SYNTHETIC", targetCalculationJson,
    riskStateJson: engine.defaultRiskState(), makerExitStateJson: null, buyClientOrderId: null, sellClientOrderId: null,
    buyFilledAt: new Date("2026-07-28T00:00:00.000Z"), sellFilledAt: null, holdTimeMinutes: 0,
    requiresReview: false, reviewReason: null, reviewCode: null, reviewDetectedAt: null, reviewSource: null,
    createdAt: new Date("2026-07-28T00:00:00.000Z"), completedAt: null, ...overrides,
  };
}

function tick(tickId: number, bid: number, ask: number, startedAt = new Date(`2026-07-28T00:00:0${tickId}.000Z`)) {
  return { tickId, startedAt, pair: "BTC/USD", bid, ask, last: null, marketTimestamp: startedAt.toISOString(), priceSource: "ticker_last", freshness: { isFresh: true, reason: null, ageMs: 0, maxAgeMs: 60000 } };
}

describe("GridIsolatedEngine V3 SELL lifecycle", () => {
  beforeEach(() => {
    cycleRows.clear(); levelRows.clear(); transactionTrace.length = 0; committedTrace.length = 0; rollbackTriggered = false;
  });

  it("L1 crea TRIGGERED V3 solo en el tick posterior al BUY", async () => {
    const engine = new GridIsolatedEngine(); const internal = engine as any;
    internal.config = { pair: "BTC/USD", mode: "SHADOW", isActive: true, trailingEnabled: false, stopLossEnabled: false };
    internal.activeRangeVersion = { id: "active-range", pair: "BTC/USD" }; internal.levels = []; internal.logEvent = vi.fn();
    const cycle = buildValidOpenV3Cycle(internal); internal.cycles = [cycle];
    expect(cycle.riskStateJson.protectiveExit.state).toBe("NONE");
    await internal.evaluateRiskForOpenCycles({ pair: "BTC/USD", price: 100.1, bid: 100.1, ask: 100.3, source: "ticker_last", timestamp: new Date().toISOString() }, tick(1, 100.1, 100.3));
    expect(cycle.riskStateJson.protectiveExit).toMatchObject({ state: "TRIGGERED", route: "CYCLE_OWNED_TARGET", triggerPrice: 100, lifecycleTickId: 1, requestedMakerPrice: null });
  });

  it("L3 usa priceTickSize persistido para el maker post-only V3", async () => {
    const engine = new GridIsolatedEngine(); const internal = engine as any;
    internal.config = { pair: "BTC/USD", mode: "SHADOW", isActive: true, trailingEnabled: false, stopLossEnabled: false };
    internal.activeRangeVersion = { id: "active-range", pair: "BTC/USD" }; internal.levels = []; internal.logEvent = vi.fn();
    const cycle = buildValidOpenV3Cycle(internal); internal.cycles = [cycle];
    const legacyTick = vi.spyOn(internal, "getLegacyPriceTickSize");
    const price = { pair: "BTC/USD", price: 100.1, bid: 100.1, ask: 100.3, source: "ticker_last", timestamp: new Date().toISOString() };
    await internal.evaluateRiskForOpenCycles(price, tick(1, 100.1, 100.3));
    await internal.evaluateRiskForOpenCycles(price, tick(2, 100.1, 100.3));
    const exit = cycle.riskStateJson.protectiveExit;
    expect(exit).toMatchObject({ state: "MAKER_PENDING", route: "CYCLE_OWNED_TARGET", requestedMakerPrice: 101, lifecycleTickId: 2 });
    expect(exit.requestedMakerPrice).toBeGreaterThan(100.1); expect(exit.requestedMakerPrice).toBeGreaterThanOrEqual(100.3); expect(exit.requestedMakerPrice).toBeGreaterThanOrEqual(100);
    expect(legacyTick).not.toHaveBeenCalled();
  });

  it("L2 mantiene MAKER_PENDING y solo completa el ciclo en un tick posterior elegible", async () => {
    const engine = new GridIsolatedEngine(); const internal = engine as any;
    internal.config = { pair: "BTC/USD", mode: "SHADOW", isActive: true, trailingEnabled: false, stopLossEnabled: false };
    internal.activeRangeVersion = { id: "historical-range", pair: "BTC/USD" }; internal.levels = []; internal.logEvent = vi.fn();
    const cycle = buildValidOpenV3Cycle(internal); internal.cycles = [cycle];
    cycleRows.set(cycle.id, { id: cycle.id, status: "sell_placed", completedAt: null, rangeVersionId: cycle.rangeVersionId });
    levelRows.set(cycle.buyLevelId, { id: cycle.buyLevelId, rangeVersionId: cycle.rangeVersionId, side: "BUY", status: "filled", filledAt: cycle.buyFilledAt });
    const placementPrice = { pair: "BTC/USD", price: 100.1, bid: 100.1, ask: 100.3, source: "ticker_last", timestamp: new Date().toISOString() };
    const at1 = new Date(); const at2 = new Date(at1.getTime() + 1);
    await internal.evaluateRiskForOpenCycles(placementPrice, tick(1, 100.1, 100.3, at1));
    await internal.evaluateRiskForOpenCycles(placementPrice, tick(2, 100.1, 100.3, at2));
    const exit = cycle.riskStateJson.protectiveExit;
    expect(exit).toMatchObject({ state: "MAKER_PENDING", lifecycleTickId: 2 }); expect(exit.makerEligibleAfter).toBeInstanceOf(Date);
    expect(await internal.processOpenCyclesShadow(placementPrice, tick(2, 101, 101.3, at2))).toBe(0);
    expect(cycleRows.get(cycle.id).status).toBe("sell_placed"); expect(levelRows.get(cycle.buyLevelId).status).toBe("filled");
    const fillAt = new Date(exit.makerEligibleAfter.getTime() + 1);
    const fillPrice = { pair: "BTC/USD", price: 101, bid: 101, ask: 101.3, source: "ticker_last", timestamp: new Date().toISOString() };
    const fillCtx = tick(3, 101, 101.3, fillAt);
    expect(internal.resolveExitForCycle(cycle, fillPrice, fillCtx)).toMatchObject({ targetPrice: 101, closePath: "CYCLE_OWNED_TARGET", eligibleForFill: true });
    expect(cycle.requiresReview).toBe(false);
    const closed = await internal.processOpenCyclesShadow(fillPrice, fillCtx);
    expect(cycle.requiresReview).toBe(false);
    expect(transactionTrace.map(entry => entry.entity)).toEqual(["cycles", "levels", "commit"]);
    expect(closed).toBe(1);
    expect(cycle.status).toBe("completed"); expect(cycle.riskStateJson.protectiveExit.state).toBe("MAKER_FILLED"); expect(cycle.sellPrice).toBe(101); expect(cycle.sellFilledAt).toBeInstanceOf(Date); expect(cycle.completedAt).toBeInstanceOf(Date);
    expect(cycleRows.get(cycle.id).status).toBe("completed"); expect(levelRows.get(cycle.buyLevelId).status).toBe("planned");
    expect(transactionTrace.some(entry => entry.entity === "levels" && entry.payload.side === "SELL")).toBe(false);
  });

  it("L4 completa el ciclo V3 histórico sin SELL level ni rearme de BUY", async () => {
    const engine = new GridIsolatedEngine(); const internal = engine as any;
    internal.config = { pair: "BTC/USD", mode: "SHADOW", isActive: true, trailingEnabled: false, stopLossEnabled: false };
    internal.activeRangeVersion = { id: "range-current", pair: "BTC/USD" };
    const cycle = buildValidOpenV3Cycle(internal); const referenceRung: any = { id: "reference-sell", side: "SELL", status: "planned", rangeVersionId: "historical-range" };
    internal.cycles = [cycle]; internal.levels = [referenceRung]; internal.logEvent = vi.fn();
    cycleRows.set(cycle.id, { id: cycle.id, status: "sell_placed", completedAt: null, rangeVersionId: cycle.rangeVersionId });
    levelRows.set(cycle.buyLevelId, { id: cycle.buyLevelId, rangeVersionId: cycle.rangeVersionId, side: "BUY", status: "filled" });
    const now = new Date(); const placement = { pair: "BTC/USD", price: 100.1, bid: 100.1, ask: 100.3, source: "ticker_last", timestamp: now.toISOString() };
    await internal.evaluateRiskForOpenCycles(placement, tick(1, 100.1, 100.3, now));
    await internal.evaluateRiskForOpenCycles(placement, tick(2, 100.1, 100.3, new Date(now.getTime() + 1)));
    const exit = cycle.riskStateJson.protectiveExit; const fillAt = new Date(exit.makerEligibleAfter.getTime() + 1);
    expect(await internal.processOpenCyclesShadow({ pair: "BTC/USD", price: 101, bid: 101, ask: 101.3, source: "ticker_last", timestamp: new Date().toISOString() }, tick(3, 101, 101.3, fillAt))).toBe(1);
    expect(cycle).toMatchObject({ status: "completed", sellLevelId: null, targetSellLevelId: null, targetRungLevelId: null });
    expect(transactionTrace.map(entry => entry.entity)).toEqual(["cycles", "commit"]);
    expect(levelRows.get(cycle.buyLevelId).status).toBe("filled"); expect(referenceRung.status).toBe("planned");
  });
});
