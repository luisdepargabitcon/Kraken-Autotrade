/**
 * gridV31EngineSingleExit.test.ts — Engine-level integrated test for
 * V3.1 single-exit invariant and trailing takeover.
 *
 * Verifies the full lifecycle:
 *   V3 cycle → trailing activates → V3 maker cancelled →
 *   trailing stop hit → TRAILING_MAKER → TRIGGERED → MAKER_PENDING
 *
 * The final fill (MAKER_FILLED) is already covered by existing tests in
 * gridOpenCycleShadowClose.test.ts. This test focuses on the V3.1-specific
 * single-exit invariant and V3 maker cancellation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GridIsolatedConfig, GridCycle, GridLevel, GridRangeVersion, GridCycleRiskState, TrailingPolicySnapshot } from "../gridIsolatedTypes";
import type { GridShadowExecutionPriceResult } from "../gridShadowExecutionPrice";

// ─── Mock dependencies before importing engine ───────────────────────
vi.mock("../../../db", () => {
  function makeMockTable(name: string, columns: string[]) {
    const table: any = { __mockTable: name };
    for (const col of columns) {
      table[col] = { __name: col, __table: name };
    }
    return table;
  }
  function cloneState(state: any) {
    return JSON.parse(JSON.stringify(state));
  }
  function evalPred(row: any, pred: any): boolean {
    if (!pred) return true;
    if (pred.op === "eq") return row[pred.col.__name] === pred.value;
    if (pred.op === "isNull") return row[pred.col.__name] == null;
    if (pred.op === "inArray") return pred.arr.includes(row[pred.col.__name]);
    if (pred.op === "and") return pred.conds.every((c: any) => evalPred(row, c));
    return true;
  }
  function executeUpdate(state: any, table: any, setValues: any, predicate: any, returningCols: any) {
    const rows = state[table.__mockTable];
    if (!rows) return [];
    const matches = rows.filter((row: any) => evalPred(row, predicate));
    for (const row of matches) {
      Object.assign(row, setValues);
    }
    return matches.map((row: any) => {
      const out: any = {};
      for (const key of Object.keys(returningCols || {})) {
        const col = returningCols[key];
        out[key] = col && col.__name ? row[col.__name] : row[key];
      }
      return out;
    });
  }
  function makeUpdateBuilder(state: any, table: any) {
    const builder: any = {
      _set: {},
      _where: null,
      _returning: null,
      set(values: any) { this._set = values; return this; },
      where(pred: any) { this._where = pred; return this; },
      returning(cols: any) { this._returning = cols; return this; },
      then(cb: any) {
        const result = executeUpdate(state, table, this._set, this._where, this._returning);
        return Promise.resolve(cb ? cb(result) : result);
      },
    };
    return builder;
  }
  const state: any = { cycles: [], levels: [] };
  const dbMock: any = {
    _resetState(rows: any) { state.cycles = cloneState(rows.cycles); state.levels = cloneState(rows.levels); },
    _resetTxQueue() {},
    update: (table: any) => makeUpdateBuilder(state, table),
    insert: (table: any) => ({
      values(_v: any) { return { onConflictDoNothing: () => ({ then: (cb: any) => Promise.resolve(cb ? cb() : undefined) }) }; },
    }),
    transaction: async (fn: any) => fn({ update: (table: any) => makeUpdateBuilder(state, table) }),
    select: () => ({ from: () => ({ where: () => ({ then: (cb: any) => Promise.resolve(cb ? cb([]) : []) }) }) }),
  };
  return { db: dbMock };
});

vi.mock("../../botLogger", () => ({
  botLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../gridShadowMarketPriceFreshness", () => ({
  evaluateShadowMarketPriceFreshness: () => ({ isFresh: true, reason: null, ageMs: 0, maxAgeMs: 60000 }),
  GRID_SHADOW_PRICE_MAX_AGE_MS: 60000,
}));

vi.mock("../gridShadowExecutionPrice", () => ({
  resolveGridShadowExecutionPrice: vi.fn(),
}));

import { gridIsolatedEngine } from "../gridIsolatedEngine";
import { db } from "../../../db";
import { botLogger } from "../../botLogger";

// ─── Helpers ─────────────────────────────────────────────────────────
const CYCLE_ID = "cycle-v31-1";
const RANGE_ID = "range-v31-1";
const BUY_LEVEL_ID = "buy-v31-1";
const SELL_LEVEL_ID = "sell-v31-1";

function makeConfig(overrides: Partial<GridIsolatedConfig> = {}): GridIsolatedConfig {
  return {
    id: "cfg",
    pair: "BTC/USD",
    mode: "SHADOW",
    capitalProfile: "moderate",
    executionPolicy: "MAKER_ONLY",
    defaultExitPolicyVersion: "CYCLE_OWNED_NET_TARGET_V3",
    trailingEnabled: true,
    trailingMode: "manual",
    trailingActivationPct: 1.0,
    trailingStopPct: 0.4,
    trailingAtrMultiplier: 0.75,
    trailingMinPct: 0.25,
    trailingMaxPct: 1.20,
    trailingAtrSmoothingAlpha: 0.25,
    stopLossEnabled: false,
    buyFeePct: 0.09,
    sellFeePct: 0.09,
    netProfitTargetPct: 0.8,
    stopLossSoftPct: 2,
    stopLossHardPct: 5,
    stopLossEmergencyPct: 10,
    hodlRecoveryEnabled: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as any;
}

function makeV3Policy(): TrailingPolicySnapshot {
  return {
    enabled: true,
    mode: "manual",
    calculationVersion: 1,
    activationPctEffective: 1.0,
    activationPrice: 60600,
    profitFloorPrice: 60600,
    atrMultiplier: 0.75,
    minPct: 0.25,
    maxPct: 1.20,
    smoothingAlpha: 0.25,
    priceTickSize: 0.01,
    manualStopPct: 0.40,
  };
}

function makeCycle(overrides: Partial<GridCycle> = {}): GridCycle {
  const policy = makeV3Policy();
  const riskState: GridCycleRiskState = {
    trailing: {
      activated: false, activatedAt: null, highestPriceSinceBuy: null,
      trailingStopPct: 0, currentStopPrice: null, reason: "",
      policy, atrPct: null, smoothedAtrPct: null, atrSource: null,
      effectiveStopPct: null, baseStopPct: null,
      profitFloorPrice: 60600, activationPrice: 60600,
    },
    stopLoss: [
      { layer: "soft", triggerPricePct: 2, triggered: false, triggeredAt: null, reason: "" },
      { layer: "hard", triggerPricePct: 5, triggered: false, triggeredAt: null, reason: "" },
      { layer: "emergency", triggerPricePct: 10, triggered: false, triggeredAt: null, reason: "" },
    ],
    hodl: { active: false, activatedAt: null, originalBuyPrice: null, recoveryTargetPrice: null, reason: "" },
    lastAction: null,
    activeExitRoute: null,
    pendingExitPrice: null,
    protectiveExit: {
      state: "NONE", route: null, triggerPrice: null, triggerDetectedAt: null,
      bestBidAtTrigger: null, bestAskAtTrigger: null, requestedMakerPrice: null,
      makerOrderCreatedAt: null, makerEligibleAfter: null, lifecycleTickId: null,
      lastRepricedAt: null, repriceAttempts: 0, pendingQuantity: 0,
      simulatedOrderId: null, fillPrice: null, filledAt: null,
      bestBidAtFill: null, bestAskAtFill: null, cancellationReason: null,
    },
    stateVersion: 1,
    lastEvaluatedAt: null,
    trailingPolicy: policy,
  };
  return {
    id: CYCLE_ID,
    rangeVersionId: RANGE_ID,
    cycleNumber: 1,
    pair: "BTC/USD",
    status: "buy_filled",
    buyLevelId: BUY_LEVEL_ID,
    sellLevelId: null,
    targetSellLevelId: null,
    targetRungLevelId: null,
    buyPrice: 60_000,
    sellPrice: null,
    targetSellPrice: 60_600,
    targetSellQuantity: 0.001,
    quantity: 0.001,
    grossPnlUsd: 0,
    feeTotalUsd: 0,
    taxReserveUsd: 0,
    netPnlUsd: 0,
    netPnlPct: 0,
    exitPolicyVersion: "CYCLE_OWNED_NET_TARGET_V3",
    targetKind: "CYCLE_OWNED_SYNTHETIC",
    targetCalculationJson: null,
    riskStateJson: riskState,
    makerExitStateJson: null,
    buyClientOrderId: "client-buy-v31",
    sellClientOrderId: null,
    buyFilledAt: new Date(Date.now() - 60_000),
    sellFilledAt: null,
    holdTimeMinutes: 0,
    createdAt: new Date(),
    completedAt: null,
    requiresReview: false,
    ...overrides,
  } as any;
}

function makeLevel(overrides: Partial<GridLevel> = {}): GridLevel {
  return {
    id: SELL_LEVEL_ID,
    rangeVersionId: RANGE_ID,
    levelIndex: 1,
    side: "SELL",
    price: 61_000,
    quantity: 0.001,
    status: "planned",
    clientOrderId: "client-sell-v31",
    exchangeOrderId: null,
    filledPrice: null,
    filledQuantity: null,
    filledAt: null,
    createdAt: new Date(),
    ...overrides,
  } as GridLevel;
}

function makeRange(overrides: Partial<GridRangeVersion> = {}): GridRangeVersion {
  return {
    id: RANGE_ID,
    pair: "BTC/USD",
    rangeVersion: 1,
    status: "active",
    centerPrice: 60_000,
    atrPct: 1.0,
    atrValue: 600,
    bollingerUpper: 61_000,
    bollingerLower: 59_000,
    bollingerMid: 60_000,
    bandwidthPct: 3.33,
    regime: "normal",
    levels: [],
    createdAt: new Date(),
    activatedAt: new Date(),
    closedAt: null,
    ...overrides,
  } as any;
}

function priceResult(opts: Partial<GridShadowExecutionPriceResult>): GridShadowExecutionPriceResult {
  const bid = opts.bid ?? null;
  return {
    pair: opts.pair ?? "BTC/USD",
    price: opts.price ?? bid ?? 0,
    source: opts.source ?? "ticker_last",
    bid,
    ask: opts.ask ?? (typeof bid === "number" ? bid + 0.1 : null),
    spreadPct: opts.spreadPct ?? null,
    timestamp: opts.timestamp ?? new Date().toISOString(),
  } as GridShadowExecutionPriceResult;
}

function makeTickContext(engine: any, price: GridShadowExecutionPriceResult, tickId: number) {
  return {
    tickId,
    startedAt: new Date(),
    pair: engine.config?.pair ?? "BTC/USD",
    bid: price.bid ?? null,
    ask: price.ask ?? null,
    last: price.source === "ticker_last" ? price.price : null,
    marketTimestamp: price.timestamp,
    priceSource: price.source,
    freshness: { isFresh: true, reason: null, ageMs: 0, maxAgeMs: 60000 },
  };
}

async function tick(engine: any, opts: Partial<GridShadowExecutionPriceResult>): Promise<number> {
  const price = priceResult(opts);
  const tickId = ++engine.currentTickId;
  const ctx = makeTickContext(engine, price, tickId);
  await engine.evaluateRiskForOpenCycles(price, ctx, 1.0);
  return engine.processOpenCyclesShadow(price, ctx);
}

function resetEngine(cycles: GridCycle[], levels: GridLevel[], configOverrides: Partial<GridIsolatedConfig> = {}) {
  (db as any)._resetTxQueue();
  const engine = gridIsolatedEngine as any;
  engine.config = makeConfig(configOverrides);
  engine.cycles = cycles;
  engine.levels = levels;
  engine.activeRangeVersion = makeRange();
  engine.referencedRangeVersions = engine.activeRangeVersion ? [engine.activeRangeVersion] : [];
  engine.lastShadowEventAt = null;
  engine.tickSequence = 0;
  engine.currentTickId = 0;
  engine.closingCycleIds?.clear();
  const rows = {
    cycles: cycles.map((c) => ({ ...c })),
    levels: levels.map((l) => ({ ...l })),
  };
  (db as any)._resetState(rows);
  return engine;
}

describe("[V3.1 Engine] Single-exit invariant — V3 takeover + trailing lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("V3 maker en MAKER_PENDING → trailing activa → maker cancelado por TRAILING_TAKEOVER", async () => {
    // Start with a cycle that already has a V3 maker pending
    const cycle = makeCycle({
      riskStateJson: {
        ...(makeCycle().riskStateJson as any),
        protectiveExit: {
          state: "MAKER_PENDING",
          route: "CYCLE_OWNED_TARGET",
          triggerPrice: 60_600,
          triggerDetectedAt: new Date(),
          bestBidAtTrigger: 60_600,
          bestAskAtTrigger: 60_601,
          requestedMakerPrice: 60_600.1,
          makerOrderCreatedAt: new Date(),
          makerEligibleAfter: null,
          lifecycleTickId: 1,
          lastRepricedAt: null,
          repriceAttempts: 0,
          pendingQuantity: 0.001,
          simulatedOrderId: "sim-v3-1",
          fillPrice: null,
          filledAt: null,
          bestBidAtFill: null,
          bestAskAtFill: null,
          cancellationReason: null,
        },
        activeExitRoute: "CYCLE_OWNED_TARGET",
        pendingExitPrice: 60_600.1,
      } as any,
    });
    const engine = resetEngine(
      [cycle],
      [makeLevel({ id: BUY_LEVEL_ID, side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any })],
      { trailingEnabled: true, trailingMode: "manual", trailingStopPct: 0.4 }
    );

    // Tick 1: price at V3 target → trailing activates, V3 maker should be cancelled
    await tick(engine, { bid: 60_600 });
    const risk = engine.cycles[0].riskStateJson as any;
    expect(risk.trailing.activated).toBe(true);
    expect(risk.lastAction).toBe("TRAILING_UPDATE");
    // V3 maker should be cancelled
    expect(risk.protectiveExit.state).toBe("CANCELLED");
    expect(risk.protectiveExit.cancellationReason).toBe("TRAILING_TAKEOVER");
    // activeExitRoute should be null while trailing follows
    expect(risk.activeExitRoute).toBeNull();
  });

  it("trailing activa → sigue máximo → retrocede → TRAILING_CLOSE → TRIGGERED → MAKER_PENDING", async () => {
    const engine = resetEngine(
      [makeCycle()],
      [makeLevel({ id: BUY_LEVEL_ID, side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any })],
      { trailingEnabled: true, trailingMode: "manual", trailingStopPct: 0.4 }
    );

    // Tick 1: price at V3 target → trailing activates
    await tick(engine, { bid: 60_600 });
    let risk = engine.cycles[0].riskStateJson as any;
    expect(risk.trailing.activated).toBe(true);
    expect(risk.lastAction).toBe("TRAILING_UPDATE");
    expect(risk.activeExitRoute).toBeNull();

    // Tick 2: price rises → trailing follows, no close
    await tick(engine, { bid: 60_700 });
    risk = engine.cycles[0].riskStateJson as any;
    expect(risk.trailing.activated).toBe(true);
    expect(risk.trailing.highestPriceSinceBuy).toBe(60_700);
    expect(risk.lastAction).toBe("TRAILING_UPDATE");
    // Stop = max(60700 * 0.996, 60600) = max(60457.2, 60600) = 60600
    expect(risk.trailing.currentStopPrice).toBeGreaterThanOrEqual(60_600 - 1);

    // Tick 3: price drops below stop → TRAILING_CLOSE
    await tick(engine, { bid: 60_500 });
    risk = engine.cycles[0].riskStateJson as any;
    expect(risk.lastAction).toBe("TRAILING_CLOSE");
    expect(risk.activeExitRoute).toBe("TRAILING_MAKER");
    expect(risk.protectiveExit.state).toBe("TRIGGERED");
    expect(risk.protectiveExit.route).toBe("TRAILING_MAKER");
    // No V3 maker should be active — single exit
    expect(risk.protectiveExit.route).not.toBe("CYCLE_OWNED_TARGET");

    // Tick 4: maker pending order placed
    await tick(engine, { bid: 60_500 });
    risk = engine.cycles[0].riskStateJson as any;
    expect(risk.protectiveExit.state).toBe("MAKER_PENDING");
    expect(risk.protectiveExit.route).toBe("TRAILING_MAKER");
    expect(risk.activeExitRoute).toBe("TRAILING_MAKER");
    expect(risk.pendingExitPrice).toBeGreaterThan(0);
    // Single exit: no V3 maker
    expect(risk.protectiveExit.cancellationReason).not.toBe("TRAILING_TAKEOVER");
  });

  it("TRAILING_MAKER pendiente no se cancela por TRAILING_UPDATE cuando precio sube", async () => {
    const engine = resetEngine(
      [makeCycle()],
      [makeLevel({ id: BUY_LEVEL_ID, side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any })],
      { trailingEnabled: true, trailingMode: "manual", trailingStopPct: 0.4 }
    );

    // Activate trailing, rise, drop to trigger TRAILING_CLOSE, then MAKER_PENDING
    await tick(engine, { bid: 60_600 }); // activate
    await tick(engine, { bid: 60_700 }); // follow max
    await tick(engine, { bid: 60_500 }); // TRAILING_CLOSE → TRIGGERED
    await tick(engine, { bid: 60_500 }); // MAKER_PENDING
    let risk = engine.cycles[0].riskStateJson as any;
    expect(risk.protectiveExit.state).toBe("MAKER_PENDING");
    expect(risk.protectiveExit.route).toBe("TRAILING_MAKER");
    expect(risk.activeExitRoute).toBe("TRAILING_MAKER");

    // Now price rises above stop — TRAILING_UPDATE should NOT cancel the maker
    await tick(engine, { bid: 60_700 });
    risk = engine.cycles[0].riskStateJson as any;
    // Maker should still be pending — not cancelled
    expect(risk.protectiveExit.state).toBe("MAKER_PENDING");
    expect(risk.protectiveExit.route).toBe("TRAILING_MAKER");
    expect(risk.activeExitRoute).toBe("TRAILING_MAKER");
    expect(risk.pendingExitPrice).toBeGreaterThan(0);
  });

  it("nunca dos SELL simultáneas: V3 maker cancelado antes de crear TRAILING_MAKER", async () => {
    // Start with V3 maker pending, then trigger trailing
    const cycle = makeCycle({
      riskStateJson: {
        ...(makeCycle().riskStateJson as any),
        protectiveExit: {
          state: "MAKER_PENDING",
          route: "CYCLE_OWNED_TARGET",
          triggerPrice: 60_600,
          triggerDetectedAt: new Date(),
          bestBidAtTrigger: 60_600,
          bestAskAtTrigger: 60_601,
          requestedMakerPrice: 60_600.1,
          makerOrderCreatedAt: new Date(),
          makerEligibleAfter: null,
          lifecycleTickId: 1,
          lastRepricedAt: null,
          repriceAttempts: 0,
          pendingQuantity: 0.001,
          simulatedOrderId: "sim-v3-1",
          fillPrice: null,
          filledAt: null,
          bestBidAtFill: null,
          bestAskAtFill: null,
          cancellationReason: null,
        },
        activeExitRoute: "CYCLE_OWNED_TARGET",
        pendingExitPrice: 60_600.1,
      } as any,
    });
    const engine = resetEngine(
      [cycle],
      [makeLevel({ id: BUY_LEVEL_ID, side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any })],
      { trailingEnabled: true, trailingMode: "manual", trailingStopPct: 0.4 }
    );

    // Tick 1: trailing activates → V3 maker cancelled
    await tick(engine, { bid: 60_600 });
    let risk = engine.cycles[0].riskStateJson as any;
    expect(risk.protectiveExit.state).toBe("CANCELLED");
    expect(risk.protectiveExit.cancellationReason).toBe("TRAILING_TAKEOVER");
    expect(risk.activeExitRoute).toBeNull();

    // Tick 2: price drops → TRAILING_CLOSE → TRIGGERED
    await tick(engine, { bid: 60_500 });
    risk = engine.cycles[0].riskStateJson as any;
    expect(risk.lastAction).toBe("TRAILING_CLOSE");
    expect(risk.protectiveExit.state).toBe("TRIGGERED");
    expect(risk.protectiveExit.route).toBe("TRAILING_MAKER");
    // The old V3 maker is CANCELLED, the new one is TRIGGERED — never both pending
    expect(risk.protectiveExit.state).not.toBe("MAKER_PENDING");

    // Tick 3: MAKER_PENDING for TRAILING_MAKER
    await tick(engine, { bid: 60_500 });
    risk = engine.cycles[0].riskStateJson as any;
    expect(risk.protectiveExit.state).toBe("MAKER_PENDING");
    expect(risk.protectiveExit.route).toBe("TRAILING_MAKER");
    // Only one SELL route active
    expect(risk.activeExitRoute).toBe("TRAILING_MAKER");
  });
});
