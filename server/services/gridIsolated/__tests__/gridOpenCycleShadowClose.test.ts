import { describe, it, expect, vi, beforeEach } from "vitest";
import { gridIsolatedEngine } from "../gridIsolatedEngine";
import { db } from "../../../db";
import { botLogger } from "../../botLogger";
import type { GridIsolatedConfig, GridCycle, GridLevel, GridRangeVersion } from "../gridIsolatedTypes";
import type { GridShadowExecutionPriceResult } from "../gridShadowExecutionPrice";

const CYCLE_ID = "cycle-1";
const RANGE_ID = "range-1";
const BUY_LEVEL_ID = "buy-level-1";
const SELL_LEVEL_ID = "sell-level-1";

vi.mock("../../../db", () => ({
  db: {
    update: vi.fn(),
    transaction: vi.fn(),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
  },
}));

vi.mock("../../botLogger", () => ({
  botLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function makeWhereBuilder(returningResult: any = [{ id: CYCLE_ID }]) {
  const builder = {
    returning: vi.fn().mockResolvedValue(returningResult),
    then: (onFulfilled: any, onRejected: any) =>
      Promise.resolve(returningResult ?? []).then(onFulfilled, onRejected),
  };
  return builder;
}

function makeUpdateBuilder(returningResult: any = [{ id: CYCLE_ID }]) {
  const whereBuilder = makeWhereBuilder(returningResult);
  const setBuilder = {
    where: vi.fn().mockReturnValue(whereBuilder),
  };
  return {
    set: vi.fn().mockReturnValue(setBuilder),
    where: vi.fn().mockReturnValue(whereBuilder),
  };
}

function resetMocks() {
  vi.clearAllMocks();
  (db.update as any).mockImplementation(() => makeUpdateBuilder());
  (db.transaction as any).mockImplementation(async (callback: any) => {
    const tx = {
      update: vi.fn().mockImplementation(() => makeUpdateBuilder([{ id: CYCLE_ID }])),
    };
    return await callback(tx);
  });
}

function makeConfig(overrides: Partial<GridIsolatedConfig> = {}): GridIsolatedConfig {
  return {
    id: "cfg",
    pair: "BTC/USD",
    mode: "SHADOW",
    capitalProfile: "moderate",
    executionPolicy: "MAKER_ONLY",
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

function priceResult(bid: number | null, ask: number | null = null): GridShadowExecutionPriceResult {
  return {
    price: bid ?? 0,
    source: bid != null ? "ticker_last" : "no_price",
    bid,
    ask,
    spreadPct: null,
    timestamp: new Date().toISOString(),
  };
}

describe("processOpenCyclesShadow — cierre transaccional SHADOW", () => {
  beforeEach(() => {
    resetMocks();
    const engine = gridIsolatedEngine as any;
    engine.config = makeConfig();
    engine.cycles = [makeCycle()];
    engine.levels = [makeLevel()];
    engine.activeRangeVersion = makeRange();
    engine.lastShadowEventAt = null;
  });

  it("devuelve 0 si el modo no es SHADOW", async () => {
    const engine = gridIsolatedEngine as any;
    engine.config = makeConfig({ mode: "OFF" });
    const result = await engine.processOpenCyclesShadow(priceResult(61_500));
    expect(result).toBe(0);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("devuelve 0 si el motor está inactivo", async () => {
    const engine = gridIsolatedEngine as any;
    engine.config = makeConfig({ isActive: false });
    const result = await engine.processOpenCyclesShadow(priceResult(61_500));
    expect(result).toBe(0);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("devuelve 0 si no hay bid disponible", async () => {
    const result = await (gridIsolatedEngine as any).processOpenCyclesShadow(priceResult(null));
    expect(result).toBe(0);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("no cierra cuando el bid está por debajo del target SELL", async () => {
    const result = await (gridIsolatedEngine as any).processOpenCyclesShadow(priceResult(60_900));
    expect(result).toBe(0);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("cierra transaccionalmente cuando el bid alcanza el target SELL", async () => {
    const result = await (gridIsolatedEngine as any).processOpenCyclesShadow(priceResult(61_200));
    expect(result).toBe(1);
    expect(db.transaction).toHaveBeenCalledTimes(1);

    const cycle = (gridIsolatedEngine as any).cycles[0];
    expect(cycle.status).toBe("completed");
    expect(cycle.sellLevelId).toBe(SELL_LEVEL_ID);
    expect(cycle.sellPrice).toBe(61_000);
    expect(cycle.sellFilledAt).toBeInstanceOf(Date);
    expect(typeof cycle.netPnlUsd).toBe("number");

    const level = (gridIsolatedEngine as any).levels[0];
    expect(level.status).toBe("filled");
    expect(level.filledPrice).toBe(61_000);
    expect(level.filledQuantity).toBe(0.001);
    expect(level.filledAt).toBeInstanceOf(Date);
  });

  it("resuelve target SELL faltante y cierra transaccionalmente", async () => {
    const engine = gridIsolatedEngine as any;
    engine.cycles = [makeCycle({ targetSellLevelId: null, targetSellPrice: null, targetSellQuantity: null })];
    engine.levels = [makeLevel({ id: SELL_LEVEL_ID })];

    const result = await engine.processOpenCyclesShadow(priceResult(61_200));
    expect(result).toBe(1);
    expect(db.update).toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalledTimes(1);

    const cycle = engine.cycles[0];
    expect(cycle.targetSellLevelId).toBe(SELL_LEVEL_ID);
    expect(cycle.status).toBe("completed");
  });

  it("omite ciclos en HODL_RECOVERY sin intentar cierre", async () => {
    const engine = gridIsolatedEngine as any;
    engine.cycles = [makeCycle({ status: "hodl_recovery" })];
    const result = await engine.processOpenCyclesShadow(priceResult(61_200));
    expect(result).toBe(0);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("hace rollback si la actualización del ciclo no afecta a ninguna fila", async () => {
    const engine = gridIsolatedEngine as any;
    (db.transaction as any).mockImplementation(async (callback: any) => {
      const tx = {
        update: vi.fn().mockImplementation(() =>
          makeUpdateBuilder([]) // 0 rows devueltas => dispara throw
        ),
      };
      return await callback(tx);
    });

    await expect(
      engine.processOpenCyclesShadow(priceResult(61_200))
    ).rejects.toThrow("ya fue cerrado por otro proceso");

    const cycle = engine.cycles[0];
    expect(cycle.status).toBe("buy_filled");
  });

  it("rechaza ciclos cuya resolución de target requiera revisión", async () => {
    const engine = gridIsolatedEngine as any;
    // Rango inexistente para el ciclo => resolver devuelve requiresReview
    engine.activeRangeVersion = makeRange({ id: "otro-rango", pair: "BTC/USD" });
    engine.cycles = [makeCycle({ targetSellLevelId: null, targetSellPrice: null, targetSellQuantity: null })];

    const result = await engine.processOpenCyclesShadow(priceResult(61_200));
    expect(result).toBe(0);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
