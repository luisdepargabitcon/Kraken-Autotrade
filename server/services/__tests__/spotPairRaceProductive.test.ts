/**
 * spotPairRaceProductive.test.ts — Productive per-pair race condition tests.
 *
 * Exercises the REAL executeEntry code via _executeEntryForTest and pause hooks.
 * Uses the same mock infrastructure as spotR10v9RealLifecycleProductive.test.ts.
 *
 * Tests:
 *   PAIR_REAL_01_DISABLE_AFTER_RESERVE
 *   PAIR_SHADOW_02_DISABLE_AFTER_ADAPTER
 *   PAIR_03_OTHER_PAIR_UNAFFECTED
 *   PAIR_04_DRAIN_TIMEOUT_NOT_SUCCESS
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

// ─── Hoisted mocks (same pattern as R10v9) ──────────────────────────────────

const { mockDbState, dbExecuteMock, dbTransactionMock } = vi.hoisted(() => {
  const state = {
    botConfig: { spot_real_reserved_capital_usd: 0 as number | null, trading_exchange: "revolutx", missingBotConfig: false },
    orderIntents: [] as any[],
    openPositions: [] as any[],
    trades: [] as any[],
    apiConfigThrows: false,
    openPositionsThrow: false,
    openPositionsVerificationThrow: false,
    tradesThrow: false,
    summaryStatsThrow: false,
    runtimeInspectionThrow: false,
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
    if (sqlText.includes("COUNT") && sqlText.includes("order_intents") && !sqlText.includes("lot_id")) {
      return { rows: [{ count: "0" }] };
    }
    if (sqlText.includes("COUNT") && sqlText.includes("order_intents") && sqlText.includes("lot_id")) {
      const { params } = extractSql(query);
      const lotId = params[0];
      const count = state.orderIntents.filter((r: any) =>
        r.lot_id === lotId && r.side === "sell" &&
        ["failed", "expired", "cancelled"].includes(r.status)
      ).length;
      return { rows: [{ count: String(count) }] };
    }
    if (sqlText.includes("COUNT") && sqlText.includes("open_positions")) {
      if (state.openPositionsThrow) throw new Error("Injected: open_positions DB failure");
      const { params } = extractSql(query);
      let filtered = state.openPositions;
      if (sqlText.includes("UNCERTAIN")) {
        filtered = filtered.filter((p: any) => p.status === "UNCERTAIN");
      }
      if (sqlText.includes("!= 'CLOSED'") || sqlText.includes("!= 'closed'")) {
        filtered = filtered.filter((p: any) => p.status !== "CLOSED");
      }
      if (sqlText.includes("SHADOW") || sqlText.includes("shadow")) {
        filtered = filtered.filter((p: any) => p.execution_mode === "SHADOW");
      }
      if (sqlText.includes("PENDING_FILL") || sqlText.includes("pending_fill")) {
        filtered = filtered.filter((p: any) => p.status === "PENDING_FILL");
      }
      if (sqlText.includes("EXIT_PENDING") || sqlText.includes("exit_pending")) {
        filtered = filtered.filter((p: any) => p.status === "EXIT_PENDING");
      }
      return { rows: [{ count: String(filtered.length) }] };
    }
    if (sqlText.includes("DISTINCT pair") && sqlText.includes("open_positions")) {
      if (state.openPositionsThrow) throw new Error("Injected: open_positions DB failure");
      const pairs = [...new Set(state.openPositions.map((p: any) => p.pair))];
      return { rows: pairs.map((p) => ({ pair: p })) };
    }
    if (sqlText.includes("SELECT lot_id FROM open_positions") && sqlText.includes("client_order_id")) {
      if (state.openPositionsThrow || state.openPositionsVerificationThrow) throw new Error("Injected: open_positions verification DB failure");
      const { params } = extractSql(query);
      const coid = params[0];
      return { rows: state.openPositions.filter((p: any) => p.client_order_id === coid).map((p: any) => ({ lot_id: p.lot_id })) };
    }
    if (sqlText.includes("SELECT trade_id FROM trades")) {
      if (state.tradesThrow) throw new Error("Injected: trades DB failure");
      const { params } = extractSql(query);
      const coid = params[0];
      const intentRows = state.orderIntents.filter((r: any) => r.client_order_id === coid);
      const lotIds = intentRows.map((r: any) => r.lot_id).filter(Boolean);
      return { rows: state.trades.filter((t: any) => lotIds.includes(t.lot_id)).map((t: any) => ({ trade_id: t.trade_id })) };
    }
    if (sqlText.includes("active_pairs") && sqlText.includes("bot_config")) {
      return { rows: [{ active_pairs: ["BTC/USD", "SOL/USD"] }] };
    }
    if (sqlText.includes("INSERT INTO order_intents")) {
      const { params } = extractSql(query);
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
        reserved_quote_usd: params[13] != null ? Number(params[13]) : null,
        reserved_quote_currency: null,
        exchange_order_id: null,
        fill_price: null, fill_volume: null, fee_usd: null,
      };
      state.orderIntents.push(row);
      return { rows: [{ id: row.id, client_order_id: row.client_order_id, exchange_order_id: null, status: "pending" }] };
    }
    if (sqlText.includes("UPDATE order_intents") && sqlText.includes("status")) {
      const { params } = extractSql(query);
      const dbStatus = params[0];
      const coid = params[params.length - 1];
      const row = state.orderIntents.find((r: any) => r.client_order_id === coid);
      if (row) {
        row.status = dbStatus;
        if (params[1] != null) row.exchange_order_id = params[1];
        return { rows: [{ id: row.id }] };
      }
      return { rows: [] };
    }
    if (sqlText.includes("FROM order_intents") && sqlText.includes("status IN")) {
      return { rows: state.orderIntents.filter((r: any) =>
        ["pending", "accepted", "uncertain"].includes(r.status) &&
        r.engine_owner === "SPOT_CANONICAL"
      ).map((r: any) => ({
        client_order_id: r.client_order_id, exchange_order_id: r.exchange_order_id ?? null,
        exchange: "revolutx", pair: r.pair, side: (r.side ?? "").toLowerCase(), volume: "0.01", status: r.status,
        internal_intent_id: r.internal_intent_id, engine_owner: r.engine_owner,
        policy_version: r.policy_version, execution_mode: r.execution_mode,
        lot_id: r.lot_id, requested_price: null, order_type: "MARKET", reason: r.reason ?? null,
        fill_price: r.fill_price, fill_volume: r.fill_volume, fee_usd: r.fee_usd,
      })) };
    }
    if (sqlText.includes("FROM order_intents") && sqlText.includes("client_order_id")) {
      const { params } = extractSql(query);
      const coid = params[0];
      const row = state.orderIntents.find((r: any) => r.client_order_id === coid);
      return { rows: row ? [row] : [] };
    }
    if (sqlText.includes("FROM order_intents") && sqlText.includes("lot_id")) {
      const { params } = extractSql(query);
      const lotId = params[0];
      return { rows: state.orderIntents.filter((r: any) => r.lot_id === lotId) };
    }
    if (sqlText.includes("INSERT INTO trades")) {
      const { params } = extractSql(query);
      const tradeId = params[0];
      const row = {
        trade_id: tradeId, lot_id: params[1], pair: params[2],
        policy_version: params[3] ?? "SPOT-1.0.0-20260812",
        engine_owner: params[4] ?? "SPOT_CANONICAL",
        net_pnl_usd: Number(params[5] ?? 0), gross_pnl_usd: Number(params[6] ?? 0),
        hold_time_minutes: Number(params[7] ?? 0), mfe: 0, mae: 0,
      };
      state.trades.push(row);
      return { rows: [{ trade_id: tradeId }] };
    }
    if (sqlText.includes("FROM trades") && sqlText.includes("lot_id")) {
      const { params } = extractSql(query);
      const lotId = params[0];
      return { rows: state.trades.filter((t: any) => t.lot_id === lotId) };
    }
    if (sqlText.includes("FROM trades") && sqlText.includes("FILTER")) {
      if (state.summaryStatsThrow) throw new Error("Injected: summary stats DB failure");
      return { rows: [{ total_trades: String(state.trades.length), winning_trades: "0", losing_trades: "0",
        net_pnl_usd: "0", gross_pnl_usd: "0", gross_profit: "0", gross_loss: "0",
        avg_hold_time: "0", best_trade: "0", worst_trade: "0", avg_mfe: "0", avg_mae: "0" }] };
    }
    if (sqlText.includes("UPDATE open_positions") && sqlText.includes("status")) {
      const { params } = extractSql(query);
      const literalMatch = sqlText.match(/status\s*=\s*'([^']+)'/i);
      const status = literalMatch ? literalMatch[1] : params[0];
      const lotId = params[params.length - 1];
      const row = state.openPositions.find((p: any) => p.lot_id === lotId);
      if (row) row.status = status;
      return { rows: row ? [{ lot_id: row.lot_id }] : [] };
    }
    if (sqlText.includes("FROM open_positions") && sqlText.includes("lot_id") && sqlText.includes("EXIT_PENDING")) {
      const { params } = extractSql(query);
      const lotId = params[0];
      const rows = state.openPositions.filter((p: any) => p.lot_id === lotId && p.status === "EXIT_PENDING");
      return { rows: rows.map((p: any) => ({ status: p.status })) };
    }
    if (sqlText.includes("FROM open_positions")) {
      if (state.openPositionsThrow) throw new Error("Injected: open_positions DB failure");
      return { rows: state.openPositions };
    }
    // UPDATE bot_config SET active_pairs (for disablePair)
    if (sqlText.includes("UPDATE bot_config") && sqlText.includes("active_pairs")) {
      return { rows: [] };
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
          if (sqlText.includes("FOR UPDATE") && sqlText.includes("bot_config") && !sqlText.includes("spot_shadow")) {
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
          if (sqlText.includes("FOR UPDATE") && sqlText.includes("order_intents") && sqlText.includes("reserved_quote_usd") && !sqlText.includes("status")) {
            const identifier = params[0];
            const row = state.orderIntents.find((r: any) => r.internal_intent_id === identifier || r.client_order_id === identifier);
            return { rows: row ? [{ reserved_quote_usd: row.reserved_quote_usd }] : [] };
          }
          if (sqlText.includes("FOR UPDATE") && sqlText.includes("order_intents")) {
            const identifier = params[0];
            const row = state.orderIntents.find((r: any) => r.internal_intent_id === identifier || r.client_order_id === identifier);
            return { rows: row ? [{ id: row.id, status: row.status, exchange_order_id: row.exchange_order_id ?? null, reserved_quote_usd: row.reserved_quote_usd, reserved_quote_currency: row.reserved_quote_currency, engine_owner: "SPOT_CANONICAL", policy_version: "SPOT-1.0.0-20260812", execution_mode: "REAL" }] : [] };
          }
          if (sqlText.includes("UPDATE order_intents") && sqlText.includes("reserved_quote_usd = NULL")) {
            const identifier = params[params.length - 1];
            const row = state.orderIntents.find((r: any) => r.internal_intent_id === identifier || r.client_order_id === identifier);
            if (row) { row.reserved_quote_usd = null; row.reserved_quote_currency = null; }
            return { rows: [] };
          }
          if (sqlText.includes("UPDATE order_intents") && sqlText.includes("status")) {
            const literalMatch = sqlText.match(/status\s*=\s*'([^']+)'/i);
            const status = literalMatch ? literalMatch[1] : params[0];
            const identifier = params[params.length - 1];
            const row = state.orderIntents.find((r: any) => r.internal_intent_id === identifier || r.client_order_id === identifier);
            if (row) row.status = status;
            return { rows: row ? [{ id: row.id, reserved_quote_usd: row.reserved_quote_usd }] : [] };
          }
          if (sqlText.includes("INSERT INTO open_positions")) {
            const lotId = params[0];
            state.openPositions.push({
              lot_id: lotId, pair: params[2], status: "OPEN",
              policy_version: params[13] ?? "SPOT-1.0.0-20260812", engine_owner: params[14] ?? "SPOT_CANONICAL",
              entry_price: Number(params[3]), amount: Number(params[4]),
              qty_remaining: Number(params[5]), highest_price: Number(params[6]),
              client_order_id: params[31] ?? null, venue_order_id: params[32] ?? null,
              execution_mode: params[12] ?? null,
            });
            return { rows: [{ lot_id: lotId }] };
          }
          if (sqlText.includes("FOR UPDATE") && sqlText.includes("bot_config") && sqlText.includes("spot_shadow")) {
            return { rows: [{ spot_shadow_capital_usd: "10000", spot_shadow_reserved_usd: "0", spot_shadow_realized_pnl_usd: "0", spot_shadow_total_fees_usd: "0" }] };
          }
          if (sqlText.includes("UPDATE bot_config") && sqlText.includes("spot_shadow")) {
            return { rows: [] };
          }
          if (sqlText.includes("UPDATE open_positions") && sqlText.includes("status")) {
            const literalMatch = sqlText.match(/status\s*=\s*'([^']+)'/i);
            const status = literalMatch ? literalMatch[1] : params[0];
            const lotId = params[params.length - 1];
            const row = state.openPositions.find((p: any) => p.lot_id === lotId);
            if (row) row.status = status;
            return { rows: row ? [{ lot_id: row.lot_id }] : [] };
          }
          if (sqlText.includes("FROM open_positions") && sqlText.includes("lot_id") && sqlText.includes("FOR UPDATE")) {
            const lotId = params[0];
            const row = state.openPositions.find((p: any) => p.lot_id === lotId && p.status !== "CLOSED");
            return { rows: row ? [{ lot_id: row.lot_id }] : [] };
          }
          if (sqlText.includes("FROM open_positions") && sqlText.includes("client_order_id") && sqlText.includes("FOR UPDATE")) {
            const coid = params[0];
            const row = state.openPositions.find((p: any) => p.client_order_id === coid && p.status !== "CLOSED");
            return { rows: row ? [{ lot_id: row.lot_id }] : [] };
          }
          if (sqlText.includes("FROM trades") && sqlText.includes("lot_id") && sqlText.includes("FOR UPDATE")) {
            const lotId = params[0];
            return { rows: state.trades.filter((t: any) => t.lot_id === lotId).map((t: any) => ({ trade_id: t.trade_id })) };
          }
          if (sqlText.includes("FROM trades") && sqlText.includes("lot_id") && !sqlText.includes("FOR UPDATE")) {
            const lotId = params[0];
            return { rows: state.trades.filter((t: any) => t.lot_id === lotId).map((t: any) => ({ id: t.trade_id })) };
          }
          if (sqlText.includes("INSERT INTO trades")) {
            const tradeId = params[0];
            const row = {
              trade_id: tradeId, lot_id: params[31] ?? params[30],
              pair: params[4], policy_version: params[15] ?? "SPOT-1.0.0-20260812",
              engine_owner: params[16] ?? "SPOT_CANONICAL",
              net_pnl_usd: Number(params[23] ?? 0), gross_pnl_usd: Number(params[19] ?? 0),
            };
            state.trades.push(row);
            return { rows: [{ trade_id: tradeId }] };
          }
          if (sqlText.includes("DELETE FROM open_positions")) {
            const lotId = params[0];
            const idx = state.openPositions.findIndex((p: any) => p.lot_id === lotId);
            if (idx >= 0) state.openPositions.splice(idx, 1);
            return { rows: [] };
          }
          if (sqlText.includes("UPDATE open_positions") && sqlText.includes("CLOSED")) {
            const lotId = params[params.length - 1];
            const row = state.openPositions.find((p: any) => p.lot_id === lotId);
            if (row) row.status = "CLOSED";
            return { rows: row ? [{ lot_id: row.lot_id }] : [] };
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

const { mockPlaceOrder, mockGetOrder, mockLoadPairMetadata, mockGetPairMetadata } = vi.hoisted(() => ({
  mockPlaceOrder: vi.fn(),
  mockGetOrder: vi.fn(),
  mockLoadPairMetadata: vi.fn(),
  mockGetPairMetadata: vi.fn(),
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
      getOrder: mockGetOrder,
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
  _setPositionSupervisionHealthyForTest as setPositionSupervisionHealthy,
  _setDrainTimeoutMsForTest as setDrainTimeoutMs,
  _getEntryCriticalSectionCountForTest as getCriticalSectionCount,
  _enterRealCriticalSectionForTest as enterCriticalSection,
  _exitRealCriticalSectionForTest as exitCriticalSection,
  _stopSpotEngineForTest as stopSpotEngine,
  _setPauseAfterReserveForTest as setPauseAfterReserve,
  _setPauseAfterShadowAdapterForTest as setPauseAfterShadowAdapter,
  _getPairEntryGenerationForTest as getPairGen,
  _getPairCriticalSectionCountForTest as getPairCsCount,
  _enterPairCriticalSectionForTest as enterPairCs,
  _exitPairCriticalSectionForTest as exitPairCs,
  _invalidatePairEntryGenerationOnly as invalidatePairGenOnly,
  _drainPairCriticalSection as drainPairCs,
} from "../spot/spotEngine";
import {
  _clearCacheForTest as clearIntentCache,
} from "../spot/spotOrderIntentStore";
import {
  ExecutionMode, SetupTag, Regime, RegimeDirection, MacroBias,
  SPOT_POLICY_VERSION,
  type SpotEntryIntent, type SpotMarketContext,
} from "../spot/spotTypes";
import { DataHealth } from "../spot/candleTimestamp";
import { disablePair, PairDisableDrainTimeoutError } from "../spot/spotPairToggle";

// ─── Helpers ────────────────────────────────────────────────────────────────

function resetDbState() {
  mockDbState.botConfig.spot_real_reserved_capital_usd = 0;
  mockDbState.botConfig.trading_exchange = "revolutx";
  mockDbState.botConfig.missingBotConfig = false;
  mockDbState.apiConfigThrows = false;
  mockDbState.openPositionsThrow = false;
  mockDbState.openPositionsVerificationThrow = false;
  mockDbState.tradesThrow = false;
  mockDbState.summaryStatsThrow = false;
  mockDbState.runtimeInspectionThrow = false;
  mockDbState.orderIntents.length = 0;
  mockDbState.openPositions.length = 0;
  mockDbState.trades.length = 0;
  mockModeState.mode = "REAL";
  mockPlaceOrder.mockReset();
  mockGetOrder.mockReset();
  mockLoadPairMetadata.mockReset();
  mockGetPairMetadata.mockReset();
  mockGetPairMetadata.mockReturnValue({ quoteCurrency: "USD", quantityStep: 0.0001 });
  setDrainTimeoutMs(15_000);
  stopSpotEngine();
  setPositionSupervisionHealthy(true);
  clearIntentCache();
  expect(getCriticalSectionCount()).toBe(0);
  while (getCriticalSectionCount() > 0) {
    exitCriticalSection();
  }
  setPauseAfterReserve(null);
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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Productive per-pair race tests", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("PAIR_REAL_01_DISABLE_AFTER_RESERVE: pair disabled during reserve → no placeOrder", async () => {
    mockModeState.mode = "REAL";
    const scanGeneration = getGeneration();

    // Set up pause barrier: after reserve, before placeOrder
    let resolveBarrier: () => void;
    const barrier = new Promise<void>((resolve) => { resolveBarrier = resolve; });
    setPauseAfterReserve(async () => { await barrier; });

    // Start entry execution — will pause after reserve
    const entryPromise = executeEntry(makeIntent("BTC/USD"), makeCtx("BTC/USD"), ExecutionMode.REAL, undefined, scanGeneration);

    // Wait a tick for the reserve to happen
    await new Promise((r) => setTimeout(r, 100));

    // Invalidate the pair generation while paused
    await invalidatePairGenOnly("BTC/USD");

    // Release the barrier
    resolveBarrier!();
    const outcome = await entryPromise;

    // Assert: no placeOrder call, entry blocked
    expect(outcome.executed).toBe(false);
    expect(outcome.stage).toBe("PAIR_DISABLED");
    expect(outcome.reasonCode).toBe("PAIR_DISABLED_RACE_BLOCKED");
    expect(outcome.submitted).toBe(false);
    expect(mockPlaceOrder).toHaveBeenCalledTimes(0);
  });

  it("PAIR_SHADOW_02_DISABLE_AFTER_ADAPTER: pair disabled during shadow adapter → no persist", async () => {
    mockModeState.mode = "SHADOW";
    const scanGeneration = getGeneration();

    // Set up pause barrier: after shadow adapter, before persist
    let resolveBarrier: () => void;
    const barrier = new Promise<void>((resolve) => { resolveBarrier = resolve; });
    setPauseAfterShadowAdapter(async () => { await barrier; });

    // Start entry execution — will pause after shadow adapter
    const entryPromise = executeEntry(makeIntent("BTC/USD"), makeCtx("BTC/USD"), ExecutionMode.SHADOW, undefined, scanGeneration);

    // Wait a tick for the adapter to run
    await new Promise((r) => setTimeout(r, 100));

    // Invalidate the pair generation while paused
    await invalidatePairGenOnly("BTC/USD");

    // Release the barrier
    resolveBarrier!();
    const outcome = await entryPromise;

    // Assert: no position persisted, entry blocked
    expect(outcome.executed).toBe(false);
    expect(outcome.stage).toBe("PAIR_DISABLED");
    expect(outcome.reasonCode).toBe("PAIR_DISABLED_RACE_BLOCKED");
    expect(mockDbState.openPositions.length).toBe(0);
  });

  it("PAIR_03_OTHER_PAIR_UNAFFECTED: invalidating SOL does NOT block BTC entry", async () => {
    mockModeState.mode = "SHADOW";
    const scanGeneration = getGeneration();

    // Invalidate SOL/USD generation
    await invalidatePairGenOnly("SOL/USD");

    // BTC entry should still succeed
    const outcome = await executeEntry(makeIntent("BTC/USD"), makeCtx("BTC/USD"), ExecutionMode.SHADOW, undefined, scanGeneration);

    expect(outcome.executed).toBe(true);
    expect(outcome.stage).toBe("EXECUTED");
    expect(getCriticalSectionCount()).toBe(0);
  });

  it("PAIR_04_DRAIN_TIMEOUT_NOT_SUCCESS: drain timeout → disablePair throws error", async () => {
    // Set a very short drain timeout
    setDrainTimeoutMs(50);

    // Open a pair critical section that won't close
    enterPairCs("BTC/USD");

    // Attempt to disable — should throw PairDisableDrainTimeoutError
    await expect(disablePair("BTC/USD")).rejects.toThrow(PairDisableDrainTimeoutError);

    // Clean up
    exitPairCs("BTC/USD");
    setDrainTimeoutMs(15_000);
  });
});
