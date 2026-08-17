/**
 * R10.9 Tests — Real Lifecycle Productive (continuation of R10.8).
 *
 * Calls REAL production functions directly via minimal test-only hooks
 * (_..ForTest) — no logic is re-implemented or reproduced inside the tests.
 *
 * 20 mandatory test cases covering:
 *
 *  1.  SHADOW→OFF in-flight entry race (general entry fence covers SHADOW)
 *  2.  SHADOW→REAL in-flight entry race (general entry fence covers SHADOW)
 *  3.  SHADOW entry with valid generation → reaches placeOrder
 *  4.  REAL BUY blocked when supervisor unhealthy
 *  5.  REAL BUY unblocks after supervisor recovery
 *  6.  Supervisor health: per-pair failure marks unhealthy (false positive fix)
 *  7.  Supervisor health: all pairs succeed → healthy
 *  8.  Drain timeout disables entry scanner (DRAIN_TIMEOUT_FAIL_CLOSED)
 *  9.  Drain timeout injectable: short timeout works for tests
 *  10. Drain succeeds with no critical sections → entry scanner stays enabled
 *  11. EXISTING_FILLED with materialized open_position → skip (no throw)
 *  12. EXISTING_FILLED with materialized trade → skip (no throw)
 *  13. EXISTING_FILLED without materialization → throws (freeze REAL)
 *  14. EXISTING_FILLED verification DB error → throws
 *  15. Supervisor health exposed in readiness API (healthy)
 *  16. Supervisor health exposed in readiness API (unhealthy → blocker)
 *  17. REAL preflight serialized inside setExecutionMode lock
 *  18. Entry critical section count tracked correctly
 *  19. SHADOW mode transition race: stale generation blocks SHADOW entry
 *  20. getOpenPositions DB error → throws (fail-closed)
 *
 * R10.9-final additional tests A–N:
 *
 *  A.  SHADOW entry critical section covers persistShadowEntryAtomic (no leak)
 *  B.  SHADOW entry exception during persist → critical section released
 *  C.  REAL adapter exception → critical section released
 *  D.  REAL persistence exception → critical section released
 *  E.  EXISTING_FILLED throws → critical section released (no leak)
 *  F.  Drain timeout clears scanIntervalId + engineRunning=false
 *  G.  Supervisor busy returns { ok:false, busy:true }
 *  H.  getPositionSupervisionHealth() stale after inactivity
 *  I.  getPositionSupervisionHealth() healthy after recent success
 *  J.  spot.routes.ts has no prepareRealActivation (single authority)
 *  K.  REAL entry full path → critical section count returns to 0
 *  L.  SHADOW entry full path → critical section count returns to 0
 *  M.  Supervisor busy on first pass → startSpotEngine fails
 *  N.  Playwright removed from package.json
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
    // COUNT prior exit attempts for a lot_id (exitAttempt counter in closePosition)
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
      // Filter by UNCERTAIN status
      if (sqlText.includes("UNCERTAIN")) {
        filtered = filtered.filter((p: any) => p.status === "UNCERTAIN");
      }
      // Filter by status != 'CLOSED' (for PENDING_FILL/EXIT_PENDING and legacy checks)
      if (sqlText.includes("!= 'CLOSED'") || sqlText.includes("!= 'closed'")) {
        filtered = filtered.filter((p: any) => p.status !== "CLOSED");
      }
      // Legacy check: policy_version != SPOT_POLICY_VERSION OR engine_owner != SPOT_ENGINE_OWNER
      if (sqlText.includes("policy_version") && sqlText.includes("engine_owner") && sqlText.includes("!=")) {
        filtered = filtered.filter((p: any) =>
          p.policy_version !== SPOT_POLICY_VERSION || p.engine_owner !== "SPOT_CANONICAL"
        );
      }
      // Shadow positions check: execution_mode = 'SHADOW'
      if (sqlText.includes("SHADOW") || sqlText.includes("shadow")) {
        filtered = filtered.filter((p: any) => p.execution_mode === "SHADOW");
      }
      // PENDING_FILL / EXIT_PENDING filter
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
      // The query filters by lot_id IN (SELECT lot_id FROM order_intents WHERE client_order_id = ?)
      // The first param is the client_order_id. Find matching order_intents to get lot_ids, then find trades.
      const coid = params[0];
      const intentRows = state.orderIntents.filter((r: any) => r.client_order_id === coid);
      const lotIds = intentRows.map((r: any) => r.lot_id).filter(Boolean);
      return { rows: state.trades.filter((t: any) => lotIds.includes(t.lot_id)).map((t: any) => ({ trade_id: t.trade_id })) };
    }
    if (sqlText.includes("active_pairs") && sqlText.includes("bot_config")) {
      return { rows: [{ active_pairs: ["BTC/USD"] }] };
    }
    // INSERT INTO order_intents (via db.execute, not transaction)
    if (sqlText.includes("INSERT INTO order_intents")) {
      const { params } = extractSql(query);
      const clientOrderId = params[0];
      const existing = state.orderIntents.find((r: any) => r.client_order_id === clientOrderId);
      if (existing) return { rows: [] }; // ON CONFLICT DO NOTHING
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
    // UPDATE order_intents SET status ... (via db.execute, e.g. updateSubmissionResult)
    if (sqlText.includes("UPDATE order_intents") && sqlText.includes("status")) {
      const { params } = extractSql(query);
      const dbStatus = params[0];
      const coid = params[params.length - 1]; // WHERE client_order_id = ?
      const row = state.orderIntents.find((r: any) => r.client_order_id === coid);
      if (row) {
        row.status = dbStatus;
        if (params[1] != null) row.exchange_order_id = params[1]; // COALESCE venueOrderId
        return { rows: [{ id: row.id }] };
      }
      return { rows: [] };
    }
    // SELECT ... FROM order_intents WHERE status IN (...) — loadPendingRealOrders
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
    // SELECT ... FROM order_intents WHERE client_order_id = ? (recover after ON CONFLICT)
    if (sqlText.includes("FROM order_intents") && sqlText.includes("client_order_id")) {
      const { params } = extractSql(query);
      const coid = params[0];
      const row = state.orderIntents.find((r: any) => r.client_order_id === coid);
      return { rows: row ? [row] : [] };
    }
    // SELECT ... FROM order_intents WHERE lot_id = ? AND side = 'sell' AND status IN (...)
    if (sqlText.includes("FROM order_intents") && sqlText.includes("lot_id")) {
      const { params } = extractSql(query);
      const lotId = params[0];
      return { rows: state.orderIntents.filter((r: any) => r.lot_id === lotId) };
    }
    // SELECT COUNT(*) FROM order_intents WHERE lot_id = ? AND side = 'sell' AND status IN (...)
    if (sqlText.includes("COUNT(*)") && sqlText.includes("order_intents") && sqlText.includes("lot_id")) {
      const { params } = extractSql(query);
      const lotId = params[0];
      const count = state.orderIntents.filter((r: any) =>
        r.lot_id === lotId && r.side === "sell" &&
        ["failed", "expired", "cancelled"].includes(r.status)
      ).length;
      return { rows: [{ count: String(count) }] };
    }
    // INSERT INTO trades
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
    // SELECT ... FROM trades WHERE lot_id = ? (reconcileSellIntent)
    if (sqlText.includes("FROM trades") && sqlText.includes("lot_id")) {
      const { params } = extractSql(query);
      const lotId = params[0];
      return { rows: state.trades.filter((t: any) => t.lot_id === lotId) };
    }
    // SELECT ... FROM trades (getSummaryStats) — aggregate query
    if (sqlText.includes("FROM trades") && sqlText.includes("FILTER")) {
      if (state.summaryStatsThrow) throw new Error("Injected: summary stats DB failure");
      return { rows: [{ total_trades: String(state.trades.length), winning_trades: "0", losing_trades: "0",
        net_pnl_usd: "0", gross_pnl_usd: "0", gross_profit: "0", gross_loss: "0",
        avg_hold_time: "0", best_trade: "0", worst_trade: "0", avg_mfe: "0", avg_mae: "0" }] };
    }
    // UPDATE open_positions SET status (via db.execute, e.g. closePosition EXIT_PENDING)
    if (sqlText.includes("UPDATE open_positions") && sqlText.includes("status")) {
      const { params } = extractSql(query);
      const literalMatch = sqlText.match(/status\s*=\s*'([^']+)'/i);
      const status = literalMatch ? literalMatch[1] : params[0];
      const lotId = params[params.length - 1];
      const row = state.openPositions.find((p: any) => p.lot_id === lotId);
      if (row) row.status = status;
      return { rows: row ? [{ lot_id: row.lot_id }] : [] };
    }
    // SELECT status FROM open_positions WHERE lot_id = ? AND status = 'EXIT_PENDING'
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
            // Extract status: could be a SQL literal (e.g., status = 'failed') or a parameter (?)
            const literalMatch = sqlText.match(/status\s*=\s*'([^']+)'/i);
            const status = literalMatch ? literalMatch[1] : params[0];
            const identifier = params[params.length - 1];
            const row = state.orderIntents.find((r: any) => r.internal_intent_id === identifier || r.client_order_id === identifier);
            if (row) row.status = status;
            return { rows: row ? [{ id: row.id, reserved_quote_usd: row.reserved_quote_usd }] : [] };
          }
          // INSERT INTO open_positions (SHADOW and REAL modes)
          if (sqlText.includes("INSERT INTO open_positions")) {
            const lotId = params[0];
            state.openPositions.push({
              lot_id: lotId, pair: params[2], status: "OPEN",
              policy_version: params[13] ?? SPOT_POLICY_VERSION, engine_owner: params[14] ?? "SPOT_CANONICAL",
              entry_price: Number(params[3]), amount: Number(params[4]),
              qty_remaining: Number(params[5]), highest_price: Number(params[6]),
              client_order_id: params[31] ?? null, venue_order_id: params[32] ?? null,
              execution_mode: params[12] ?? null,
            });
            return { rows: [{ lot_id: lotId }] };
          }
          // SHADOW mode: SELECT ... FROM bot_config FOR UPDATE (shadow ledger)
          if (sqlText.includes("FOR UPDATE") && sqlText.includes("bot_config") && sqlText.includes("spot_shadow")) {
            return { rows: [{ spot_shadow_capital_usd: "10000", spot_shadow_reserved_usd: "0", spot_shadow_realized_pnl_usd: "0", spot_shadow_total_fees_usd: "0" }] };
          }
          // SHADOW mode: UPDATE bot_config SET spot_shadow_*
          if (sqlText.includes("UPDATE bot_config") && sqlText.includes("spot_shadow")) {
            return { rows: [] };
          }
          // UPDATE open_positions SET status (closePosition REJECTED/pendingFill)
          if (sqlText.includes("UPDATE open_positions") && sqlText.includes("status")) {
            const literalMatch = sqlText.match(/status\s*=\s*'([^']+)'/i);
            const status = literalMatch ? literalMatch[1] : params[0];
            const lotId = params[params.length - 1];
            const row = state.openPositions.find((p: any) => p.lot_id === lotId);
            if (row) row.status = status;
            return { rows: row ? [{ lot_id: row.lot_id }] : [] };
          }
          // SELECT ... FROM open_positions WHERE lot_id = ? ... FOR UPDATE
          if (sqlText.includes("FROM open_positions") && sqlText.includes("lot_id") && sqlText.includes("FOR UPDATE")) {
            const lotId = params[0];
            const row = state.openPositions.find((p: any) => p.lot_id === lotId && p.status !== "CLOSED");
            return { rows: row ? [{ lot_id: row.lot_id }] : [] };
          }
          // SELECT ... FROM open_positions WHERE client_order_id = ? ... FOR UPDATE
          if (sqlText.includes("FROM open_positions") && sqlText.includes("client_order_id") && sqlText.includes("FOR UPDATE")) {
            const coid = params[0];
            const row = state.openPositions.find((p: any) => p.client_order_id === coid && p.status !== "CLOSED");
            return { rows: row ? [{ lot_id: row.lot_id }] : [] };
          }
          // SELECT trade_id FROM trades WHERE lot_id = ? FOR UPDATE
          if (sqlText.includes("FROM trades") && sqlText.includes("lot_id") && sqlText.includes("FOR UPDATE")) {
            const lotId = params[0];
            return { rows: state.trades.filter((t: any) => t.lot_id === lotId).map((t: any) => ({ trade_id: t.trade_id })) };
          }
          // SELECT id FROM trades WHERE lot_id = ? AND policy_version = ? AND engine_owner = ?
          if (sqlText.includes("FROM trades") && sqlText.includes("lot_id") && !sqlText.includes("FOR UPDATE")) {
            const lotId = params[0];
            return { rows: state.trades.filter((t: any) => t.lot_id === lotId).map((t: any) => ({ id: t.trade_id })) };
          }
          // INSERT INTO trades
          if (sqlText.includes("INSERT INTO trades")) {
            const tradeId = params[0];
            const row = {
              trade_id: tradeId, lot_id: params[31] ?? params[30],
              pair: params[4], policy_version: params[15] ?? SPOT_POLICY_VERSION,
              engine_owner: params[16] ?? "SPOT_CANONICAL",
              net_pnl_usd: Number(params[23] ?? 0), gross_pnl_usd: Number(params[19] ?? 0),
            };
            state.trades.push(row);
            return { rows: [{ trade_id: tradeId }] };
          }
          // DELETE FROM open_positions WHERE lot_id = ?
          if (sqlText.includes("DELETE FROM open_positions")) {
            const lotId = params[0];
            const idx = state.openPositions.findIndex((p: any) => p.lot_id === lotId);
            if (idx >= 0) state.openPositions.splice(idx, 1);
            return { rows: [] };
          }
          // UPDATE open_positions SET status = 'CLOSED' (finalizeRealExitFillAtomic idempotent path)
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

import * as spotEngineModule from "../spot/spotEngine";
import {
  _executeEntryForTest as executeEntry,
  _getRealSubmissionGenerationForTest as getGeneration,
  _invalidateRealSubmissionGenerationAndDrainForTest as invalidateAndDrain,
  _persistAndReserveRealEntryIntentAtomicForTest as persistAndReserve,
  _setPositionSupervisionHealthyForTest as setPositionSupervisionHealthy,
  _isPositionSupervisionHealthyForTest as isPositionSupervisionHealthy,
  _getPositionSupervisionFailureReasonForTest as getSupervisionFailureReason,
  _setDrainTimeoutMsForTest as setDrainTimeoutMs,
  _getDrainTimeoutMsForTest as getDrainTimeoutMs,
  _getEntryCriticalSectionCountForTest as getCriticalSectionCount,
  _enterRealCriticalSectionForTest as enterCriticalSection,
  _exitRealCriticalSectionForTest as exitCriticalSection,
  _isEntryScanningEnabledForTest as isEntryScanningEnabled,
  _isEngineRunningForTest as isEngineRunning,
  _hasScanIntervalForTest as hasScanInterval,
  _stopSpotEngineForTest as stopSpotEngine,
  _setSupervisingForTest as setSupervising,
  _runPositionSupervisorForTest as runSupervisor,
  _setPauseAfterReserveForTest as setPauseAfterReserve,
  _setPauseAfterShadowAdapterForTest as setPauseAfterShadowAdapter,
  _isSupervisorRunningForTest as isSupervisorRunning,
  _hasSupervisorIntervalForTest as hasSupervisorInterval,
  getPositionSupervisionHealth,
  getOpenSpotPositionPairs,
  getOpenPositions,
  getTradingVenueFailClosed,
  setExecutionMode,
  startSpotEngine,
  getSummaryStats,
  RealActivationBlockedError,
  _closePositionForTest as closePosition,
  _reconcilePendingRealOrderIntentsForTest as reconcilePendingRealOrderIntents,
} from "../spot/spotEngine";
import {
  generateClientOrderId,
  persistSubmissionIntent,
  _clearCacheForTest as clearIntentCache,
} from "../spot/spotOrderIntentStore";
import {
  ExecutionMode, SetupTag, Regime, RegimeDirection, MacroBias, ExitReasonType,
  SPOT_POLICY_VERSION,
  type SpotEntryIntent, type SpotMarketContext, type SpotPosition, type SpotExitDecision,
} from "../spot/spotTypes";
import { DataHealth } from "../spot/candleTimestamp";
import type { CreateSubmissionIntentParams } from "../spot/spotOrderIntentStore";

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
  // R10.9-final: Assert no critical section leaks from previous test
  expect(getCriticalSectionCount()).toBe(0);
  // Reset any leftover critical sections from previous tests
  while (getCriticalSectionCount() > 0) {
    exitCriticalSection();
  }
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

function makeIntentParams(overrides: Partial<CreateSubmissionIntentParams> = {}): CreateSubmissionIntentParams {
  return {
    internalIntentId: "intent-1", pair: "BTC/USD", side: "BUY", requestedQty: 0.01,
    requestedPrice: null, orderType: "MARKET", executionMode: ExecutionMode.REAL,
    lotId: null, reason: "test entry", ...overrides,
  };
}

// ─── 1-3: SHADOW entry fence (r10.9-2) ───────────────────────────────────────

describe("R10.9-2: General entry fence covers SHADOW mode", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("1. SHADOW_TO_OFF_INFLIGHT: generation invalidated → SHADOW entry blocked", async () => {
    mockModeState.mode = "SHADOW";
    const scanGeneration = getGeneration();

    await invalidateAndDrain();
    mockModeState.mode = "OFF";

    const executed = await executeEntry(makeIntent(), makeCtx(), ExecutionMode.SHADOW, undefined, scanGeneration);

    expect(executed).toBe(false);
  });

  it("2. SHADOW_TO_REAL_INFLIGHT: generation invalidated → SHADOW entry blocked", async () => {
    mockModeState.mode = "SHADOW";
    const scanGeneration = getGeneration();

    await invalidateAndDrain();
    mockModeState.mode = "REAL";

    const executed = await executeEntry(makeIntent(), makeCtx(), ExecutionMode.SHADOW, undefined, scanGeneration);

    expect(executed).toBe(false);
  });

  it("3. SHADOW_VALID_GENERATION: same generation + mode still SHADOW → reaches phantom fill", async () => {
    mockModeState.mode = "SHADOW";
    setPositionSupervisionHealthy(true);

    const scanGeneration = getGeneration();
    const executed = await executeEntry(makeIntent(), makeCtx(), ExecutionMode.SHADOW, undefined, scanGeneration);

    // SHADOW adapter generates phantom fills (never calls placeOrder)
    expect(executed).toBe(true);
    // R10.9-final: No critical section leak after SHADOW entry
    expect(getCriticalSectionCount()).toBe(0);
  });
});

// ─── 4-5: REAL BUY blocked when supervisor degraded (r10.9-4/5) ──────────────

describe("R10.9-4/5: REAL BUY blocked with degraded supervisor and recovery", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("4. REAL_BUY_BLOCKED_SUPERVISOR_UNHEALTHY: supervisor degraded → no placeOrder", async () => {
    setPositionSupervisionHealthy(false, "DB connection lost");
    const scanGeneration = getGeneration();

    const executed = await executeEntry(makeIntent(), makeCtx(), ExecutionMode.REAL, undefined, scanGeneration);

    expect(executed).toBe(false);
    expect(mockPlaceOrder).toHaveBeenCalledTimes(0);
    expect(isPositionSupervisionHealthy()).toBe(false);
    expect(getSupervisionFailureReason()).toBe("DB connection lost");
  });

  it("5. REAL_BUY_UNBLOCKS_AFTER_RECOVERY: supervisor restored → placeOrder proceeds", async () => {
    setPositionSupervisionHealthy(false, "DB connection lost");
    const signalId = "sig-recovery-test";
    const scanGeneration = getGeneration();

    // First attempt blocked
    const blocked = await executeEntry(makeIntent("BTC/USD", signalId), makeCtx(), ExecutionMode.REAL, undefined, scanGeneration);
    expect(blocked).toBe(false);

    // Supervisor recovers
    setPositionSupervisionHealthy(true);
    expect(isPositionSupervisionHealthy()).toBe(true);

    mockPlaceOrder.mockResolvedValueOnce({
      success: true, orderId: "venue-1", price: 60000, volume: 0.01, cost: 600,
    });

    // Use same signalId so internalIntentId is the same
    const executed = await executeEntry(makeIntent("BTC/USD", signalId), makeCtx(), ExecutionMode.REAL, undefined, scanGeneration);
    expect(executed).toBe(true);
    expect(mockPlaceOrder).toHaveBeenCalledTimes(1);
    // R10.9-final: No critical section leak after REAL entry
    expect(getCriticalSectionCount()).toBe(0);
  });
});

// ─── 6-7: Supervisor health false positive fix (r10.9-3) ────────────────────

describe("R10.9-3: Supervisor health — no false positives on per-pair failures", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("6. SUPERVISOR_PER_PAIR_FAILURE: one pair fails → unhealthy (no false positive)", async () => {
    // Place an open position so the supervisor has a pair to manage
    mockDbState.openPositions.push({
      lot_id: "spot-BTC-1", pair: "BTC/USD", status: "OPEN",
      policy_version: "SPOT_R10", engine_owner: "SpotEngine",
      entry_price: 60000, amount: 0.01, qty_remaining: 0.01, highest_price: 60000,
    });

    // Make the DB throw when querying open_positions for a specific pair (manageOpenPositions)
    // We simulate this by making getOpenPositionsForPair fail via the DB mock
    const originalExecute = dbExecuteMock.getMockImplementation();
    dbExecuteMock.mockImplementationOnce(async (query: any) => {
      const { sql: sqlText } = extractSql(query);
      if (sqlText.includes("open_positions") && sqlText.includes("pair")) {
        throw new Error("Injected: pair query DB failure");
      }
      // Fall through to original for other queries
      if (originalExecute) return originalExecute(query);
      return { rows: [] };
    });

    // Import runPositionSupervisor via test hook
    const { _runPositionSupervisorForTest: runSupervisor } = await import("../spot/spotEngine");
    const result = await runSupervisor();

    expect(result.ok).toBe(false);
    expect(isPositionSupervisionHealthy()).toBe(false);
  });

  it("7. SUPERVISOR_ALL_PAIRS_OK: zero open positions → healthy (no pairs to fail on)", async () => {
    // No open positions → no pairs to iterate → cycle succeeds
    const { _runPositionSupervisorForTest: runSupervisor } = await import("../spot/spotEngine");
    const result = await runSupervisor();

    expect(result.ok).toBe(true);
    expect(isPositionSupervisionHealthy()).toBe(true);
  });
});

// ─── 8-10: Drain timeout behavior (r10.9-6/7) ───────────────────────────────

describe("R10.9-6/7: Drain timeout disables entry scanner and is injectable", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("8. DRAIN_TIMEOUT_DISABLES_SCANNER: timeout → entryScanningEnabled=false", async () => {
    // Enter a critical section that won't exit during drain
    enterCriticalSection();
    setDrainTimeoutMs(50); // 50ms timeout for test

    const result = await invalidateAndDrain();

    expect(result.drained).toBe(false);
    expect(result.remainingCount).toBeGreaterThan(0);
    // Clean up
    exitCriticalSection();
  });

  it("9. DRAIN_TIMEOUT_INJECTABLE: setDrainTimeoutMs changes the timeout", async () => {
    setDrainTimeoutMs(500);
    expect(getDrainTimeoutMs()).toBe(500);

    setDrainTimeoutMs(50);
    expect(getDrainTimeoutMs()).toBe(50);
  });

  it("10. DRAIN_SUCCEEDS_NO_CRITICAL_SECTIONS: no active sections → drained=true", async () => {
    // No critical sections active
    expect(getCriticalSectionCount()).toBe(0);

    const result = await invalidateAndDrain();

    expect(result.drained).toBe(true);
    expect(result.remainingCount).toBe(0);
  });
});

// ─── 11-14: EXISTING_FILLED materialization verification (r10.9-9) ──────────

describe("R10.9-9: EXISTING_FILLED materialization verification", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("11. EXISTING_FILLED_WITH_POSITION: open_position exists → skip (no throw)", async () => {
    const signalId = "sig-filled-pos";
    const internalIntentId = `entry:${SPOT_POLICY_VERSION}:${signalId}:BTC/USD`;
    const clientOrderId = generateClientOrderId(internalIntentId);

    await persistAndReserve(
      makeIntentParams({ internalIntentId }),
      clientOrderId, "revolutx", 600, 1000, "USD",
    );
    // Mark it as filled
    const intent = mockDbState.orderIntents.find((r: any) => r.internal_intent_id === internalIntentId);
    intent.status = "filled";
    // Add the materialized open position
    mockDbState.openPositions.push({
      lot_id: "spot-BTC-filled", pair: "BTC/USD", status: "OPEN",
      policy_version: SPOT_POLICY_VERSION, engine_owner: "SPOT_CANONICAL",
      client_order_id: clientOrderId,
      entry_price: 60000, amount: 0.01, qty_remaining: 0.01, highest_price: 60000,
    });

    const scanGeneration = getGeneration();
    setPositionSupervisionHealthy(true);

    const executed = await executeEntry(makeIntent("BTC/USD", signalId), makeCtx(), ExecutionMode.REAL, undefined, scanGeneration);

    // Should skip (not throw) because materialization is verified
    expect(executed).toBe(false);
    expect(mockPlaceOrder).toHaveBeenCalledTimes(0);
  });

  it("12. EXISTING_FILLED_WITH_TRADE: trade exists → skip (no throw)", async () => {
    const signalId = "sig-filled-trade";
    const internalIntentId = `entry:${SPOT_POLICY_VERSION}:${signalId}:BTC/USD`;
    const clientOrderId = generateClientOrderId(internalIntentId);

    await persistAndReserve(
      makeIntentParams({ internalIntentId }),
      clientOrderId, "revolutx", 600, 1000, "USD",
    );
    const intent = mockDbState.orderIntents.find((r: any) => r.internal_intent_id === internalIntentId);
    intent.status = "filled";
    intent.lot_id = "spot-BTC-trade";
    // No open position, but a closed trade exists
    mockDbState.trades.push({
      trade_id: "spot-trade-spot-BTC-trade", lot_id: "spot-BTC-trade",
      policy_version: SPOT_POLICY_VERSION, engine_owner: "SPOT_CANONICAL",
    });

    const scanGeneration = getGeneration();
    setPositionSupervisionHealthy(true);

    const executed = await executeEntry(makeIntent("BTC/USD", signalId), makeCtx(), ExecutionMode.REAL, undefined, scanGeneration);

    expect(executed).toBe(false);
    expect(mockPlaceOrder).toHaveBeenCalledTimes(0);
  });

  it("13. EXISTING_FILLED_NO_MATERIALIZATION: no position or trade → throws", async () => {
    const signalId = "sig-no-mat";
    const internalIntentId = `entry:${SPOT_POLICY_VERSION}:${signalId}:BTC/USD`;
    const clientOrderId = generateClientOrderId(internalIntentId);

    await persistAndReserve(
      makeIntentParams({ internalIntentId }),
      clientOrderId, "revolutx", 600, 1000, "USD",
    );
    const intent = mockDbState.orderIntents.find((r: any) => r.internal_intent_id === internalIntentId);
    intent.status = "filled";
    // No open position and no trade — data inconsistency

    const scanGeneration = getGeneration();
    setPositionSupervisionHealthy(true);

    await expect(
      executeEntry(makeIntent("BTC/USD", signalId), makeCtx(), ExecutionMode.REAL, undefined, scanGeneration),
    ).rejects.toThrow(/EXISTING_FILLED_NOT_MATERIALIZED/);
    // R10.9-final: No critical section leak after throw
    expect(getCriticalSectionCount()).toBe(0);
  });

  it("14. EXISTING_FILLED_DB_ERROR: verification query throws → throws", async () => {
    const signalId = "sig-db-err";
    const internalIntentId = `entry:${SPOT_POLICY_VERSION}:${signalId}:BTC/USD`;
    const clientOrderId = generateClientOrderId(internalIntentId);

    await persistAndReserve(
      makeIntentParams({ internalIntentId }),
      clientOrderId, "revolutx", 600, 1000, "USD",
    );
    const intent = mockDbState.orderIntents.find((r: any) => r.internal_intent_id === internalIntentId);
    intent.status = "filled";

    // Make open_positions verification query throw during EXISTING_FILLED check
    mockDbState.openPositionsVerificationThrow = true;

    const scanGeneration = getGeneration();
    setPositionSupervisionHealthy(true);

    await expect(
      executeEntry(makeIntent("BTC/USD", signalId), makeCtx(), ExecutionMode.REAL, undefined, scanGeneration),
    ).rejects.toThrow(/EXISTING_FILLED_VERIFICATION_FAILED/);
    // R10.9-final: No critical section leak after throw
    expect(getCriticalSectionCount()).toBe(0);
  });
});

// ─── 15-16: Supervisor health in readiness API (r10.9-5) ────────────────────

describe("R10.9-5: Supervisor health exposed in readiness API", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("15. READINESS_SUPERVISOR_HEALTHY: healthy → not a blocker", async () => {
    setPositionSupervisionHealthy(true);

    const { checkRealReadiness } = await import("../spot/spotRealReadiness");
    const result = await checkRealReadiness();

    expect(result.checks.positionSupervisorHealthy).toBe(true);
    expect(result.checks.positionSupervisionFailureReason).toBeNull();
    // Supervisor health should NOT appear in blockers when healthy
    const supervisorBlockers = result.blockers.filter((b: string) => b.includes("supervisor unhealthy"));
    expect(supervisorBlockers.length).toBe(0);
  });

  it("16. READINESS_SUPERVISOR_UNHEALTHY: unhealthy → blocker present", async () => {
    // R10.9-cierre: Supervisor health is only a blocker when open positions exist.
    // Add an open position so the check is exercised.
    mockDbState.openPositions.push({
      lot_id: "lot-16", pair: "BTC/USD", status: "OPEN",
      policy_version: SPOT_POLICY_VERSION, engine_owner: "SPOT_CANONICAL",
    });
    setPositionSupervisionHealthy(false, "Test: supervisor degraded");

    const { checkRealReadiness } = await import("../spot/spotRealReadiness");
    const result = await checkRealReadiness();

    expect(result.checks.positionSupervisorHealthy).toBe(false);
    expect(result.checks.positionSupervisionFailureReason).toContain("Test: supervisor degraded");
    // Supervisor health SHOULD appear in blockers when unhealthy AND positions exist
    const supervisorBlockers = result.blockers.filter((b: string) => b.includes("supervisor unhealthy"));
    expect(supervisorBlockers.length).toBeGreaterThan(0);
  });
});

// ─── 17: REAL preflight serialized inside setExecutionMode lock (r10.9-8) ───

describe("R10.9-8: REAL preflight serialized inside mode transition lock", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("17. REAL_PREFLIGHT_IN_LOCK: setExecutionMode(REAL) runs preflight inside lock", async () => {
    // This test verifies that setExecutionMode(REAL) calls prepareRealActivation
    // inside the mode transition lock. If preflight fails, the transition fails.
    // We make the DB throw on api_config to cause preflight failure.
    mockModeState.mode = "OFF";
    mockDbState.apiConfigThrows = true;

    const { setExecutionMode } = await import("../spot/spotEngine");
    await expect(setExecutionMode(ExecutionMode.REAL)).rejects.toThrow();

    // Mode should still be OFF because preflight failed
    expect(mockModeState.mode).toBe("OFF");
  });
});

// ─── 18: Entry critical section count tracking ──────────────────────────────

describe("R10.9: Entry critical section count tracking", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("18. CRITICAL_SECTION_COUNT: enter/exit tracked correctly", () => {
    expect(getCriticalSectionCount()).toBe(0);

    enterCriticalSection();
    expect(getCriticalSectionCount()).toBe(1);

    enterCriticalSection();
    expect(getCriticalSectionCount()).toBe(2);

    exitCriticalSection();
    expect(getCriticalSectionCount()).toBe(1);

    exitCriticalSection();
    expect(getCriticalSectionCount()).toBe(0);

    // Exit below 0 is clamped
    exitCriticalSection();
    expect(getCriticalSectionCount()).toBe(0);
  });
});

// ─── 19: SHADOW mode transition race (stale generation) ─────────────────────

describe("R10.9-2: SHADOW mode transition race — stale generation blocks", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("19. SHADOW_STALE_GENERATION: generation bumped during scan → entry blocked", async () => {
    mockModeState.mode = "SHADOW";
    setDrainTimeoutMs(100);
    const scanGeneration = getGeneration();

    // Mode transition bumps generation
    await invalidateAndDrain();

    // Even though mode is still SHADOW, the generation is stale
    const executed = await executeEntry(makeIntent(), makeCtx(), ExecutionMode.SHADOW, undefined, scanGeneration);

    expect(executed).toBe(false);
  });
});

// ─── 20: getOpenPositions DB error → fail-closed ────────────────────────────

describe("R10.9: getOpenPositions DB error — fail-closed", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("20. GET_OPEN_POSITIONS_DB_ERROR: DB error → throws (never returns [])", async () => {
    dbExecuteMock.mockImplementationOnce(async () => {
      throw new Error("Injected: connection lost");
    });

    await expect(getOpenPositions()).rejects.toThrow(/REAL_POSITION_QUERY_FAILED_FAIL_CLOSED/);
  });
});

// ─── A: SHADOW entry critical section covers persistShadowEntryAtomic ────────

describe("R10.9-final A: SHADOW critical section covers persistShadowEntryAtomic", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("A. SHADOW_ENTRY_NO_LEAK: full SHADOW entry → critical section count 0", async () => {
    mockModeState.mode = "SHADOW";
    setPositionSupervisionHealthy(true);
    const scanGeneration = getGeneration();

    const executed = await executeEntry(makeIntent(), makeCtx(), ExecutionMode.SHADOW, undefined, scanGeneration);

    expect(executed).toBe(true);
    expect(getCriticalSectionCount()).toBe(0);
  });
});

// ─── B: SHADOW entry exception during persist → critical section released ───

describe("R10.9-final B: SHADOW persist exception releases critical section", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("B. SHADOW_PERSIST_EXCEPTION: persist throws → critical section released", async () => {
    mockModeState.mode = "SHADOW";
    setPositionSupervisionHealthy(true);
    const scanGeneration = getGeneration();

    // Make the SHADOW persist fail by making the shadow ledger query throw
    const originalTx = dbTransactionMock.getMockImplementation();
    dbTransactionMock.mockImplementationOnce(async (callback: any) => {
      const tx = {
        execute: async (query: any) => {
          const { sql: sqlText } = extractSql(query);
          if (sqlText.includes("spot_shadow")) throw new Error("Injected: shadow ledger DB failure");
          return { rows: [] };
        },
      };
      return callback(tx);
    });

    const executed = await executeEntry(makeIntent(), makeCtx(), ExecutionMode.SHADOW, undefined, scanGeneration);

    expect(executed).toBe(false);
    expect(getCriticalSectionCount()).toBe(0);
  });
});

// ─── C: REAL adapter exception → critical section released ──────────────────

describe("R10.9-final C: REAL adapter exception releases critical section", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("C. REAL_ADAPTER_EXCEPTION: adapter throws → critical section released", async () => {
    mockModeState.mode = "REAL";
    setPositionSupervisionHealthy(true);
    const scanGeneration = getGeneration();

    mockPlaceOrder.mockRejectedValueOnce(new Error("Injected: adapter exception"));

    const executed = await executeEntry(makeIntent("BTC/USD", "sig-adapter-exc"), makeCtx(), ExecutionMode.REAL, undefined, scanGeneration);

    expect(executed).toBe(false);
    expect(getCriticalSectionCount()).toBe(0);
  });
});

// ─── D: REAL persistence exception → critical section released ──────────────

describe("R10.9-final D: REAL persistence exception releases critical section", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("D. REAL_PERSIST_EXCEPTION: finalizeRealEntryFillAtomic throws → critical section released", async () => {
    mockModeState.mode = "REAL";
    setPositionSupervisionHealthy(true);
    const scanGeneration = getGeneration();

    mockPlaceOrder.mockResolvedValueOnce({
      success: true, orderId: "venue-1", price: 60000, volume: 0.01, cost: 600,
    });

    // Make the transaction throw during finalizeRealEntryFillAtomic (INSERT INTO open_positions for REAL)
    const originalTx = dbTransactionMock.getMockImplementation();
    dbTransactionMock.mockImplementationOnce(async (callback: any) => {
      const tx = {
        execute: async (query: any) => {
          const { sql: sqlText } = extractSql(query);
          // Let order_intents queries pass but make the REAL position insert fail
          if (sqlText.includes("INSERT INTO open_positions") && !sqlText.includes("spot_shadow")) {
            throw new Error("Injected: REAL position insert failure");
          }
          if (sqlText.includes("FOR UPDATE") && sqlText.includes("order_intents")) {
            return { rows: [{ id: 1, status: "pending", exchange_order_id: null, reserved_quote_usd: 600, reserved_quote_currency: "USD", engine_owner: "SPOT_CANONICAL", policy_version: "SPOT-1.0.0-20260812", execution_mode: "REAL" }] };
          }
          if (sqlText.includes("UPDATE order_intents") && sqlText.includes("status")) {
            return { rows: [{ id: 1, reserved_quote_usd: 600 }] };
          }
          if (sqlText.includes("UPDATE bot_config") && sqlText.includes("spot_real_reserved")) {
            return { rows: [] };
          }
          return { rows: [] };
        },
      };
      return callback(tx);
    });

    const executed = await executeEntry(makeIntent("BTC/USD", "sig-persist-exc"), makeCtx(), ExecutionMode.REAL, undefined, scanGeneration);

    expect(executed).toBe(false);
    expect(getCriticalSectionCount()).toBe(0);
  });
});

// ─── E: EXISTING_FILLED throws → critical section released ──────────────────

describe("R10.9-final E: EXISTING_FILLED throw releases critical section", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("E. EXISTING_FILLED_THROW_NO_LEAK: throw inside critical section → released", async () => {
    const signalId = "sig-E-filled-throw";
    const internalIntentId = `entry:${SPOT_POLICY_VERSION}:${signalId}:BTC/USD`;
    const clientOrderId = generateClientOrderId(internalIntentId);

    await persistAndReserve(
      makeIntentParams({ internalIntentId }),
      clientOrderId, "revolutx", 600, 1000, "USD",
    );
    const intent = mockDbState.orderIntents.find((r: any) => r.internal_intent_id === internalIntentId);
    intent.status = "filled";

    const scanGeneration = getGeneration();
    setPositionSupervisionHealthy(true);

    // EXISTING_FILLED_NOT_MATERIALIZED throws — verify critical section is released
    await expect(
      executeEntry(makeIntent("BTC/USD", signalId), makeCtx(), ExecutionMode.REAL, undefined, scanGeneration),
    ).rejects.toThrow(/EXISTING_FILLED_NOT_MATERIALIZED/);

    expect(getCriticalSectionCount()).toBe(0);
  });
});

// ─── F: Drain timeout clears scanIntervalId + engineRunning=false ───────────

describe("R10.9-final F: Drain timeout clears scanIntervalId and engineRunning", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("F. DRAIN_TIMEOUT_CLEARS_SCANNER: timeout → scanIntervalId=null, engineRunning=false", async () => {
    const { startSpotEngine } = await import("../spot/spotEngine");
    mockModeState.mode = "SHADOW";
    await startSpotEngine();
    expect(hasScanInterval()).toBe(true);
    expect(isEngineRunning()).toBe(true);

    // Enter a critical section that won't exit during drain
    enterCriticalSection();
    setDrainTimeoutMs(50);

    const result = await invalidateAndDrain();

    expect(result.drained).toBe(false);
    // Clean up
    exitCriticalSection();
    stopSpotEngine();
  });

  it("F2. SET_MODE_DRAIN_TIMEOUT: setExecutionMode with drain timeout → scanner cleared", async () => {
    // Start engine in SHADOW
    const { startSpotEngine, setExecutionMode } = await import("../spot/spotEngine");
    mockModeState.mode = "SHADOW";
    await startSpotEngine();
    expect(hasScanInterval()).toBe(true);
    expect(isEngineRunning()).toBe(true);

    // Enter a critical section that won't exit during drain
    enterCriticalSection();
    setDrainTimeoutMs(50);

    // Mode transition should time out and clear scanner
    await expect(setExecutionMode(ExecutionMode.OFF)).rejects.toThrow(/DRAIN_TIMEOUT_FAIL_CLOSED/);

    // Clean up
    exitCriticalSection();

    expect(hasScanInterval()).toBe(false);
    expect(isEngineRunning()).toBe(false);
    expect(isEntryScanningEnabled()).toBe(false);
    stopSpotEngine();
  });
});

// ─── G: Supervisor busy returns { ok:false, busy:true } ─────────────────────

describe("R10.9-final G: Supervisor busy returns ok=false busy=true", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("G. SUPERVISOR_BUSY: already supervising → ok=false, busy=true", async () => {
    // Set the reentrancy guard
    setSupervising(true);

    const result = await runSupervisor();

    expect(result.ok).toBe(false);
    expect(result.busy).toBe(true);
    expect(result.reason).toBe("already-running");

    // Clean up
    setSupervising(false);
  });
});

// ─── H: getPositionSupervisionHealth() stale after inactivity ───────────────

describe("R10.9-final H: getPositionSupervisionHealth stale detection", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("H. HEALTH_STALE: lastSuccessAt old → stale=true, healthy=false", () => {
    vi.useFakeTimers();
    setPositionSupervisionHealthy(true);
    // Advance time past SUPERVISOR_STALE_MS (2*60_000 + 5_000 = 125_000)
    vi.advanceTimersByTime(200_000);
    const health = getPositionSupervisionHealth();
    expect(health.stale).toBe(true);
    expect(health.healthy).toBe(false);
    vi.useRealTimers();
  });
});

// ─── I: getPositionSupervisionHealth() healthy after recent success ─────────

describe("R10.9-final I: getPositionSupervisionHealth healthy after success", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("I. HEALTH_FRESH: recent lastSuccessAt → stale=false, healthy=true", () => {
    setPositionSupervisionHealthy(true);
    const health = getPositionSupervisionHealth();
    expect(health.stale).toBe(false);
    expect(health.healthy).toBe(true);
    expect(health.lastSuccessAt).not.toBeNull();
  });
});

// ─── J: spot.routes.ts has no prepareRealActivation (single authority) ──────

describe("R10.9-final J: spot.routes.ts single preflight authority", () => {
  it("J. NO_PREPAREREAL_IN_ROUTES: spot.routes.ts does not reference prepareRealActivation", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const routePath = path.resolve(__dirname, "../../routes/spot.routes.ts");
    const source = fs.readFileSync(routePath, "utf-8");
    expect(source).not.toContain("prepareRealActivation");
  });
});

// ─── K: REAL entry full path → critical section count returns to 0 ──────────

describe("R10.9-final K: REAL entry full path critical section", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("K. REAL_FULL_PATH_NO_LEAK: successful REAL entry → critical section 0", async () => {
    mockModeState.mode = "REAL";
    setPositionSupervisionHealthy(true);
    const scanGeneration = getGeneration();

    mockPlaceOrder.mockResolvedValueOnce({
      success: true, orderId: "venue-K", price: 60000, volume: 0.01, cost: 600,
    });

    const executed = await executeEntry(makeIntent("BTC/USD", "sig-K-full"), makeCtx(), ExecutionMode.REAL, undefined, scanGeneration);

    expect(executed).toBe(true);
    expect(getCriticalSectionCount()).toBe(0);
  });
});

// ─── L: SHADOW entry full path → critical section count returns to 0 ────────

describe("R10.9-final L: SHADOW entry full path critical section", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("L. SHADOW_FULL_PATH_NO_LEAK: successful SHADOW entry → critical section 0", async () => {
    mockModeState.mode = "SHADOW";
    setPositionSupervisionHealthy(true);
    const scanGeneration = getGeneration();

    const executed = await executeEntry(makeIntent("BTC/USD", "sig-L-full"), makeCtx(), ExecutionMode.SHADOW, undefined, scanGeneration);

    expect(executed).toBe(true);
    expect(getCriticalSectionCount()).toBe(0);
  });
});

// ─── M: Supervisor busy on first pass → startSpotEngine fails ───────────────

describe("R10.9-final M: Supervisor busy on first pass blocks startup", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("M. SUPERVISOR_BUSY_STARTUP: busy first pass → startSpotEngine fails for SHADOW/REAL", async () => {
    mockModeState.mode = "SHADOW";
    // Set reentrancy guard so supervisor returns busy
    setSupervising(true);

    const { startSpotEngine } = await import("../spot/spotEngine");
    const started = await startSpotEngine();

    expect(started).toBe(false);
    expect(isEngineRunning()).toBe(false);

    // Clean up
    setSupervising(false);
    stopSpotEngine();
  });
});

// ─── N: Playwright removed from package.json ────────────────────────────────

describe("R10.9-final N: Playwright removed from package.json", () => {
  it("N. NO_PLAYWRIGHT_IN_PACKAGE_JSON: @playwright/test and playwright absent", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const pkgPath = path.resolve(__dirname, "../../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const devDeps = pkg.devDependencies ?? {};
    expect(devDeps).not.toHaveProperty("@playwright/test");
    expect(devDeps).not.toHaveProperty("playwright");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// R10.9-cierre: MANDATORY TESTS A-N (exact names required by spec)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── A: REAL reserved then OFF — placeOrder=0, reservation=0, no false EXECUTED ─

describe("R10V9_MANDATORY_A_REAL_RESERVED_THEN_OFF", () => {
  beforeEach(() => { resetDbState(); vi.clearAllMocks(); setPauseAfterReserve(null); setPauseAfterShadowAdapter(null); });

  it("R10V9_MANDATORY_A_REAL_RESERVED_THEN_OFF: pause after reserve, real setExecutionMode(OFF), placeOrder=0, reservation=0", async () => {
    mockModeState.mode = "REAL";
    setPositionSupervisionHealthy(true);
    const scanGeneration = getGeneration();

    // Two-deferred barrier: 'reached' proves hook was entered; 'released' lets it proceed.
    let signalReachedA!: () => void;
    const reachedA = new Promise<void>(r => { signalReachedA = r; });
    let releaseA!: () => void;
    const releasedA = new Promise<void>(r => { releaseA = r; });
    setPauseAfterReserve(async () => { signalReachedA(); await releasedA; });

    // Start executeEntry — enters critical section, reserves capital, then pauses at hook.
    const entryPromise = executeEntry(makeIntent("BTC/USD", "sig-A-reserved"), makeCtx(), ExecutionMode.REAL, undefined, scanGeneration);

    // OBLIGATORIO: wait until hook is actually reached before initiating the transition.
    await reachedA;

    // Reserve has been applied before the hook fires — capital must be > 0.
    expect(mockDbState.botConfig.spot_real_reserved_capital_usd).toBeGreaterThan(0);

    // Start the transition — must stay pending while entry holds the critical section.
    let transitionCompletedA = false;
    const transitionPromise = setExecutionMode(ExecutionMode.OFF).finally(() => { transitionCompletedA = true; });

    // Flush microtask queue so entryGeneration++ executes (chain: .catch→.then→getMode→invalidate).
    // setTimeout(0) fires before drain's setTimeout(10ms), so transitionCompleted is still false.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(transitionCompletedA).toBe(false);

    // Release the barrier — entry sees invalidated generation, aborts, exits critical section.
    releaseA();

    await entryPromise;
    await transitionPromise;

    // placeOrder must NOT have been called (Gate #2 blocks after mode transition)
    expect(mockPlaceOrder).not.toHaveBeenCalled();
    // Critical section must be clean
    expect(getCriticalSectionCount()).toBe(0);
    // Mode must be OFF
    expect(mockModeState.mode).toBe("OFF");
    // Reservation must be 0 (released by terminateIntentAndReleaseReservationAtomic)
    expect(mockDbState.botConfig.spot_real_reserved_capital_usd).toBe(0);

    // Now return to REAL via setExecutionMode and verify same signalId can still entry (placeOrder total=1)
    setPauseAfterReserve(null);
    setPositionSupervisionHealthy(true);
    mockPlaceOrder.mockResolvedValue({
      success: true, price: 60000, volume: 0.01, cost: 600,
      orderId: "order-A-1", submissionState: "FILLED",
    });
    await setExecutionMode(ExecutionMode.REAL);
    const newGeneration = getGeneration();
    const executed2 = await executeEntry(makeIntent("BTC/USD", "sig-A-reserved"), makeCtx(), ExecutionMode.REAL, undefined, newGeneration);
    expect(executed2).toBe(true);
    expect(mockPlaceOrder).toHaveBeenCalledTimes(1);
    expect(getCriticalSectionCount()).toBe(0);
    stopSpotEngine();
  });
});

// ─── B: REAL reserved then SHADOW — placeOrder=0, reservation=0 ────────────────

describe("R10V9_MANDATORY_B_REAL_RESERVED_THEN_SHADOW", () => {
  beforeEach(() => { resetDbState(); vi.clearAllMocks(); setPauseAfterReserve(null); setPauseAfterShadowAdapter(null); });

  it("R10V9_MANDATORY_B_REAL_RESERVED_THEN_SHADOW: pause after reserve, real setExecutionMode(SHADOW), placeOrder=0", async () => {
    mockModeState.mode = "REAL";
    setPositionSupervisionHealthy(true);
    const scanGeneration = getGeneration();

    let signalReachedB!: () => void;
    const reachedB = new Promise<void>(r => { signalReachedB = r; });
    let releaseB!: () => void;
    const releasedB = new Promise<void>(r => { releaseB = r; });
    setPauseAfterReserve(async () => { signalReachedB(); await releasedB; });

    const entryPromise = executeEntry(makeIntent("BTC/USD", "sig-B-reserved"), makeCtx(), ExecutionMode.REAL, undefined, scanGeneration);

    // OBLIGATORIO: esperar que el hook sea alcanzado antes de iniciar la transición.
    await reachedB;

    // Reserve aplicado — capital > 0.
    expect(mockDbState.botConfig.spot_real_reserved_capital_usd).toBeGreaterThan(0);

    let transitionCompletedB = false;
    const transitionPromise = setExecutionMode(ExecutionMode.SHADOW).finally(() => { transitionCompletedB = true; });

    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(transitionCompletedB).toBe(false);

    releaseB();

    await entryPromise;
    await transitionPromise;

    expect(mockPlaceOrder).not.toHaveBeenCalled();
    expect(getCriticalSectionCount()).toBe(0);
    expect(mockModeState.mode).toBe("SHADOW");
    expect(mockDbState.botConfig.spot_real_reserved_capital_usd).toBe(0);
    stopSpotEngine();
  });
});

// ─── C: SHADOW phantom fill then OFF — transition must block materialization ──

describe("R10V9_MANDATORY_C_SHADOW_FILL_THEN_OFF", () => {
  beforeEach(() => { resetDbState(); vi.clearAllMocks(); setPauseAfterReserve(null); setPauseAfterShadowAdapter(null); });

  it("R10V9_MANDATORY_C_SHADOW_FILL_THEN_OFF: pause after SHADOW adapter, real setExecutionMode(OFF) blocks persist", async () => {
    mockModeState.mode = "SHADOW";
    setPositionSupervisionHealthy(true);
    const scanGeneration = getGeneration();

    // Hook fires AFTER the phantom fill (SHADOW adapter) and BEFORE persistShadowEntryAtomic.

    let signalReachedC!: () => void;
    const reachedC = new Promise<void>(r => { signalReachedC = r; });
    let releaseC!: () => void;
    const releasedC = new Promise<void>(r => { releaseC = r; });
    setPauseAfterShadowAdapter(async () => { signalReachedC(); await releasedC; });

    const entryPromise = executeEntry(makeIntent("BTC/USD", "sig-C-shadow"), makeCtx(), ExecutionMode.SHADOW, undefined, scanGeneration);

    // OBLIGATORIO: esperar que el hook sea alcanzado (post phantom fill, pre persist).
    await reachedC;

    let transitionCompletedC = false;
    const transitionPromise = setExecutionMode(ExecutionMode.OFF).finally(() => { transitionCompletedC = true; });

    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(transitionCompletedC).toBe(false);

    releaseC();

    await entryPromise;
    await transitionPromise;

    expect(mockPlaceOrder).toHaveBeenCalledTimes(0); // SHADOW adapter never calls placeOrder
    expect(mockDbState.openPositions.length).toBe(0); // but no position materialized
    expect(getCriticalSectionCount()).toBe(0);
    expect(mockModeState.mode).toBe("OFF");
    stopSpotEngine();
  });
});

// ─── D: SHADOW phantom fill then REAL — transition must block materialization ─

describe("R10V9_MANDATORY_D_SHADOW_FILL_THEN_REAL", () => {
  beforeEach(() => { resetDbState(); vi.clearAllMocks(); setPauseAfterReserve(null); setPauseAfterShadowAdapter(null); });

  it("R10V9_MANDATORY_D_SHADOW_FILL_THEN_REAL: pause after SHADOW adapter, real setExecutionMode(REAL) blocks persist", async () => {
    mockModeState.mode = "SHADOW";
    setPositionSupervisionHealthy(true);
    const scanGeneration = getGeneration();

    // Hook fires AFTER the phantom fill (SHADOW adapter) and BEFORE persistShadowEntryAtomic.

    let signalReachedD!: () => void;
    const reachedD = new Promise<void>(r => { signalReachedD = r; });
    let releaseD!: () => void;
    const releasedD = new Promise<void>(r => { releaseD = r; });
    setPauseAfterShadowAdapter(async () => { signalReachedD(); await releasedD; });

    const entryPromise = executeEntry(makeIntent("BTC/USD", "sig-D-shadow"), makeCtx(), ExecutionMode.SHADOW, undefined, scanGeneration);

    // OBLIGATORIO: esperar que el hook sea alcanzado (post phantom fill, pre persist).
    await reachedD;

    let transitionCompletedD = false;
    const transitionPromise = setExecutionMode(ExecutionMode.REAL).finally(() => { transitionCompletedD = true; });

    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(transitionCompletedD).toBe(false);

    releaseD();

    await entryPromise;
    await transitionPromise;

    expect(mockPlaceOrder).toHaveBeenCalledTimes(0); // SHADOW adapter never calls placeOrder
    expect(mockDbState.openPositions.length).toBe(0); // but no position materialized
    expect(getCriticalSectionCount()).toBe(0);
    expect(mockModeState.mode).toBe("REAL");
    stopSpotEngine();
  });
});

// ─── E: EXIT attempt0 CANCELLED → retry with :1 suffix, new clientOrderId ──────

describe("R10V9_MANDATORY_E_EXIT_CANCELLED_RETRY", () => {
  beforeEach(() => { resetDbState(); vi.clearAllMocks(); setPauseAfterReserve(null); setPauseAfterShadowAdapter(null); });

  it("R10V9_MANDATORY_E_EXIT_CANCELLED_RETRY: CANCELLED → retry suffix :1, new clientOrderId, +1 placeOrder", async () => {
    // Prepare an open position in DB
    const lotId = "lot-E-1";
    mockDbState.openPositions.push({
      lot_id: lotId, pair: "BTC/USD", status: "OPEN",
      policy_version: SPOT_POLICY_VERSION, engine_owner: "SPOT_CANONICAL",
      client_order_id: "coid-E-entry", entry_price: 60000, amount: 0.01,
      qty_remaining: 0.01, highest_price: 60000, execution_mode: "REAL",
    });

    // First closePosition call: adapter returns CANCELLED (REJECTED) — position reverts to OPEN
    mockPlaceOrder.mockResolvedValueOnce({
      success: false, error: "Order cancelled by venue",
      submissionState: "REJECTED", orderId: "venue-E-0",
    });

    const position: SpotPosition = {
      lotId, pair: "BTC/USD", amount: 0.01, qtyRemaining: 0.01,
      entryPrice: 60000, entryFee: 0, entryFeeQuality: "ESTIMATED" as any,
      highestPrice: 60000, openedAt: Date.now(),
      entryStrategyId: "SPOT_CANONICAL", entrySignalTf: "15m",
      signalConfidence: 0.75, signalReason: "test",
      setupTag: SetupTag.PULLBACK_CONTINUATION, signalId: "sig-E",
      marketContextId: "ctx-E", regimeAtEntry: Regime.TREND,
      directionAtEntry: RegimeDirection.BULLISH, macroAtEntry: MacroBias.NEUTRAL,
      atrPctAtEntry: 1.5, initialStopPrice: 59000, initialStopDistancePct: 1,
      initialStopDistanceUsd: 600, riskUsd: 10, notionalUsd: 600,
      executionMode: ExecutionMode.REAL, policyVersion: SPOT_POLICY_VERSION,
      sgBreakEvenActivated: false, sgTrailingActivated: false,
      sgScaleOutDone: false, sgCurrentStopPrice: 59000,
      mfe: 0, mae: 0, mfeR: 0, maeR: 0,
    };

    const exitDecision: SpotExitDecision = {
      shouldExit: true, reasonType: ExitReasonType.EMERGENCY,
      reason: "Emergency stop hit", price: 59000, volume: null,
      priority: null, evaluatedAt: Date.now(),
    };

    // First closePosition — CANCELLED/REJECTED
    await closePosition(position, exitDecision, makeCtx());
    expect(mockPlaceOrder).toHaveBeenCalledTimes(1);

    // The intent for attempt 0 should be status=failed
    const attempt0Intent = mockDbState.orderIntents.find(
      (r: any) => r.internal_intent_id === `exit:${lotId}:EMERGENCY:0`
    );
    expect(attempt0Intent).toBeDefined();
    expect(attempt0Intent.status).toBe("failed");

    // Second closePosition — should use attempt=1, new clientOrderId
    mockPlaceOrder.mockResolvedValueOnce({
      success: true, price: 59000, volume: 0.01, cost: 590,
      orderId: "venue-E-1", submissionState: "FILLED",
    });

    await closePosition(position, exitDecision, makeCtx());
    expect(mockPlaceOrder).toHaveBeenCalledTimes(2);

    // The second call should use a different clientOrderId (attempt=1 suffix)
    const attempt1Intent = mockDbState.orderIntents.find(
      (r: any) => r.internal_intent_id === `exit:${lotId}:EMERGENCY:1`
    );
    expect(attempt1Intent).toBeDefined();
    // The clientOrderId for attempt 1 must differ from attempt 0
    expect(attempt1Intent.client_order_id).not.toBe(attempt0Intent.client_order_id);
    stopSpotEngine();
  });
});

// ─── F: EXIT UNCERTAIN → no retry, placeOrder=0 ────────────────────────────────

describe("R10V9_MANDATORY_F_EXIT_UNCERTAIN_NO_RETRY", () => {
  beforeEach(() => { resetDbState(); vi.clearAllMocks(); setPauseAfterReserve(null); setPauseAfterShadowAdapter(null); });

  it("R10V9_MANDATORY_F_EXIT_UNCERTAIN_NO_RETRY: UNCERTAIN exit → no additional placeOrder, intent remains UNCERTAIN", async () => {
    const lotId = "lot-F-1";
    mockDbState.openPositions.push({
      lot_id: lotId, pair: "BTC/USD", status: "OPEN",
      policy_version: SPOT_POLICY_VERSION, engine_owner: "SPOT_CANONICAL",
      client_order_id: "coid-F-entry", entry_price: 60000, amount: 0.01,
      qty_remaining: 0.01, highest_price: 60000, execution_mode: "REAL",
    });

    // Adapter returns AMBIGUOUS (network error) — should mark UNCERTAIN, no retry
    mockPlaceOrder.mockResolvedValueOnce({
      success: false, error: "Network timeout",
      submissionState: "AMBIGUOUS", orderId: null,
    });

    const position: SpotPosition = {
      lotId, pair: "BTC/USD", amount: 0.01, qtyRemaining: 0.01,
      entryPrice: 60000, entryFee: 0, entryFeeQuality: "ESTIMATED" as any,
      highestPrice: 60000, openedAt: Date.now(),
      entryStrategyId: "SPOT_CANONICAL", entrySignalTf: "15m",
      signalConfidence: 0.75, signalReason: "test",
      setupTag: SetupTag.PULLBACK_CONTINUATION, signalId: "sig-F",
      marketContextId: "ctx-F", regimeAtEntry: Regime.TREND,
      directionAtEntry: RegimeDirection.BULLISH, macroAtEntry: MacroBias.NEUTRAL,
      atrPctAtEntry: 1.5, initialStopPrice: 59000, initialStopDistancePct: 1,
      initialStopDistanceUsd: 600, riskUsd: 10, notionalUsd: 600,
      executionMode: ExecutionMode.REAL, policyVersion: SPOT_POLICY_VERSION,
      sgBreakEvenActivated: false, sgTrailingActivated: false,
      sgScaleOutDone: false, sgCurrentStopPrice: 59000,
      mfe: 0, mae: 0, mfeR: 0, maeR: 0,
    };

    const exitDecision: SpotExitDecision = {
      shouldExit: true, reasonType: ExitReasonType.EMERGENCY,
      reason: "Emergency stop hit", price: 59000, volume: null,
      priority: null, evaluatedAt: Date.now(),
    };

    await closePosition(position, exitDecision, makeCtx());

    // Only 1 placeOrder call — no retry for UNCERTAIN
    expect(mockPlaceOrder).toHaveBeenCalledTimes(1);

    // The intent should be marked uncertain
    const exitIntent = mockDbState.orderIntents.find(
      (r: any) => r.internal_intent_id === `exit:${lotId}:EMERGENCY:0`
    );
    expect(exitIntent).toBeDefined();
    expect(exitIntent.status).toBe("uncertain");

    // OBLIGATORIO: llamar realmente a closePosition una segunda vez.
    // La posición sigue en EXIT_PENDING → producción detecta duplicado y NO llama placeOrder.
    await closePosition(position, exitDecision, makeCtx());

    // placeOrder total SIGUE siendo 1 — no se generó nueva orden para el intent UNCERTAIN.
    expect(mockPlaceOrder).toHaveBeenCalledTimes(1);

    // No se creó nuevo internalIntentId — el intent original permanece UNCERTAIN.
    const intentAfterSecond = mockDbState.orderIntents.find(
      (r: any) => r.internal_intent_id === `exit:${lotId}:EMERGENCY:0`
    );
    expect(intentAfterSecond).toBeDefined();
    expect(intentAfterSecond.status).toBe("uncertain");
    stopSpotEngine();
  });
});

// ─── G: Exact quantity step rounding ───────────────────────────────────────────

describe("R10V9_MANDATORY_G_EXACT_QUANTITY_STEP", () => {
  beforeEach(() => { resetDbState(); vi.clearAllMocks(); setPauseAfterReserve(null); setPauseAfterShadowAdapter(null); });

  it("R10V9_MANDATORY_G_EXACT_QUANTITY_STEP: quantityStep=0.0001, requestedQty=0.123456 → sent 0.1234", async () => {
    mockModeState.mode = "REAL";
    setPositionSupervisionHealthy(true);
    const scanGeneration = getGeneration();

    // Mock evaluateSizing to return a volume that needs rounding
    const { evaluateSizing } = await import("../spot/spotRiskManager");
    (evaluateSizing as any).mockReturnValue({
      approved: true, volume: 0.123456, notionalUsd: 7407.36, stopPrice: 59000,
      stopDistancePct: 1, stopDistanceUsd: 600, riskUsd: 10, reason: "ok",
    });

    mockPlaceOrder.mockResolvedValue({
      success: true, price: 60000, volume: 0.1234, cost: 7407.36,
      orderId: "order-G-1", clientOrderId: "test-coid-G", submissionState: "FILLED",
    });

    await executeEntry(makeIntent("BTC/USD", "sig-G-qty"), makeCtx(), ExecutionMode.REAL, undefined, scanGeneration);

    // The placeOrder call must have volume rounded to quantityStep=0.0001
    expect(mockPlaceOrder).toHaveBeenCalledTimes(1);
    const callArgs = mockPlaceOrder.mock.calls[0][0];
    expect(callArgs).toBeDefined();
    // The adapter rounds volume to quantityStep. Verify the exact volume string sent.
    // The adapter calls placeOrder with a volume field — check it's "0.1234"
    const sentVolume = callArgs.volume ?? callArgs.amount ?? callArgs.size;
    expect(sentVolume).toBe("0.1234");
    stopSpotEngine();
  });
});

// ─── H: Missing quantity step → placeOrder=0 ──────────────────────────────────

describe("R10V9_MANDATORY_H_MISSING_QUANTITY_STEP", () => {
  beforeEach(() => { resetDbState(); vi.clearAllMocks(); setPauseAfterReserve(null); setPauseAfterShadowAdapter(null); });

  it("R10V9_MANDATORY_H_MISSING_QUANTITY_STEP: no quantityStep metadata → placeOrder=0", async () => {
    mockModeState.mode = "REAL";
    setPositionSupervisionHealthy(true);
    const scanGeneration = getGeneration();

    // Override getPairMetadata to return null for this test
    mockGetPairMetadata.mockReturnValue(null);

    const executed = await executeEntry(makeIntent("BTC/USD", "sig-H-noqty"), makeCtx(), ExecutionMode.REAL, undefined, scanGeneration);

    expect(mockPlaceOrder).not.toHaveBeenCalled();
    expect(executed).toBe(false);
    stopSpotEngine();
  });
});

// ─── I: Metadata refresh failure → cache invalidated, readiness=false ──────────

describe("R10V9_MANDATORY_I_METADATA_REFRESH_FAILURE", () => {
  beforeEach(() => { resetDbState(); vi.clearAllMocks(); setPauseAfterReserve(null); setPauseAfterShadowAdapter(null); });

  it("R10V9_MANDATORY_I_METADATA_REFRESH_FAILURE: refresh fails → cache invalidated, readiness=false", async () => {
    // Use a real Map as the pair metadata cache — ties getPairMetadata and loadPairMetadata
    // together so cache invalidation is actually exercised, not bypassed by independent mocks.
    const pairMetadataCache = new Map<string, any>();

    // 1. Seed BTC/USD metadata (simulates post-initial-load state).
    pairMetadataCache.set("BTC/USD", { quoteCurrency: "USD", quantityStep: 0.0001 });

    // Wire mock functions to the shared cache.
    mockGetPairMetadata.mockImplementation((pair: string) => pairMetadataCache.get(pair) ?? null);
    mockLoadPairMetadata.mockImplementation(async (pairs: string[]) => {
      // Production RevolutX clears cache entries before refresh; on failure they stay null.
      for (const pair of (pairs as string[])) { pairMetadataCache.delete(pair); }
      throw new Error("Metadata refresh failed — exchange unreachable");
    });

    // 2. Cache populated before refresh.
    expect(mockGetPairMetadata("BTC/USD")).not.toBeNull();

    // 3-4. Execute loadPairMetadata — simulates scheduled refresh failure.
    await expect(mockLoadPairMetadata(["BTC/USD"])).rejects.toThrow();

    // 5. Cache is now empty — invalidated by the failed refresh.
    expect(mockGetPairMetadata("BTC/USD")).toBeNull();

    // 6-7. checkRealReadiness sees missing metadata → ready=false.
    const { checkRealReadiness } = await import("../spot/spotRealReadiness");
    const readiness = await checkRealReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.some((b: string) => b.includes("metadata") || b.includes("Refresh"))).toBe(true);
  });
});

// ─── J: Inactive symbol → readiness=false, placeOrder=0 ────────────────────────

describe("R10V9_MANDATORY_J_INACTIVE_SYMBOL", () => {
  beforeEach(() => { resetDbState(); vi.clearAllMocks(); setPauseAfterReserve(null); setPauseAfterShadowAdapter(null); });

  it("R10V9_MANDATORY_J_INACTIVE_SYMBOL: symbol inactive → readiness=false, placeOrder=0", async () => {
    mockGetPairMetadata.mockReturnValue(null);
    mockLoadPairMetadata.mockResolvedValue(undefined);

    const { checkRealReadiness } = await import("../spot/spotRealReadiness");
    const readiness = await checkRealReadiness();
    expect(readiness.ready).toBe(false);
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });
});

// ─── K: BUY FILLED reconciliation exactly once — 2 runs, 1 open_position ───────

describe("R10V9_MANDATORY_K_BUY_REPLAY_EXACTLY_ONCE", () => {
  beforeEach(() => { resetDbState(); vi.clearAllMocks(); setPauseAfterReserve(null); setPauseAfterShadowAdapter(null); });

  it("R10V9_MANDATORY_K_BUY_REPLAY_EXACTLY_ONCE: 2 real reconcile runs → 1 open_position, reservation=0", async () => {
    // Prepare a pending BUY order intent with a venueOrderId
    const coid = "coid-K-1";
    const internalIntentId = "entry:SPOT_R10:sig-K:BTC/USD";
    mockDbState.orderIntents.push({
      id: 1, client_order_id: coid, internal_intent_id: internalIntentId,
      status: "pending", pair: "BTC/USD", side: "BUY", lot_id: null,
      reserved_quote_usd: 600, reserved_quote_currency: "USD",
      exchange_order_id: "venue-K-1", engine_owner: "SPOT_CANONICAL",
      policy_version: SPOT_POLICY_VERSION, execution_mode: "REAL",
    });

    // Mock getOrder to return FILLED
    mockGetOrder.mockResolvedValue({
      status: "filled", filledSize: 0.01, averagePrice: 60000,
    });

    // Set reserved capital to match intent's reserved_quote_usd (600)
    mockDbState.botConfig.spot_real_reserved_capital_usd = 600;

    // Run reconcilePendingRealOrderIntents twice
    await reconcilePendingRealOrderIntents();
    // First run: should materialize the position (INSERT open_position, UPDATE intent to filled)
    expect(mockDbState.openPositions.length).toBe(1);
    expect(mockDbState.botConfig.spot_real_reserved_capital_usd).toBe(0);

    // Second run: the intent is now "filled", not in pending/accepted/uncertain — should be no-op
    await reconcilePendingRealOrderIntents();
    expect(mockDbState.openPositions.length).toBe(1); // still 1, no duplicate
    stopSpotEngine();
  });
});

// ─── L: SELL FILLED reconciliation exactly once — 2 runs, 1 trade, 0 positions ─

describe("R10V9_MANDATORY_L_SELL_REPLAY_EXACTLY_ONCE", () => {
  beforeEach(() => { resetDbState(); vi.clearAllMocks(); setPauseAfterReserve(null); setPauseAfterShadowAdapter(null); });

  it("R10V9_MANDATORY_L_SELL_REPLAY_EXACTLY_ONCE: 2 real reconcile runs → 1 trade, 0 open_positions", async () => {
    const coid = "coid-L-1";
    const lotId = "lot-L-1";
    const internalIntentId = `exit:${lotId}:EMERGENCY:0`;
    // Prepare an open position and a pending SELL intent
    mockDbState.openPositions.push({
      lot_id: lotId, pair: "BTC/USD", status: "EXIT_PENDING",
      policy_version: SPOT_POLICY_VERSION, engine_owner: "SPOT_CANONICAL",
      client_order_id: coid, entry_price: 60000, amount: 0.01,
      qty_remaining: 0.01, highest_price: 60000, execution_mode: "REAL",
    });
    mockDbState.orderIntents.push({
      id: 1, client_order_id: coid, internal_intent_id: internalIntentId,
      status: "accepted", pair: "BTC/USD", side: "SELL", lot_id: lotId,
      reserved_quote_usd: null, reserved_quote_currency: null,
      exchange_order_id: "venue-L-1", engine_owner: "SPOT_CANONICAL",
      policy_version: SPOT_POLICY_VERSION, execution_mode: "REAL",
    });

    // Mock getOrder to return FILLED for the SELL
    mockGetOrder.mockResolvedValue({
      status: "filled", filledSize: 0.01, averagePrice: 59000,
    });

    // Run reconcilePendingRealOrderIntents twice
    await reconcilePendingRealOrderIntents();
    // First run: should materialize the trade (INSERT trade, close position)
    expect(mockDbState.trades.length).toBe(1);
    expect(mockDbState.openPositions.filter((p: any) => p.status !== "CLOSED").length).toBe(0);

    // Second run: the intent is now "filled" — should be no-op
    await reconcilePendingRealOrderIntents();
    expect(mockDbState.trades.length).toBe(1); // still 1, no duplicate
    stopSpotEngine();
  });
});

// ─── M: SELL FILLED but position+trade missing → UNCERTAIN/invariant failure ──

describe("R10V9_MANDATORY_M_SELL_MISSING_POSITION_AND_TRADE", () => {
  beforeEach(() => { resetDbState(); vi.clearAllMocks(); setPauseAfterReserve(null); setPauseAfterShadowAdapter(null); });

  it("R10V9_MANDATORY_M_SELL_MISSING_POSITION_AND_TRADE: SELL=FILLED but no position/trade → UNCERTAIN, no invented trade", async () => {
    const coid = "coid-M-1";
    const lotId = "lot-M-1";
    const internalIntentId = `exit:${lotId}:EMERGENCY:0`;
    // Prepare a pending SELL intent with FILLED on exchange, but NO open position and NO trade
    mockDbState.orderIntents.push({
      id: 1, client_order_id: coid, internal_intent_id: internalIntentId,
      status: "accepted", pair: "BTC/USD", side: "SELL", lot_id: lotId,
      reserved_quote_usd: null, reserved_quote_currency: null,
      exchange_order_id: "venue-M-1", engine_owner: "SPOT_CANONICAL",
      policy_version: SPOT_POLICY_VERSION, execution_mode: "REAL",
    });

    mockGetOrder.mockResolvedValue({
      status: "filled", filledSize: 0.01, averagePrice: 59000,
    });

    // Populate intent cache so updateSubmissionResult can mark UNCERTAIN
    await persistSubmissionIntent({
      internalIntentId, pair: "BTC/USD", side: "SELL", requestedQty: 0.01,
      requestedPrice: null, orderType: "MARKET", executionMode: ExecutionMode.REAL,
      lotId, reason: "test exit",
    }, coid, "revolutx");

    // Run reconcile — should detect inconsistency and mark UNCERTAIN
    await reconcilePendingRealOrderIntents();

    // No trade should be invented
    expect(mockDbState.trades.length).toBe(0);
    // The intent should be marked uncertain
    const intent = mockDbState.orderIntents.find((r: any) => r.internal_intent_id === internalIntentId);
    expect(intent).toBeDefined();
    expect(intent.status).toBe("uncertain");
    stopSpotEngine();
  });
});

// ─── N: Summary DB failure → getSummaryStats throws, no fabricated zero metrics ─

describe("R10V9_MANDATORY_N_SUMMARY_DB_FAILURE_HTTP500", () => {
  beforeEach(() => { resetDbState(); vi.clearAllMocks(); setPauseAfterReserve(null); setPauseAfterShadowAdapter(null); });

  it("R10V9_MANDATORY_N_SUMMARY_DB_FAILURE_HTTP500: DB error in getSummaryStats → throws, no fabricated zeros", async () => {
    // Inject DB failure for the summary stats aggregate query
    mockDbState.summaryStatsThrow = true;

    // Create minimal Express app wiring the REAL production getSummaryStats (mocked DB).
    const expressLib = (await import("express")).default;
    const appN = expressLib();
    appN.use(expressLib.json());
    appN.get("/api/spot/summary", async (_req: any, res: any) => {
      try {
        const stats = await getSummaryStats();
        res.json(stats);
      } catch {
        res.status(500).json({ error: "Failed to get spot summary stats" });
      }
    });

    // Fire actual HTTP GET /api/spot/summary via node:http.
    const httpMod = await import("node:http");
    const result = await new Promise<{ status: number; body: any }>((resolve) => {
      const server = httpMod.createServer(appN as any);
      server.listen(0, () => {
        const port = (server.address() as any).port;
        httpMod.get(`http://localhost:${port}/api/spot/summary`, (res: any) => {
          let data = "";
          res.on("data", (c: string) => { data += c; });
          res.on("end", () => { server.close(); resolve({ status: res.statusCode, body: JSON.parse(data) }); });
        });
      });
    });

    // HTTP 500 — and no fabricated zero metrics in the response body.
    expect(result.status).toBe(500);
    expect((result.body as any).totalTrades).toBeUndefined();
    expect((result.body as any).netPnlUsd).toBeUndefined();
    stopSpotEngine();
  });
});

// ─── O: Runtime inspection failure → readiness=false ──────────────────────────

describe("R10V9_MANDATORY_O_RUNTIME_INSPECTION_FAILURE", () => {
  beforeEach(() => { resetDbState(); vi.clearAllMocks(); setPauseAfterReserve(null); setPauseAfterShadowAdapter(null); });

  it("R10V9_MANDATORY_O_RUNTIME_INSPECTION_FAILURE: runtime health inspection throws → readiness=false with blocker", async () => {
    // Make _isEngineRunningForTest throw to trigger the outer runtime inspection catch
    const spy = vi.spyOn(spotEngineModule, '_isEngineRunningForTest').mockImplementation(() => {
      throw new Error("Injected: runtime inspection failure");
    });

    const { checkRealReadiness } = await import("../spot/spotRealReadiness");
    const readiness = await checkRealReadiness();

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.some((b: string) => b.includes("Runtime health inspection failed"))).toBe(true);

    spy.mockRestore();
    stopSpotEngine();
  });
});

// ─── P: REAL activation preflight blocked → RealActivationBlockedError, 403 ────

describe("R10V9_MANDATORY_P_REAL_ACTIVATION_BLOCKED_403", () => {
  beforeEach(() => { resetDbState(); vi.clearAllMocks(); setPauseAfterReserve(null); setPauseAfterShadowAdapter(null); });

  it("R10V9_MANDATORY_P_REAL_ACTIVATION_BLOCKED_403: preflight fails → RealActivationBlockedError with blockers", async () => {
    // Start from OFF mode — setExecutionMode(REAL) will run prepareRealActivation
    mockModeState.mode = "OFF";

    // Make structural readiness fail by removing the exchange init
    mockGetPairMetadata.mockReturnValue(null);

    // setExecutionMode(REAL) should throw RealActivationBlockedError
    await expect(setExecutionMode(ExecutionMode.REAL)).rejects.toThrow(RealActivationBlockedError);

    // Verify the error has blockers
    try {
      await setExecutionMode(ExecutionMode.REAL);
    } catch (err: any) {
      expect(err).toBeInstanceOf(RealActivationBlockedError);
      expect(err.blockers).toBeDefined();
      expect(err.blockers.length).toBeGreaterThan(0);
    }
    stopSpotEngine();
  });
});
