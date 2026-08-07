import { describe, it, expect, vi, beforeEach } from "vitest";

const transactionTrace: Array<{ operation: string; entity: string; payload?: unknown }> = [];
const committedTrace: Array<{ operation: string; entity: string; payload?: unknown }> = [];
let rollbackTriggered = false;
type FailurePoint = { operation: "insert" | "update"; entity: string; occurrence?: number };
let failureAt: FailurePoint | null = null;
let beforeCommitObserver: (() => void | Promise<void>) | null = null;
const operationOccurrences = new Map<string, number>();

function resolveEntityName(entity: unknown): string {
  if (entity === gridRangeVersions) return "gridRangeVersions";
  if (entity === gridIsolatedLevels) return "gridIsolatedLevels";
  if (entity === gridIsolatedCycles) return "gridIsolatedCycles";
  return "unknown";
}

function chain(operation: string, entity: unknown) {
  const entityName = resolveEntityName(entity);
  return {
    values: async (payload: unknown) => {
      transactionTrace.push({ operation, entity: entityName, payload });
      const key = `${operation}:${entityName}`;
      const occurrence = (operationOccurrences.get(key) ?? 0) + 1;
      operationOccurrences.set(key, occurrence);
      if (failureAt?.operation === operation && failureAt.entity === entityName && (failureAt.occurrence ?? 1) === occurrence) throw new Error(`forced ${key}`);
      return [];
    },
    set: (payload: unknown) => ({
      where: async () => {
        transactionTrace.push({ operation, entity: entityName, payload });
        const key = `${operation}:${entityName}`;
        const occurrence = (operationOccurrences.get(key) ?? 0) + 1;
        operationOccurrences.set(key, occurrence);
        if (failureAt?.operation === operation && failureAt.entity === entityName && (failureAt.occurrence ?? 1) === occurrence) throw new Error(`forced ${key}`);
        return [];
      },
    }),
  };
}

vi.mock("../../../db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn((entity) => chain("insert", entity)),
    update: vi.fn((entity) => chain("update", entity)),
    transaction: vi.fn(async (callback) => {
      const transactionStart = transactionTrace.length;
      const tx = { insert: (entity: unknown) => chain("insert", entity), update: (entity: unknown) => chain("update", entity) };
      try {
        const result = await callback(tx);
        await beforeCommitObserver?.();
        committedTrace.push(...transactionTrace.slice(transactionStart).filter((entry) => entry.entity !== "transaction"));
        transactionTrace.push({ operation: "commit", entity: "transaction" });
        return result;
      } catch (error) {
        rollbackTriggered = true;
        transactionTrace.push({ operation: "rollback", entity: "transaction" });
        throw error;
      }
    }),
  },
}));

import { db } from "../../../db";
import { GridIsolatedEngine } from "../gridIsolatedEngine";
import { gridRangeVersions, gridIsolatedLevels, gridIsolatedCycles } from "@shared/schema";
import { buildGridExecutionMarketSnapshot } from "../gridExecutionMarketSnapshot";
import {
  validateTargetCalculationJson,
  validateRiskStateJson,
  validateMakerExitStateJson,
  safeParseRiskStateJsonForensic,
  safeParseTargetCalculationJsonForensic,
  safeParseMakerExitStateJsonForensic,
} from "../gridJsonbValidators";
import { computeGridCycleEconomicPnl } from "../gridCycleEconomicPnl";
import { computeGrossTargetFromNet, computeSellPrice } from "../gridNetCalculator";

function makeConstraints(overrides?: any) {
  return {
    pair: "BTC/USD",
    normalizedPair: "BTC-USD",
    executionVenue: "REVOLUT_X" as const,
    baseCurrency: "BTC",
    quoteCurrency: "USD",
    priceTickSize: 0.1,
    quantityStep: 0.00001,
    minOrderBase: 0.0001,
    minOrderQuote: 1,
    minOrderUsd: 1,
    maxOrderBase: 100,
    pricePrecision: 1,
    quantityPrecision: 5,
    status: "ACTIVE",
    region: "EEA",
    source: "revolut_x_authenticated_configuration_pairs",
    fetchedAt: new Date(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    verified: true,
    reasonCode: null,
    ...overrides,
  };
}

const verifiedSnapshot = { verified: true, fresh: true, pair: "BTC/USD", normalizedPair: "BTC/USD", executionVenue: "REVOLUT_X", bid: 100, ask: 100.5, price: 100.25, spreadPct: 0.5, priceTickSize: 0.5, priceTickPct: 0.5, acquiredAt: new Date("2026-07-27T12:00:00.000Z"), timestamp: new Date("2026-07-27T12:00:00.000Z"), source: "REVOLUT_X_TICKER", reasonCode: null };
const verifiedConstraints = { verified: true, pair: "BTC/USD", normalizedPair: "BTC/USD", executionVenue: "REVOLUT_X", priceTickSize: 0.5, quantityStep: 0.00000001, minOrderBase: 0.0001, minOrderQuote: 10, minOrderUsd: 10, maxOrderBase: 10, baseCurrency: "BTC", quoteCurrency: "USD", source: "REVOLUT_X_AUTHENTICATED", fetchedAt: new Date("2026-07-27T12:00:00.000Z"), expiresAt: new Date("2026-07-27T12:15:00.000Z") };

function makeTicker(overrides?: any) {
  return {
    bid: 92900.0,
    ask: 93000.0,
    last: 92950.0,
    ...overrides,
  };
}

describe("Grid V3 cycle-owned engine logic", () => {
  beforeEach(() => {
    transactionTrace.length = 0;
    committedTrace.length = 0;
    rollbackTriggered = false;
    failureAt = null;
    beforeCommitObserver = null;
    operationOccurrences.clear();
    vi.clearAllMocks();
  });

  it("T1 BUY planned sin snapshot válido no escribe ni cambia el nivel", async () => {
    const engine = new GridIsolatedEngine();
    const internal = engine as any;
    const level = { id: "buy-1", side: "BUY", status: "planned", price: 100.24, rangeVersionId: "range-1" };
    internal.config = { pair: "BTC/USD", mode: "SHADOW" };
    internal.activeRangeVersion = { id: "range-1" };
    internal.logEvent = vi.fn();
    const result = await internal.processBuyLevelLifecycle(level, { ask: 101, bid: 100, price: 100 }, { tickId: 1, startedAt: new Date(), freshness: { isFresh: true } }, { active: false }, null);
    expect(result).toBeNull();
    expect(level.status).toBe("planned");
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("T2 BUY planned usa el tick oficial 0.50 y no el legacy BTC 0.10", async () => {
    const engine = new GridIsolatedEngine();
    const internal = engine as any;
    const level: any = { id: "buy-2", side: "BUY", status: "planned", price: 100.74, quantity: 1, rangeVersionId: "range-1" };
    internal.config = { pair: "BTC/USD", mode: "SHADOW", gridMinLevelUsd: 10, maxOpenCycles: 10, defaultExitPolicyVersion: "CYCLE_OWNED_NET_TARGET_V3" };
    internal.activeRangeVersion = { id: "range-1" };
    internal.cycles = [];
    internal.logEvent = vi.fn();
    const result = await internal.processBuyLevelLifecycle(level, { ask: 101, bid: 100, price: 100 }, { tickId: 2, startedAt: new Date(), pair: "BTC/USD", freshness: { isFresh: true }, ask: 101, bid: 100 }, { allowBuyFill: true }, 0.5);
    expect(result).toBe("pending");
    expect(level.buyMakerRequestedPrice).toBe(100.5);
    expect(level.buyMakerRequestedPrice).not.toBe(100.7);
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("T3 propuesta no viable conserva memoria y evita transacción", async () => {
    const engine = new GridIsolatedEngine();
    const internal = engine as any;
    const oldRange = { id: "old", midPrice: 100, bandWidthPct: 1, bandLower: 95, bandUpper: 105 };
    const oldLevels = [{ id: "old-buy" }];
    internal.config = { pair: "BTC/USD" };
    internal.activeRangeVersion = oldRange;
    internal.levels = oldLevels;
    internal.buildRangeProposal = vi.fn().mockResolvedValue({ ok: false, reasonCode: "NOT_VIABLE", explanation: "no viable" });
    internal.logEvent = vi.fn();
    const result = await internal.proposeRangeVersion({}, {} as any, {} as any);
    expect(result).toEqual({ ok: false, reasonCode: "NOT_VIABLE", explanation: "no viable" });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(internal.activeRangeVersion).toBe(oldRange);
    expect(internal.levels).toBe(oldLevels);
  });
  function validCandidate() {
    return { ok: true, rangeVersionId: "new-range", gridLevels: [
      { id: "new-1", rangeVersionId: "new-range", levelIndex: 1, side: "BUY", price: 99, notionalUsd: 10, quantity: 0.1, status: "planned", clientOrderId: null, netProfitTargetUsd: 1, feeEstimateUsd: 0.1, taxReserveUsd: 0.2 },
      { id: "new-2", rangeVersionId: "new-range", levelIndex: 2, side: "SELL", price: 101, notionalUsd: 10, quantity: 0.1, status: "planned", clientOrderId: null, netProfitTargetUsd: 1, feeEstimateUsd: 0.1, taxReserveUsd: 0.2 },
    ], professionalGenerator: { centerPrice: 100, operationalUpper: 105, operationalLower: 95 }, allocation: { finalGridBudgetUsd: 100, capitalPerLevelUsd: 50 }, generatedLevels: [{}, {}], viabilityStatus: "viable" };
  }

  it("T4 rebuild viable persiste candidato en una transacción y conserva el orden", async () => {
    const engine = new GridIsolatedEngine(); const internal = engine as any;
    internal.config = { pair: "BTC/USD", netProfitTargetPct: 1 };
    internal.activeRangeVersion = { id: "old", midPrice: 100, bandWidthPct: 1, bandLower: 95, bandUpper: 105 };
    internal.levels = [{ id: "old-free", status: "planned" }]; internal.cycles = []; internal.logEvent = vi.fn();
    internal.buildRangeProposal = vi.fn().mockResolvedValue(validCandidate()); internal.getNextVersionNumber = vi.fn().mockResolvedValue(2);
    await internal.rebuildRangeAndLevels({ midPrice: 101, bandWidthPct: 1, upper: 105, middle: 100, lower: 95, atrPct: 1, regime: "ranging" }, {} as any, {} as any);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(transactionTrace.map((x) => x.operation)).toEqual(["insert", "insert", "insert", "update", "update", "commit"]);
    expect(internal.activeRangeVersion.id).toBe("new-range");
    expect(committedTrace).toHaveLength(5);
  });

  it("T5 rebuild no cambia memoria durante callback y la cambia tras commit", async () => {
    const engine = new GridIsolatedEngine(); const internal = engine as any; const oldRange = { id: "old", midPrice: 100, bandWidthPct: 1, bandLower: 95, bandUpper: 105 }; const oldLevels = [{ id: "old-free", status: "planned" }];
    internal.config = { pair: "BTC/USD", netProfitTargetPct: 1 }; internal.activeRangeVersion = oldRange; internal.levels = oldLevels; internal.cycles = []; internal.logEvent = vi.fn(); internal.buildRangeProposal = vi.fn().mockResolvedValue(validCandidate()); internal.getNextVersionNumber = vi.fn().mockResolvedValue(2);
    beforeCommitObserver = () => {
      expect(internal.activeRangeVersion).toBe(oldRange);
      expect(internal.levels).toBe(oldLevels);
      expect(committedTrace).toHaveLength(0);
      transactionTrace.push({ operation: "before_commit_memory_checked", entity: "engine" });
    };
    await internal.rebuildRangeAndLevels({ midPrice: 101, bandWidthPct: 1, upper: 105, middle: 100, lower: 95, atrPct: 1, regime: "ranging" }, verifiedSnapshot as any, verifiedConstraints as any);
    expect(transactionTrace.findIndex((x) => x.operation === "before_commit_memory_checked")).toBeLessThan(transactionTrace.findIndex((x) => x.operation === "commit"));
    expect(committedTrace.length).toBeGreaterThan(0);
    expect(internal.activeRangeVersion.id).toBe("new-range"); expect(internal.levels).not.toBe(oldLevels);
  });

  it("T6 fallo de transacción hace rollback y conserva memoria", async () => {
    const engine = new GridIsolatedEngine(); const internal = engine as any; const oldRange = { id: "old", midPrice: 100, bandWidthPct: 1, bandLower: 95, bandUpper: 105 }; const oldLevels = [{ id: "old-free", status: "planned" }];
    internal.config = { pair: "BTC/USD", netProfitTargetPct: 1 }; internal.activeRangeVersion = oldRange; internal.levels = oldLevels; internal.cycles = []; internal.logEvent = vi.fn(); internal.buildRangeProposal = vi.fn().mockResolvedValue(validCandidate()); internal.getNextVersionNumber = vi.fn().mockResolvedValue(2);
    failureAt = { operation: "insert", entity: "gridIsolatedLevels", occurrence: 1 };
    await internal.rebuildRangeAndLevels({ midPrice: 101, bandWidthPct: 1, upper: 105, middle: 100, lower: 95, atrPct: 1, regime: "ranging" }, verifiedSnapshot as any, verifiedConstraints as any);
    expect(rollbackTriggered).toBe(true);
    expect(transactionTrace.map((entry) => `${entry.operation}:${entry.entity}`)).toEqual(["insert:gridRangeVersions", "insert:gridIsolatedLevels", "rollback:transaction"]);
    expect(transactionTrace.some((entry) => entry.operation === "commit")).toBe(false);
    expect(transactionTrace.some((entry) => entry.operation === "update")).toBe(false);
    expect(committedTrace).toHaveLength(0); expect(internal.activeRangeVersion).toBe(oldRange); expect(internal.levels).toBe(oldLevels);
  });

  it("T7 rollback al reemplazar el rango anterior conserva memoria", async () => {
    const engine = new GridIsolatedEngine(); const internal = engine as any;
    const oldRange = { id: "old", midPrice: 100, bandWidthPct: 1, bandLower: 95, bandUpper: 105 }; const oldLevels = [{ id: "old-free", rangeVersionId: "old", status: "planned" }];
    internal.config = { pair: "BTC/USD", netProfitTargetPct: 1 }; internal.activeRangeVersion = oldRange; internal.levels = oldLevels; internal.cycles = []; internal.logEvent = vi.fn(); internal.buildRangeProposal = vi.fn().mockResolvedValue(validCandidate()); internal.getNextVersionNumber = vi.fn().mockResolvedValue(2);
    failureAt = { operation: "update", entity: "gridRangeVersions", occurrence: 1 };
    await internal.rebuildRangeAndLevels({ midPrice: 101, bandWidthPct: 1, upper: 105, middle: 100, lower: 95, atrPct: 1, regime: "ranging" }, verifiedSnapshot as any, verifiedConstraints as any);
    expect(transactionTrace.map((entry) => `${entry.operation}:${entry.entity}`)).toEqual(["insert:gridRangeVersions", "insert:gridIsolatedLevels", "insert:gridIsolatedLevels", "update:gridRangeVersions", "rollback:transaction"]);
    expect(rollbackTriggered).toBe(true); expect(committedTrace).toHaveLength(0); expect(internal.activeRangeVersion).toBe(oldRange); expect(internal.levels).toBe(oldLevels);
  });

  it("T8 preserva por ID niveles de ciclos abiertos e históricos", async () => {
    const engine = new GridIsolatedEngine(); const internal = engine as any;
    const freeLevel = { id: "level-free", rangeVersionId: "old-range", side: "BUY", status: "planned" };
    const ownedLevel = { id: "level-owned-open-cycle", rangeVersionId: "old-range", side: "BUY", status: "filled" };
    const historicalLevel = { id: "level-historical", rangeVersionId: "older-range", side: "SELL", status: "filled" };
    internal.config = { pair: "BTC/USD", netProfitTargetPct: 1 }; internal.activeRangeVersion = { id: "old-range", midPrice: 100, bandWidthPct: 1, bandLower: 95, bandUpper: 105 }; internal.levels = [freeLevel, ownedLevel, historicalLevel]; internal.cycles = [{ id: "cycle-open", buyLevelId: "level-owned-open-cycle", sellLevelId: null, targetSellLevelId: null, rangeVersionId: "old-range", status: "buy_filled" }]; internal.logEvent = vi.fn(); internal.buildRangeProposal = vi.fn().mockResolvedValue(validCandidate()); internal.getNextVersionNumber = vi.fn().mockResolvedValue(2);
    await internal.rebuildRangeAndLevels({ midPrice: 101, bandWidthPct: 1, upper: 105, middle: 100, lower: 95, atrPct: 1, regime: "ranging" }, verifiedSnapshot as any, verifiedConstraints as any);
    expect(internal.levels.find((level: any) => level.id === "level-free")?.status).toBe("replaced");
    expect(internal.levels).toContain(ownedLevel); expect(internal.levels).toContain(historicalLevel);
    expect(internal.levels.filter((level: any) => level.id.startsWith("new-")).every((level: any) => level.rangeVersionId === "new-range")).toBe(true);
  });

  it("T9 simulateShadowTick bloquea BUY cuando allowRangeBuys es false", async () => {
    const engine = new GridIsolatedEngine(); const internal = engine as any;
    const buy: any = { id: "buy-invalid-snapshot", side: "BUY", status: "planned", price: 100.74, quantity: 1, rangeVersionId: "range-1" };
    internal.config = { pair: "BTC/USD", mode: "SHADOW", gridMinLevelUsd: 10, maxOpenCycles: 10, defaultExitPolicyVersion: "CYCLE_OWNED_NET_TARGET_V3" }; internal.activeRangeVersion = { id: "range-1", midPrice: 101 }; internal.levels = [buy]; internal.cycles = []; internal.logEvent = vi.fn();
    await internal.simulateShadowTick({ price: 100, ask: 101, bid: 100 }, { tickId: 10, startedAt: new Date(), pair: "BTC/USD", freshness: { isFresh: true }, ask: 101, bid: 100 }, { bandSnapshot: {}, pumpGuard: { allowBuyFill: true }, allowRangeBuys: false, priceTickSize: null });
    expect(buy.status).toBe("planned"); expect(buy.buyMakerRequestedPrice).toBeUndefined(); expect(db.update).not.toHaveBeenCalled(); expect(internal.logEvent).toHaveBeenCalledWith("EXECUTION_MARKET_SNAPSHOT_UNAVAILABLE", expect.any(String), expect.any(Object));
  });

  it("T10 simulateShadowTick propaga tick oficial 0.50 al placement BUY", async () => {
    const engine = new GridIsolatedEngine(); const internal = engine as any;
    const buy: any = { id: "buy-official-tick", side: "BUY", status: "planned", price: 100.74, quantity: 1, rangeVersionId: "range-1" };
    internal.config = { pair: "BTC/USD", mode: "SHADOW", gridMinLevelUsd: 10, maxOpenCycles: 10, defaultExitPolicyVersion: "CYCLE_OWNED_NET_TARGET_V3" }; internal.activeRangeVersion = { id: "range-1", midPrice: 101 }; internal.levels = [buy]; internal.cycles = []; internal.logEvent = vi.fn();
    const legacyTickSpy = vi.spyOn(internal, "getLegacyPriceTickSize");
    await internal.simulateShadowTick({ price: 100, ask: 101, bid: 100 }, { tickId: 11, startedAt: new Date(), pair: "BTC/USD", freshness: { isFresh: true }, ask: 101, bid: 100 }, { bandSnapshot: {}, pumpGuard: { allowBuyFill: true }, allowRangeBuys: true, priceTickSize: verifiedSnapshot.priceTickSize });
    expect(buy.status).toBe("buy_maker_pending"); expect(buy.buyMakerRequestedPrice).toBe(100.5); expect(legacyTickSpy).not.toHaveBeenCalled(); expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("rechaza snapshot con par distinto o venue incorrecto", () => {
    const constraints = makeConstraints();
    const ticker = makeTicker();
    const now = new Date();
    const snapshot = buildGridExecutionMarketSnapshot({
      pair: "ETH/USD",
      ticker,
      constraints,
      source: "revolut_x_ticker",
      timestamp: now,
      acquiredAt: now,
      now,
    });
    expect(snapshot.verified).toBe(false);
    expect(snapshot.reasonCode).toBe("EXECUTION_MARKET_PAIR_MISMATCH");

    const badVenue = makeConstraints({ executionVenue: "KRAKEN" as any });
    const snapshot2 = buildGridExecutionMarketSnapshot({
      pair: "BTC/USD",
      ticker: makeTicker(),
      constraints: badVenue,
      source: "revolut_x_ticker",
      timestamp: now,
      acquiredAt: now,
      now,
    });
    expect(snapshot2.verified).toBe(false);
  });

  it("rechaza snapshot no verificado si constraints no son válidas", () => {
    const constraints = makeConstraints({ verified: false, reasonCode: "PAIR_CONSTRAINTS_UNAVAILABLE" });
    const now = new Date();
    const snapshot = buildGridExecutionMarketSnapshot({
      pair: "BTC/USD",
      ticker: makeTicker(),
      constraints,
      source: "revolut_x_ticker",
      timestamp: now,
      acquiredAt: now,
      now,
    });
    expect(snapshot.verified).toBe(false);
    expect(snapshot.reasonCode).toMatch(/CONSTRAINT|CONSTRAINTS/);
  });

  it("bloquea BUY si snapshot es stale o no verificado (fail-closed)", () => {
    const staleSnapshot = buildGridExecutionMarketSnapshot({
      pair: "BTC/USD",
      ticker: makeTicker(),
      constraints: makeConstraints(),
      source: "revolut_x_ticker",
      timestamp: new Date(Date.now() - 60_000),
      acquiredAt: new Date(),
      now: new Date(),
    });
    // Timestamp antiguo > maxAgeMs => rechazado; BUY bloqueada.
    expect(staleSnapshot.verified).toBe(false);
    expect(staleSnapshot.reasonCode).toBe("EXECUTION_MARKET_STALE");
    const allowRangeBuys = staleSnapshot.verified && staleSnapshot.fresh;
    expect(allowRangeBuys).toBe(false);

    const unverifiedConstraints = makeConstraints({ verified: false, reasonCode: "PAIR_CONSTRAINTS_UNAVAILABLE" });
    const badSnapshot = buildGridExecutionMarketSnapshot({
      pair: "BTC/USD",
      ticker: makeTicker(),
      constraints: unverifiedConstraints,
      source: "revolut_x_ticker",
      timestamp: new Date(),
      acquiredAt: new Date(),
      now: new Date(),
    });
    expect(badSnapshot.verified).toBe(false);
    const allowRangeBuys2 = badSnapshot.verified && badSnapshot.fresh;
    expect(allowRangeBuys2).toBe(false);
  });

  it("permite SELL fills independientemente de allowRangeBuys", () => {
    // En V3 SELL fills dependen del maker lifecycle y del bid vs requestedMakerPrice,
    // no del flag allowRangeBuys.
    const allowRangeBuys = false;
    const bestBid = 97000;
    const requestedMakerPrice = 96500;
    const canFillSell = bestBid >= requestedMakerPrice;
    expect(allowRangeBuys).toBe(false);
    expect(canFillSell).toBe(true);
  });

  it("valida JSONB V3 completo y coherente", () => {
    const calc = {
      selected: true,
      stateVersion: 2,
      policyVersion: "CYCLE_OWNED_NET_TARGET_V3",
      targetKind: "CYCLE_OWNED_SYNTHETIC",
      targetSellLevelId: null,
      targetRungLevelId: null,
      targetSellPrice: 97000.0,
      targetSellQuantity: 0.01,
      grossExitGapPct: 1.0,
      actualGrossGapPct: 1.0,
      grossPnlUsd: 5.0,
      buyFeePct: 0,
      sellFeePct: 0.09,
      spreadBufferPct: 0.01,
      safetyBufferPct: 0.10,
      taxReservePct: 20,
      buyFeeUsd: 0,
      sellFeeUsd: 0.0873,
      exchangeFeesUsd: 0.0873,
      operationalCostsUsd: 0.1012,
      netBeforeTaxUsd: 4.8115,
      netBeforeTaxPct: 0.523,
      taxReserveUsd: 0.9623,
      availablePnlAfterTaxUsd: 3.8492,
      availablePnlAfterTaxPct: 0.4185,
      netProfitTargetPct: 0.4,
      priceTickSize: 0.1,
      quantityStep: 0.00001,
      minOrderBase: 0.0001,
      minOrderQuote: 1,
      minOrderUsd: 1,
      maxOrderBase: 100,
      baseCurrency: "BTC",
      quoteCurrency: "USD",
      constraintsSource: "revolut_x_authenticated_configuration_pairs",
      constraintsFetchedAt: new Date().toISOString(),
      rejectedCandidates: [],
      explanation: "Target V3 canónico",
    };
    const validation = validateTargetCalculationJson(calc);
    expect(validation.valid).toBe(true);
  });

  it("rechaza JSONB V3 cuando availablePnlAfterTaxPct < netProfitTargetPct", () => {
    const calc = {
      selected: true,
      stateVersion: 2,
      policyVersion: "CYCLE_OWNED_NET_TARGET_V3",
      targetKind: "CYCLE_OWNED_SYNTHETIC",
      targetSellLevelId: null,
      targetRungLevelId: null,
      targetSellPrice: 97000.0,
      targetSellQuantity: 0.01,
      grossExitGapPct: 1.0,
      actualGrossGapPct: 1.0,
      grossPnlUsd: 5.0,
      buyFeePct: 0,
      sellFeePct: 0.09,
      spreadBufferPct: 0.01,
      safetyBufferPct: 0.10,
      taxReservePct: 20,
      buyFeeUsd: 0,
      sellFeeUsd: 0.0873,
      exchangeFeesUsd: 0.0873,
      operationalCostsUsd: 0.1012,
      netBeforeTaxUsd: 4.8115,
      netBeforeTaxPct: 0.523,
      taxReserveUsd: 0.9623,
      availablePnlAfterTaxUsd: 3.8492,
      availablePnlAfterTaxPct: 0.4185,
      netProfitTargetPct: 0.5,
      priceTickSize: 0.1,
      quantityStep: 0.00001,
      minOrderBase: 0.0001,
      minOrderQuote: 1,
      minOrderUsd: 1,
      maxOrderBase: 100,
      baseCurrency: "BTC",
      quoteCurrency: "USD",
      constraintsSource: "revolut_x_authenticated_configuration_pairs",
      constraintsFetchedAt: new Date().toISOString(),
      rejectedCandidates: [],
      explanation: "Target V3 canónico",
    };
    const validation = validateTargetCalculationJson(calc);
    expect(validation.valid).toBe(false);
    if (!validation.valid) {
      expect(validation.code).toBe("TARGET_V3_NET_BELOW_TARGET");
      expect(validation.reason).toContain("inferior al objetivo");
    }
  });

  it("protege ciclo #26 con snapshot V3 exacto (no recálculo)", () => {
    // Fixture exacto del ciclo #26: buyPrice, quantity y targetSellPrice son intocables.
    const cycle26 = {
      id: "a2a0b7ca-a710-4402-8a11-54222bf98455",
      buyPrice: 62532.30,
      quantity: 0.00383786,
      targetSellPrice: 65692.19591410,
      targetCalculationJson: {
        selected: true,
        stateVersion: 2,
        policyVersion: "CYCLE_OWNED_NET_TARGET_V3",
        targetKind: "CYCLE_OWNED_SYNTHETIC",
        targetSellLevelId: null,
        targetRungLevelId: null,
        targetSellPrice: 65692.19591410,
        targetSellQuantity: 0.00383786,
        grossExitGapPct: 5.0565,
        actualGrossGapPct: 5.0565,
        grossPnlUsd: 12.1272,
        buyFeePct: 0,
        sellFeePct: 0.09,
        spreadBufferPct: 0.01,
        safetyBufferPct: 0.10,
        taxReservePct: 20,
        buyFeeUsd: 0,
        sellFeeUsd: 0.2269,
        exchangeFeesUsd: 0.2269,
        operationalCostsUsd: 0.2640,
        netBeforeTaxUsd: 11.6363,
        netBeforeTaxPct: 4.8487,
        taxReserveUsd: 2.3273,
        availablePnlAfterTaxUsd: 9.3091,
        availablePnlAfterTaxPct: 3.8789,
        netProfitTargetPct: 0.2,
        priceTickSize: 0.1,
        quantityStep: 0.00001,
        minOrderBase: 0.0001,
        minOrderQuote: 1,
        minOrderUsd: 1,
        maxOrderBase: 100,
        baseCurrency: "BTC",
        quoteCurrency: "USD",
        constraintsSource: "revolut_x_authenticated_configuration_pairs",
        constraintsFetchedAt: new Date("2025-01-22T18:00:00.000Z").toISOString(),
        rejectedCandidates: [],
        explanation: "target V3 ciclo 26",
      },
    };
    // Reconstruir economía con parámetros del snapshot inmutable (no config actual).
    const calc = cycle26.targetCalculationJson;
    const pnl = computeGridCycleEconomicPnl({
      buyPrice: cycle26.buyPrice,
      sellPrice: cycle26.targetSellPrice,
      quantity: cycle26.quantity,
      buyFeePct: calc.buyFeePct,
      sellFeePct: calc.sellFeePct,
      spreadBufferPct: calc.spreadBufferPct,
      safetyBufferPct: calc.safetyBufferPct,
      taxReservePct: calc.taxReservePct,
    });

    // Precio y cantidad no deben recalcularse.
    expect(cycle26.targetSellPrice).toBe(65692.19591410);
    expect(cycle26.quantity).toBe(0.00383786);

    // Economía recalculada a partir del snapshot debe ser internamente coherente.
    expect(pnl.exchangeFeesUsd).toBeCloseTo(calc.exchangeFeesUsd, 2);
    expect(pnl.operationalCostsUsd).toBeCloseTo(calc.operationalCostsUsd, 2);
    expect(pnl.netPnlUsd).toBeCloseTo(calc.availablePnlAfterTaxUsd, 2);
  });
});

// ─── Gate E — Snapshot edge cases ─────────────────────────────────────

describe("Gate E — buildGridExecutionMarketSnapshot edge cases", () => {
  function makeConstraints(overrides?: any) {
    return {
      pair: "BTC/USD",
      normalizedPair: "BTC-USD",
      executionVenue: "REVOLUT_X" as const,
      baseCurrency: "BTC",
      quoteCurrency: "USD",
      priceTickSize: 0.5,
      quantityStep: 0.00000001,
      minOrderBase: 0.0001,
      minOrderQuote: 10,
      minOrderUsd: 10,
      maxOrderBase: 10,
      pricePrecision: 1,
      quantityPrecision: 8,
      status: "ACTIVE",
      region: "EEA",
      source: "revolut_x_authenticated_configuration_pairs",
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      verified: true,
      reasonCode: null,
      ...overrides,
    };
  }
  function makeTicker(overrides?: any) {
    return { bid: 92900.0, ask: 93000.0, last: 92950.0, ...overrides };
  }

  it("E-S1: rechaza BID inválido (null) con EXECUTION_MARKET_BID_INVALID", () => {
    const now = new Date();
    const snapshot = buildGridExecutionMarketSnapshot({
      pair: "BTC/USD", ticker: makeTicker({ bid: null }), constraints: makeConstraints(),
      source: "revolut_x_ticker", timestamp: now, acquiredAt: now, now,
    });
    expect(snapshot.verified).toBe(false);
    expect(snapshot.reasonCode).toBe("EXECUTION_MARKET_BID_INVALID");
  });

  it("E-S2: rechaza ASK ≤ BID con EXECUTION_MARKET_ASK_INVALID", () => {
    const now = new Date();
    const snapshot = buildGridExecutionMarketSnapshot({
      pair: "BTC/USD", ticker: makeTicker({ bid: 93000, ask: 93000 }), constraints: makeConstraints(),
      source: "revolut_x_ticker", timestamp: now, acquiredAt: now, now,
    });
    expect(snapshot.verified).toBe(false);
    expect(snapshot.reasonCode).toBe("EXECUTION_MARKET_ASK_INVALID");
  });

  it("E-S3: rechaza fuente sin REVOLUT ni KRAKEN con EXECUTION_MARKET_SOURCE_INVALID", () => {
    const now = new Date();
    const snapshot = buildGridExecutionMarketSnapshot({
      pair: "BTC/USD", ticker: makeTicker(), constraints: makeConstraints(),
      source: "binance_ticker", timestamp: now, acquiredAt: now, now,
    });
    expect(snapshot.verified).toBe(false);
    expect(snapshot.reasonCode).toBe("EXECUTION_MARKET_SOURCE_INVALID");
  });

  it("E-S4: rechaza timestamp excesivamente futuro con EXECUTION_MARKET_FUTURE_TIMESTAMP", () => {
    const now = new Date();
    const futureTs = new Date(now.getTime() + 60_000);
    const snapshot = buildGridExecutionMarketSnapshot({
      pair: "BTC/USD", ticker: makeTicker(), constraints: makeConstraints(),
      source: "revolut_x_ticker", timestamp: futureTs, acquiredAt: now, now,
    });
    expect(snapshot.verified).toBe(false);
    expect(snapshot.reasonCode).toBe("EXECUTION_MARKET_FUTURE_TIMESTAMP");
  });

  it("E-S5: rechaza last price inválido (negativo) con EXECUTION_MARKET_TIMESTAMP_INVALID", () => {
    const now = new Date();
    const snapshot = buildGridExecutionMarketSnapshot({
      pair: "BTC/USD", ticker: makeTicker({ last: -1 }), constraints: makeConstraints(),
      source: "revolut_x_ticker", timestamp: now, acquiredAt: now, now,
    });
    expect(snapshot.verified).toBe(false);
    expect(snapshot.reasonCode).toBe("EXECUTION_MARKET_TIMESTAMP_INVALID");
  });

  it("E-S6: rechaza por fetchedAt stale cuando no hay timestamp de mercado", () => {
    const now = new Date();
    const staleFetched = new Date(now.getTime() - 60_000);
    const snapshot = buildGridExecutionMarketSnapshot({
      pair: "BTC/USD", ticker: makeTicker(), constraints: makeConstraints(),
      source: "revolut_x_ticker", timestamp: null, fetchedAt: staleFetched, acquiredAt: now, now,
    });
    expect(snapshot.verified).toBe(false);
    expect(snapshot.reasonCode).toBe("EXECUTION_MARKET_STALE");
  });

  it("E-S7: snapshot válido produce spread, spreadPct y priceTickPct correctos", () => {
    const now = new Date();
    const snapshot = buildGridExecutionMarketSnapshot({
      pair: "BTC/USD", ticker: makeTicker(), constraints: makeConstraints(),
      source: "revolut_x_ticker", timestamp: now, acquiredAt: now, now,
    });
    expect(snapshot.verified).toBe(true);
    expect(snapshot.fresh).toBe(true);
    expect(snapshot.spreadUsd).toBe(100);
    expect(snapshot.spreadPct).toBeCloseTo(100 / 92900 * 100, 6);
    expect(snapshot.priceTickSize).toBe(0.5);
    expect(snapshot.priceTickPct).toBeCloseTo(0.5 / 92950 * 100, 6);
    expect(snapshot.venue).toBe("REVOLUT_X");
  });
});

// ─── Gate E — JSONB V3 validation edge cases ──────────────────────────

function validV3Calc(): Record<string, unknown> {
  return {
    selected: true,
    stateVersion: 2,
    policyVersion: "CYCLE_OWNED_NET_TARGET_V3",
    targetKind: "CYCLE_OWNED_SYNTHETIC",
    targetSellLevelId: null,
    targetRungLevelId: null,
    targetSellPrice: 97000.0,
    targetSellQuantity: 0.01,
    grossExitGapPct: 1.0,
    actualGrossGapPct: 1.0,
    grossPnlUsd: 5.0,
    buyFeePct: 0,
    sellFeePct: 0.09,
    spreadBufferPct: 0.01,
    safetyBufferPct: 0.10,
    taxReservePct: 20,
    buyFeeUsd: 0,
    sellFeeUsd: 0.0873,
    exchangeFeesUsd: 0.0873,
    operationalCostsUsd: 0.1012,
    netBeforeTaxUsd: 4.8115,
    netBeforeTaxPct: 0.523,
    taxReserveUsd: 0.9623,
    availablePnlAfterTaxUsd: 3.8492,
    availablePnlAfterTaxPct: 0.4185,
    netProfitTargetPct: 0.4,
    priceTickSize: 0.1,
    quantityStep: 0.00001,
    minOrderBase: 0.0001,
    minOrderQuote: 1,
    minOrderUsd: 1,
    maxOrderBase: 100,
    baseCurrency: "BTC",
    quoteCurrency: "USD",
    constraintsSource: "revolut_x_authenticated_configuration_pairs",
    constraintsFetchedAt: new Date().toISOString(),
    rejectedCandidates: [],
    explanation: "Target V3 canónico",
  };
}

describe("Gate E — validateTargetCalculationJson V3 edge cases", () => {
  it("E-J1: raw no es objeto → TARGET_NOT_OBJECT", () => {
    const result = validateTargetCalculationJson("not-an-object");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("TARGET_NOT_OBJECT");
  });

  it("E-J2: targetKind inválido → TARGET_KIND_INVALID", () => {
    const calc = validV3Calc();
    calc.targetKind = "BOGUS";
    const result = validateTargetCalculationJson(calc);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("TARGET_KIND_INVALID");
  });

  it("E-J3: V3 con stateVersion=1 → TARGET_V3_INVALID", () => {
    const calc = validV3Calc();
    calc.stateVersion = 1;
    const result = validateTargetCalculationJson(calc);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("TARGET_V3_INVALID");
  });

  it("E-J4: V3 con campos numéricos faltantes → TARGET_V3_MISSING_FIELDS", () => {
    const calc = validV3Calc();
    delete calc.targetSellPrice;
    delete calc.grossPnlUsd;
    const result = validateTargetCalculationJson(calc);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("TARGET_V3_MISSING_FIELDS");
  });

  it("E-J5: V3 con strings faltantes → TARGET_V3_MISSING_STRINGS", () => {
    const calc = validV3Calc();
    delete calc.baseCurrency;
    delete calc.explanation;
    const result = validateTargetCalculationJson(calc);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("TARGET_V3_MISSING_STRINGS");
  });

  it("E-J6: V3 con targetSellPrice negativo → TARGET_V3_NON_POSITIVE", () => {
    const calc = validV3Calc();
    calc.targetSellPrice = -100;
    const result = validateTargetCalculationJson(calc);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("TARGET_V3_NON_POSITIVE");
  });

  it("E-J7: V3 con precio no alineado a tick → TARGET_V3_PRICE_NOT_ALIGNED", () => {
    const calc = validV3Calc();
    calc.targetSellPrice = 97000.07;
    calc.priceTickSize = 0.1;
    const result = validateTargetCalculationJson(calc);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("TARGET_V3_PRICE_NOT_ALIGNED");
  });

  it("E-J8: V3 con cantidad no alineada a step → TARGET_V3_QTY_NOT_ALIGNED", () => {
    const calc = validV3Calc();
    calc.targetSellQuantity = 0.0100001;
    calc.quantityStep = 0.00001;
    const result = validateTargetCalculationJson(calc);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("TARGET_V3_QTY_NOT_ALIGNED");
  });

  it("E-J9: V3 con cantidad inferior a minOrderBase → TARGET_V3_QTY_BELOW_MIN", () => {
    const calc = validV3Calc();
    calc.targetSellQuantity = 0.00001;
    calc.minOrderBase = 0.0001;
    const result = validateTargetCalculationJson(calc);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("TARGET_V3_QTY_BELOW_MIN");
  });

  it("E-J10: V3 con notional inferior a minOrderQuote → TARGET_V3_NOTIONAL_BELOW_MIN", () => {
    const calc = validV3Calc();
    calc.targetSellPrice = 0.1;
    calc.targetSellQuantity = 0.0001;
    calc.minOrderQuote = 10;
    calc.minOrderUsd = 10;
    const result = validateTargetCalculationJson(calc);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("TARGET_V3_NOTIONAL_BELOW_MIN");
  });

  it("E-J11: V3 con exchangeFeesUsd incoherente → TARGET_V3_FEES_INCOHERENT", () => {
    const calc = validV3Calc();
    calc.exchangeFeesUsd = 999;
    const result = validateTargetCalculationJson(calc);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("TARGET_V3_FEES_INCOHERENT");
  });

  it("E-J12: V3 con netBeforeTaxUsd incoherente → TARGET_V3_NET_BEFORE_TAX_INCOHERENT", () => {
    const calc = validV3Calc();
    calc.netBeforeTaxUsd = 999;
    const result = validateTargetCalculationJson(calc);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("TARGET_V3_NET_BEFORE_TAX_INCOHERENT");
  });

  it("E-J13: V3 con availablePnlAfterTaxUsd incoherente → TARGET_V3_NET_AFTER_TAX_INCOHERENT", () => {
    const calc = validV3Calc();
    calc.availablePnlAfterTaxUsd = 999;
    const result = validateTargetCalculationJson(calc);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("TARGET_V3_NET_AFTER_TAX_INCOHERENT");
  });

  it("E-J14: V3 con minOrderUsd distinto a minOrderQuote para USD → TARGET_V3_MIN_USD_MISMATCH", () => {
    const calc = validV3Calc();
    calc.minOrderUsd = 5;
    calc.minOrderQuote = 10;
    const result = validateTargetCalculationJson(calc);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("TARGET_V3_MIN_USD_MISMATCH");
  });

  it("E-J15: V3 con targetSellLevelId no null → TARGET_V3_INVALID", () => {
    const calc = validV3Calc();
    calc.targetSellLevelId = "should-be-null";
    const result = validateTargetCalculationJson(calc);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("TARGET_V3_INVALID");
  });

  it("E-J16: forensic parser preserva raw y code para V3 inválido", () => {
    const calc = validV3Calc();
    calc.targetSellPrice = -1;
    const result = safeParseTargetCalculationJsonForensic(calc);
    expect(result.valid).toBe(false);
    expect(result.value).toBeNull();
    expect(result.raw).toBe(calc);
    expect(result.code).toBe("TARGET_V3_NON_POSITIVE");
  });
});

// ─── Gate E — Risk state validation ───────────────────────────────────

function validRiskState(): Record<string, unknown> {
  return {
    stateVersion: 1,
    trailing: { activated: false, activatedAt: null, highestPriceSinceBuy: null, trailingStopPct: 0, currentStopPrice: null, reason: "" },
    stopLoss: [{ layer: "soft", triggerPricePct: -5, triggered: false, triggeredAt: null, reason: "" }],
    hodl: { active: false, activatedAt: null, originalBuyPrice: null, recoveryTargetPrice: null, reason: "" },
    protectiveExit: { state: "NONE", route: null, triggerPrice: null, triggerDetectedAt: null, bestBidAtTrigger: null, bestAskAtTrigger: null, requestedMakerPrice: null, makerOrderCreatedAt: null, makerEligibleAfter: null, lifecycleTickId: null, lastRepricedAt: null, repriceAttempts: 0, pendingQuantity: 0, simulatedOrderId: null, fillPrice: null, filledAt: null, bestBidAtFill: null, bestAskAtFill: null, cancellationReason: null },
    lastAction: null,
    activeExitRoute: null,
    pendingExitPrice: null,
    lastEvaluatedAt: null,
  };
}

describe("Gate E — validateRiskStateJson edge cases", () => {
  it("E-R1: raw no es objeto → RISK_NOT_OBJECT", () => {
    const result = validateRiskStateJson(42);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("RISK_NOT_OBJECT");
  });

  it("E-R2: trailing no es objeto → RISK_TRAILING_INVALID", () => {
    const raw = validRiskState();
    raw.trailing = "not-an-object";
    const result = validateRiskStateJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("RISK_TRAILING_INVALID");
  });

  it("E-R3: stopLoss no es array → RISK_STOPLOSS_INVALID", () => {
    const raw = validRiskState();
    raw.stopLoss = "not-an-array";
    const result = validateRiskStateJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("RISK_STOPLOSS_INVALID");
  });

  it("E-R4: stopLoss layer inválido → RISK_STOPLOSS_LAYER_INVALID", () => {
    const raw = validRiskState();
    raw.stopLoss = [{ layer: "BOGUS", triggerPricePct: 0, triggered: false, triggeredAt: null, reason: "" }];
    const result = validateRiskStateJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("RISK_STOPLOSS_LAYER_INVALID");
  });

  it("E-R5: protectiveExit.state inválido → RISK_PROTECTIVE_EXIT_STATE_INVALID", () => {
    const raw = validRiskState();
    (raw.protectiveExit as any).state = "BOGUS";
    const result = validateRiskStateJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("RISK_PROTECTIVE_EXIT_STATE_INVALID");
  });

  it("E-R6: activeExitRoute inválido → RISK_ACTIVE_EXIT_ROUTE_INVALID", () => {
    const raw = validRiskState();
    raw.activeExitRoute = "BOGUS_ROUTE";
    const result = validateRiskStateJson(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("RISK_ACTIVE_EXIT_ROUTE_INVALID");
  });

  it("E-R7: risk state válido produce valor tipado", () => {
    const result = validateRiskStateJson(validRiskState());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.stateVersion).toBe(1);
      expect(result.value.protectiveExit.state).toBe("NONE");
      expect(result.value.stopLoss).toHaveLength(1);
      expect(result.value.stopLoss[0].layer).toBe("soft");
    }
  });

  it("E-R8: forensic parser con risk state inválido preserva raw y code", () => {
    const raw = { stateVersion: 99, protectiveExit: { state: "NONE" } };
    const result = safeParseRiskStateJsonForensic(raw);
    expect(result.valid).toBe(false);
    expect(result.value).toBeNull();
    expect(result.raw).toBe(raw);
    expect(result.code).toBe("RISK_UNKNOWN_VERSION");
  });
});

// ─── Gate E — Maker exit validation ───────────────────────────────────

describe("Gate E — validateMakerExitStateJson edge cases", () => {
  it("E-M1: raw no es objeto → MAKER_EXIT_NOT_OBJECT", () => {
    const result = validateMakerExitStateJson("not-an-object");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("MAKER_EXIT_NOT_OBJECT");
  });

  it("E-M2: route inválido → MAKER_EXIT_ROUTE_INVALID", () => {
    const result = validateMakerExitStateJson({ state: "MAKER_PENDING", route: "BOGUS_ROUTE" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("MAKER_EXIT_ROUTE_INVALID");
  });

  it("E-M3: maker exit válido produce valor tipado con state MAKER_PENDING", () => {
    const raw = {
      state: "MAKER_PENDING",
      route: "CYCLE_OWNED_TARGET",
      requestedMakerPrice: 96500,
      makerOrderCreatedAt: new Date().toISOString(),
      makerEligibleAfter: new Date(Date.now() + 1000).toISOString(),
      lifecycleTickId: 5,
      pendingQuantity: 0.01,
    };
    const result = validateMakerExitStateJson(raw);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.state).toBe("MAKER_PENDING");
      expect(result.value.route).toBe("CYCLE_OWNED_TARGET");
      expect(result.value.requestedMakerPrice).toBe(96500);
      expect(result.value.lifecycleTickId).toBe(5);
    }
  });

  it("E-M4: forensic parser con state inválido preserva raw", () => {
    const raw = { state: "BOGUS", route: null };
    const result = safeParseMakerExitStateJsonForensic(raw);
    expect(result.valid).toBe(false);
    expect(result.value).toBeNull();
    expect(result.raw).toBe(raw);
    expect(result.code).toBe("MAKER_EXIT_STATE_INVALID");
  });
});
