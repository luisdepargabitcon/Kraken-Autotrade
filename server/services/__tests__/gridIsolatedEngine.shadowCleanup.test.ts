import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock data ────────────────────────────────────────────────────
const RANGE_ID = "ab00bb17-c49d-486c-83ad-2b73b1621279";
const CYCLE_IDS = Array.from({ length: 24 }, (_, i) => `cycle-${i + 1}`);
const LEVEL_IDS = Array.from({ length: 24 }, (_, i) => `level-${i + 1}`);

const mockCyclesRows: any[] = CYCLE_IDS.map((id, i) => ({
  id,
  rangeVersionId: RANGE_ID,
  cycleNumber: i + 1,
  pair: "BTC/USD",
  status: "open",
  buyLevelId: LEVEL_IDS[i],
  sellLevelId: null,
  buyPrice: "60000",
  sellPrice: null,
  quantity: "0.001",
  grossPnlUsd: "0",
  feeTotalUsd: "0",
  taxReserveUsd: "0",
  netPnlUsd: "0",
  netPnlPct: "0",
  buyClientOrderId: null,
  sellClientOrderId: null,
  buyFilledAt: new Date(),
  sellFilledAt: null,
  holdTimeMinutes: null,
  createdAt: new Date(),
  completedAt: null,
}));

const mockLevelRows: any[] = LEVEL_IDS.map((id, i) => ({
  id,
  rangeVersionId: RANGE_ID,
  levelIndex: i,
  side: "BUY",
  price: "60000",
  notionalUsd: "60",
  quantity: "0.001",
  status: "filled",
  filledQuantity: "0.001",
  filledPrice: "60000",
  clientOrderId: null,
  exchangeOrderId: null,
  postOnlyAttempts: 0,
  usedTakerFallback: false,
  netProfitTargetUsd: "0.6",
  feeEstimateUsd: "0.06",
  taxReserveUsd: "0.015",
  createdAt: new Date(),
  placedAt: null,
  filledAt: new Date(),
  cancelledAt: null,
}));

const mockRangeRows: any[] = [{
  id: RANGE_ID,
  versionNumber: 17,
  pair: "BTC/USD",
  bandLower: "59000",
  bandUpper: "61000",
  midPrice: "60000",
  status: "active",
  createdAt: new Date(),
  activatedAt: new Date(),
  closedAt: null,
}];

const mockConfigRows: any[] = [{
  id: 1,
  pair: "BTC/USD",
  mode: "OFF",
  executionPolicy: "MAKER_3_ATTEMPTS_THEN_TAKER_FALLBACK",
  netProfitTargetPct: "1.2",
  capitalProfile: "aggressive",
  gridMaxCapitalPerCycleUsd: "100",
  gridAllocationMode: "uniform",
  gridCapitalDeploymentMode: "capped",
  gridProgressiveIntensity: "0.30",
  gridMaxLevelPct: "40",
  gridMinLevelUsd: "30",
  isActive: false,
  maxOpenCycles: 10,
  maxDailyOrders: 100,
  fiscalStatus: "fisco",
  dumpGuardDeviationPct: "5.0",
  dumpGuardVolumeSpikeRatio: "2.0",
  dumpGuardCooldownMinutes: 30,
  createdAt: new Date(),
  updatedAt: new Date(),
}];

// ─── Mock DB ──────────────────────────────────────────────────────
let currentCycles = [...mockCyclesRows];
let currentLevels = [...mockLevelRows];

vi.mock("../../db", () => {
  const makeChainable = () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(async function (this: any) {
        // Determine what to return based on `from` call arg
        const fromArg = chain.from.mock.calls[chain.from.mock.calls.length - 1]?.[0];
        // gridIsolatedCycles or gridIsolatedLevels — check by reference is impossible in mock
        // Instead, use a heuristic: return based on a global flag
        return currentCycles;
      }),
    };
    return chain;
  };

  // We need a smarter mock. Let's use a simpler approach:
  // Track what table is being queried via the `from` argument
  const selectImpl = vi.fn().mockImplementation(() => {
    let tableRef: any = null;
    const chainable = {
      from: vi.fn().mockImplementation((table: any) => {
        tableRef = table;
        return chainable;
      }),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(async (n: number) => {
        // Return data based on which table mock object was passed
        // Since schema is mocked, we identify by the mock object reference
        if (tableRef && tableRef.__mockTable === "cycles") return currentCycles;
        if (tableRef && tableRef.__mockTable === "levels") return currentLevels;
        if (tableRef && tableRef.__mockTable === "range") return mockRangeRows;
        if (tableRef && tableRef.__mockTable === "config") return mockConfigRows;
        if (tableRef && tableRef.__mockTable === "events") return [];
        return [];
      }),
    };
    return chainable;
  });

  const updateChain = {
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  };

  const txObj = {
    select: selectImpl,
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1 }]) }),
    }),
    update: vi.fn().mockReturnValue(updateChain),
  };

  return {
    db: {
      select: selectImpl,
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1 }]) }),
      }),
      update: vi.fn().mockReturnValue(updateChain),
      transaction: vi.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => fn(txObj)),
    },
  };
});

vi.mock("@shared/schema", () => ({
  gridIsolatedEvents: { createdAt: "created_at", __mockTable: "events" },
  gridIsolatedLevels: { __mockTable: "levels" },
  gridIsolatedCycles: { __mockTable: "cycles" },
  gridRangeVersions: { __mockTable: "range" },
  gridIsolatedConfigs: { __mockTable: "config" },
  exchangeBalanceSnapshots: {},
  strategyCapitalReservations: {},
  gridIsolatedMetricsSnapshots: {},
  gridIsolatedBacktests: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  desc: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray, ...vals: any[]) => ({ sql: strings.join("?"), params: vals })),
}));

vi.mock("../../services/botLogger", () => ({
  botLogger: {
    info: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../services/exchanges/RevolutXService", () => ({
  revolutXService: {
    isInitialized: vi.fn().mockReturnValue(false),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    getBalance: vi.fn().mockResolvedValue({ USD: 0, BTC: 0 }),
  },
}));

vi.mock("../../services/MarketDataService", () => ({
  MarketDataService: {
    getTicker: vi.fn().mockResolvedValue({ last: 60000, bid: 59990, ask: 60010 }),
  },
}));

// ─── Import after mocks ───────────────────────────────────────────
import { gridIsolatedEngine } from "../gridIsolated/gridIsolatedEngine";

const EXPECTED_TOKEN = `ARCHIVE_SHADOW_PREFIX_${RANGE_ID.toUpperCase()}_${CYCLE_IDS.length}_CYCLES`;

describe("3C.2-I-C: applyShadowCleanup — runtime sync + anti-repeat", () => {
  beforeEach(() => {
    // Reset in-memory state
    currentCycles = mockCyclesRows.map(c => ({ ...c }));
    currentLevels = mockLevelRows.map(l => ({ ...l }));

    // Inject cycles and levels into engine memory
    const engine = gridIsolatedEngine as any;
    engine.cycles = currentCycles.map(c => ({
      id: c.id,
      rangeVersionId: c.rangeVersionId,
      cycleNumber: c.cycleNumber,
      pair: c.pair,
      status: c.status as any,
      buyLevelId: c.buyLevelId,
      sellLevelId: c.sellLevelId,
      buyPrice: c.buyPrice ? parseFloat(c.buyPrice) : null,
      sellPrice: c.sellPrice ? parseFloat(c.sellPrice) : null,
      quantity: parseFloat(c.quantity),
      grossPnlUsd: parseFloat(c.grossPnlUsd),
      feeTotalUsd: parseFloat(c.feeTotalUsd),
      taxReserveUsd: parseFloat(c.taxReserveUsd),
      netPnlUsd: parseFloat(c.netPnlUsd),
      netPnlPct: parseFloat(c.netPnlPct),
      buyClientOrderId: c.buyClientOrderId,
      sellClientOrderId: c.sellClientOrderId,
      buyFilledAt: c.buyFilledAt,
      sellFilledAt: c.sellFilledAt,
      holdTimeMinutes: c.holdTimeMinutes,
      createdAt: c.createdAt,
      completedAt: c.completedAt,
    }));
    engine.levels = currentLevels.map(l => ({
      id: l.id,
      rangeVersionId: l.rangeVersionId,
      levelIndex: l.levelIndex,
      side: l.side as any,
      price: parseFloat(l.price),
      notionalUsd: parseFloat(l.notionalUsd),
      quantity: parseFloat(l.quantity),
      status: l.status as any,
      filledQuantity: parseFloat(l.filledQuantity),
      filledPrice: l.filledPrice ? parseFloat(l.filledPrice) : null,
      clientOrderId: l.clientOrderId,
      exchangeOrderId: l.exchangeOrderId,
      postOnlyAttempts: l.postOnlyAttempts,
      usedTakerFallback: l.usedTakerFallback,
      netProfitTargetUsd: parseFloat(l.netProfitTargetUsd),
      feeEstimateUsd: parseFloat(l.feeEstimateUsd),
      taxReserveUsd: parseFloat(l.taxReserveUsd),
      createdAt: l.createdAt,
      placedAt: l.placedAt,
      filledAt: l.filledAt,
      cancelledAt: l.cancelledAt,
    }));
    engine.config = {
      id: 1,
      pair: "BTC/USD",
      mode: "OFF",
      executionPolicy: "MAKER_3_ATTEMPTS_THEN_TAKER_FALLBACK",
      netProfitTargetPct: 1.2,
      capitalProfile: "aggressive",
      gridMaxCapitalPerCycleUsd: 100,
      gridAllocationMode: "uniform",
      gridCapitalDeploymentMode: "capped",
      gridProgressiveIntensity: 0.30,
      gridMaxLevelPct: 40,
      gridMinLevelUsd: 30,
      isActive: false,
      maxOpenCycles: 10,
      maxDailyOrders: 100,
      fiscalStatus: "fisco",
      dumpGuardDeviationPct: 5.0,
      dumpGuardVolumeSpikeRatio: 2.0,
      dumpGuardCooldownMinutes: 30,
    };
    engine.activeRangeVersion = {
      id: RANGE_ID,
      versionNumber: 17,
      pair: "BTC/USD",
      bandLower: 59000,
      bandUpper: 61000,
      midPrice: 60000,
      status: "active",
      createdAt: new Date(),
      activatedAt: new Date(),
      closedAt: null,
    };
  });

  it("applyShadowCleanup dryRun=false with correct token and counts: ok=true, applied=true", async () => {
    const result = await gridIsolatedEngine.applyShadowCleanup({
      dryRun: false,
      confirmToken: EXPECTED_TOKEN,
      expectedCyclesCount: 24,
      expectedLevelsCount: 24,
    });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.archivedCyclesCount).toBe(24);
    expect(result.updatedLevelsCount).toBe(24);
    expect(result.realOrdersAffected).toBe(false);
  });

  it("after apply, engine.cycles all have status=cancelled in memory", async () => {
    await gridIsolatedEngine.applyShadowCleanup({
      dryRun: false,
      confirmToken: EXPECTED_TOKEN,
      expectedCyclesCount: 24,
      expectedLevelsCount: 24,
    });

    const engine = gridIsolatedEngine as any;
    const openCycles = engine.cycles.filter((c: any) =>
      !["completed", "cancelled", "stop_loss_hit", "trailing_closed"].includes(c.status)
    );
    expect(openCycles.length).toBe(0);
  });

  it("after apply, engine.levels affected have status=cancelled in memory", async () => {
    await gridIsolatedEngine.applyShadowCleanup({
      dryRun: false,
      confirmToken: EXPECTED_TOKEN,
      expectedCyclesCount: 24,
      expectedLevelsCount: 24,
    });

    const engine = gridIsolatedEngine as any;
    const affectedLevels = engine.levels.filter((l: any) => LEVEL_IDS.includes(l.id));
    for (const level of affectedLevels) {
      expect(level.status).toBe("cancelled");
      expect(level.filledPrice).toBeNull();
      expect(level.filledQuantity).toBe(0);
      expect(level.filledAt).toBeNull();
      expect(level.cancelledAt).not.toBeNull();
    }
  });

  it("after apply, getStatusSafe shows 0 open cycles", async () => {
    await gridIsolatedEngine.applyShadowCleanup({
      dryRun: false,
      confirmToken: EXPECTED_TOKEN,
      expectedCyclesCount: 24,
      expectedLevelsCount: 24,
    });

    const status = await gridIsolatedEngine.getStatusSafe();
    expect(status.openCycles).toBe(0);
    expect(status.activeOpenCyclesCount).toBe(0);
    expect(status.globalOpenCyclesCount).toBe(0);
    expect(status.realOpenOrdersCount).toBe(0);
  });

  it("guard anti-repeat: second apply with same counts aborts (0 != 24)", async () => {
    // First apply succeeds
    await gridIsolatedEngine.applyShadowCleanup({
      dryRun: false,
      confirmToken: EXPECTED_TOKEN,
      expectedCyclesCount: 24,
      expectedLevelsCount: 24,
    });

    // Update DB mock to reflect cancelled cycles (preview reads from DB)
    currentCycles = mockCyclesRows.map(c => ({ ...c, status: "cancelled", completedAt: new Date() }));
    currentLevels = mockLevelRows.map(l => ({ ...l, status: "cancelled", cancelledAt: new Date() }));

    // Second apply with same expected counts should abort
    const result = await gridIsolatedEngine.applyShadowCleanup({
      dryRun: false,
      confirmToken: EXPECTED_TOKEN,
      expectedCyclesCount: 24,
      expectedLevelsCount: 24,
    });

    expect(result.ok).toBe(false);
    expect(result.applied).toBe(false);
    expect(result.reason).toContain("expectedCyclesCount");
  });

  it("guard anti-repeat: second apply with counts=0 aborts (no cycles to archive)", async () => {
    // First apply succeeds
    await gridIsolatedEngine.applyShadowCleanup({
      dryRun: false,
      confirmToken: EXPECTED_TOKEN,
      expectedCyclesCount: 24,
      expectedLevelsCount: 24,
    });

    // Update DB mock to reflect cancelled cycles
    currentCycles = mockCyclesRows.map(c => ({ ...c, status: "cancelled", completedAt: new Date() }));
    currentLevels = mockLevelRows.map(l => ({ ...l, status: "cancelled", cancelledAt: new Date() }));

    // Second apply with counts=0 should abort because affectedCyclesCount <= 0
    const result = await gridIsolatedEngine.applyShadowCleanup({
      dryRun: false,
      confirmToken: EXPECTED_TOKEN,
      expectedCyclesCount: 0,
      expectedLevelsCount: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.applied).toBe(false);
  });
});
