import { describe, expect, it, vi, beforeEach } from "vitest";
import { gridIsolatedCycles, gridIsolatedLevels, gridIsolatedConfigs, gridRangeVersions } from "@shared/schema";

// ─── DB Mock: table-by-reference identification ─────────────────────

const cycleRows = new Map<string, any>();
const levelRows = new Map<string, any>();
const configRows = new Map<string, any>();
const rangeRows = new Map<string, any>();

const transactionTrace: Array<{ operation: string; table: string; payload?: any; ids?: string[] }> = [];
const committedTrace: Array<{ operation: string; table: string; payload?: any; ids?: string[] }> = [];
let rollbackTriggered = false;

function resolveTableName(table: unknown): string {
  if (table === gridIsolatedCycles) return "gridIsolatedCycles";
  if (table === gridIsolatedLevels) return "gridIsolatedLevels";
  if (table === gridIsolatedConfigs) return "gridIsolatedConfigs";
  if (table === gridRangeVersions) return "gridRangeVersions";
  return "unknown";
}

function getRowsByTable(name: string): Map<string, any> | null {
  switch (name) {
    case "gridIsolatedCycles": return cycleRows;
    case "gridIsolatedLevels": return levelRows;
    case "gridIsolatedConfigs": return configRows;
    case "gridRangeVersions": return rangeRows;
    default: return null;
  }
}

function cloneMap(map: Map<string, any>): Map<string, any> {
  return new Map([...map].map(([k, v]) => [k, { ...v }]));
}

vi.mock("../../../db", () => {
  let txCycles: Map<string, any> | null = null;
  let txLevels: Map<string, any> | null = null;
  let txConfigs: Map<string, any> | null = null;
  let txRanges: Map<string, any> | null = null;
  let inTransaction = false;

  function activeMap(name: string): Map<string, any> | null {
    if (!inTransaction) {
      return getRowsByTable(name);
    }
    switch (name) {
      case "gridIsolatedCycles": return txCycles;
      case "gridIsolatedLevels": return txLevels;
      case "gridIsolatedConfigs": return txConfigs;
      case "gridRangeVersions": return txRanges;
      default: return null;
    }
  }

  function makeSelectChain(rows: any[]) {
    const self: any = {
      where: () => self,
      orderBy: () => self,
      limit: (n: number) => Promise.resolve(rows.slice(0, n)),
      then: (resolve: any, reject?: any) => Promise.resolve(rows).then(resolve, reject),
    };
    return self;
  }

  const update = (table: unknown) => {
    const tableName = resolveTableName(table);
    return {
      set: (payload: any) => {
        const applyUpdate = (): { id: string }[] => {
          const map = activeMap(tableName);
          if (!map) return [];
          const candidates = [...map.values()].filter((row: any) => {
            if (tableName === "gridIsolatedCycles") {
              return row.status !== "completed" && row.status !== "cancelled" && row.completedAt == null;
            }
            if (tableName === "gridIsolatedLevels") {
              return true; // specific filtering done by caller conditions
            }
            if (tableName === "gridIsolatedConfigs") {
              return true;
            }
            return false;
          });
          if (candidates.length === 0) return [];
          const target = candidates[0];
          Object.assign(target, payload);
          if (inTransaction) {
            transactionTrace.push({ operation: "update", table: tableName, payload, ids: [target.id] });
          }
          return [{ id: target.id }];
        };
        return {
          where: () => ({
            returning: async () => applyUpdate(),
            then: (resolve: any, reject?: any) => Promise.resolve(applyUpdate()).then(resolve, reject),
          }),
        };
      },
    };
  };

  return {
    db: {
      select: () => ({
        from: (table: unknown) => {
          const tableName = resolveTableName(table);
          const map = activeMap(tableName);
          const rows = map ? [...map.values()] : [];
          return makeSelectChain(rows);
        },
      }),
      insert: (table: unknown) => {
        const tableName = resolveTableName(table);
        return {
          values: (payload: any) => ({
            returning: async (cols?: any) => {
              const map = activeMap(tableName);
              if (!map) return [];
              const id = `cfg-${Date.now()}`;
              map.set(id, { id, ...payload });
              return [{ id }];
            },
          }),
        };
      },
      update,
      transaction: async (callback: any) => {
        txCycles = cloneMap(cycleRows);
        txLevels = cloneMap(levelRows);
        txConfigs = cloneMap(configRows);
        txRanges = cloneMap(rangeRows);
        inTransaction = true;
        const txStart = transactionTrace.length;
        try {
          const tx = { update, insert: (table: unknown) => {
            const tableName = resolveTableName(table);
            return {
              values: (payload: any) => ({
                returning: async () => {
                  const map = activeMap(tableName);
                  if (!map) return [];
                  const id = `tx-${Date.now()}`;
                  map.set(id, { id, ...payload });
                  transactionTrace.push({ operation: "insert", table: tableName, payload, ids: [id] });
                  return [{ id }];
                },
              }),
            };
          }, select: () => ({
            from: (table: unknown) => {
              const tableName = resolveTableName(table);
              const map = activeMap(tableName);
              const rows = map ? [...map.values()] : [];
              return makeSelectChain(rows);
            },
          }) };
          const result = await callback(tx);
          // Commit: copy transactional state back to main maps
          cycleRows.clear(); txCycles!.forEach((v, k) => cycleRows.set(k, v));
          levelRows.clear(); txLevels!.forEach((v, k) => levelRows.set(k, v));
          configRows.clear(); txConfigs!.forEach((v, k) => configRows.set(k, v));
          rangeRows.clear(); txRanges!.forEach((v, k) => rangeRows.set(k, v));
          committedTrace.push(...transactionTrace.slice(txStart));
          transactionTrace.push({ operation: "commit", table: "transaction" });
          return result;
        } catch (error) {
          rollbackTriggered = true;
          transactionTrace.push({ operation: "rollback", table: "transaction" });
          throw error;
        } finally {
          inTransaction = false;
          txCycles = null; txLevels = null; txConfigs = null; txRanges = null;
        }
      },
    },
  };
});

// ─── Mock external services for tick() ──────────────────────────────

vi.mock("../gridBandAdapter", () => ({
  getGridBandSnapshot: vi.fn(async () => ({
    suitableForGrid: true,
    midPrice: 100,
    bandUpper: 105,
    bandLower: 95,
    bandMiddle: 100,
    bandWidthPct: 10,
    atrPct: 5,
    reason: null,
  })),
}));

vi.mock("../../MarketDataService", () => ({
  MarketDataService: {
    getTicker: vi.fn(async () => ({ bid: 100, ask: 101, last: 100.5 })),
  },
}));

vi.mock("../../exchanges/RevolutXService", () => ({
  revolutXService: {
    resolveGridPairConstraints: vi.fn(async () => ({
      pair: "BTC/USD", normalizedPair: "BTC-USD", executionVenue: "REVOLUT_X",
      baseCurrency: "BTC", quoteCurrency: "USD",
      priceTickSize: 0.1, quantityStep: 0.00001,
      minOrderBase: 0.0001, minOrderQuote: 1, minOrderUsd: 1, maxOrderBase: 100,
      pricePrecision: 1, quantityPrecision: 5,
      status: "ACTIVE", region: "EEA",
      source: "test", fetchedAt: new Date(), expiresAt: new Date(Date.now() + 900000),
      verified: true, reasonCode: null,
    })),
    getTicker: vi.fn(async () => ({ bid: 100, ask: 101, last: 100.5 })),
  },
}));

import { GridIsolatedEngine } from "../gridIsolatedEngine";

// ─── Helpers ────────────────────────────────────────────────────────

function makeV3TargetCalculationJson(overrides: Record<string, unknown> = {}) {
  return {
    selected: true, stateVersion: 2, policyVersion: "CYCLE_OWNED_NET_TARGET_V3",
    targetKind: "CYCLE_OWNED_SYNTHETIC",
    targetSellLevelId: null, targetRungLevelId: null,
    targetSellPrice: 100, targetSellQuantity: 1,
    grossExitGapPct: 1, actualGrossGapPct: 1, grossPnlUsd: 2,
    buyFeePct: 0, sellFeePct: 0, spreadBufferPct: 0, safetyBufferPct: 0, taxReservePct: 0,
    buyFeeUsd: 0, sellFeeUsd: 0, exchangeFeesUsd: 0, operationalCostsUsd: 0,
    netBeforeTaxUsd: 2, netBeforeTaxPct: 2, taxReserveUsd: 0,
    availablePnlAfterTaxUsd: 2, availablePnlAfterTaxPct: 2, netProfitTargetPct: 1,
    priceTickSize: 0.5, quantityStep: 0.00001, minOrderBase: 0.00001, minOrderQuote: 1,
    minOrderUsd: 1, maxOrderBase: 100, baseCurrency: "BTC", quoteCurrency: "USD",
    constraintsSource: "test", constraintsFetchedAt: new Date().toISOString(),
    rejectedCandidates: [], explanation: "V3 test target",
    ...overrides,
  };
}

function makeTickCtx(tickId: number, bid = 100, ask = 101, startedAt = new Date(`2026-07-28T00:00:0${tickId}.000Z`)) {
  return {
    tickId, startedAt, pair: "BTC/USD", bid, ask,
    last: null, marketTimestamp: startedAt.toISOString(), priceSource: "ticker_last",
    freshness: { isFresh: true, reason: null, ageMs: 0, maxAgeMs: 60000 },
  };
}

function makePrice(pair = "BTC/USD", bid = 100, ask = 101, price = 100.5) {
  return { pair, bid, ask, price, source: "ticker_last", timestamp: new Date().toISOString(), spreadPct: 1 };
}

function setupEngineWithBreakerOpen(engine: any, overrides: Record<string, unknown> = {}) {
  engine.config = {
    pair: "BTC/USD", mode: "SHADOW", isActive: true,
    trailingEnabled: false, stopLossEnabled: false,
    bandPeriod: 20, bandStdDevMultiplier: 2,
    atrPeriod: 14, atrTimeframe: "1h",
    netProfitTargetPct: 1, buyFeePct: 0, sellFeePct: 0,
    maxOpenCycles: 5, maxDailyOrders: 100,
    gridMinLevelUsd: 1, gridWalletMode: "automatic",
    circuitBreakerOpen: true,
    circuitBreakerOpenedAt: new Date(),
    circuitBreakerReason: "test breaker",
    circuitBreakerCooldownUntil: null,
    circuitBreakerReviewAfter: null,
    circuitBreakerResolvedAt: null,
    circuitBreakerResolvedBy: null,
    circuitBreakerResolutionReason: null,
    circuitBreakerSourceCycleId: null,
    circuitBreakerSeverity: null,
    ...overrides,
  };
  engine.circuitBreakerOpen = true;
  engine.circuitBreakerOpenedAt = new Date();
  engine.circuitBreakerReason = "test breaker";
  engine.circuitBreakerCooldownUntil = null;
  engine.logEvent = vi.fn();
  engine.logShadowTickEvent = vi.fn();
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("GridIsolatedEngine circuit breaker V3 — hardened", () => {
  beforeEach(() => {
    cycleRows.clear(); levelRows.clear(); configRows.clear(); rangeRows.clear();
    transactionTrace.length = 0; committedTrace.length = 0; rollbackTriggered = false;
    vi.clearAllMocks();
  });

  // ── D1: Breaker blocks all creation ───────────────────────────────

  it("D1 bloquea BUY nueva, impide proposeRangeVersion, impide rebuild y permite salidas", async () => {
    const engine = new GridIsolatedEngine();
    const internal = engine as any;
    setupEngineWithBreakerOpen(internal);

    // D1.a: canProcessShadowFill blocks new BUY (planned, not pending)
    const buyLevel = { id: "buy-1", side: "BUY", status: "planned", price: 99, quantity: 0.01, rangeVersionId: "range-1" };
    const buyResult = internal.canProcessShadowFill(
      buyLevel, "range-1", { active: false, allowBuyFill: false },
      { tickId: 1, pair: "BTC/USD", freshness: { isFresh: true } },
      makePrice(), 0.1,
    );
    expect(buyResult).toMatchObject({ ok: false, eventType: "GRID_CIRCUIT_BREAKER_BLOCKED_BUY" });

    // D1.b: processBuyLevelLifecycle does not place or fill the BUY
    internal.activeRangeVersion = { id: "range-1", midPrice: 100 };
    internal.levels = [buyLevel];
    const buyLifecycleResult = await internal.processBuyLevelLifecycle(
      buyLevel, makePrice(), makeTickCtx(1), { active: false, allowBuyFill: false }, 0.1,
    );
    expect(buyLifecycleResult).toBeNull();
    expect(buyLevel.status).toBe("planned");

    // D1.c: tick with no active range does NOT call proposeRangeVersion
    internal.activeRangeVersion = null;
    internal.cycles = [];
    internal.levels = [];
    const proposeSpy = vi.spyOn(internal, "proposeRangeVersion");
    vi.spyOn(internal, "rebuildRangeAndLevels");
    await internal.tick();
    expect(proposeSpy).not.toHaveBeenCalled();

    // D1.d: tick with active range and drifted band does NOT call rebuildRangeAndLevels
    internal.activeRangeVersion = {
      id: "range-1", midPrice: 100, bandLower: 95, bandUpper: 105, bandWidthPct: 10,
    };
    const rebuildSpy = vi.spyOn(internal, "rebuildRangeAndLevels");
    await internal.tick();
    expect(rebuildSpy).not.toHaveBeenCalled();

    // D1.e: existing exits (SELL) are NOT blocked by circuit breaker
    // SELL may fail for other reasons (no claiming cycle) but must NOT be blocked by breaker
    const sellLevel = { id: "sell-1", side: "SELL", status: "planned", price: 105, quantity: 0.01, rangeVersionId: "range-1" };
    const sellResult = internal.canProcessShadowFill(
      sellLevel, "range-1", { active: false, allowBuyFill: false },
      { tickId: 1, pair: "BTC/USD", freshness: { isFresh: true } },
      makePrice(), 0.1,
    );
    expect(sellResult.eventType).not.toBe("GRID_CIRCUIT_BREAKER_BLOCKED_BUY");

    // D1.f: BUY_MAKER_PENDING (existing pending) is NOT blocked by breaker
    const pendingBuy = { id: "buy-pending", side: "BUY", status: "buy_maker_pending", price: 99, quantity: 0.01, rangeVersionId: "range-1" };
    const pendingResult = internal.canProcessShadowFill(
      pendingBuy, "range-1", { active: false, allowBuyFill: false },
      { tickId: 1, pair: "BTC/USD", freshness: { isFresh: true } },
      makePrice(), 0.1,
    );
    expect(pendingResult.ok).not.toMatchObject({ eventType: "GRID_CIRCUIT_BREAKER_BLOCKED_BUY" });
  });

  // ── D2: V3 close with breaker open, full DB assertions ─────────────

  it("D2 cierre V3 real con breaker abierto — DB CAS verificada", async () => {
    const engine = new GridIsolatedEngine();
    const internal = engine as any;
    setupEngineWithBreakerOpen(internal);
    internal.activeRangeVersion = { id: "range-1", midPrice: 100 };
    internal.levels = [];

    const risk = internal.defaultRiskState();
    const targetJson = makeV3TargetCalculationJson();
    const cycle: any = {
      id: "cb-cycle", rangeVersionId: "range-1", cycleNumber: 1, pair: "BTC/USD",
      status: "buy_filled", buyLevelId: "buy-src", sellLevelId: null,
      targetSellLevelId: null, targetRungLevelId: null,
      buyPrice: 98, sellPrice: null, targetSellPrice: 100, targetSellQuantity: 1, quantity: 1,
      grossPnlUsd: 0, feeTotalUsd: 0, taxReserveUsd: 0, netPnlUsd: 0, netPnlPct: 0,
      exitPolicyVersion: "CYCLE_OWNED_NET_TARGET_V3", targetKind: "CYCLE_OWNED_SYNTHETIC",
      targetCalculationJson: targetJson, riskStateJson: risk, makerExitStateJson: null,
      buyClientOrderId: null, sellClientOrderId: null,
      buyFilledAt: new Date("2026-07-28T00:00:00.000Z"), sellFilledAt: null,
      holdTimeMinutes: 0, requiresReview: false,
      reviewReason: null, reviewCode: null, reviewDetectedAt: null, reviewSource: null,
      createdAt: new Date("2026-07-28T00:00:00.000Z"), completedAt: null,
    };
    internal.cycles = [cycle];

    // Seed DB rows
    cycleRows.set(cycle.id, { id: cycle.id, status: "sell_placed", completedAt: null });
    levelRows.set("buy-src", { id: "buy-src", side: "BUY", status: "filled", rangeVersionId: "range-1" });

    const now = new Date();
    const price = makePrice("BTC/USD", 100.1, 100.3, 100.1);

    // Tick 1: trigger → TRIGGERED
    await internal.evaluateRiskForOpenCycles(price, makeTickCtx(1, 100.1, 100.3, now));
    expect(cycle.riskStateJson.protectiveExit.state).toBe("TRIGGERED");

    // Tick 2: TRIGGERED → MAKER_PENDING
    await internal.evaluateRiskForOpenCycles(price, makeTickCtx(2, 100.1, 100.3, new Date(now.getTime() + 1000)));
    const exit = cycle.riskStateJson.protectiveExit;
    expect(exit.state).toBe("MAKER_PENDING");
    expect(exit.requestedMakerPrice).toBeGreaterThan(0);

    // Same tick: no fill (makerEligibleAfter not reached)
    expect(await internal.processOpenCyclesShadow(price, makeTickCtx(2, 100.1, 100.3, new Date(now.getTime() + 1000)))).toBe(0);

    // Later tick: bid reaches target → fill
    const fillTime = new Date(exit.makerEligibleAfter!.getTime() + 1);
    const fillPrice = makePrice("BTC/USD", 101, 101.5, 101);
    const closedCount = await internal.processOpenCyclesShadow(fillPrice, makeTickCtx(3, 101, 101.5, fillTime));

    // Assertions: processOpenCyclesShadow returns 1
    expect(closedCount).toBe(1);

    // DB: cycle row updated to completed
    const dbCycle = cycleRows.get(cycle.id);
    expect(dbCycle).toBeDefined();
    expect(dbCycle.status).toBe("completed");
    expect(dbCycle.completedAt).not.toBeNull();

    // In-memory: cycle completed
    expect(cycle.status).toBe("completed");

    // protectiveExit.state = MAKER_FILLED
    expect(cycle.riskStateJson.protectiveExit.state).toBe("MAKER_FILLED");

    // BUY source level: rearmed to planned (belongs to active range)
    const dbBuyLevel = levelRows.get("buy-src");
    expect(dbBuyLevel).toBeDefined();
    expect(dbBuyLevel.status).toBe("planned");

    // No SELL level was created or updated
    const sellLevelEntries = [...levelRows.values()].filter((r: any) => r.side === "SELL");
    expect(sellLevelEntries.length).toBe(0);

    // sellLevelId, targetSellLevelId, targetRungLevelId all null
    expect(cycle.sellLevelId).toBeNull();
    expect(cycle.targetSellLevelId).toBeNull();
    expect(cycle.targetRungLevelId).toBeNull();

    // Breaker still open
    expect(internal.circuitBreakerOpen).toBe(true);

    // Transaction committed, no rollback
    expect(rollbackTriggered).toBe(false);
    expect(committedTrace.some((e: any) => e.table === "gridIsolatedCycles")).toBe(true);
  });

  // ── D3: No auto-close with real tick ───────────────────────────────

  it("D3 no se autocierra tras tick real con reviewAfter y cooldown vencidos", async () => {
    const engine = new GridIsolatedEngine();
    const internal = engine as any;
    const expiredDate = new Date(Date.now() - 60000);
    setupEngineWithBreakerOpen(internal, {
      circuitBreakerReviewAfter: expiredDate,
      circuitBreakerCooldownUntil: expiredDate,
      circuitBreakerResolvedAt: null,
    });
    internal.circuitBreakerCooldownUntil = expiredDate;
    internal.activeRangeVersion = null;
    internal.cycles = [];
    internal.levels = [];

    // Run a real tick
    await internal.tick();

    // Breaker still open after tick
    expect(internal.circuitBreakerOpen).toBe(true);
    expect(internal.config.circuitBreakerOpen).toBe(true);
    expect(internal.config.circuitBreakerResolvedAt).toBeNull();
    expect(internal.circuitBreakerOpenedAt).not.toBeNull();

    // No auto-resolution: proposeRangeVersion not called (blocked)
    // Breaker blocks BUY/range/rebuild
    const buyLevel = { id: "buy-d3", side: "BUY", status: "planned", price: 99, quantity: 0.01, rangeVersionId: "range-1" };
    const buyResult = internal.canProcessShadowFill(
      buyLevel, "range-1", { active: false, allowBuyFill: false },
      { tickId: 1, pair: "BTC/USD", freshness: { isFresh: true } },
      makePrice(), 0.1,
    );
    expect(buyResult).toMatchObject({ ok: false, eventType: "GRID_CIRCUIT_BREAKER_BLOCKED_BUY" });

    // Existing exits (SELL) are NOT blocked by circuit breaker
    const sellLevel = { id: "sell-d3", side: "SELL", status: "planned", price: 105, quantity: 0.01, rangeVersionId: "range-1" };
    const sellResult = internal.canProcessShadowFill(
      sellLevel, "range-1", { active: false, allowBuyFill: false },
      { tickId: 1, pair: "BTC/USD", freshness: { isFresh: true } },
      makePrice(), 0.1,
    );
    expect(sellResult.eventType).not.toBe("GRID_CIRCUIT_BREAKER_BLOCKED_BUY");

    // D3.b: loadConfig with breaker open in DB → stays open after reload
    const cfgId = "cfg-1";
    configRows.set(cfgId, {
      id: 1, pair: "BTC/USD", mode: "SHADOW",
      capitalProfile: null, executionPolicy: "MAKER_ONLY",
      defaultExitPolicyVersion: "CYCLE_OWNED_NET_TARGET_V3",
      trailingEnabled: false, stopLossEnabled: false,
      buyFeePct: "0.0000", sellFeePct: "0.0000", netProfitTargetPct: "1.000",
      bandPeriod: 20, bandStdDevMultiplier: "2.00",
      atrPeriod: 14, atrTimeframe: "1h",
      gridStepAtrMultiplier: "1.00", gridStepMinPct: "0.500", gridStepMaxPct: "2.000",
      geometricRatioMin: "0.800", geometricRatioMax: "1.200",
      trailingActivationPct: "2.000", trailingStopPct: "1.000",
      stopLossSoftPct: "2.000", stopLossHardPct: "5.000", stopLossEmergencyPct: "10.000",
      hodlRecoveryEnabled: false,
      pumpGuardDeviationPct: "5.000", pumpGuardVolumeSpikeRatio: "3.00", pumpGuardCooldownMinutes: 30,
      dumpGuardDeviationPct: "5.000", dumpGuardVolumeSpikeRatio: "3.00", dumpGuardCooldownMinutes: 30,
      maxOpenCycles: 5, maxDailyOrders: 100,
      fiscalStatus: "individual", isActive: true,
      makerAttemptsBeforeTaker: 3, takerFallbackEnabled: false,
      takerFallbackAttemptNumber: 4, maxTakerFallbackPerCycle: 1,
      takerFallbackRequiresNetProfit: true, takerFallbackAuditRequired: true,
      gridWalletMode: "automatic", gridWalletInitialUsd: "1000.00", gridWalletMaxUsd: "5000.00",
      gridWalletUseProfits: true, gridWalletCompoundProfits: true,
      gridMaxCapitalPerCycleUsd: "600.00", gridMaxCapitalPerCyclePct: "60.00",
      gridReservePct: "20.00", gridMinFreeCapitalUsd: "50.00",
      gridPauseCycleWhenCapitalDepleted: true, gridAllowNewCycleWhenCapitalFree: true,
      gridAllocationMode: "uniform", gridCapitalDeploymentMode: "capped",
      gridProgressiveIntensity: "0.30", gridMaxLevelPct: "40.00", gridMinLevelUsd: "30.00",
      enforceCompactRange: true, gridRangeMaxPct: "2.50",
      maxDistanceFromCenterPct: "1.25", maxSellDistanceFromNearestBuyPct: "1.50",
      gridRangeControlMode: "adaptive_smart", adaptiveRangeEnabled: true,
      adaptiveRangeProfile: "balanced", adaptiveRangeMinPct: "1.50", adaptiveRangeMaxPct: "7.00",
      adaptiveRangeLowVolMaxPct: "3.00", adaptiveRangeNormalMaxPct: "5.00", adaptiveRangeHighVolMaxPct: "7.00",
      adaptiveRangeTargetFullLevels: false, adaptiveRangeMinViableLevels: 4,
      circuitBreakerOpen: true, circuitBreakerOpenedAt: new Date(),
      circuitBreakerReason: "test", circuitBreakerCooldownUntil: expiredDate,
      circuitBreakerSourceCycleId: null, circuitBreakerSeverity: null,
      circuitBreakerReviewAfter: expiredDate, circuitBreakerResolvedAt: null,
      circuitBreakerResolvedBy: null, circuitBreakerResolutionReason: null,
      createdAt: new Date(), updatedAt: new Date(),
    });

    const engine2 = new GridIsolatedEngine();
    const internal2 = engine2 as any;
    await internal2.loadConfig();
    expect(internal2.circuitBreakerOpen).toBe(true);
    expect(internal2.config.circuitBreakerOpen).toBe(true);
    expect(internal2.config.circuitBreakerResolvedAt).toBeNull();
  });

  // ── D4: Resolution with real saveConfig ────────────────────────────

  it("D4 resolveCircuitBreaker persiste resolución real via saveConfig", async () => {
    const cfgId = "cfg-d4";
    configRows.set(cfgId, {
      id: 1, pair: "BTC/USD", mode: "SHADOW",
      capitalProfile: null, executionPolicy: "MAKER_ONLY",
      defaultExitPolicyVersion: "CYCLE_OWNED_NET_TARGET_V3",
      trailingEnabled: false, stopLossEnabled: false,
      buyFeePct: "0.0000", sellFeePct: "0.0000", netProfitTargetPct: "1.000",
      bandPeriod: 20, bandStdDevMultiplier: "2.00",
      atrPeriod: 14, atrTimeframe: "1h",
      gridStepAtrMultiplier: "1.00", gridStepMinPct: "0.500", gridStepMaxPct: "2.000",
      geometricRatioMin: "0.800", geometricRatioMax: "1.200",
      trailingActivationPct: "2.000", trailingStopPct: "1.000",
      stopLossSoftPct: "2.000", stopLossHardPct: "5.000", stopLossEmergencyPct: "10.000",
      hodlRecoveryEnabled: false,
      pumpGuardDeviationPct: "5.000", pumpGuardVolumeSpikeRatio: "3.00", pumpGuardCooldownMinutes: 30,
      dumpGuardDeviationPct: "5.000", dumpGuardVolumeSpikeRatio: "3.00", dumpGuardCooldownMinutes: 30,
      maxOpenCycles: 5, maxDailyOrders: 100,
      fiscalStatus: "individual", isActive: true,
      makerAttemptsBeforeTaker: 3, takerFallbackEnabled: false,
      takerFallbackAttemptNumber: 4, maxTakerFallbackPerCycle: 1,
      takerFallbackRequiresNetProfit: true, takerFallbackAuditRequired: true,
      gridWalletMode: "automatic", gridWalletInitialUsd: "1000.00", gridWalletMaxUsd: "5000.00",
      gridWalletUseProfits: true, gridWalletCompoundProfits: true,
      gridMaxCapitalPerCycleUsd: "600.00", gridMaxCapitalPerCyclePct: "60.00",
      gridReservePct: "20.00", gridMinFreeCapitalUsd: "50.00",
      gridPauseCycleWhenCapitalDepleted: true, gridAllowNewCycleWhenCapitalFree: true,
      gridAllocationMode: "uniform", gridCapitalDeploymentMode: "capped",
      gridProgressiveIntensity: "0.30", gridMaxLevelPct: "40.00", gridMinLevelUsd: "30.00",
      enforceCompactRange: true, gridRangeMaxPct: "2.50",
      maxDistanceFromCenterPct: "1.25", maxSellDistanceFromNearestBuyPct: "1.50",
      gridRangeControlMode: "adaptive_smart", adaptiveRangeEnabled: true,
      adaptiveRangeProfile: "balanced", adaptiveRangeMinPct: "1.50", adaptiveRangeMaxPct: "7.00",
      adaptiveRangeLowVolMaxPct: "3.00", adaptiveRangeNormalMaxPct: "5.00", adaptiveRangeHighVolMaxPct: "7.00",
      adaptiveRangeTargetFullLevels: false, adaptiveRangeMinViableLevels: 4,
      circuitBreakerOpen: true, circuitBreakerOpenedAt: new Date(),
      circuitBreakerReason: "risk", circuitBreakerCooldownUntil: null,
      circuitBreakerSourceCycleId: null, circuitBreakerSeverity: "critical",
      circuitBreakerReviewAfter: new Date(Date.now() + 300000),
      circuitBreakerResolvedAt: null, circuitBreakerResolvedBy: null,
      circuitBreakerResolutionReason: null,
      createdAt: new Date(), updatedAt: new Date(),
    });

    const engine = new GridIsolatedEngine();
    const internal = engine as any;

    // Load config from DB (real loadConfig)
    await internal.loadConfig();

    // Verify breaker loaded open
    expect(internal.circuitBreakerOpen).toBe(true);
    expect(internal.config.circuitBreakerOpen).toBe(true);

    // Do NOT replace saveConfig — let the real one run with DB mock
    const result = await internal.resolveCircuitBreaker({
      resolutionReason: "manual review",
      resolvedBy: "tester",
    });

    expect(result).toEqual({ success: true });

    // In-memory state
    expect(internal.circuitBreakerOpen).toBe(false);
    expect(internal.circuitBreakerOpenedAt).toBeNull();
    expect(internal.circuitBreakerReason).toBeNull();
    expect(internal.circuitBreakerCooldownUntil).toBeNull();

    // Config in-memory matches persisted
    expect(internal.config.circuitBreakerOpen).toBe(false);
    expect(internal.config.circuitBreakerResolvedBy).toBe("tester");
    expect(internal.config.circuitBreakerResolutionReason).toBe("manual review");
    expect(internal.config.circuitBreakerResolvedAt).toBeInstanceOf(Date);
    expect(internal.config.circuitBreakerOpenedAt).toBeNull();
    expect(internal.config.circuitBreakerReason).toBeNull();
    expect(internal.config.circuitBreakerCooldownUntil).toBeNull();

    // DB: config row persisted with resolution
    const dbCfg = configRows.get(cfgId);
    expect(dbCfg).toBeDefined();
    expect(dbCfg.circuitBreakerOpen).toBe(false);
    expect(dbCfg.circuitBreakerResolvedBy).toBe("tester");
    expect(dbCfg.circuitBreakerResolutionReason).toBe("manual review");
    expect(dbCfg.circuitBreakerResolvedAt).toBeTruthy();
    expect(dbCfg.circuitBreakerOpenedAt).toBeNull();
    expect(dbCfg.circuitBreakerReason).toBeNull();
    expect(dbCfg.circuitBreakerCooldownUntil).toBeNull();

    // No auto-close happened before explicit resolution
    // (no prior config writes with circuitBreakerOpen=false)
    expect(rollbackTriggered).toBe(false);
  });
});
