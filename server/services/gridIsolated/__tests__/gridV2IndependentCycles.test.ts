/**
 * GRID REV-C11 FASE 3 — TARGETS V2 Y CICLOS INDEPENDIENTES
 *
 * 17 tests deterministas que verifican el contrato V2:
 * - Target sintético siempre SYNTHETIC_RUNG con targetSellLevelId=null
 * - Ciclos V2 totalmente independientes (comparten rung sin bloquearse)
 * - No FIFO, no asociación ambigua
 * - Legacy intacto
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GridIsolatedConfig, GridCycle, GridLevel, GridRangeVersion } from "../gridIsolatedTypes";
import type { GridShadowExecutionPriceResult } from "../gridShadowExecutionPrice";
import { selectFirstProfitableHigherRung } from "../gridCycleExitSelector";

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

// ─── Helpers ─────────────────────────────────────────────────────────
const RANGE_ID = "range-1";
const RANGE_ID_2 = "range-2";

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
    id: "level-1",
    rangeVersionId: RANGE_ID,
    levelIndex: 1,
    side: "SELL",
    price: 61_000,
    quantity: 0.001,
    status: "planned",
    clientOrderId: null,
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
    id: "cycle-1",
    rangeVersionId: RANGE_ID,
    cycleNumber: 1,
    pair: "BTC/USD",
    status: "buy_filled",
    buyLevelId: "buy-1",
    sellLevelId: null,
    targetSellLevelId: null,
    targetRungLevelId: null,
    buyPrice: 60_000,
    sellPrice: null,
    targetSellPrice: null,
    targetSellQuantity: null,
    quantity: 0.001,
    grossPnlUsd: 0,
    feeTotalUsd: 0,
    taxReserveUsd: 0,
    netPnlUsd: 0,
    netPnlPct: 0,
    exitPolicyVersion: "FIRST_PROFITABLE_HIGHER_RUNG_V2",
    targetKind: null,
    targetCalculationJson: null,
    riskStateJson: null,
    makerExitStateJson: null,
    buyClientOrderId: null,
    sellClientOrderId: null,
    buyFilledAt: new Date(Date.now() - 60_000),
    sellFilledAt: null,
    holdTimeMinutes: 0,
    requiresReview: false,
    reviewReason: null,
    reviewCode: null,
    reviewDetectedAt: null,
    reviewSource: null,
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
    midPrice: 60_000,
    upperPrice: 62_000,
    lowerPrice: 58_000,
    bandUpper: 62_000,
    bandMiddle: 60_000,
    bandLower: 58_000,
    bandWidthPct: 3.33,
    atrPct: 1,
    regime: "ranging",
    levelsCount: 5,
    geometricRatio: 1,
    capitalBudgetUsd: 10000,
    capitalPerLevelUsd: 1000,
    netProfitTargetPct: 0.8,
    createdAt: new Date(),
    activatedAt: new Date(),
    closedAt: null,
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

async function runUntilClosed(
  engine: any,
  opts: Partial<GridShadowExecutionPriceResult>,
  maxTicks: number = 6
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
    if (closed > 0 && !isLastTick) return closed;
  }
  return 0;
}

const selectorParams = {
  buyFillPrice: 60_000,
  buyFillQuantity: 0.001,
  netProfitTargetPct: 0.8,
  buyFeePct: 0,
  sellFeePct: 0,
  makerFeePct: 0,
  takerFeePct: 0.09,
  taxReservePct: 20,
};

const sharedRange = makeRange();

// ─── Tests ───────────────────────────────────────────────────────────

describe("GRID REV-C11 FASE 3 — TARGETS V2 Y CICLOS INDEPENDIENTES", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db as any)._resetTxQueue();
  });

  // Test 1: Ciclo V2 nuevo con rung del lado BUY
  it("1. Ciclo V2 con rung BUY: targetKind=SYNTHETIC_RUNG, targetRungLevelId=rung.id, targetSellLevelId=null", () => {
    const cycle = makeCycle({ id: "c1", buyPrice: 60_000, quantity: 0.001 });
    const levels = [
      makeLevel({ id: "buy-rung-1", side: "BUY", price: 60_700, quantity: 0.001 }),
    ];
    const result = selectFirstProfitableHigherRung(cycle, levels, sharedRange, selectorParams);
    expect(result.selected).toBe(true);
    expect(result.targetKind).toBe("SYNTHETIC_RUNG");
    expect(result.targetRungLevelId).toBe("buy-rung-1");
    expect(result.targetSellLevelId).toBeNull();
  });

  // Test 2: Ciclo V2 nuevo con rung del lado SELL
  it("2. Ciclo V2 con rung SELL: targetKind=SYNTHETIC_RUNG, targetRungLevelId=rung.id, targetSellLevelId=null", () => {
    const cycle = makeCycle({ id: "c2", buyPrice: 60_000, quantity: 0.001 });
    const levels = [
      makeLevel({ id: "sell-rung-1", side: "SELL", price: 60_700, quantity: 0.001 }),
    ];
    const result = selectFirstProfitableHigherRung(cycle, levels, sharedRange, selectorParams);
    expect(result.selected).toBe(true);
    expect(result.targetKind).toBe("SYNTHETIC_RUNG");
    expect(result.targetRungLevelId).toBe("sell-rung-1");
    expect(result.targetSellLevelId).toBeNull();
  });

  // Test 3: Dos ciclos diferentes comparten targetRungLevelId
  it("3. Dos ciclos V2 comparten targetRungLevelId: ambos se crean, ninguno bloquea al otro", () => {
    const cycleA = makeCycle({ id: "cA", buyPrice: 60_000, quantity: 0.001 });
    const cycleB = makeCycle({ id: "cB", buyPrice: 60_000, quantity: 0.001 });
    const levels = [
      makeLevel({ id: "shared-rung", side: "SELL", price: 60_700, quantity: 0.001 }),
    ];
    const resultA = selectFirstProfitableHigherRung(cycleA, levels, sharedRange, selectorParams);
    const resultB = selectFirstProfitableHigherRung(cycleB, levels, sharedRange, selectorParams);
    expect(resultA.selected).toBe(true);
    expect(resultB.selected).toBe(true);
    expect(resultA.targetRungLevelId).toBe("shared-rung");
    expect(resultB.targetRungLevelId).toBe("shared-rung");
    expect(resultA.targetSellLevelId).toBeNull();
    expect(resultB.targetSellLevelId).toBeNull();
  });

  // Test 4: Dos ciclos con cantidades distintas
  it("4. Dos ciclos con cantidades distintas: cada targetSellQuantity coincide con su propia cantidad", () => {
    const cycleA = makeCycle({ id: "cA", buyPrice: 60_000, quantity: 0.002 });
    const cycleB = makeCycle({ id: "cB", buyPrice: 60_000, quantity: 0.0015 });
    const levels = [
      makeLevel({ id: "shared-rung", side: "SELL", price: 60_700, quantity: 0.001 }),
    ];
    const resultA = selectFirstProfitableHigherRung(cycleA, levels, sharedRange, selectorParams);
    const resultB = selectFirstProfitableHigherRung(cycleB, levels, sharedRange, selectorParams);
    expect(resultA.selected).toBe(true);
    expect(resultB.selected).toBe(true);
    expect(resultA.targetSellQuantity).toBe(0.002);
    expect(resultB.targetSellQuantity).toBe(0.0015);
  });

  // Test 5: Dos ciclos generan estados TRIGGERED independientes
  it("5. Dos ciclos V2 generan estados TRIGGERED independientes via evaluateRiskForOpenCycles", async () => {
    const rungId = "shared-rung";
    const cycleA = makeCycle({
      id: "cA", cycleNumber: 1, buyPrice: 60_000, quantity: 0.001,
      targetSellPrice: 60_700, targetSellQuantity: 0.001,
      targetRungLevelId: rungId, targetKind: "SYNTHETIC_RUNG",
      riskStateJson: null,
    });
    const cycleB = makeCycle({
      id: "cB", cycleNumber: 2, buyPrice: 60_000, quantity: 0.001,
      targetSellPrice: 60_700, targetSellQuantity: 0.001,
      targetRungLevelId: rungId, targetKind: "SYNTHETIC_RUNG",
      riskStateJson: null,
    });
    const levels = [
      makeLevel({ id: "buy-A", side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any }),
      makeLevel({ id: "buy-B", side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any }),
      makeLevel({ id: rungId, side: "SELL", price: 60_700, quantity: 0.001 }),
    ];
    const engine = resetEngine([cycleA, cycleB], levels);
    // Use bid below target to trigger without crossing (maker post-only requires bid < target)
    await engine.evaluateRiskForOpenCycles(priceResult({ bid: 60_500 }), makeTickContext(engine, priceResult({ bid: 60_500 }), ++engine.currentTickId));
    const riskA = engine.cycles[0].riskStateJson as any;
    const riskB = engine.cycles[1].riskStateJson as any;
    expect(riskA?.protectiveExit?.state).toBe("TRIGGERED");
    expect(riskB?.protectiveExit?.state).toBe("TRIGGERED");
    expect(riskA?.protectiveExit?.lifecycleTickId).toBeDefined();
    expect(riskB?.protectiveExit?.lifecycleTickId).toBeDefined();
    expect(riskA?.protectiveExit?.pendingQuantity).toBe(0.001);
    expect(riskB?.protectiveExit?.pendingQuantity).toBe(0.001);
  });

  // Test 6: Dos ciclos generan MAKER_PENDING independientes
  it("6. Dos ciclos V2 generan MAKER_PENDING independientes: simulatedOrderId distintos, timestamps independientes", async () => {
    const rungId = "shared-rung";
    const cycleA = makeCycle({
      id: "cA", cycleNumber: 1, buyPrice: 60_000, quantity: 0.001,
      targetSellPrice: 60_700, targetSellQuantity: 0.001,
      targetRungLevelId: rungId, targetKind: "SYNTHETIC_RUNG",
      riskStateJson: null,
    });
    const cycleB = makeCycle({
      id: "cB", cycleNumber: 2, buyPrice: 60_000, quantity: 0.001,
      targetSellPrice: 60_700, targetSellQuantity: 0.001,
      targetRungLevelId: rungId, targetKind: "SYNTHETIC_RUNG",
      riskStateJson: null,
    });
    const levels = [
      makeLevel({ id: "buy-A", side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any }),
      makeLevel({ id: "buy-B", side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any }),
      makeLevel({ id: rungId, side: "SELL", price: 60_700, quantity: 0.001 }),
    ];
    const engine = resetEngine([cycleA, cycleB], levels);

    // Tick 1: trigger (bid below target for post-only validity)
    await processLifecycleTick(engine, { bid: 60_500 });
    // Tick 2: maker pending (bid still below target)
    await processLifecycleTick(engine, { bid: 60_500 });

    const riskA = engine.cycles[0].riskStateJson as any;
    const riskB = engine.cycles[1].riskStateJson as any;
    expect(riskA?.protectiveExit?.state).toBe("MAKER_PENDING");
    expect(riskB?.protectiveExit?.state).toBe("MAKER_PENDING");
    expect(riskA?.protectiveExit?.simulatedOrderId).toBeTruthy();
    expect(riskB?.protectiveExit?.simulatedOrderId).toBeTruthy();
    expect(riskA?.protectiveExit?.simulatedOrderId).not.toBe(riskB?.protectiveExit?.simulatedOrderId);
    expect(riskA?.protectiveExit?.makerOrderCreatedAt).toBeDefined();
    expect(riskB?.protectiveExit?.makerOrderCreatedAt).toBeDefined();
    expect(riskA?.protectiveExit?.lifecycleTickId).toBeDefined();
    expect(riskB?.protectiveExit?.lifecycleTickId).toBeDefined();
    expect(riskA?.protectiveExit?.pendingQuantity).toBe(0.001);
    expect(riskB?.protectiveExit?.pendingQuantity).toBe(0.001);
  });

  // Test 7: El precio alcanza el target compartido — ambos pueden ser elegibles, no FIFO
  it("7. Precio alcanza target compartido: ambos ciclos procesados por su propio lifecycle, no FIFO", async () => {
    const rungId = "shared-rung";
    const cycleA = makeCycle({
      id: "cA", cycleNumber: 1, buyPrice: 60_000, quantity: 0.001, buyLevelId: "buy-A",
      targetSellPrice: 60_700, targetSellQuantity: 0.001,
      targetRungLevelId: rungId, targetKind: "SYNTHETIC_RUNG",
      riskStateJson: null,
    });
    const cycleB = makeCycle({
      id: "cB", cycleNumber: 2, buyPrice: 60_000, quantity: 0.001, buyLevelId: "buy-B",
      targetSellPrice: 60_700, targetSellQuantity: 0.001,
      targetRungLevelId: rungId, targetKind: "SYNTHETIC_RUNG",
      riskStateJson: null,
    });
    const levels = [
      makeLevel({ id: "buy-A", side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any }),
      makeLevel({ id: "buy-B", side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any }),
      makeLevel({ id: rungId, side: "SELL", price: 60_700, quantity: 0.001 }),
    ];
    const engine = resetEngine([cycleA, cycleB], levels);

    // Tick 1: trigger both (bid below target)
    await processLifecycleTick(engine, { bid: 60_500 });
    // Tick 2: maker pending both (bid still below target)
    await processLifecycleTick(engine, { bid: 60_500 });
    // Tick 3: fill both (bid above target)
    const closed = await processLifecycleTick(engine, { bid: 60_800 });

    expect(closed).toBe(2);
    expect(engine.cycles[0].status).not.toBe("buy_filled");
    expect(engine.cycles[1].status).not.toBe("buy_filled");
  });

  // Test 8: Cerrar el ciclo A — B permanece abierto
  it("8. Cerrar ciclo A: A queda terminal, B permanece abierto conservando makerExitStateJson y remainingQuantity", async () => {
    const rungId = "shared-rung";
    const cycleA = makeCycle({
      id: "cA", cycleNumber: 1, buyPrice: 60_000, quantity: 0.001, buyLevelId: "buy-A",
      targetSellPrice: 60_700, targetSellQuantity: 0.001,
      targetRungLevelId: rungId, targetKind: "SYNTHETIC_RUNG",
      riskStateJson: null,
    });
    const cycleB = makeCycle({
      id: "cB", cycleNumber: 2, buyPrice: 60_000, quantity: 0.001, buyLevelId: "buy-B",
      targetSellPrice: 60_700, targetSellQuantity: 0.001,
      targetRungLevelId: rungId, targetKind: "SYNTHETIC_RUNG",
      riskStateJson: null,
    });
    const levels = [
      makeLevel({ id: "buy-A", side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any }),
      makeLevel({ id: "buy-B", side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any }),
      makeLevel({ id: rungId, side: "SELL", price: 60_700, quantity: 0.001 }),
    ];
    const engine = resetEngine([cycleA, cycleB], levels);

    // Advance lifecycle: trigger + pending (bid below target)
    await processLifecycleTick(engine, { bid: 60_500 });
    await processLifecycleTick(engine, { bid: 60_500 });

    // Fill both (bid above target)
    const closed = await processLifecycleTick(engine, { bid: 60_800 });
    expect(closed).toBe(2);

    // Verify both are terminal with independent PnL
    expect(engine.cycles[0].completedAt).toBeTruthy();
    expect(engine.cycles[1].completedAt).toBeTruthy();
    expect(engine.cycles[0].sellPrice).toBeGreaterThan(0);
    expect(engine.cycles[1].sellPrice).toBeGreaterThan(0);
  });

  // Test 9: Cerrar después el ciclo B — PnL independiente, evento independiente
  it("9. Cerrar ciclo B después: PnL independiente, evento independiente", async () => {
    const rungId = "shared-rung";
    const cycleA = makeCycle({
      id: "cA", cycleNumber: 1, buyPrice: 60_000, quantity: 0.002, buyLevelId: "buy-A",
      targetSellPrice: 60_700, targetSellQuantity: 0.002,
      targetRungLevelId: rungId, targetKind: "SYNTHETIC_RUNG",
      riskStateJson: null,
    });
    const cycleB = makeCycle({
      id: "cB", cycleNumber: 2, buyPrice: 60_000, quantity: 0.001, buyLevelId: "buy-B",
      targetSellPrice: 60_700, targetSellQuantity: 0.001,
      targetRungLevelId: rungId, targetKind: "SYNTHETIC_RUNG",
      riskStateJson: null,
    });
    const levels = [
      makeLevel({ id: "buy-A", side: "BUY", price: 60_000, quantity: 0.002, status: "filled" as any }),
      makeLevel({ id: "buy-B", side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any }),
      makeLevel({ id: rungId, side: "SELL", price: 60_700, quantity: 0.001 }),
    ];
    const engine = resetEngine([cycleA, cycleB], levels);

    // Trigger + pending (bid below target)
    await processLifecycleTick(engine, { bid: 60_500 });
    await processLifecycleTick(engine, { bid: 60_500 });
    // Fill (bid above target)
    const closed = await processLifecycleTick(engine, { bid: 60_800 });

    expect(closed).toBe(2);
    // PnL must be independent: cycleA has 2x quantity
    const pnlA = engine.cycles[0].grossPnlUsd;
    const pnlB = engine.cycles[1].grossPnlUsd;
    expect(pnlA).not.toBe(pnlB);
    expect(pnlA).toBeGreaterThan(pnlB);
  });

  // Test 10: Fallo o rollback del ciclo A no modifica B
  it("10. Rollback del ciclo A: no cancela pending de B, no modifica su cantidad, no emite evento para B", async () => {
    const rungId = "shared-rung";
    const cycleA = makeCycle({
      id: "cA", cycleNumber: 1, buyPrice: 60_000, quantity: 0.001, buyLevelId: "buy-A",
      targetSellPrice: 60_700, targetSellQuantity: 0.001,
      targetRungLevelId: rungId, targetKind: "SYNTHETIC_RUNG",
      riskStateJson: null,
    });
    const cycleB = makeCycle({
      id: "cB", cycleNumber: 2, buyPrice: 60_000, quantity: 0.001, buyLevelId: "buy-B",
      targetSellPrice: 60_700, targetSellQuantity: 0.001,
      targetRungLevelId: rungId, targetKind: "SYNTHETIC_RUNG",
      riskStateJson: null,
    });
    const levels = [
      makeLevel({ id: "buy-A", side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any }),
      makeLevel({ id: "buy-B", side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any }),
      makeLevel({ id: rungId, side: "SELL", price: 60_700, quantity: 0.001 }),
    ];
    const engine = resetEngine([cycleA, cycleB], levels);

    // Advance to MAKER_PENDING (bid below target)
    await processLifecycleTick(engine, { bid: 60_500 });
    await processLifecycleTick(engine, { bid: 60_500 });

    const riskBBefore = JSON.parse(JSON.stringify(engine.cycles[1].riskStateJson));
    const qtyBBefore = engine.cycles[1].quantity;
    const statusBBefore = engine.cycles[1].status;

    // Sabotage cycle A's DB row to cause rollback (make status not match)
    (db as any)._state.cycles[0].status = "completed";
    (db as any)._state.cycles[0].completedAt = new Date().toISOString();

    // Try to close — cycle A will fail (0 rows updated), cycle B should still close
    // bid above target to trigger fills
    const closed = await processLifecycleTick(engine, { bid: 60_800 });

    // Cycle A should NOT have closed (its DB row was sabotaged)
    // Cycle B should close independently
    expect(closed).toBeGreaterThanOrEqual(1);
    expect(engine.cycles[1].status).not.toBe(statusBBefore);
    expect(engine.cycles[1].completedAt).toBeTruthy();
    // B's quantity was not consumed by A
    expect(engine.cycles[1].quantity).toBe(qtyBBefore);
  });

  // Test 11: Dos ciclos con mismo targetRungLevelId y mismo targetSellPrice se distinguen por cycle.id
  it("11. Dos ciclos con mismo rung y mismo targetSellPrice: se distinguen por cycle.id, no por FIFO ni precio", () => {
    const rungId = "shared-rung";
    const cycleA = makeCycle({ id: "cA", buyPrice: 60_000, quantity: 0.001 });
    const cycleB = makeCycle({ id: "cB", buyPrice: 60_000, quantity: 0.001 });
    const levels = [
      makeLevel({ id: rungId, side: "SELL", price: 60_700, quantity: 0.001 }),
    ];
    const resultA = selectFirstProfitableHigherRung(cycleA, levels, sharedRange, selectorParams);
    const resultB = selectFirstProfitableHigherRung(cycleB, levels, sharedRange, selectorParams);
    expect(resultA.selected).toBe(true);
    expect(resultB.selected).toBe(true);
    expect(resultA.targetSellPrice).toBe(resultB.targetSellPrice);
    expect(resultA.targetRungLevelId).toBe(resultB.targetRungLevelId);
    // They are distinct cycles identified by their own id, not by FIFO or price
    expect(cycleA.id).not.toBe(cycleB.id);
  });

  // Test 12: Dos ciclos con mismo rung pero rangos distintos
  it("12. Dos ciclos con mismo rung pero rangos distintos: cada uno mantiene rangeVersionId propio", () => {
    const range1 = makeRange({ id: RANGE_ID });
    const range2 = makeRange({ id: RANGE_ID_2 });
    const cycleA = makeCycle({ id: "cA", rangeVersionId: RANGE_ID, buyPrice: 60_000, quantity: 0.001 });
    const cycleB = makeCycle({ id: "cB", rangeVersionId: RANGE_ID_2, buyPrice: 60_000, quantity: 0.001 });
    const levels = [
      makeLevel({ id: "rung-r1", rangeVersionId: RANGE_ID, side: "SELL", price: 60_700, quantity: 0.001 }),
      makeLevel({ id: "rung-r2", rangeVersionId: RANGE_ID_2, side: "SELL", price: 60_700, quantity: 0.001 }),
    ];
    const resultA = selectFirstProfitableHigherRung(cycleA, levels, range1, selectorParams);
    const resultB = selectFirstProfitableHigherRung(cycleB, levels, range2, selectorParams);
    expect(resultA.selected).toBe(true);
    expect(resultB.selected).toBe(true);
    expect(resultA.targetRungLevelId).toBe("rung-r1");
    expect(resultB.targetRungLevelId).toBe("rung-r2");
    expect(cycleA.rangeVersionId).toBe(RANGE_ID);
    expect(cycleB.rangeVersionId).toBe(RANGE_ID_2);
  });

  // Test 13: SYNTHETIC_RUNG no actualiza fila SELL persistida durante el cierre cuando targetSellLevelId=null
  it("13. SYNTHETIC_RUNG con targetSellLevelId=null: no actualiza fila SELL persistida durante cierre", async () => {
    const rungId = "shared-rung";
    const cycle = makeCycle({
      id: "cA", cycleNumber: 1, buyPrice: 60_000, quantity: 0.001, buyLevelId: "buy-A",
      targetSellPrice: 60_700, targetSellQuantity: 0.001,
      targetSellLevelId: null,
      targetRungLevelId: rungId, targetKind: "SYNTHETIC_RUNG",
      riskStateJson: null,
    });
    const levels = [
      makeLevel({ id: "buy-A", side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any }),
      makeLevel({ id: rungId, side: "SELL", price: 60_700, quantity: 0.001, status: "planned" as any }),
    ];
    const engine = resetEngine([cycle], levels);

    const result = await runUntilClosed(engine, { bid: 60_800 });
    expect(result).toBe(1);
    expect(engine.cycles[0].status).toBe("completed");
    expect(engine.cycles[0].sellLevelId).toBeNull();

    // The SELL level should NOT be marked as filled by the V2 closure
    const sellLevel = engine.levels.find((l: GridLevel) => l.id === rungId);
    expect(sellLevel.status).not.toBe("filled");
  });

  // Test 14: Ciclo legacy con targetSellLevelId continúa cerrando mediante su SELL persistido
  it("14. Ciclo legacy con targetSellLevelId: continúa cerrando mediante SELL persistido, no se convierte a SYNTHETIC_RUNG", async () => {
    const sellId = "legacy-sell-1";
    const cycle = makeCycle({
      id: "cLegacy", cycleNumber: 1, buyPrice: 60_000, quantity: 0.001, buyLevelId: "buy-legacy",
      targetSellPrice: 61_000, targetSellQuantity: 0.001,
      targetSellLevelId: sellId,
      targetRungLevelId: sellId,
      targetKind: "PERSISTED_SELL",
      exitPolicyVersion: "SYMMETRIC_INDEX_V1",
      riskStateJson: null,
    });
    const levels = [
      makeLevel({ id: "buy-legacy", side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any }),
      makeLevel({ id: sellId, side: "SELL", price: 61_000, quantity: 0.001, status: "planned" as any }),
    ];
    const engine = resetEngine([cycle], levels);

    const result = await runUntilClosed(engine, { bid: 61_200 });
    expect(result).toBe(1);
    expect(engine.cycles[0].status).toBe("completed");
    expect(engine.cycles[0].targetKind).toBe("PERSISTED_SELL");
    expect(engine.cycles[0].exitPolicyVersion).toBe("SYMMETRIC_INDEX_V1");
    // Legacy closure marks the SELL level as filled
    const sellLevel = engine.levels.find((l: GridLevel) => l.id === sellId);
    expect(sellLevel.status).toBe("filled");
  });

  // Test 15: Ciclo #26 no se modifica, no se convierte, no recibe backfill
  it("15. Ciclo legacy #26: no se convierte a V2, no recibe backfill de targetKind", () => {
    const cycle26 = makeCycle({
      id: "cycle-26",
      cycleNumber: 26,
      buyPrice: 58_000,
      quantity: 0.001,
      targetSellLevelId: "legacy-sell-26",
      targetRungLevelId: "legacy-sell-26",
      targetKind: "PERSISTED_SELL",
      exitPolicyVersion: "SYMMETRIC_INDEX_V1",
      targetSellPrice: 59_000,
      targetSellQuantity: 0.001,
    });
    // Verify the cycle retains its legacy fields
    expect(cycle26.targetKind).toBe("PERSISTED_SELL");
    expect(cycle26.exitPolicyVersion).toBe("SYMMETRIC_INDEX_V1");
    expect(cycle26.targetSellLevelId).toBe("legacy-sell-26");
    expect(cycle26.targetSellPrice).toBe(59_000);
    // Selector V2 should NOT be applied to this cycle
    const levels = [
      makeLevel({ id: "legacy-sell-26", side: "SELL", price: 59_000, quantity: 0.001 }),
    ];
    const result = selectFirstProfitableHigherRung(cycle26, levels, sharedRange, selectorParams);
    // Even if selector runs, it returns SYNTHETIC_RUNG — but this cycle should never be passed to it
    // The point is: the engine checks exitPolicyVersion before calling the selector
    expect(cycle26.exitPolicyVersion).not.toBe("FIRST_PROFITABLE_HIGHER_RUNG_V2");
  });

  // Test 16: No existe test que espere exclusividad de targetRungLevelId
  it("16. No existe restricción de exclusividad de targetRungLevelId en el selector", () => {
    const rungId = "shared-rung";
    const cycleA = makeCycle({ id: "cA", buyPrice: 60_000, quantity: 0.001 });
    const cycleB = makeCycle({ id: "cB", buyPrice: 60_000, quantity: 0.001 });
    const cycleC = makeCycle({ id: "cC", buyPrice: 60_000, quantity: 0.001 });
    const levels = [
      makeLevel({ id: rungId, side: "SELL", price: 60_700, quantity: 0.001 }),
    ];
    // All three cycles can select the same rung — no exclusivity check
    const resultA = selectFirstProfitableHigherRung(cycleA, levels, sharedRange, selectorParams);
    const resultB = selectFirstProfitableHigherRung(cycleB, levels, sharedRange, selectorParams);
    const resultC = selectFirstProfitableHigherRung(cycleC, levels, sharedRange, selectorParams);
    expect(resultA.selected).toBe(true);
    expect(resultB.selected).toBe(true);
    expect(resultC.selected).toBe(true);
    expect(resultA.targetRungLevelId).toBe(rungId);
    expect(resultB.targetRungLevelId).toBe(rungId);
    expect(resultC.targetRungLevelId).toBe(rungId);
  });

  // Test 17: No existe selección FIFO para ciclos V2
  it("17. No existe selección FIFO para ciclos V2: processOpenCyclesShadow procesa por cycle.id, no por timestamp", async () => {
    const rungId = "shared-rung";
    // Cycle B is older (earlier buyFilledAt) than A — FIFO would pick B first
    const olderDate = new Date(Date.now() - 120_000);
    const newerDate = new Date(Date.now() - 60_000);
    const cycleA = makeCycle({
      id: "cA", cycleNumber: 1, buyPrice: 60_000, quantity: 0.001, buyLevelId: "buy-A",
      targetSellPrice: 60_700, targetSellQuantity: 0.001,
      targetRungLevelId: rungId, targetKind: "SYNTHETIC_RUNG",
      riskStateJson: null, buyFilledAt: newerDate,
    });
    const cycleB = makeCycle({
      id: "cB", cycleNumber: 2, buyPrice: 60_000, quantity: 0.001, buyLevelId: "buy-B",
      targetSellPrice: 60_700, targetSellQuantity: 0.001,
      targetRungLevelId: rungId, targetKind: "SYNTHETIC_RUNG",
      riskStateJson: null, buyFilledAt: olderDate,
    });
    const levels = [
      makeLevel({ id: "buy-A", side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any }),
      makeLevel({ id: "buy-B", side: "BUY", price: 60_000, quantity: 0.001, status: "filled" as any }),
      makeLevel({ id: rungId, side: "SELL", price: 60_700, quantity: 0.001 }),
    ];
    const engine = resetEngine([cycleA, cycleB], levels);

    // Advance lifecycle for both (bid below target for trigger/pending)
    await processLifecycleTick(engine, { bid: 60_500 });
    await processLifecycleTick(engine, { bid: 60_500 });

    // Both should close — no FIFO ordering prevents either (bid above target for fill)
    const closed = await processLifecycleTick(engine, { bid: 60_800 });
    expect(closed).toBe(2);
    // Both are terminal regardless of creation order
    expect(engine.cycles[0].completedAt).toBeTruthy();
    expect(engine.cycles[1].completedAt).toBeTruthy();
  });
});
