/**
 * spotMax1SingleLot.test.ts — MAX1 productization tests.
 *
 * Required by SPOT MAX1 plan:
 *   MAX_LOTS_PER_PAIR_DEFAULT_IS_1
 *   OPEN_LOT_BLOCKS_SECOND_ENTRY
 *   SECOND_ENTRY_SAME_PAIR_BLOCKED
 *   DIFFERENT_PAIR_NOT_BLOCKED
 *   PAIR_CAN_REENTER_AFTER_CLOSE
 *   RISK_PER_TRADE_UNCHANGED_50
 *   INITIAL_STOP_UNCHANGED
 *   ENTRY_V4_UNCHANGED
 *   EXIT_E0_UNCHANGED
 *   NO_PAIR_SPECIFIC_EXCEPTION
 *   NO_GLOBAL_CONCURRENCY_1
 *   MAX_LOTS_BLOCK_REASON_CORRECT
 *   PENDING_SAME_PAIR_BLOCKS_SECOND
 *   RACE_SAME_PAIR_SERIALIZED
 *
 * Engine-level tests reuse the productive mock pattern from
 * spotPairRaceProductive.test.ts but WITHOUT mocking spotRiskManager —
 * the real DEFAULT_SPOT_RISK_CONFIG.maxLotsPerPair=1 applies.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── extractSql helper ──────────────────────────────────────────────────────

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

// ─── Hoisted DB mock ────────────────────────────────────────────────────────

const { mockDbState, dbExecuteMock, dbTransactionMock } = vi.hoisted(() => {
  const state = {
    botConfig: { spot_real_reserved_capital_usd: 0 as number | null, trading_exchange: "revolutx" },
    orderIntents: [] as any[],
    openPositions: [] as any[],
    trades: [] as any[],
  };

  const executeFn = vi.fn(async (query: any) => {
    const { sql: sqlText, params } = extractSql(query);
    if (sqlText.includes("trading_exchange") && sqlText.includes("api_config")) {
      return { rows: [{ trading_exchange: state.botConfig.trading_exchange }] };
    }
    if (sqlText.includes("spot_real_reserved_capital_usd") && sqlText.includes("bot_config")) {
      return { rows: [{ reserved: String(state.botConfig.spot_real_reserved_capital_usd ?? 0) }] };
    }
    // MAX1 in-flight guard: COUNT order_intents with internal_intent_id != param
    if (sqlText.includes("COUNT") && sqlText.includes("order_intents") && sqlText.includes("internal_intent_id")) {
      const pair = params[0];
      const excludeId = params[params.length - 1];
      const count = state.orderIntents.filter((r: any) =>
        r.pair === pair &&
        ["pending", "accepted", "uncertain", "PENDING_FILL"].includes(r.status) &&
        (r.side ?? "buy").toLowerCase() === "buy" &&
        r.internal_intent_id !== excludeId
      ).length;
      return { rows: [{ count: String(count) }] };
    }
    if (sqlText.includes("COUNT") && sqlText.includes("order_intents")) {
      return { rows: [{ count: "0" }] };
    }
    if (sqlText.includes("COUNT") && sqlText.includes("open_positions")) {
      let filtered = state.openPositions;
      if (sqlText.includes("!= 'CLOSED'") || sqlText.includes("!= 'closed'")) {
        filtered = filtered.filter((p: any) => p.status !== "CLOSED");
      }
      if (sqlText.includes("pair =")) {
        const pair = params[0];
        filtered = filtered.filter((p: any) => p.pair === pair);
      }
      return { rows: [{ count: String(filtered.length) }] };
    }
    if (sqlText.includes("INSERT INTO order_intents")) {
      const clientOrderId = params[0];
      const existing = state.orderIntents.find((r: any) => r.client_order_id === clientOrderId);
      if (existing) return { rows: [] };
      const row = {
        id: state.orderIntents.length + 1,
        client_order_id: clientOrderId,
        pair: params[2], side: params[3], status: "pending",
        internal_intent_id: params[5],
        engine_owner: params[6] ?? "SPOT_CANONICAL",
        policy_version: params[7] ?? "SPOT-1.0.0-20260812",
        execution_mode: params[8] ?? "REAL",
        lot_id: params[9] ?? null,
      };
      state.orderIntents.push(row);
      return { rows: [{ id: row.id, client_order_id: row.client_order_id }] };
    }
    if (sqlText.includes("UPDATE order_intents") && sqlText.includes("status")) {
      const dbStatus = params[0];
      const coid = params[params.length - 1];
      const row = state.orderIntents.find((r: any) => r.client_order_id === coid || r.internal_intent_id === coid);
      if (row) row.status = dbStatus;
      return { rows: row ? [{ id: row.id }] : [] };
    }
    if (sqlText.includes("FROM order_intents")) {
      return { rows: [] };
    }
    if (sqlText.includes("FROM open_positions")) {
      return { rows: state.openPositions };
    }
    return { rows: [] };
  });

  const transactionFn = vi.fn(async (callback: (tx: any) => Promise<any>) => {
    const tx = {
      execute: async (query: any) => {
        const { sql: sqlText, params } = extractSql(query);
        if (sqlText.includes("INSERT INTO open_positions")) {
          const lotId = params[0];
          state.openPositions.push({
            lot_id: lotId, pair: params[2], status: "OPEN",
            policy_version: params[13] ?? "SPOT-1.0.0-20260812",
            engine_owner: params[14] ?? "SPOT_CANONICAL",
            entry_price: Number(params[3]), execution_mode: params[12] ?? "SHADOW",
          });
          return { rows: [{ lot_id: lotId }] };
        }
        if (sqlText.includes("FOR UPDATE") && sqlText.includes("bot_config") && sqlText.includes("spot_shadow")) {
          return { rows: [{ spot_shadow_capital_usd: "10000", spot_shadow_reserved_usd: "0", spot_shadow_realized_pnl_usd: "0", spot_shadow_total_fees_usd: "0" }] };
        }
        if (sqlText.includes("INSERT INTO trades")) {
          return { rows: [{ trade_id: params[0] }] };
        }
        if (sqlText.includes("INSERT INTO order_intents")) {
          const clientOrderId = params[0];
          const existing = state.orderIntents.find((r: any) => r.client_order_id === clientOrderId);
          if (existing) return { rows: [] };
          const row = {
            id: state.orderIntents.length + 1, client_order_id: clientOrderId,
            pair: params[2], side: params[3], status: "pending",
            internal_intent_id: params[5], lot_id: params[9],
          };
          state.orderIntents.push(row);
          return { rows: [{ id: row.id, client_order_id: row.client_order_id }] };
        }
        return { rows: [] };
      },
    };
    return callback(tx);
  });

  return { mockDbState: state, dbExecuteMock: executeFn, dbTransactionMock: transactionFn };
});

vi.mock("../../db", () => ({
  db: { execute: dbExecuteMock, transaction: dbTransactionMock },
}));

vi.mock("../spot/spotActivityLogger", () => ({
  logActivity: vi.fn(() => ({})),
}));

vi.mock("../spot/feeModel", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getTradingFeeModel: vi.fn(() => ({ exchange: "revolutx", takerFeePct: 0.09, makerFeePct: 0.00, quality: "REAL" })),
    getSpotTakerFeePct: vi.fn(() => 0.09),
    getRoundTripFeePct: vi.fn(() => 0.18),
    computeFeeBreakdown: vi.fn((entry: number, exit: number, vol: number) => {
      const takerPct = 0.09 / 100;
      return {
        entryFeeUsd: entry * vol * takerPct,
        exitFeeUsd: exit * vol * takerPct,
        totalFeeUsd: entry * vol * takerPct + exit * vol * takerPct,
        roundTripFeePct: 0.18,
        quality: "REAL",
      };
    }),
  };
});

const { mockModeState } = vi.hoisted(() => ({ mockModeState: { mode: "SHADOW" as string } }));

vi.mock("../spot/spotExecutionModeStore", () => ({
  loadExecutionMode: vi.fn(async () => mockModeState.mode),
  saveExecutionMode: vi.fn(async (mode: string) => { mockModeState.mode = mode; }),
  getCachedExecutionMode: vi.fn(() => mockModeState.mode),
  invalidateExecutionModeCache: vi.fn(() => {}),
}));

const { mockPlaceOrder, mockGetPairMetadata, mockLoadPairMetadata } = vi.hoisted(() => ({
  mockPlaceOrder: vi.fn(),
  mockGetPairMetadata: vi.fn(),
  mockLoadPairMetadata: vi.fn(),
}));

vi.mock("../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {
    getTradingExchange: () => ({
      exchangeName: "revolutx",
      isInitialized: () => true,
      getBalance: async () => ({ USD: 10000 }),
      getPairMetadata: mockGetPairMetadata,
      loadPairMetadata: mockLoadPairMetadata,
      placeOrder: mockPlaceOrder,
    }),
    getDataExchange: () => ({
      exchangeName: "revolutx",
      isInitialized: () => true,
      getTicker: async () => ({ bid: 60000, ask: 60010, last: 60005, spread: 10, fetchedAt: Date.now() }),
      getPairMetadata: mockGetPairMetadata,
    }),
    getDataExchangeType: () => "revolutx",
  },
}));

import {
  _executeEntryForTest as executeEntry,
  _getRealSubmissionGenerationForTest as getGeneration,
  _setPositionSupervisionHealthyForTest as setPositionSupervisionHealthy,
  _setDrainTimeoutMsForTest as setDrainTimeoutMs,
  _getEntryCriticalSectionCountForTest as getCriticalSectionCount,
  _stopSpotEngineForTest as stopSpotEngine,
  _setPauseAfterShadowAdapterForTest as setPauseAfterShadowAdapter,
} from "../spot/spotEngine";
import { evaluateSizing, DEFAULT_SPOT_RISK_CONFIG } from "../spot/spotRiskManager";
import { DEFAULT_SPOT_EXIT_CONFIG } from "../spot/spotExitPolicy";
import { SPOT_ENTRY_V4_MIN_QUALITY_SCORE } from "../spot/spotEntryV4";
import {
  ExecutionMode, SetupTag, Regime, RegimeDirection, MacroBias,
  type SpotEntryIntent, type SpotMarketContext,
} from "../spot/spotTypes";
import { DataHealth } from "../spot/candleTimestamp";

// ─── Helpers ────────────────────────────────────────────────────────────────

function resetDbState() {
  mockDbState.botConfig.spot_real_reserved_capital_usd = 0;
  mockDbState.botConfig.trading_exchange = "revolutx";
  mockDbState.orderIntents.length = 0;
  mockDbState.openPositions.length = 0;
  mockDbState.trades.length = 0;
  mockModeState.mode = "SHADOW";
  mockPlaceOrder.mockReset();
  mockGetPairMetadata.mockReset();
  mockLoadPairMetadata.mockReset();
  mockGetPairMetadata.mockReturnValue({ quoteCurrency: "USD", quantityStep: 0.0001 });
  setDrainTimeoutMs(15_000);
  stopSpotEngine();
  setPositionSupervisionHealthy(true);
  setPauseAfterShadowAdapter(null);
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

function makeIntent(pair = "BTC/USD", signalId?: string): SpotEntryIntent {
  return {
    signalId: signalId ?? `sig-${pair}-${Math.random()}`, pair, setupTag: SetupTag.PULLBACK_CONTINUATION,
    createdAt: Date.now(), expiresAt: Date.now() + 30000, state: "APPROVED" as any,
    origin15mOpenAt: Date.now(), origin15mCloseAt: Date.now(), originPrice: 60000, originClose: 60000,
    originAtrPct: 1.5, originRegime: Regime.TREND, originDirection: RegimeDirection.BULLISH,
    originMacro: MacroBias.NEUTRAL, originVolume: 100, originContextId: "ctx-1",
    retryCount: 0, initialBlockReason: null, lastBlockReason: null, lastEvaluatedAt: null,
  };
}

function makeOpenPosition(pair = "BTC/USD", status = "OPEN") {
  return {
    lot_id: `lot-${pair}-${Math.random()}`, pair, status,
    policy_version: "SPOT-1.0.0-20260812", engine_owner: "SPOT_CANONICAL",
    entry_price: 60000, execution_mode: "SHADOW",
  };
}

// ─── Pure risk-config tests ─────────────────────────────────────────────────

describe("MAX1 risk config", () => {
  it("MAX_LOTS_PER_PAIR_DEFAULT_IS_1", () => {
    expect(DEFAULT_SPOT_RISK_CONFIG.maxLotsPerPair).toBe(1);
  });

  it("RISK_PER_TRADE_UNCHANGED_50", () => {
    expect(DEFAULT_SPOT_RISK_CONFIG.riskPerTradeUsd).toBe(50);
  });

  it("INITIAL_STOP_UNCHANGED", () => {
    expect(DEFAULT_SPOT_RISK_CONFIG.slAtrMultiplier).toBe(2.0);
    expect(DEFAULT_SPOT_RISK_CONFIG.minStopDistancePct).toBe(0.5);
    expect(DEFAULT_SPOT_RISK_CONFIG.maxStopDistancePct).toBe(5.0);
  });

  it("NO_PAIR_SPECIFIC_EXCEPTION", () => {
    // The config is a single flat object — no per-pair overrides exist.
    expect(typeof DEFAULT_SPOT_RISK_CONFIG.maxLotsPerPair).toBe("number");
    const keys = Object.keys(DEFAULT_SPOT_RISK_CONFIG);
    expect(keys.some((k) => /btc|eth|sol|xrp|usd\//i.test(k))).toBe(false);
    // Same limit applies identically to every pair — no per-pair override map.
    for (const pair of ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"]) {
      const res = evaluateSizing(makeCtx(pair), makeIntent(pair), 10_000, 1);
      expect(res.approved).toBe(false);
      expect(res.blockCode).toBe("MAX_LOTS_REACHED");
    }
  });

  it("NO_GLOBAL_CONCURRENCY_1", () => {
    // maxLotsPerPair limits per pair only. Two different pairs each pass the
    // gate with openLotsForPair=0 — there is no global concurrency field.
    const cfg = DEFAULT_SPOT_RISK_CONFIG as any;
    expect(cfg.maxConcurrentPositions).toBeUndefined();
    const btc = evaluateSizing(makeCtx("BTC/USD"), makeIntent("BTC/USD"), 10_000, 0);
    const eth = evaluateSizing(makeCtx("ETH/USD"), makeIntent("ETH/USD"), 10_000, 0);
    expect(btc.approved).toBe(true);
    expect(eth.approved).toBe(true);
  });

  it("MAX_LOTS_BLOCK_REASON_CORRECT", () => {
    const res = evaluateSizing(makeCtx("BTC/USD"), makeIntent("BTC/USD"), 10_000, 1);
    expect(res.approved).toBe(false);
    expect(res.blockReason).toBe("MAX_LOTS_REACHED");
    expect(res.blockCode).toBe("MAX_LOTS_REACHED");
  });
});

// ─── Engine-level enforcement tests (SHADOW, real risk config) ──────────────

describe("MAX1 engine enforcement", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("OPEN_LOT_BLOCKS_SECOND_ENTRY / SECOND_ENTRY_SAME_PAIR_BLOCKED", async () => {
    mockDbState.openPositions.push(makeOpenPosition("BTC/USD", "OPEN"));
    const outcome = await executeEntry(makeIntent("BTC/USD"), makeCtx("BTC/USD"), ExecutionMode.SHADOW, undefined, getGeneration());
    expect(outcome.executed).toBe(false);
    expect(outcome.reasonCode).toBe("MAX_LOTS_REACHED");
    expect(mockDbState.openPositions.filter((p: any) => p.status !== "CLOSED").length).toBe(1);
  });

  it("DIFFERENT_PAIR_NOT_BLOCKED", async () => {
    mockDbState.openPositions.push(makeOpenPosition("BTC/USD", "OPEN"));
    const outcome = await executeEntry(makeIntent("ETH/USD"), makeCtx("ETH/USD"), ExecutionMode.SHADOW, undefined, getGeneration());
    expect(outcome.executed).toBe(true);
    expect(outcome.stage).toBe("EXECUTED");
  });

  it("PAIR_CAN_REENTER_AFTER_CLOSE", async () => {
    mockDbState.openPositions.push(makeOpenPosition("BTC/USD", "CLOSED"));
    const outcome = await executeEntry(makeIntent("BTC/USD"), makeCtx("BTC/USD"), ExecutionMode.SHADOW, undefined, getGeneration());
    expect(outcome.executed).toBe(true);
    expect(outcome.stage).toBe("EXECUTED");
  });

  it("PENDING_SAME_PAIR_BLOCKS_SECOND", async () => {
    // A REAL pending entry intent exists for BTC/USD — no open_positions row yet.
    mockDbState.orderIntents.push({
      client_order_id: "coid-pending-1", pair: "BTC/USD", side: "buy",
      status: "PENDING_FILL", internal_intent_id: "entry:other-signal:BTC/USD",
      engine_owner: "SPOT_CANONICAL", policy_version: "SPOT-1.0.0-20260812",
      execution_mode: "REAL", lot_id: "lot-pending-1",
    });
    const outcome = await executeEntry(makeIntent("BTC/USD"), makeCtx("BTC/USD"), ExecutionMode.SHADOW, undefined, getGeneration());
    expect(outcome.executed).toBe(false);
    expect(outcome.reasonCode).toBe("MAX_LOTS_REACHED");
    expect(mockDbState.openPositions.length).toBe(0);
  });

  it("RACE_SAME_PAIR_SERIALIZED: second concurrent entry blocked inside critical section", async () => {
    // Entry 1 pauses inside the pair critical section (after shadow adapter,
    // before persist). Entry 2 passes sizing (openLots=0) then blocks at the
    // pair critical section; after entry 1 persists, entry 2 enters and the
    // in-CS MAX1 guard must reject it.
    let releaseEntry1: () => void;
    const barrier = new Promise<void>((resolve) => { releaseEntry1 = resolve; });
    setPauseAfterShadowAdapter(async () => { await barrier; });

    const entry1 = executeEntry(makeIntent("BTC/USD", "sig-1"), makeCtx("BTC/USD"), ExecutionMode.SHADOW, undefined, getGeneration());
    await new Promise((r) => setTimeout(r, 100));

    const entry2 = executeEntry(makeIntent("BTC/USD", "sig-2"), makeCtx("BTC/USD"), ExecutionMode.SHADOW, undefined, getGeneration());
    await new Promise((r) => setTimeout(r, 50));

    releaseEntry1!();
    const [outcome1, outcome2] = await Promise.all([entry1, entry2]);

    expect(outcome1.executed).toBe(true);
    expect(outcome2.executed).toBe(false);
    expect(outcome2.reasonCode).toBe("MAX_LOTS_REACHED");
    expect(mockDbState.openPositions.filter((p: any) => p.status !== "CLOSED" && p.pair === "BTC/USD").length).toBe(1);
  });
});

// ─── Module freeze invariants ───────────────────────────────────────────────

describe("MAX1 freeze invariants", () => {
  it("ENTRY_V4_UNCHANGED", () => {
    expect(SPOT_ENTRY_V4_MIN_QUALITY_SCORE).toBe(0.30);
  });

  it("EXIT_E0_UNCHANGED", () => {
    // Exit E0 policy config unchanged — no adaptive E1 fields.
    expect(DEFAULT_SPOT_EXIT_CONFIG).toBeDefined();
    expect((DEFAULT_SPOT_EXIT_CONFIG as any).adaptiveGiveback).toBeUndefined();
  });
});
