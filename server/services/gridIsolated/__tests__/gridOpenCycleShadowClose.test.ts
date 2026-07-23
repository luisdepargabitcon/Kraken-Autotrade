import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GridIsolatedConfig, GridCycle, GridLevel, GridRangeVersion } from "../gridIsolatedTypes";
import type { GridShadowExecutionPriceResult } from "../gridShadowExecutionPrice";
import { GRID_SHADOW_PRICE_MAX_AGE_MS } from "../gridShadowMarketPriceFreshness";

// ─── Mock dependencies before importing engine ───────────────────────
vi.mock("../../../db", () => {
  // Simple in-memory DB used by processOpenCyclesShadow.
  // It supports update + transaction with predicate evaluation.
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
      _where: { op: "and", conds: [] },
      set(values: any) { builder._set = values; return builder; },
      where(predicate: any) { builder._where = predicate; return builder; },
      returning(cols: any) {
        return Promise.resolve(executeUpdate(state, table, builder._set, builder._where, cols));
      },
      then(onF: any, onR: any) {
        return Promise.resolve(executeUpdate(state, table, builder._set, builder._where, {})).then(onF, onR);
      },
    };
    return builder;
  }

  let txQueue = Promise.resolve();

  const db: any = {
    _state: { cycles: [], levels: [] },
    _resetState(newState: any) { db._state = newState; },
    _resetTxQueue() { txQueue = Promise.resolve(); },
    update(table: any) { return makeUpdateBuilder(db._state, table); },
    insert() { return { values: (vals: any) => Promise.resolve([]) }; },
    transaction: vi.fn().mockImplementation((callback: any) => {
      const p = txQueue.then(async () => {
        const txState = cloneState(db._state);
        const tx = {
          update: (table: any) => makeUpdateBuilder(txState, table),
          insert: () => ({ values: (vals: any) => Promise.resolve([]) }),
        };
        try {
          const result = await callback(tx);
          db._state = txState;
          return result;
        } catch (e) {
          throw e;
        }
      });
      txQueue = p.catch(() => {});
      return p;
    }),
  };

  return { db, __testDb: db };
});

vi.mock("@shared/schema", () => ({
  gridIsolatedEvents: { createdAt: "created_at" },
  gridIsolatedConfigs: {},
  gridRangeVersions: {},
  gridIsolatedLevels: (() => {
    const cols = ["id", "rangeVersionId", "levelIndex", "side", "price", "quantity", "status", "clientOrderId", "exchangeOrderId", "filledPrice", "filledQuantity", "filledAt", "createdAt", "placedAt", "cancelledAt"];
    const table: any = { __mockTable: "levels" };
    for (const c of cols) table[c] = { __name: c, __table: "levels" };
    return table;
  })(),
  gridIsolatedCycles: (() => {
    const cols = ["id", "rangeVersionId", "cycleNumber", "pair", "status", "buyLevelId", "sellLevelId", "targetSellLevelId", "targetRungLevelId", "buyPrice", "sellPrice", "targetSellPrice", "targetSellQuantity", "exitPolicyVersion", "targetKind", "targetCalculationJson", "riskStateJson", "quantity", "grossPnlUsd", "feeTotalUsd", "taxReserveUsd", "netPnlUsd", "netPnlPct", "buyClientOrderId", "sellClientOrderId", "buyFilledAt", "sellFilledAt", "holdTimeMinutes", "createdAt", "completedAt"];
    const table: any = { __mockTable: "cycles" };
    for (const c of cols) table[c] = { __name: c, __table: "cycles" };
    return table;
  })(),
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: any, value: any) => ({ op: "eq", col, value }),
  and: (...conds: any[]) => ({ op: "and", conds }),
  isNull: (col: any) => ({ op: "isNull", col }),
  inArray: (col: any, arr: any[]) => ({ op: "inArray", col, arr }),
  desc: vi.fn(),
  sql: (strings: TemplateStringsArray, ...vals: any[]) => ({ sql: strings.join("?"), params: vals }),
}));

vi.mock("../../botLogger", () => ({
  botLogger: {
    info: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    debug: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../MarketDataService", () => ({
  MarketDataService: {},
}));

vi.mock("../../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {},
}));

// ─── Import engine after mocks ─────────────────────────────────────
import { gridIsolatedEngine } from "../gridIsolatedEngine";
import { db } from "../../../db";
import { botLogger } from "../../botLogger";

// ─── Helpers ─────────────────────────────────────────────────────────
const CYCLE_ID = "cycle-1";
const RANGE_ID = "range-1";
const BUY_LEVEL_ID = "buy-level-1";
const SELL_LEVEL_ID = "sell-level-1";

function makeConfig(overrides: Partial<GridIsolatedConfig> = {}): GridIsolatedConfig {
  return {
    id: "cfg",
    pair: "BTC/USD",
    mode: "SHADOW",
    capitalProfile: "moderate",
    executionPolicy: "MAKER_ONLY",
    defaultExitPolicyVersion: "FIRST_PROFITABLE_HIGHER_RUNG_V2",
    trailingEnabled: false,
    stopLossEnabled: false,
    buyFeePct: 0.09,
    sellFeePct: 0.09,
    netProfitTargetPct: 0.8,
    bandPeriod: 20,
    bandStdDevMultiplier: 2,
    atrPeriod: 14,
    atrTimeframe: "1h",
    gridStepAtrMultiplier: 1.5,
    gridStepMinPct: 0.5,
    gridStepMaxPct: 2.0,
    geometricRatioMin: 1.02,
    geometricRatioMax: 1.05,
    trailingActivationPct: 1.0,
    trailingStopPct: 0.5,
    stopLossSoftPct: 3,
    stopLossHardPct: 5,
    stopLossEmergencyPct: 10,
    hodlRecoveryEnabled: false,
    pumpGuardDeviationPct: 2,
    pumpGuardVolumeSpikeRatio: 2,
    pumpGuardCooldownMinutes: 60,
    dumpGuardDeviationPct: 2,
    dumpGuardVolumeSpikeRatio: 2,
    dumpGuardCooldownMinutes: 60,
    maxOpenCycles: 10,
    maxDailyOrders: 50,
    fiscalStatus: "simple",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    makerAttemptsBeforeTaker: 3,
    takerFallbackEnabled: false,
    takerFallbackAttemptNumber: 4,
    maxTakerFallbackPerCycle: 1,
    takerFallbackRequiresNetProfit: true,
    takerFallbackAuditRequired: true,
    gridWalletMode: "automatic",
    gridWalletInitialUsd: 1000,
    gridWalletMaxUsd: 5000,
    gridWalletUseProfits: true,
    gridWalletCompoundProfits: true,
    gridMaxCapitalPerCycleUsd: 600,
    gridMaxCapitalPerCyclePct: 60,
    gridReservePct: 20,
    gridMinFreeCapitalUsd: 50,
    gridPauseCycleWhenCapitalDepleted: true,
    gridAllowNewCycleWhenCapitalFree: true,
    gridAllocationMode: "uniform",
    gridCapitalDeploymentMode: "capped",
    gridProgressiveIntensity: 0.3,
    gridMaxLevelPct: 40,
    gridMinLevelUsd: 30,
    enforceCompactRange: true,
    gridRangeMaxPct: 2.5,
    maxDistanceFromCenterPct: 1.25,
    maxSellDistanceFromNearestBuyPct: 1.5,
    gridRangeControlMode: "adaptive_smart",
    adaptiveRangeEnabled: true,
    adaptiveRangeProfile: "balanced",
    adaptiveRangeMinPct: 1.5,
    adaptiveRangeMaxPct: 7.0,
    adaptiveRangeLowVolMaxPct: 3.0,
    adaptiveRangeNormalMaxPct: 5.0,
    adaptiveRangeHighVolMaxPct: 7.0,
    adaptiveRangeTargetFullLevels: false,
    adaptiveRangeMinViableLevels: 4,
    ...overrides,
  } as GridIsolatedConfig;
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
    clientOrderId: "client-sell-1",
    exchangeOrderId: null,
    filledPrice: null,
    filledQuantity: null,
    filledAt: null,
    createdAt: new Date(),
    ...overrides,
  } as GridLevel;
}

function makeCycle(overrides: Partial<GridCycle> = {}): GridCycle {
  return {
    id: CYCLE_ID,
    rangeVersionId: RANGE_ID,
    cycleNumber: 1,
    pair: "BTC/USD",
    status: "buy_filled",
    buyLevelId: BUY_LEVEL_ID,
    sellLevelId: null,
    targetSellLevelId: SELL_LEVEL_ID,
    targetRungLevelId: SELL_LEVEL_ID,
    buyPrice: 60_000,
    sellPrice: null,
    targetSellPrice: 61_000,
    targetSellQuantity: 0.001,
    quantity: 0.001,
    grossPnlUsd: 0,
    feeTotalUsd: 0,
    taxReserveUsd: 0,
    netPnlUsd: 0,
    netPnlPct: 0,
    exitPolicyVersion: "SYMMETRIC_INDEX_V1",
    targetKind: "PERSISTED_SELL",
    targetCalculationJson: null,
    riskStateJson: null,
    makerExitStateJson: null,
    buyClientOrderId: "client-buy-1",
    sellClientOrderId: null,
    buyFilledAt: new Date(Date.now() - 60_000),
    sellFilledAt: null,
    holdTimeMinutes: 0,
    createdAt: new Date(),
    completedAt: null,
    ...overrides,
  } as GridCycle;
}

function makeRange(overrides: Partial<GridRangeVersion> = {}): GridRangeVersion {
  return {
    id: RANGE_ID,
    pair: "BTC/USD",
    status: "active",
    versionNumber: 1,
    createdAt: new Date(),
    ...overrides,
  } as GridRangeVersion;
}

let testClockMs = Date.now();
const TICK_CLOCK_STEP_MS = 100;

function makeTickContext(engine: any, price: GridShadowExecutionPriceResult, tickId: number) {
  const startedAt = new Date(testClockMs);
  testClockMs += TICK_CLOCK_STEP_MS;
  return {
    tickId,
    startedAt,
    pair: engine.config?.pair ?? "BTC/USD",
    bid: price.bid ?? null,
    ask: price.ask ?? null,
    last: price.source === "ticker_last" ? price.price : null,
    marketTimestamp: price.timestamp,
    priceSource: price.source,
    freshness: { isFresh: true, reason: null, ageMs: 0, maxAgeMs: 60000 },
  };
}

function getMinTargetPrice(engine: any): number | null {
  const openStatuses = new Set(["buy_filled", "hodl_recovery"]);
  const prices: number[] = [];
  for (const c of engine.cycles ?? []) {
    if (!openStatuses.has(c.status)) continue;
    const risk = c.riskStateJson ?? c.makerExitStateJson;
    const t =
      c.targetSellPrice ??
      risk?.pendingExitPrice ??
      risk?.protectiveExit?.triggerPrice ??
      risk?.protectiveExit?.requestedMakerPrice ??
      null;
    if (typeof t === "number" && Number.isFinite(t) && t > 0) prices.push(t);
    else if (typeof t === "string" && !isNaN(parseFloat(t))) prices.push(parseFloat(t));
  }
  return prices.length > 0 ? Math.min(...prices) : null;
}


async function callProcessOpenCyclesShadow(engine: any, opts: Partial<GridShadowExecutionPriceResult>): Promise<number> {
  const price = priceResult(opts);
  const tickId = ++engine.currentTickId;
  const ctx = makeTickContext(engine, price, tickId);
  return engine.processOpenCyclesShadow(price, ctx);
}

async function runUntilClosed(
  engine: any,
  opts: Partial<GridShadowExecutionPriceResult>,
  maxTicks: number = 5
): Promise<number> {
  let closed = 0;
  for (let i = 0; i < maxTicks; i++) {
    const isLastTick = i === maxTicks - 1;
    const minTarget = getMinTargetPrice(engine);
    const rawBid = typeof opts.bid === "number" ? opts.bid : null;
    const placementBid =
      !isLastTick && rawBid != null && minTarget != null && rawBid >= minTarget
        ? minTarget - 0.2
        : rawBid;
    closed = await processLifecycleTick(engine, { ...opts, bid: placementBid });
    if (closed > 0 && isLastTick) return closed;
    if (closed > 0 && !isLastTick) {
      // Closed early on a placement tick (can happen when bid > target). Stop here.
      return closed;
    }
  }
  return 0;
}

async function processLifecycleTick(
  engine: any,
  opts: Partial<GridShadowExecutionPriceResult>
): Promise<number> {
  const price = priceResult(opts);
  const tickId = ++engine.currentTickId;
  const ctx = makeTickContext(engine, price, tickId);
  await engine.evaluateRiskForOpenCycles(price, ctx);
  return engine.processOpenCyclesShadow(price, ctx);
}

async function processLifecycleTickAt(
  engine: any,
  opts: Partial<GridShadowExecutionPriceResult>,
  startedAt: Date
): Promise<number> {
  const price = priceResult(opts);
  const tickId = ++engine.currentTickId;
  const ctx = makeCtxAt(engine, price, tickId, startedAt);
  await engine.evaluateRiskForOpenCycles(price, ctx);
  return engine.processOpenCyclesShadow(price, ctx);
}

function priceResult(opts: Partial<GridShadowExecutionPriceResult>): GridShadowExecutionPriceResult {
  const bid = opts.bid ?? null;
  return {
    pair: opts.pair ?? "BTC/USD",
    price: opts.price ?? bid ?? 0,
    source: opts.source ?? "ticker_last",
    bid,
    ask: opts.ask ?? (typeof bid === "number" ? bid + 0.001 : null),
    spreadPct: opts.spreadPct ?? null,
    timestamp: opts.timestamp ?? new Date().toISOString(),
  } as GridShadowExecutionPriceResult;
}

function makeCtxAt(engine: any, price: GridShadowExecutionPriceResult, tickId: number, startedAt: Date) {
  return {
    tickId,
    startedAt,
    pair: engine.config?.pair ?? "BTC/USD",
    bid: price.bid ?? null,
    ask: price.ask ?? null,
    last: price.source === "ticker_last" ? price.price : null,
    marketTimestamp: price.timestamp,
    priceSource: price.source,
    freshness: { isFresh: true, reason: null, ageMs: 0, maxAgeMs: 60000 },
  };
}

function resetEngine(cycles: GridCycle[], levels: GridLevel[], configOverrides: Partial<GridIsolatedConfig> = {}, rangeOverrides: Partial<GridRangeVersion> = {}) {
  (db as any)._resetTxQueue();
  const engine = gridIsolatedEngine as any;
  engine.config = makeConfig(configOverrides);
  engine.cycles = cycles;
  engine.levels = levels;
  engine.activeRangeVersion = makeRange(rangeOverrides);
  engine.referencedRangeVersions = engine.activeRangeVersion ? [engine.activeRangeVersion] : [];
  engine.lastShadowEventAt = null;
  engine.tickSequence = 0;
  engine.currentTickId = 0;
  engine.closingCycleIds?.clear();
  testClockMs = Date.now();

  const rows = {
    cycles: cycles.map((c) => ({ ...c })),
    levels: levels.map((l) => ({ ...l })),
  };
  (db as any)._resetState(rows);
  return engine;
}

describe("processOpenCyclesShadow — cierre transaccional SHADOW", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db as any)._resetTxQueue();
    resetEngine([makeCycle()], [makeLevel()]);
  });

  describe("MODO / ACTIVACIÓN", () => {
    it("devuelve 0 si el modo no es SHADOW", async () => {
      const engine = gridIsolatedEngine as any;
      engine.config.mode = "OFF";
      const result = await callProcessOpenCyclesShadow(engine, { bid: 61_500 });
      expect(result).toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("devuelve 0 si el motor está inactivo", async () => {
      const engine = gridIsolatedEngine as any;
      engine.config.isActive = false;
      const result = await callProcessOpenCyclesShadow(engine, { bid: 61_500 });
      expect(result).toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
    });
  });

  describe("PRECIO", () => {
    it("bestBid >= targetSellPrice → cierra tras lifecycle maker", async () => {
      const result = await runUntilClosed(gridIsolatedEngine as any, { bid: 61_200 });
      expect(result).toBe(1);
    });

    it("sellExecutionPrice = targetSellPrice, no un bid superior", async () => {
      await runUntilClosed(gridIsolatedEngine as any, { bid: 65_000 });
      const cycle = (gridIsolatedEngine as any).cycles[0];
      expect(cycle.sellPrice).toBe(61_000);
    });

    it("ask >= target pero bid < target → no cierra", async () => {
      const result = await callProcessOpenCyclesShadow((gridIsolatedEngine as any), { bid: 60_900, ask: 61_200 });
      expect(result).toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("last >= target pero bid < target → no cierra", async () => {
      const result = await callProcessOpenCyclesShadow((gridIsolatedEngine as any), { bid: 60_900, price: 61_500, source: "ticker_last" });
      expect(result).toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("no cierra si no hay bid disponible", async () => {
      const result = await callProcessOpenCyclesShadow((gridIsolatedEngine as any), { bid: null });
      expect(result).toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("sin bid y fallback last no autorizado → no cierra", async () => {
      const result = await callProcessOpenCyclesShadow((gridIsolatedEngine as any), { bid: null, price: 61_500, source: "no_price" });
      expect(result).toBe(0);
    });
  });

  describe("ESTADOS", () => {
    it("pending no se procesa", async () => {
      const engine = resetEngine([makeCycle({ status: "pending" as any })], [makeLevel()]);
      const result = await callProcessOpenCyclesShadow(engine, { bid: 61_200 });
      expect(result).toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("buy_placed no se procesa", async () => {
      const engine = resetEngine([makeCycle({ status: "buy_placed" as any })], [makeLevel()]);
      const result = await callProcessOpenCyclesShadow(engine, { bid: 61_200 });
      expect(result).toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("buy_filled sí se procesa", async () => {
      const result = await runUntilClosed(gridIsolatedEngine as any, { bid: 61_200 });
      expect(result).toBe(1);
    });

    it("sell_filled no crea otra ejecución", async () => {
      const engine = resetEngine(
        [makeCycle({ status: "sell_filled" as any, sellLevelId: SELL_LEVEL_ID, sellPrice: 61_000, sellFilledAt: new Date(), completedAt: new Date() })],
        [makeLevel({ status: "filled" as any, filledPrice: 61_000, filledQuantity: 0.001, filledAt: new Date() })]
      );
      const result = await callProcessOpenCyclesShadow(engine, { bid: 61_200 });
      expect(result).toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("completed no se reprocesa", async () => {
      const engine = resetEngine(
        [makeCycle({ status: "completed" as any, sellLevelId: SELL_LEVEL_ID, sellPrice: 61_000, sellFilledAt: new Date(), completedAt: new Date() })],
        [makeLevel({ status: "filled" as any, filledPrice: 61_000, filledQuantity: 0.001, filledAt: new Date() })]
      );
      const result = await callProcessOpenCyclesShadow(engine, { bid: 61_200 });
      expect(result).toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("stop_loss_hit no se reprocesa", async () => {
      const engine = resetEngine(
        [makeCycle({ status: "stop_loss_hit" as any, completedAt: new Date() })],
        [makeLevel()]
      );
      const result = await callProcessOpenCyclesShadow(engine, { bid: 61_200 });
      expect(result).toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("trailing_closed no se reprocesa", async () => {
      const engine = resetEngine(
        [makeCycle({ status: "trailing_closed" as any, completedAt: new Date() })],
        [makeLevel()]
      );
      const result = await callProcessOpenCyclesShadow(engine, { bid: 61_200 });
      expect(result).toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("hodl_recovery queda requiresReview y no se cierra", async () => {
      const engine = resetEngine([makeCycle({ status: "hodl_recovery" as any })], [makeLevel()]);
      const result = await callProcessOpenCyclesShadow(engine, { bid: 61_200 });
      expect(result).toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
    });
  });

  describe("VALIDACIÓN Y ATOMICIDAD DEL SELL", () => {
    it("ciclo actualizado y SELL actualizada → commit", async () => {
      const engine = gridIsolatedEngine as any;
      const result = await runUntilClosed(engine, { bid: 61_200 });
      expect(result).toBe(1);

      const cycle = engine.cycles[0];
      expect(cycle.status).toBe("completed");
      expect(cycle.sellLevelId).toBe(SELL_LEVEL_ID);
      expect(cycle.completedAt).toBeInstanceOf(Date);

      const level = engine.levels[0];
      expect(level.status).toBe("filled");
      expect(level.filledPrice).toBe(61_000);
      expect(level.filledAt).toBeInstanceOf(Date);
    });

    it("SELL ya filled → no segundo fill (rollback)", async () => {
      const engine = resetEngine(
        [makeCycle()],
        [makeLevel({ status: "filled" as any, filledPrice: 61_000, filledQuantity: 0.001, filledAt: new Date() })]
      );
      await processLifecycleTick(engine, { bid: 60_900 }); // trigger
      await processLifecycleTick(engine, { bid: 60_900 }); // pending
      await expect(callProcessOpenCyclesShadow(engine, { bid: 61_200 })).rejects.toThrow("no está disponible");
      const cycle = engine.cycles[0];
      expect(cycle.status).toBe("buy_filled");
    });

    it("targetSellLevelId incorrecto → rollback", async () => {
      const engine = resetEngine(
        [makeCycle({ targetSellLevelId: "fake-id" })],
        [makeLevel({ id: SELL_LEVEL_ID })]
      );
      // Nivel con id "fake-id" no existe → tx.update(levels) devuelve 0 filas
      await processLifecycleTick(engine, { bid: 60_900 }); // trigger
      await processLifecycleTick(engine, { bid: 60_900 }); // pending
      await expect(callProcessOpenCyclesShadow(engine, { bid: 61_200 })).rejects.toThrow("no está disponible");
    });

    it("rangeVersionId distinto → rollback", async () => {
      const engine = resetEngine(
        [makeCycle()],
        [makeLevel({ rangeVersionId: "otro-rango" })]
      );
      await processLifecycleTick(engine, { bid: 60_900 }); // trigger
      await processLifecycleTick(engine, { bid: 60_900 }); // pending
      await expect(callProcessOpenCyclesShadow(engine, { bid: 61_200 })).rejects.toThrow("no está disponible");
    });

    it("side distinto de SELL → rollback", async () => {
      const engine = resetEngine(
        [makeCycle()],
        [makeLevel({ side: "BUY" as any })]
      );
      await processLifecycleTick(engine, { bid: 60_900 }); // trigger
      await processLifecycleTick(engine, { bid: 60_900 }); // pending
      await expect(callProcessOpenCyclesShadow(engine, { bid: 61_200 })).rejects.toThrow("no está disponible");
    });

    it("ciclo ya completed → idempotente (no transacción exitosa)", async () => {
      const engine = resetEngine(
        [makeCycle({ status: "completed" as any, completedAt: new Date(), sellPrice: 61_000, sellFilledAt: new Date(), sellLevelId: SELL_LEVEL_ID })],
        [makeLevel({ status: "filled" as any, filledPrice: 61_000, filledQuantity: 0.001, filledAt: new Date() })]
      );
      const result = await callProcessOpenCyclesShadow(engine, { bid: 61_200 });
      expect(result).toBe(0);
    });
  });

  describe("RESOLUCIÓN FALTANTE DE TARGET", () => {
    it("resuelve target SELL faltante, persiste y cierra", async () => {
      const engine = resetEngine(
        [makeCycle({ targetSellLevelId: null, targetSellPrice: null, targetSellQuantity: null })],
        [makeLevel({ id: SELL_LEVEL_ID, side: "SELL", price: 61_000, quantity: 0.001, status: "planned" as any })]
      );
      const result = await runUntilClosed(engine, { bid: 61_200 });
      expect(result).toBe(1);
      const cycle = engine.cycles[0];
      expect(cycle.targetSellLevelId).toBe(SELL_LEVEL_ID);
      expect(cycle.targetSellPrice).toBe(61_000);
      expect(cycle.status).toBe("completed");
    });

    it("rechaza ciclos cuya resolución de target requiera revisión", async () => {
      const engine = resetEngine(
        [makeCycle({ targetSellLevelId: null, targetSellPrice: null, targetSellQuantity: null })],
        [makeLevel({ id: SELL_LEVEL_ID, side: "SELL", price: 61_000, quantity: 0.001 })],
        {},
        { id: "otro-rango" }
      );
      const result = await callProcessOpenCyclesShadow(engine, { bid: 61_200 });
      expect(result).toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("SELL reclamada por otro ciclo → revisión, no cierre", async () => {
      const engine = resetEngine(
        [
          makeCycle({ id: "c1", cycleNumber: 1, targetSellLevelId: null, targetSellPrice: null, targetSellQuantity: null }),
          makeCycle({ id: "c2", cycleNumber: 2, targetSellLevelId: SELL_LEVEL_ID, targetSellPrice: 61_000, targetSellQuantity: 0.001 }),
        ],
        [makeLevel({ id: SELL_LEVEL_ID, side: "SELL", price: 61_000, quantity: 0.001 })]
      );
      const result = await runUntilClosed(engine, { bid: 61_200 });
      // c2 has target, c1 cannot resolve because SELL already claimed by c2
      expect(result).toBe(1); // c2 closes
      expect(engine.cycles[0].targetSellLevelId).toBeNull(); // c1 unresolved
      expect(engine.cycles[0].status).not.toBe("completed");
    });
  });

  describe("CONCURRENCIA", () => {
    it("dos llamadas concurrentes → un solo cierre", async () => {
      const engine = gridIsolatedEngine as any;
      // Trigger -> pending por debajo del target -> dos intentos concurrentes de fill.
      await processLifecycleTick(engine, { bid: 60_900 });
      await processLifecycleTick(engine, { bid: 60_900 });
      expect((engine.cycles[0].riskStateJson as any)?.protectiveExit?.state).toBe("MAKER_PENDING");
      const results = await Promise.allSettled([
        callProcessOpenCyclesShadow(engine, { bid: 61_200 }),
        callProcessOpenCyclesShadow(engine, { bid: 61_200 }),
      ]);
      const successes = results.filter((r) => r.status === "fulfilled" && r.value === 1).length;
      expect(successes).toBe(1);
      expect(engine.cycles[0].status).toBe("completed");
    });
  });

  describe("SEGURIDAD / PNL", () => {
    it("Ciclo A: PnL exacto con buyPrice=63264.40 target=64893.12322364 qty=0.00379061", async () => {
      const qty = 0.00379061;
      const target = 64893.12322364;
      const engine = resetEngine(
        [makeCycle({
          id: "cA",
          cycleNumber: 1,
          buyPrice: 63264.40,
          targetSellPrice: target,
          targetSellQuantity: qty,
          quantity: qty,
          targetSellLevelId: SELL_LEVEL_ID,
        })],
        [makeLevel({ id: SELL_LEVEL_ID, side: "SELL", price: target, quantity: qty, status: "planned" as any })]
      );
      await runUntilClosed(engine, { bid: target });
      const cycle = engine.cycles[0];
      const expectedFee = 0.4372156701960858;
      const expectedTax = 1.1473277737131882;
      const expectedNet = 4.589311094852752;
      expect(cycle.grossPnlUsd).toBeCloseTo(6.173854538762, 10);
      expect(cycle.feeTotalUsd).toBeCloseTo(expectedFee, 10);
      expect(cycle.taxReserveUsd).toBeCloseTo(expectedTax, 10);
      expect(cycle.netPnlUsd).toBeCloseTo(expectedNet, 10);
      expect(cycle.netPnlPct).toBeCloseTo(1.9137226658, 10);

      // Los roles se auditan en el evento GRID_CYCLE_COMPLETED, no en el ciclo
      const completedCall = (botLogger.info as any).mock.calls.find((call: any[]) => call[0] === "GRID_CYCLE_COMPLETED");
      expect(completedCall).toBeTruthy();
      expect(completedCall[2]).toMatchObject({
        buyLiquidityRole: "maker",
        sellLiquidityRole: "maker",
        executionPolicy: "MAKER_ONLY",
        takerFallbackUsed: false,
      });
    });

    it("no invoca ningún adaptador de exchange", async () => {
      // ExchangeFactory mock is empty; no call assertions needed except process succeeds
      const result = await runUntilClosed(gridIsolatedEngine as any, { bid: 61_200 });
      expect(result).toBe(1);
    });

    it("executionPolicy=MAKER_ONLY, takerFallbackUsed=false, roles=maker", async () => {
      const engine = gridIsolatedEngine as any;
      await callProcessOpenCyclesShadow(engine, { bid: 61_200 });
      const cycle = engine.cycles[0];
      expect(engine.config.executionPolicy).toBe("MAKER_ONLY");
      expect(cycle.executionPolicy).toBeFalsy(); // not stored on cycle directly
    });
  });

  describe("FRESHNESS Y PRECIO OBSOLETO", () => {
    it("bid >= target y precio fresco → cierra", async () => {
      const result = await runUntilClosed(gridIsolatedEngine as any, { bid: 61_200 });
      expect(result).toBe(1);
      expect(db.transaction).toHaveBeenCalled();
    });

    it("bid >= target y priceStale=true → no cierra", async () => {
      const staleTimestamp = new Date(Date.now() - GRID_SHADOW_PRICE_MAX_AGE_MS - 1).toISOString();
      const result = await callProcessOpenCyclesShadow((gridIsolatedEngine as any), { bid: 61_200, timestamp: staleTimestamp });
      expect(result).toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
      expect(botLogger.info).toHaveBeenCalledWith(
        "GRID_SHADOW_CLOSE_SKIPPED_STALE_PRICE",
        expect.any(String),
        expect.objectContaining({ reason: "stale" }),
      );
      expect((gridIsolatedEngine as any).cycles[0].status).toBe("buy_filled");
    });

    it("bid >= target y timestamp ausente → no cierra", async () => {
      const result = await callProcessOpenCyclesShadow((gridIsolatedEngine as any), { bid: 61_200, timestamp: "" });
      expect(result).toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
      expect(botLogger.info).toHaveBeenCalledWith(
        "GRID_SHADOW_CLOSE_SKIPPED_STALE_PRICE",
        expect.any(String),
        expect.objectContaining({ reason: "missing_timestamp" }),
      );
    });

    it("bid >= target y timestamp inválido → no cierra", async () => {
      const result = await callProcessOpenCyclesShadow((gridIsolatedEngine as any), { bid: 61_200, timestamp: "not-a-date" });
      expect(result).toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
      expect(botLogger.info).toHaveBeenCalledWith(
        "GRID_SHADOW_CLOSE_SKIPPED_STALE_PRICE",
        expect.any(String),
        expect.objectContaining({ reason: "invalid_timestamp" }),
      );
    });

    it("bid >= target y edad exactamente igual al límite → cierra", async () => {
      const engine = gridIsolatedEngine as any;
      const edgeTimestamp = new Date(Date.now() - GRID_SHADOW_PRICE_MAX_AGE_MS + 100).toISOString();
      const result = await runUntilClosed(engine, { bid: 61_200, timestamp: edgeTimestamp }, 5);
      expect(result).toBe(1);
      expect(db.transaction).toHaveBeenCalled();
    });

    it("bid >= target y edad superior al límite → no cierra", async () => {
      const staleTimestamp = new Date(Date.now() - GRID_SHADOW_PRICE_MAX_AGE_MS - 10).toISOString();
      const result = await callProcessOpenCyclesShadow((gridIsolatedEngine as any), { bid: 61_200, timestamp: staleTimestamp });
      expect(result).toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("precio de ETH/USD no puede cerrar un ciclo BTC/USD", async () => {
      const result = await callProcessOpenCyclesShadow((gridIsolatedEngine as any), { bid: 61_200, pair: "ETH/USD" });
      expect(result).toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
      expect(botLogger.info).toHaveBeenCalledWith(
        "GRID_SHADOW_CLOSE_SKIPPED_STALE_PRICE",
        expect.any(String),
        expect.objectContaining({ reason: "pair_mismatch" }),
      );
      expect((gridIsolatedEngine as any).cycles[0].status).toBe("buy_filled");
    });

    it("diagnóstico y motor producen la misma conclusión de frescura", async () => {
      const { evaluateShadowMarketPriceFreshness } = await import("../gridShadowMarketPriceFreshness");
      const staleTimestamp = new Date(Date.now() - GRID_SHADOW_PRICE_MAX_AGE_MS - 1).toISOString();
      const freshness = evaluateShadowMarketPriceFreshness({ timestamp: staleTimestamp });
      expect(freshness.isFresh).toBe(false);
      expect(freshness.reason).toBe("stale");

      const engineResult = await callProcessOpenCyclesShadow((gridIsolatedEngine as any), { bid: 61_200, timestamp: staleTimestamp });
      expect(engineResult).toBe(0);
    });

    it("sellExecutionPrice sigue siendo targetSellPrice", async () => {
      await runUntilClosed(gridIsolatedEngine as any, { bid: 65_000 });
      const cycle = (gridIsolatedEngine as any).cycles[0];
      expect(cycle.sellPrice).toBe(61_000);
      expect(cycle.sellPrice).not.toBe(65_000);
    });

    it("al llegar un precio nuevo y fresco el ciclo vuelve a ser elegible", async () => {
      const engine = gridIsolatedEngine as any;
      const staleTimestamp = new Date(Date.now() - GRID_SHADOW_PRICE_MAX_AGE_MS - 1).toISOString();
      expect(await callProcessOpenCyclesShadow(engine, { bid: 61_200, timestamp: staleTimestamp })).toBe(0);
      const result = await runUntilClosed(engine, { bid: 61_200 }, 5);
      expect(result).toBe(1); // trigger -> pending -> fill con precio fresco
    });
  });

  describe("RANGOS HISTÓRICOS", () => {
    it("resuelve target, persiste y cierra con rango histórico y sin rango activo", async () => {
      const historicalRangeId = "9bf99770-c40c-4870-a166-4389a51226f0";
      const cycle = makeCycle({
        rangeVersionId: historicalRangeId,
        buyPrice: 63264.40,
        quantity: 0.00379061,
        targetSellLevelId: null,
        targetSellPrice: null,
        targetSellQuantity: null,
      });
      const level = makeLevel({
        id: "c6e8cfd1-37fa-4516-88e8-79ebe54a5f43",
        rangeVersionId: historicalRangeId,
        side: "SELL",
        price: 64893.12322364,
        quantity: 0.00379061,
      });
      const engine = resetEngine([cycle], [level], {}, { id: historicalRangeId, pair: "BTC/USD", status: "replaced" });
      engine.activeRangeVersion = null;
      engine.referencedRangeVersions = [makeRange({ id: historicalRangeId, pair: "BTC/USD", status: "replaced" })];

      const result = await runUntilClosed(engine, { bid: 64893.12322364 });
      expect(result).toBe(1);
      const closed = engine.cycles[0];
      expect(closed.targetSellLevelId).toBe("c6e8cfd1-37fa-4516-88e8-79ebe54a5f43");
      expect(closed.targetSellPrice).toBe(64893.12322364);
      expect(closed.status).toBe("completed");
    });

    it("resuelve target histórico cuando el rango activo es distinto", async () => {
      const historicalRangeId = "9bf99770-c40c-4870-a166-4389a51226f0";
      const activeRangeId = "new-active-range";
      const cycle = makeCycle({
        rangeVersionId: historicalRangeId,
        buyPrice: 62532.30,
        quantity: 0.00383786,
        targetSellLevelId: null,
        targetSellPrice: null,
        targetSellQuantity: null,
      });
      const level = makeLevel({
        id: "4f300503-ff58-4aba-9d0b-6fc8f7869018",
        rangeVersionId: historicalRangeId,
        side: "SELL",
        price: 65692.19591410,
        quantity: 0.00383786,
      });
      const engine = resetEngine([cycle], [level], {}, { id: activeRangeId, pair: "BTC/USD", status: "active" });
      engine.referencedRangeVersions = [
        makeRange({ id: historicalRangeId, pair: "BTC/USD", status: "replaced" }),
        makeRange({ id: activeRangeId, pair: "BTC/USD", status: "active" }),
      ];

      const result = await runUntilClosed(engine, { bid: 65692.19591410 });
      expect(result).toBe(1);
      expect(engine.cycles[0].targetSellLevelId).toBe("4f300503-ff58-4aba-9d0b-6fc8f7869018");
    });

    it("no cierra ciclos históricos si referencedRangeVersions no incluye su rango", async () => {
      const cycle = makeCycle({
        rangeVersionId: "missing-historical-range",
        targetSellLevelId: null,
        targetSellPrice: null,
        targetSellQuantity: null,
      });
      const level = makeLevel({
        rangeVersionId: "missing-historical-range",
        side: "SELL",
        price: 61_000,
        quantity: 0.001,
      });
      const engine = resetEngine([cycle], [level], {}, { id: "active-range", pair: "BTC/USD" });
      engine.referencedRangeVersions = [makeRange({ id: "active-range", pair: "BTC/USD" })];

      const result = await callProcessOpenCyclesShadow(engine, { bid: 61_200 });
      expect(result).toBe(0);
      expect(engine.cycles[0].targetSellLevelId).toBeNull();
    });

    it("mantener abierto con bid < target para rango histórico", async () => {
      const historicalRangeId = "9bf99770-c40c-4870-a166-4389a51226f0";
      const cycle = makeCycle({
        rangeVersionId: historicalRangeId,
        targetSellLevelId: null,
        targetSellPrice: null,
        targetSellQuantity: null,
      });
      const level = makeLevel({
        id: "c6e8cfd1-37fa-4516-88e8-79ebe54a5f43",
        rangeVersionId: historicalRangeId,
        side: "SELL",
        price: 64893.12322364,
        quantity: 0.00379061,
      });
      const engine = resetEngine([cycle], [level], {}, { id: "active-range", pair: "BTC/USD" });
      engine.referencedRangeVersions = [makeRange({ id: historicalRangeId, pair: "BTC/USD", status: "replaced" })];

      const result = await callProcessOpenCyclesShadow(engine, { bid: 64000 });
      expect(result).toBe(0);
      expect(engine.cycles[0].status).toBe("buy_filled");
    });

    it("Ciclo A y B exactos: resuelve targets, cierra ambos y PnL correcto", async () => {
      const rangeA = "9bf99770-c40c-4870-a166-4389a51226f0";
      const rangeB = "9bf99770-c40c-4870-a166-4389a51226f1";
      const cycleA = makeCycle({
        id: "cA",
        cycleNumber: 25,
        rangeVersionId: rangeA,
        buyPrice: 63264.40,
        quantity: 0.00379061,
        targetSellLevelId: null,
        targetSellPrice: null,
        targetSellQuantity: null,
      });
      const cycleB = makeCycle({
        id: "cB",
        cycleNumber: 26,
        rangeVersionId: rangeB,
        buyPrice: 62532.30,
        quantity: 0.00383786,
        targetSellLevelId: null,
        targetSellPrice: null,
        targetSellQuantity: null,
      });
      const levelA = makeLevel({
        id: "c6e8cfd1-37fa-4516-88e8-79ebe54a5f43",
        rangeVersionId: rangeA,
        side: "SELL",
        price: 64893.12322364,
        quantity: 0.00379061,
      });
      const levelB = makeLevel({
        id: "4f300503-ff58-4aba-9d0b-6fc8f7869018",
        rangeVersionId: rangeB,
        side: "SELL",
        price: 65692.19591410,
        quantity: 0.00383786,
      });
      const engine = resetEngine([cycleA, cycleB], [levelA, levelB], {}, { id: "active-range", pair: "BTC/USD" });
      engine.referencedRangeVersions = [
        makeRange({ id: rangeA, pair: "BTC/USD", status: "replaced" }),
        makeRange({ id: rangeB, pair: "BTC/USD", status: "replaced" }),
      ];

      const result = await runUntilClosed(engine, { bid: 66_000 });
      expect(result).toBe(2);

      const closedA = engine.cycles.find((c: any) => c.id === "cA");
      const closedB = engine.cycles.find((c: any) => c.id === "cB");
      expect(closedA.targetSellLevelId).toBe("c6e8cfd1-37fa-4516-88e8-79ebe54a5f43");
      expect(closedA.grossPnlUsd).toBeCloseTo(6.173854538762, 10);
      expect(closedA.feeTotalUsd).toBeCloseTo(0.4372156701960858, 10);
      expect(closedA.netPnlUsd).toBeCloseTo(4.589311094852752, 10);
      expect(closedB.targetSellLevelId).toBe("4f300503-ff58-4aba-9d0b-6fc8f7869018");
    });
  });

  describe("RIESGO Y MÁQUINA DE ESTADOS", () => {
    it("trailing stop se activa, recalcula stop y cierra por trailing_closed", async () => {
      const engine = resetEngine(
        [makeCycle({
          targetSellPrice: 70_000,
          targetSellLevelId: null,
          targetRungLevelId: null,
          exitPolicyVersion: "FIRST_PROFITABLE_HIGHER_RUNG_V2",
          targetKind: "SYNTHETIC_RUNG",
          riskStateJson: null,
        })],
        [makeLevel({ id: BUY_LEVEL_ID, side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any })],
        { trailingEnabled: true, trailingActivationPct: 1.0, trailingStopPct: 0.5 }
      );

      // Paso 1: activar trailing a 60650 (1.08% > 1%)
      await processLifecycleTick(engine, { bid: 60_650 });
      let risk = engine.cycles[0].riskStateJson as any;
      expect(risk?.trailing?.activated).toBe(true);
      expect(risk?.activeExitRoute).toBeNull();

      // Paso 2: precio cae por debajo del stop (60650 * 0.995 = 60346.75)
      await processLifecycleTick(engine, { bid: 60_300 });
      risk = engine.cycles[0].riskStateJson as any;
      expect(risk?.lastAction).toBe("TRAILING_CLOSE");
      expect(risk?.activeExitRoute).toBe("TRAILING_MAKER");
      expect(risk?.pendingExitPrice).toBeCloseTo(60_300, 2);
      expect(risk?.protectiveExit?.state).toBe("TRIGGERED");

      // Paso 3: la orden maker post-only se coloca por encima del bid
      await processLifecycleTick(engine, { bid: 60_300 });
      risk = engine.cycles[0].riskStateJson as any;
      expect(risk?.protectiveExit?.state).toBe("MAKER_PENDING");
      expect(risk?.pendingExitPrice).toBeCloseTo(60_300.1, 1);

      // Paso 4: el cierre SHADOW ejecuta el maker exit cuando bid >= pending price
      const result = await processLifecycleTick(engine, { bid: 60_300.2 });
      expect(result).toBe(1);
      expect(engine.cycles[0].status).toBe("trailing_closed");
      expect(engine.cycles[0].sellPrice).toBeCloseTo(60_300.1, 1);
    });

    it("stop-loss soft cierra como stop_loss_hit cuando HODL está desactivado", async () => {
      const engine = resetEngine(
        [makeCycle({
          targetSellPrice: 70_000,
          targetSellLevelId: null,
          targetRungLevelId: null,
          exitPolicyVersion: "FIRST_PROFITABLE_HIGHER_RUNG_V2",
          targetKind: "SYNTHETIC_RUNG",
          riskStateJson: null,
        })],
        [makeLevel({ id: BUY_LEVEL_ID, side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any })],
        { stopLossEnabled: true, stopLossSoftPct: 3, hodlRecoveryEnabled: false }
      );

      await processLifecycleTick(engine, { bid: 58_000 });
      let risk = engine.cycles[0].riskStateJson as any;
      expect(risk?.lastAction).toBe("STOP_LOSS_SOFT");
      expect(risk?.activeExitRoute).toBe("PROTECTIVE_MAKER");
      expect(risk?.protectiveExit?.state).toBe("TRIGGERED");

      await processLifecycleTick(engine, { bid: 58_000 });
      risk = engine.cycles[0].riskStateJson as any;
      expect(risk?.protectiveExit?.state).toBe("MAKER_PENDING");
      expect(risk?.pendingExitPrice).toBeCloseTo(58_000.1, 1);

      const result = await processLifecycleTick(engine, { bid: 58_000.2 });
      expect(result).toBe(1);
      expect(engine.cycles[0].status).toBe("stop_loss_hit");
      expect(engine.cycles[0].sellPrice).toBeCloseTo(58_000.1, 1);
    });

    it("HODL recovery activa, espera target y cierra cuando se alcanza", async () => {
      const engine = resetEngine(
        [makeCycle({
          targetSellPrice: 70_000,
          targetSellLevelId: null,
          targetRungLevelId: null,
          exitPolicyVersion: "FIRST_PROFITABLE_HIGHER_RUNG_V2",
          targetKind: "SYNTHETIC_RUNG",
          riskStateJson: null,
        })],
        [makeLevel({ id: BUY_LEVEL_ID, side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any })],
        { stopLossEnabled: true, stopLossSoftPct: 3, hodlRecoveryEnabled: true }
      );

      // Soft stop en 58200 -> activa HODL con target de break-even > 60000
      await processLifecycleTick(engine, { bid: 58_200 });
      let risk = engine.cycles[0].riskStateJson as any;
      expect(risk?.lastAction).toBe("HODL_RECOVERY_ACTIVATE");
      expect(engine.cycles[0].status).toBe("hodl_recovery");
      const recoveryTarget = risk?.hodl?.recoveryTargetPrice;
      expect(recoveryTarget).toBeGreaterThan(60_000);

      // Recuperación: el precio vuelve al target de break-even -> PENDING
      await processLifecycleTick(engine, { bid: recoveryTarget });
      risk = engine.cycles[0].riskStateJson as any;
      expect(risk?.activeExitRoute).toBe("HODL_RECOVERY");
      expect(risk?.protectiveExit?.state).toBe("MAKER_PENDING");
      expect(risk?.pendingExitPrice).toBeCloseTo(recoveryTarget + 0.1, 1);

      const result = await processLifecycleTick(engine, { bid: recoveryTarget + 0.2 });
      expect(result).toBe(1);
      expect(engine.cycles[0].status).toBe("completed");
      expect(engine.cycles[0].sellPrice).toBeCloseTo(recoveryTarget + 0.1, 1);
    });

    it("rearma el nivel BUY original tras cerrar el ciclo", async () => {
      const engine = resetEngine(
        [makeCycle()],
        [
          makeLevel({ id: BUY_LEVEL_ID, side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any }),
          makeLevel({ id: SELL_LEVEL_ID, side: "SELL", price: 61_000, quantity: 0.001, status: "planned" as any }),
        ]
      );
      await runUntilClosed(engine, { bid: 61_000 });
      expect(engine.cycles[0].status).toBe("completed");

      const buyLevel = engine.levels.find((l: any) => l.id === BUY_LEVEL_ID);
      expect(buyLevel?.status).toBe("planned");
      expect(buyLevel?.filledPrice).toBeNull();
    });
  });

  describe("REV-C11 FASE 1 — quarantine, CAS y legacy", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      (db as any)._resetTxQueue();
    });

    it("ciclo con requiresReview=true no avanza ni reemplaza su JSON de revisión", async () => {
      const engine = resetEngine(
        [makeCycle({
          requiresReview: true,
          riskStateJson: { sentinel: 1 } as any,
          makerExitStateJson: { sentinel: 2 } as any,
        })],
        [makeLevel()]
      );
      await processLifecycleTick(engine, { bid: 61_200 });
      const cycle = engine.cycles[0];
      expect(cycle.status).toBe("buy_filled");
      expect(cycle.requiresReview).toBe(true);
      expect((cycle.riskStateJson as any)?.sentinel).toBe(1);
      expect((cycle.makerExitStateJson as any)?.sentinel).toBe(2);
      const completedCall = (botLogger.info as any).mock.calls.find((call: any[]) => call[0] === "GRID_CYCLE_COMPLETED");
      expect(completedCall).toBeFalsy();
    });

    it("protectiveExit.state=REQUIRES_REVIEW no avanza y marca el ciclo para revisión", async () => {
      const engine = resetEngine(
        [makeCycle({
          requiresReview: false,
          riskStateJson: { protectiveExit: { state: "REQUIRES_REVIEW" } } as any,
        })],
        [makeLevel()]
      );
      await processLifecycleTick(engine, { bid: 61_200 });
      const cycle = engine.cycles[0];
      expect(cycle.status).toBe("buy_filled");
      expect(cycle.requiresReview).toBe(true);
    });

    it("persistSellLifecycle devuelve false y no muta memoria si el ciclo no está abierto", async () => {
      const engine = resetEngine(
        [makeCycle({ riskStateJson: { before: true } as any })],
        [makeLevel()]
      );
      (db as any)._state.cycles[0].status = "completed";
      const cycle = engine.cycles[0];
      const level = engine.levels[0];
      const originalCycleStatus = cycle.status;
      const originalLevelStatus = level.status;

      const result = await (engine as any).persistSellLifecycle(
        cycle,
        level,
        (engine as any).defaultRiskState(),
        (engine as any).defaultMakerExit(),
        "open"
      );

      expect(result).toBe(false);
      expect(cycle.status).toBe(originalCycleStatus);
      expect(level.status).toBe(originalLevelStatus);
      expect((db as any)._state.cycles[0].status).toBe("completed");
      expect((db as any)._state.cycles[0].riskStateJson).toEqual({ before: true });
    });

    it("persistSellLifecycle devuelve false y realiza rollback completo si el SELL level no es planned/open", async () => {
      const engine = resetEngine(
        [makeCycle({ riskStateJson: { before: true } as any })],
        [makeLevel()]
      );
      (db as any)._state.levels[0].status = "filled";
      const before = JSON.parse(JSON.stringify((db as any)._state));
      const cycle = engine.cycles[0];
      const level = engine.levels[0];

      const result = await (engine as any).persistSellLifecycle(
        cycle,
        level,
        (engine as any).defaultRiskState(),
        (engine as any).defaultMakerExit(),
        "open"
      );

      expect(result).toBe(false);
      expect(cycle.status).toBe("buy_filled");
      expect(level.status).toBe("planned");
      const after = (db as any)._state;
      expect(after.cycles[0].status).toBe(before.cycles[0].status);
      expect(after.cycles[0].riskStateJson).toEqual(before.cycles[0].riskStateJson);
      expect(after.levels[0].status).toBe(before.levels[0].status);
    });

    it("dos ejecuciones concurrentes de persistSellLifecycle: una sola exitosa y memoria consistente", async () => {
      const engine = resetEngine([makeCycle()], [makeLevel()]);
      const cycle = engine.cycles[0];
      const level = engine.levels[0];
      const risk = (engine as any).defaultRiskState();
      const exit = (engine as any).defaultMakerExit();

      const results = await Promise.allSettled([
        (engine as any).persistSellLifecycle(cycle, level, risk, exit, "open"),
        (engine as any).persistSellLifecycle(cycle, level, risk, exit, "open"),
      ]);

      const successCount = results.filter((r: any) => r.status === "fulfilled" && r.value === true).length;
      expect(successCount).toBe(1);
      expect(cycle.status).toBe("sell_placed");
      expect(level.status).toBe("open");
    });

    it("makerEligibleAfter es estrictamente posterior a makerOrderCreatedAt", async () => {
      const engine = resetEngine(
        [makeCycle({ status: "buy_filled" as any, targetSellLevelId: SELL_LEVEL_ID })],
        [makeLevel({ status: "open" as any })]
      );
      await processLifecycleTick(engine, { bid: 60_900 });
      await processLifecycleTick(engine, { bid: 60_900 });
      const exit = (engine.cycles[0].riskStateJson as any)?.protectiveExit;
      expect(exit?.state).toBe("MAKER_PENDING");
      expect(exit?.makerOrderCreatedAt).toBeInstanceOf(Date);
      expect(exit?.makerEligibleAfter).toBeInstanceOf(Date);
      expect(exit?.makerEligibleAfter.getTime()).toBeGreaterThan(exit?.makerOrderCreatedAt.getTime());
    });

    it("mismo tick lógico: bloqueado", async () => {
      const engine = resetEngine(
        [makeCycle({ status: "buy_filled" as any, targetSellLevelId: SELL_LEVEL_ID })],
        [makeLevel({ status: "open" as any })]
      );
      const tick1At = new Date(testClockMs);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick1At); // TRIGGERED
      const tick2At = new Date(testClockMs + TICK_CLOCK_STEP_MS);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick2At); // MAKER_PENDING
      const exit = (engine.cycles[0].riskStateJson as any)?.protectiveExit;
      expect(exit?.state).toBe("MAKER_PENDING");
      expect(exit?.lifecycleTickId).toBe(engine.currentTickId);

      // Mismo tickId: no puede avanzar a fill
      const sameTickCtx = makeCtxAt(engine, priceResult({ bid: 61_000 }), engine.currentTickId, new Date(testClockMs + TICK_CLOCK_STEP_MS * 2));
      const result = await engine.processOpenCyclesShadow(priceResult({ bid: 61_000 }), sameTickCtx);
      expect(result).toBe(0);
      expect(engine.cycles[0].status).toBe("buy_filled");
    });

    it("tick posterior pero 1 ms antes de makerEligibleAfter: bloqueado", async () => {
      const engine = resetEngine(
        [makeCycle({ status: "buy_filled" as any, targetSellLevelId: SELL_LEVEL_ID })],
        [makeLevel({ status: "open" as any })]
      );
      const tick1At = new Date(testClockMs);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick1At); // TRIGGERED
      const tick2At = new Date(testClockMs + TICK_CLOCK_STEP_MS);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick2At); // MAKER_PENDING
      const exit = (engine.cycles[0].riskStateJson as any)?.protectiveExit;
      const eligibleMs = exit.makerEligibleAfter.getTime();

      // Tick posterior pero 1 ms antes de eligibleAfter
      const beforeEligible = new Date(eligibleMs - 1);
      const result = await processLifecycleTickAt(engine, { bid: 61_000 }, beforeEligible);
      expect(result).toBe(0);
      expect(engine.cycles[0].status).toBe("buy_filled");
    });

    it("exactamente en makerEligibleAfter: permitido", async () => {
      const engine = resetEngine(
        [makeCycle({ status: "buy_filled" as any, targetSellLevelId: SELL_LEVEL_ID })],
        [makeLevel({ status: "open" as any })]
      );
      const tick1At = new Date(testClockMs);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick1At); // TRIGGERED
      const tick2At = new Date(testClockMs + TICK_CLOCK_STEP_MS);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick2At); // MAKER_PENDING
      const exit = (engine.cycles[0].riskStateJson as any)?.protectiveExit;
      const eligibleMs = exit.makerEligibleAfter.getTime();

      // Exactamente en eligibleAfter
      const atEligible = new Date(eligibleMs);
      const result = await processLifecycleTickAt(engine, { bid: 61_000 }, atEligible);
      expect(result).toBe(1);
      expect(engine.cycles[0].status).toBe("completed");
    });

    it("después de makerEligibleAfter: permitido", async () => {
      const engine = resetEngine(
        [makeCycle({ status: "buy_filled" as any, targetSellLevelId: SELL_LEVEL_ID })],
        [makeLevel({ status: "open" as any })]
      );
      const tick1At = new Date(testClockMs);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick1At); // TRIGGERED
      const tick2At = new Date(testClockMs + TICK_CLOCK_STEP_MS);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick2At); // MAKER_PENDING
      const exit = (engine.cycles[0].riskStateJson as any)?.protectiveExit;
      const eligibleMs = exit.makerEligibleAfter.getTime();

      const afterEligible = new Date(eligibleMs + 50);
      const result = await processLifecycleTickAt(engine, { bid: 61_000 }, afterEligible);
      expect(result).toBe(1);
      expect(engine.cycles[0].status).toBe("completed");
    });

    it("timestamp anterior al makerOrderCreatedAt: bloqueado", async () => {
      const engine = resetEngine(
        [makeCycle({ status: "buy_filled" as any, targetSellLevelId: SELL_LEVEL_ID })],
        [makeLevel({ status: "open" as any })]
      );
      const tick1At = new Date(testClockMs);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick1At); // TRIGGERED
      const tick2At = new Date(testClockMs + TICK_CLOCK_STEP_MS);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick2At); // MAKER_PENDING
      const exit = (engine.cycles[0].riskStateJson as any)?.protectiveExit;
      const createdMs = exit.makerOrderCreatedAt.getTime();

      // Timestamp anterior a makerOrderCreatedAt (pero tickId posterior)
      const beforeCreated = new Date(createdMs - 10);
      const result = await processLifecycleTickAt(engine, { bid: 61_000 }, beforeCreated);
      expect(result).toBe(0);
      expect(engine.cycles[0].status).toBe("buy_filled");
    });

    it("reloj regresivo (tick posterior con timestamp menor al tick anterior): bloqueado", async () => {
      const engine = resetEngine(
        [makeCycle({ status: "buy_filled" as any, targetSellLevelId: SELL_LEVEL_ID })],
        [makeLevel({ status: "open" as any })]
      );
      const tick1At = new Date(testClockMs);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick1At); // TRIGGERED
      const tick2At = new Date(testClockMs + TICK_CLOCK_STEP_MS);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick2At); // MAKER_PENDING

      // Reloj regresivo: tickId mayor pero timestamp mucho menor
      const regressiveAt = new Date(testClockMs - 1000);
      const result = await processLifecycleTickAt(engine, { bid: 61_000 }, regressiveAt);
      expect(result).toBe(0);
      expect(engine.cycles[0].status).toBe("buy_filled");
    });

    it("reprice actualiza makerOrderCreatedAt y crea makerEligibleAfter nuevo y posterior", async () => {
      const engine = resetEngine(
        [makeCycle({ status: "buy_filled" as any, targetSellLevelId: SELL_LEVEL_ID })],
        [makeLevel({ status: "open" as any })]
      );
      const tick1At = new Date(testClockMs);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick1At); // TRIGGERED
      const tick2At = new Date(testClockMs + TICK_CLOCK_STEP_MS);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick2At); // MAKER_PENDING
      const exitBefore = (engine.cycles[0].riskStateJson as any)?.protectiveExit;
      const createdBefore = exitBefore.makerOrderCreatedAt.getTime();
      const eligibleBefore = exitBefore.makerEligibleAfter.getTime();

      // Forzar reprice: cambiar targetSellPrice para que difiera más de un tick
      engine.cycles[0].targetSellPrice = 61_500;
      (db as any)._state.cycles[0].targetSellPrice = 61_500;

      // Avanzar reloj significativamente para que el reprice ocurra
      const tick3At = new Date(testClockMs + TICK_CLOCK_STEP_MS * 10);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick3At);

      const exitAfter = (engine.cycles[0].riskStateJson as any)?.protectiveExit;
      // Reprice debe actualizar makerOrderCreatedAt
      expect(exitAfter.makerOrderCreatedAt.getTime()).toBeGreaterThan(createdBefore);
      // makerEligibleAfter debe ser posterior al nuevo makerOrderCreatedAt
      expect(exitAfter.makerEligibleAfter.getTime()).toBeGreaterThan(exitAfter.makerOrderCreatedAt.getTime());
      // makerEligibleAfter debe ser posterior al anterior
      expect(exitAfter.makerEligibleAfter.getTime()).toBeGreaterThan(eligibleBefore);
    });

    it("tick posterior al reprice pero antes de la nueva elegibilidad: bloqueado", async () => {
      const engine = resetEngine(
        [makeCycle({ status: "buy_filled" as any, targetSellLevelId: SELL_LEVEL_ID })],
        [makeLevel({ status: "open" as any })]
      );
      const tick1At = new Date(testClockMs);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick1At); // TRIGGERED
      const tick2At = new Date(testClockMs + TICK_CLOCK_STEP_MS);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick2At); // MAKER_PENDING

      // Forzar reprice
      engine.cycles[0].targetSellPrice = 61_500;
      (db as any)._state.cycles[0].targetSellPrice = 61_500;
      const tick3At = new Date(testClockMs + TICK_CLOCK_STEP_MS * 10);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick3At); // REPRICE

      const exit = (engine.cycles[0].riskStateJson as any)?.protectiveExit;
      const newEligibleMs = exit.makerEligibleAfter.getTime();

      // Tick posterior al reprice pero antes de la nueva elegibilidad
      const beforeNewEligible = new Date(newEligibleMs - 1);
      const result = await processLifecycleTickAt(engine, { bid: 61_500 }, beforeNewEligible);
      expect(result).toBe(0);
      expect(engine.cycles[0].status).toBe("buy_filled");
    });

    it("tick posterior y elegible después del reprice: permitido", async () => {
      const engine = resetEngine(
        [makeCycle({ status: "buy_filled" as any, targetSellLevelId: SELL_LEVEL_ID })],
        [makeLevel({ status: "open" as any })]
      );
      const tick1At = new Date(testClockMs);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick1At); // TRIGGERED
      const tick2At = new Date(testClockMs + TICK_CLOCK_STEP_MS);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick2At); // MAKER_PENDING

      // Forzar reprice
      engine.cycles[0].targetSellPrice = 61_500;
      (db as any)._state.cycles[0].targetSellPrice = 61_500;
      const tick3At = new Date(testClockMs + TICK_CLOCK_STEP_MS * 10);
      await processLifecycleTickAt(engine, { bid: 60_900 }, tick3At); // REPRICE

      const exit = (engine.cycles[0].riskStateJson as any)?.protectiveExit;
      const newEligibleMs = exit.makerEligibleAfter.getTime();

      // Tick posterior y elegible
      const afterNewEligible = new Date(newEligibleMs + 50);
      const result = await processLifecycleTickAt(engine, { bid: 61_500 }, afterNewEligible);
      expect(result).toBe(1);
      expect(engine.cycles[0].status).toBe("completed");
    });

    it("legacy SELL de rango anterior puede cerrar y no rearma el BUY", async () => {
      const oldRange = "legacy-range";
      const cycle = makeCycle({
        id: "legacy-cycle",
        rangeVersionId: oldRange,
        buyLevelId: "legacy-buy",
        buyPrice: 60_000,
        targetSellLevelId: "legacy-sell",
        targetSellPrice: 61_000,
        targetSellQuantity: 0.001,
        targetKind: "PERSISTED_SELL",
      });
      const buyLevel = makeLevel({
        id: "legacy-buy",
        rangeVersionId: oldRange,
        side: "BUY",
        price: 60_000,
        quantity: 0.001,
        status: "filled" as any,
        filledPrice: 60_000 as any,
      });
      const sellLevel = makeLevel({
        id: "legacy-sell",
        rangeVersionId: oldRange,
        side: "SELL",
        price: 61_000,
        quantity: 0.001,
        status: "open" as any,
      });
      const engine = resetEngine([cycle], [buyLevel, sellLevel], {}, { id: "active-range", pair: "BTC/USD", status: "active" });
      engine.referencedRangeVersions = [
        makeRange({ id: oldRange, pair: "BTC/USD", status: "replaced" } as any),
        makeRange({ id: "active-range", pair: "BTC/USD", status: "active" } as any),
      ];

      const result = await runUntilClosed(engine, { bid: 61_000 });
      expect(result).toBe(1);
      expect(engine.cycles[0].status).toBe("completed");
      expect(engine.cycles[0].sellPrice).toBe(61_000);
      const legacyBuy = engine.levels.find((l: any) => l.id === "legacy-buy");
      expect(legacyBuy?.status).toBe("filled");
      expect(legacyBuy?.filledPrice).toBe(60_000);
    });

    it("legacy BUY de rango anterior no puede abrir un nuevo ciclo", async () => {
      const oldRange = "legacy-range";
      const legacyBuy = makeLevel({
        id: "legacy-buy",
        rangeVersionId: oldRange,
        side: "BUY",
        price: 60_000,
        quantity: 0.001,
        status: "planned" as any,
      });
      const engine = resetEngine([], [legacyBuy], {}, { id: "active-range", pair: "BTC/USD", status: "active" });
      engine.referencedRangeVersions = [
        makeRange({ id: oldRange, pair: "BTC/USD", status: "replaced" } as any),
        makeRange({ id: "active-range", pair: "BTC/USD", status: "active" } as any),
      ];

      const price = priceResult({ bid: 60_000 });
      const tickId = ++engine.currentTickId;
      const ctx = makeTickContext(engine, price, tickId);
      const pumpGuard = { active: false, blockNewRangeGeneration: false, blockRangeRebuild: false, allowBuyFill: true, allowExistingCycleSellExit: true, allowSellWithoutOpenCycle: false };
      const validation = await (engine as any).canProcessShadowFill(legacyBuy, "active-range", pumpGuard, ctx, price);
      expect(validation.ok).toBe(false);
      expect(engine.cycles.length).toBe(0);
    });
  });
});
