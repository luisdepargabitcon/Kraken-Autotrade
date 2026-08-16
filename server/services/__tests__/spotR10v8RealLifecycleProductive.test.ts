/**
 * R10.8 Tests — Real Lifecycle Productive (continuation of R10.7).
 *
 * Calls REAL production functions directly via minimal test-only hooks
 * (_..ForTest) — no logic is re-implemented or reproduced inside the tests.
 *
 * Covers:
 *   9.  REAL→OFF / REAL→SHADOW in-flight submission race (transition gate)
 *   5.  Reservation release fail-closed (aggregate inconsistency / missing bot_config)
 *   6.  Trading venue fail-closed verification (mismatch / DB failure)
 *   7.  Position query fail-closed (DB error ≠ "no positions")
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── extractSql helper (drizzle sql`` template → sql text + bound params) ────

function extractSql(query: any): { sql: string; params: any[] } {
  if (typeof query === "string") return { sql: query, params: [] };
  if (query?.sql) return { sql: query.sql, params: [] };
  if (query?.queryChunks) {
    const params: any[] = [];
    const walk = (chunks: any[]): string => chunks.map((chunk: any) => {
      if (chunk !== null && typeof chunk === "object" && chunk.value !== undefined) {
        return Array.isArray(chunk.value) ? chunk.value.join("") : chunk.value;
      }
      if (chunk !== null && typeof chunk === "object" && Array.isArray(chunk.queryChunks)) {
        return walk(chunk.queryChunks);
      }
      params.push(chunk);
      return "?";
    }).join("");
    const sqlText = walk(query.queryChunks);
    return { sql: sqlText, params };
  }
  return { sql: String(query), params: [] };
}

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockDbState, dbExecuteMock, dbTransactionMock } = vi.hoisted(() => {
  const state = {
    botConfig: { spot_real_reserved_capital_usd: 0 as number | null, trading_exchange: "revolutx", missingBotConfig: false },
    orderIntents: [] as any[],
    openPositions: [] as any[],
    apiConfigThrows: false,
  };

  const executeFn = vi.fn(async (query: any) => {
    const { sql: sqlText } = extractSql(query);
    if (sqlText.includes("trading_exchange") && sqlText.includes("api_config")) {
      if (state.apiConfigThrows) throw new Error("Injected: api_config DB failure");
      return { rows: [{ trading_exchange: state.botConfig.trading_exchange }] };
    }
    if (sqlText.includes("spot_real_reserved_capital_usd") && sqlText.includes("bot_config")) {
      return { rows: [{ reserved: String(state.botConfig.spot_real_reserved_capital_usd ?? 0) }] };
    }
    if (sqlText.includes("COUNT") && sqlText.includes("order_intents")) {
      return { rows: [{ count: "0" }] };
    }
    if (sqlText.includes("COUNT") && sqlText.includes("open_positions")) {
      return { rows: [{ count: String(state.openPositions.length) }] };
    }
    return { rows: [] };
  });

  let txQueue: Promise<any> = Promise.resolve();

  const transactionFn = vi.fn(async (callback: (tx: any) => Promise<any>) => {
    const run = txQueue.then(async () => {
      const snapshot = JSON.parse(JSON.stringify({
        botConfig: state.botConfig, orderIntents: state.orderIntents, openPositions: state.openPositions,
      }));

      const tx = {
        execute: async (query: any) => {
          const { sql: sqlText, params } = extractSql(query);

          if (sqlText.includes("FOR UPDATE") && sqlText.includes("bot_config") && sqlText.includes("as reserved")) {
            if (state.botConfig.missingBotConfig) return { rows: [] };
            return { rows: [{ reserved: String(state.botConfig.spot_real_reserved_capital_usd ?? 0) }] };
          }
          if (sqlText.includes("FOR UPDATE") && sqlText.includes("bot_config")) {
            if (state.botConfig.missingBotConfig) return { rows: [] };
            return { rows: [{ spot_real_reserved_capital_usd: String(state.botConfig.spot_real_reserved_capital_usd ?? 0) }] };
          }
          if (sqlText.includes("UPDATE bot_config") && sqlText.includes("spot_real_reserved_capital_usd")) {
            state.botConfig.spot_real_reserved_capital_usd = Number(params[0]);
            return { rows: [] };
          }
          if (sqlText.includes("INSERT INTO order_intents")) {
            const clientOrderId = params[0];
            const existing = state.orderIntents.find((r: any) => r.client_order_id === clientOrderId);
            if (existing) return { rows: [] };
            const row = {
              id: state.orderIntents.length + 1,
              client_order_id: clientOrderId,
              pair: params[2],
              side: params[3],
              status: "pending",
              internal_intent_id: params[5],
              lot_id: params[9],
              reserved_quote_usd: params[13] != null ? Number(params[13]) : null,
              reserved_quote_currency: params[14] ?? null,
            };
            state.orderIntents.push(row);
            return { rows: [{ id: row.id, client_order_id: row.client_order_id }] };
          }
          if (sqlText.includes("FOR UPDATE") && sqlText.includes("order_intents") && sqlText.includes("reserved_quote_usd")) {
            const identifier = params[0];
            const row = state.orderIntents.find((r: any) => r.internal_intent_id === identifier || r.client_order_id === identifier);
            return { rows: row ? [{ reserved_quote_usd: row.reserved_quote_usd }] : [] };
          }
          if (sqlText.includes("FOR UPDATE") && sqlText.includes("order_intents")) {
            const identifier = params[0];
            const row = state.orderIntents.find((r: any) => r.internal_intent_id === identifier || r.client_order_id === identifier);
            return { rows: row ? [{ id: row.id }] : [] };
          }
          if (sqlText.includes("UPDATE order_intents") && sqlText.includes("reserved_quote_usd = NULL")) {
            const identifier = params[params.length - 1];
            const row = state.orderIntents.find((r: any) => r.internal_intent_id === identifier || r.client_order_id === identifier);
            if (row) { row.reserved_quote_usd = null; row.reserved_quote_currency = null; }
            return { rows: [] };
          }
          if (sqlText.includes("UPDATE order_intents") && sqlText.includes("status")) {
            const status = params[0];
            const identifier = params[params.length - 1];
            const row = state.orderIntents.find((r: any) => r.internal_intent_id === identifier || r.client_order_id === identifier);
            if (row) row.status = status;
            return { rows: row ? [{ id: row.id, reserved_quote_usd: row.reserved_quote_usd }] : [] };
          }
          return { rows: [] };
        },
      };

      try {
        return await callback(tx);
      } catch (error) {
        state.botConfig = snapshot.botConfig;
        state.orderIntents = snapshot.orderIntents;
        state.openPositions = snapshot.openPositions;
        throw error;
      }
    });
    txQueue = run.catch(() => {});
    return run;
  });

  return { mockDbState: state, dbExecuteMock: executeFn, dbTransactionMock: transactionFn };
});

vi.mock("../../db", () => ({
  db: { execute: dbExecuteMock, transaction: dbTransactionMock },
}));

vi.mock("../spot/spotActivityLogger", () => ({
  logActivity: vi.fn(() => ({})),
}));

const { mockModeState } = vi.hoisted(() => ({ mockModeState: { mode: "REAL" as string } }));

vi.mock("../spot/spotExecutionModeStore", () => ({
  loadExecutionMode: vi.fn(async () => mockModeState.mode),
  saveExecutionMode: vi.fn(async (mode: string) => { mockModeState.mode = mode; }),
  getCachedExecutionMode: vi.fn(() => mockModeState.mode),
  invalidateExecutionModeCache: vi.fn(() => {}),
}));

const { mockPlaceOrder } = vi.hoisted(() => ({ mockPlaceOrder: vi.fn() }));

vi.mock("../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {
    getTradingExchange: () => ({
      exchangeName: "revolutx",
      isInitialized: () => true,
      getBalance: async () => ({ USD: 10000 }),
      getPairMetadata: () => ({ quoteCurrency: "USD", quantityStep: 0.0001 }),
      placeOrder: mockPlaceOrder,
    }),
  },
}));

vi.mock("../spot/spotRiskManager", () => ({
  evaluateSizing: vi.fn(() => ({
    approved: true, volume: 0.01, notionalUsd: 600, stopPrice: 59000,
    stopDistancePct: 1, stopDistanceUsd: 600, riskUsd: 10, reason: "ok",
  })),
  DEFAULT_SPOT_RISK_CONFIG: {},
}));

import {
  _executeEntryForTest as executeEntry,
  _getRealSubmissionGenerationForTest as getGeneration,
  _invalidateRealSubmissionGenerationAndDrainForTest as invalidateAndDrain,
  _persistAndReserveRealEntryIntentAtomicForTest as persistAndReserve,
  _terminateIntentAndReleaseReservationAtomicForTest as terminateIntent,
  _setPositionSupervisionHealthyForTest as setPositionSupervisionHealthy,
  getOpenSpotPositionPairs,
  getTradingVenueFailClosed,
} from "../spot/spotEngine";
import {
  ExecutionMode, SetupTag, Regime, RegimeDirection, MacroBias,
  type SpotEntryIntent, type SpotMarketContext,
} from "../spot/spotTypes";
import { DataHealth } from "../spot/candleTimestamp";
import type { CreateSubmissionIntentParams } from "../spot/spotOrderIntentStore";

function resetDbState() {
  mockDbState.botConfig.spot_real_reserved_capital_usd = 0;
  mockDbState.botConfig.trading_exchange = "revolutx";
  mockDbState.botConfig.missingBotConfig = false;
  mockDbState.apiConfigThrows = false;
  mockDbState.orderIntents.length = 0;
  mockDbState.openPositions.length = 0;
  mockModeState.mode = "REAL";
  mockPlaceOrder.mockReset();
}

function makeCtx(pair = "BTC/USD"): SpotMarketContext {
  return {
    marketContextId: "ctx-1",
    generatedAt: Date.now(),
    pair,
    dataHealth: DataHealth.GOOD,
    macroBias: MacroBias.NEUTRAL,
    regimeContext: {
      regimeId: "r1", contextId: "ctx-1", pair, regime: Regime.TREND,
      direction: RegimeDirection.BULLISH, volatility: "NORMAL" as any, macroBias: MacroBias.NEUTRAL,
      adx: 28, ema20: 60000, ema50: 59000, ema200: 55000, emaAlignment: "bullish",
      bollingerWidth: 2.5, atrPct: 1.5, confidence: 0.75, dataHealth: DataHealth.GOOD, generatedAt: Date.now(),
    },
    candles5m: [], candles15m: [], candles1h: [], candles4h: [],
    ticker: { bid: 60000, ask: 60010, last: 60005, spread: 10, fetchedAt: Date.now() },
    spreadPct: 0.02, atr: 900,
    volumeMetrics: { volumeRatio: 1.5, volume24h: 50000000, participation: "NORMAL" },
  };
}

function makeIntent(pair = "BTC/USD"): SpotEntryIntent {
  return {
    signalId: `sig-${pair}-${Math.random()}`, pair, setupTag: SetupTag.PULLBACK_CONTINUATION,
    createdAt: Date.now(), expiresAt: Date.now() + 30000, state: "APPROVED" as any,
    origin15mOpenAt: Date.now(), origin15mCloseAt: Date.now(), originPrice: 60000, originClose: 60000,
    originAtrPct: 1.5, originRegime: Regime.TREND, originDirection: RegimeDirection.BULLISH,
    originMacro: MacroBias.NEUTRAL, originVolume: 100, originContextId: "ctx-1",
    retryCount: 0, initialBlockReason: null, lastBlockReason: null, lastEvaluatedAt: null,
  };
}

// ─── 9. REAL→OFF / REAL→SHADOW in-flight submission race ────────────────────

describe("R10.8-9: REAL transition in-flight submission race", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
    mockPlaceOrder.mockReset();
  });

  it("REAL_TO_OFF_INFLIGHT_ENTRY: generation invalidated before gate check → placeOrder=0", async () => {
    const scanGeneration = getGeneration();

    // Simulate: POST /api/spot/mode → OFF already resolved successfully (drain completed)
    // BEFORE this scan's executeEntry reaches its gate check.
    await invalidateAndDrain();
    mockModeState.mode = "OFF";

    const executed = await executeEntry(makeIntent(), makeCtx(), ExecutionMode.REAL, undefined, scanGeneration);

    expect(executed).toBe(false);
    expect(mockPlaceOrder).toHaveBeenCalledTimes(0);
  });

  it("REAL_TO_SHADOW_INFLIGHT_ENTRY: generation invalidated before gate check → placeOrder=0", async () => {
    const scanGeneration = getGeneration();

    await invalidateAndDrain();
    mockModeState.mode = "SHADOW";

    const executed = await executeEntry(makeIntent(), makeCtx(), ExecutionMode.REAL, undefined, scanGeneration);

    expect(executed).toBe(false);
    expect(mockPlaceOrder).toHaveBeenCalledTimes(0);
  });

  it("Same generation + mode still REAL → gate passes, reaches placeOrder", async () => {
    const scanGeneration = getGeneration();
    setPositionSupervisionHealthy(true);
    mockPlaceOrder.mockResolvedValueOnce({
      success: true, orderId: "venue-1", price: "60000", volume: "0.01", cost: "600",
      submissionState: "ACCEPTED",
    });

    await executeEntry(makeIntent(), makeCtx(), ExecutionMode.REAL, undefined, scanGeneration);

    expect(mockPlaceOrder).toHaveBeenCalledTimes(1);
  });
});

// ─── 5. Reservation release fail-closed ──────────────────────────────────────

function makeIntentParams(overrides: Partial<CreateSubmissionIntentParams> = {}): CreateSubmissionIntentParams {
  return {
    internalIntentId: "intent-1", pair: "BTC/USD", side: "BUY", requestedQty: 0.01,
    requestedPrice: null, orderType: "MARKET", executionMode: ExecutionMode.REAL,
    lotId: null, reason: "test entry", ...overrides,
  };
}

describe("R10.8-5: Reservation release fail-closed (no hidden inconsistencies)", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("RESERVATION_AGGREGATE_INCONSISTENT: intent reserved=600, aggregate=500 → release throws, both unchanged", async () => {
    await persistAndReserve(
      makeIntentParams({ internalIntentId: "intent-inc" }), "client-inc", "revolutx", 600, 1000, "USD",
    );
    // Corrupt the aggregate to simulate an inconsistency (aggregate lost track of another reservation)
    mockDbState.botConfig.spot_real_reserved_capital_usd = 500;

    await expect(terminateIntent("intent-inc", "FAILED")).rejects.toThrow(/REAL_RESERVATION_AGGREGATE_INCONSISTENT/);

    const intent = mockDbState.orderIntents.find((r: any) => r.internal_intent_id === "intent-inc");
    expect(Number(intent.reserved_quote_usd)).toBe(600);
    expect(mockDbState.botConfig.spot_real_reserved_capital_usd).toBe(500);
  });

  it("MISSING_BOT_CONFIG_RELEASE: bot_config row missing → release throws, intent reservation unchanged", async () => {
    await persistAndReserve(
      makeIntentParams({ internalIntentId: "intent-missing" }), "client-missing", "revolutx", 600, 1000, "USD",
    );
    mockDbState.botConfig.missingBotConfig = true;

    await expect(terminateIntent("intent-missing", "FAILED")).rejects.toThrow(/REAL_RESERVATION_AGGREGATE_INCONSISTENT/);

    const intent = mockDbState.orderIntents.find((r: any) => r.internal_intent_id === "intent-missing");
    expect(Number(intent.reserved_quote_usd)).toBe(600);
  });
});

// ─── 6. Trading venue fail-closed ────────────────────────────────────────────

describe("R10.8-6: Trading venue fail-closed verification", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("VENUE_MISMATCH: configured=kraken, runtime=revolutx → getTradingVenueFailClosed throws", async () => {
    mockDbState.botConfig.trading_exchange = "kraken";
    await expect(getTradingVenueFailClosed()).rejects.toThrow(/REAL_TRADING_VENUE_MISMATCH/);
  });

  it("VENUE_DB_FAILURE: api_config query throws → getTradingVenueFailClosed throws (no invented venue)", async () => {
    mockDbState.apiConfigThrows = true;
    await expect(getTradingVenueFailClosed()).rejects.toThrow(/REAL_TRADING_VENUE_UNVERIFIED/);
  });

  it("VENUE_MATCH: configured=revolutx, runtime=revolutx → resolves", async () => {
    mockDbState.botConfig.trading_exchange = "revolutx";
    await expect(getTradingVenueFailClosed()).resolves.toBe("revolutx");
  });
});

// ─── 7. Position query fail-closed ───────────────────────────────────────────

describe("R10.8-7: Position query DB failure ≠ no positions", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("getOpenSpotPositionPairs: DB error → throws (never returns [])", async () => {
    dbExecuteMock.mockImplementationOnce(async () => {
      throw new Error("Injected: connection lost");
    });
    await expect(getOpenSpotPositionPairs()).rejects.toThrow(/REAL_POSITION_QUERY_FAILED_FAIL_CLOSED/);
  });
});
