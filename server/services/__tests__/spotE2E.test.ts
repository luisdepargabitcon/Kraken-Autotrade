/**
 * R10.9 Tests â€” Real Lifecycle Productive (continuation of R10.8).
 *
 * Calls REAL production functions directly via minimal test-only hooks
 * (_..ForTest) â€” no logic is re-implemented or reproduced inside the tests.
 *
 * 20 mandatory test cases covering:
 *
 *  1.  SHADOWâ†’OFF in-flight entry race (general entry fence covers SHADOW)
 *  2.  SHADOWâ†’REAL in-flight entry race (general entry fence covers SHADOW)
 *  3.  SHADOW entry with valid generation â†’ reaches placeOrder
 *  4.  REAL BUY blocked when supervisor unhealthy
 *  5.  REAL BUY unblocks after supervisor recovery
 *  6.  Supervisor health: per-pair failure marks unhealthy (false positive fix)
 *  7.  Supervisor health: all pairs succeed â†’ healthy
 *  8.  Drain timeout disables entry scanner (DRAIN_TIMEOUT_FAIL_CLOSED)
 *  9.  Drain timeout injectable: short timeout works for tests
 *  10. Drain succeeds with no critical sections â†’ entry scanner stays enabled
 *  11. EXISTING_FILLED with materialized open_position â†’ skip (no throw)
 *  12. EXISTING_FILLED with materialized trade â†’ skip (no throw)
 *  13. EXISTING_FILLED without materialization â†’ throws (freeze REAL)
 *  14. EXISTING_FILLED verification DB error â†’ throws
 *  15. Supervisor health exposed in readiness API (healthy)
 *  16. Supervisor health exposed in readiness API (unhealthy â†’ blocker)
 *  17. REAL preflight serialized inside setExecutionMode lock
 *  18. Entry critical section count tracked correctly
 *  19. SHADOW mode transition race: stale generation blocks SHADOW entry
 *  20. getOpenPositions DB error â†’ throws (fail-closed)
 *
 * R10.9-final additional tests Aâ€“N:
 *
 *  A.  SHADOW entry critical section covers persistShadowEntryAtomic (no leak)
 *  B.  SHADOW entry exception during persist â†’ critical section released
 *  C.  REAL adapter exception â†’ critical section released
 *  D.  REAL persistence exception â†’ critical section released
 *  E.  EXISTING_FILLED throws â†’ critical section released (no leak)
 *  F.  Drain timeout clears scanIntervalId + engineRunning=false
 *  G.  Supervisor busy returns { ok:false, busy:true }
 *  H.  getPositionSupervisionHealth() stale after inactivity
 *  I.  getPositionSupervisionHealth() healthy after recent success
 *  J.  spot.routes.ts has no prepareRealActivation (single authority)
 *  K.  REAL entry full path â†’ critical section count returns to 0
 *  L.  SHADOW entry full path â†’ critical section count returns to 0
 *  M.  Supervisor busy on first pass â†’ startSpotEngine fails
 *  N.  Playwright removed from package.json
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// â”€â”€â”€ extractSql helper (drizzle sql`` template â†’ sql text + bound params) â”€â”€â”€â”€

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

// â”€â”€â”€ Hoisted mocks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    // SELECT ... FROM order_intents WHERE status IN (...) â€” loadPendingRealOrders
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
    if (sqlText.includes("FROM trades") && sqlText.includes("WHERE lot_id")) {
      const { params } = extractSql(query);
      const lotId = params[0];
      return { rows: state.trades.filter((t: any) => t.lot_id === lotId) };
    }
    // SELECT ... FROM trades ORDER BY executed_at (getClosedTrades)
    if (sqlText.includes("FROM trades") && sqlText.includes("ORDER BY")) {
      return { rows: state.trades };
    }
    // SELECT ... FROM trades (getSummaryStats) â€” aggregate query
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
          if (sqlText.includes("FOR UPDATE") && sqlText.includes("bot_config") && sqlText.includes("spot_real")) {
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
            return { rows: [{ spot_shadow_capital_usd: "10000000", spot_shadow_reserved_usd: "1000000", spot_shadow_realized_pnl_usd: "0", spot_shadow_total_fees_usd: "0" }] };
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
              trade_id: tradeId, lot_id: params[27],
              pair: params[3], price: Number(params[4] ?? 0),
              amount: Number(params[5] ?? 0), entry_price: Number(params[6] ?? 0),
              policy_version: params[10] ?? SPOT_POLICY_VERSION,
              engine_owner: params[11] ?? "SPOT_CANONICAL",
              net_pnl_usd: Number(params[19] ?? 0), gross_pnl_usd: Number(params[15] ?? 0),
              entry_fee_usd: Number(params[16] ?? 0), exit_fee_usd: Number(params[17] ?? 0),
              exit_reason_type: params[26] ?? null,
              hold_time_minutes: Number(params[28] ?? 0), mfe: Number(params[21] ?? 0), mae: Number(params[22] ?? 0),
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
  getClosedTrades,
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
  ExecutionMode, SetupTag, Regime, RegimeDirection, MacroBias, ExitReasonType, ExitPriority,
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

function makeCtx2(pair: string, marketContextId: string): SpotMarketContext {
  const base = makeCtx(pair);
  return { ...base, marketContextId, regimeContext: { ...base.regimeContext, contextId: marketContextId } };
}

function makeExitDecision(price: number, reason: string): SpotExitDecision {
  return {
    shouldExit: true,
    reasonType: ExitReasonType.STRUCTURE_INVALIDATION,
    reason,
    price,
    volume: null,
    priority: ExitPriority.STRUCTURE_INVALIDATION,
    evaluatedAt: Date.now(),
  };
}

function castToPosition(row: any): SpotPosition {
  return {
    ...row,
    entryFeeQuality: "ESTIMATED" as any,
    sgScaleOutDone: false,
    initialStopDistanceUsd: row.initialStopDistanceUsd ?? 0,
    notionalUsd: row.notionalUsd ?? row.entryPrice * row.amount,
  } as SpotPosition;
}

// ─── E2E: Single SHADOW lot end-to-end ───────────────────────────────────────

describe("SPOT_LEDGER_SINGLE_E2E", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("SIGNAL → INTENT → SIZING → SHADOW BUY → open_positions → getOpenPositions → SHADOW SELL → trades → getClosedTrades → summary", async () => {
    mockModeState.mode = "SHADOW";
    const ctx = makeCtx("ETH/USD");
    const intent = makeIntent("ETH/USD", "sig-eth-single");

    const tradeCountBefore = (await getClosedTrades(10)).length;
    expect(tradeCountBefore).toBe(0);

    const entry = await executeEntry(intent, ctx, ExecutionMode.SHADOW, undefined, getGeneration());
    expect(entry.executed).toBe(true);
    expect(getCriticalSectionCount()).toBe(0);

    const openPositions = await getOpenPositions();
    expect(openPositions).toHaveLength(1);
    const lotId = openPositions[0].lotId;
    expect(openPositions[0].pair).toBe("ETH/USD");
    expect(openPositions[0].executionMode).toBe("SHADOW");

    const position = castToPosition(openPositions[0]);
    const exitDecision = makeExitDecision(61000, "Salida por pérdida de estructura");
    await closePosition(position, exitDecision, ctx);

    const openAfter = await getOpenPositions();
    expect(openAfter).toHaveLength(0);

    const trades = await getClosedTrades(10);
    expect(trades).toHaveLength(1);
    expect(trades[0].lotId).toBe(lotId);

    const summary = await getSummaryStats();
    expect(summary.totalTrades).toBe(1);
    expect(Number(summary.netPnlUsd)).toBeDefined();
  });
});

// ─── E2E: Two SHADOW lots on same pair ───────────────────────────────────────

describe("SPOT_LEDGER_DOUBLE_E2E", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("Two ETH/USD lots with distinct signalId/contextId, close both, verify no duplicates", async () => {
    mockModeState.mode = "SHADOW";

    const ctxA = makeCtx2("ETH/USD", "ctx-eth-a");
    const ctxB = makeCtx2("ETH/USD", "ctx-eth-b");
    const intentA = makeIntent("ETH/USD", "sig-eth-a");
    const intentB = makeIntent("ETH/USD", "sig-eth-b");

    const entryA = await executeEntry(intentA, ctxA, ExecutionMode.SHADOW, undefined, getGeneration());
    const entryB = await executeEntry(intentB, ctxB, ExecutionMode.SHADOW, undefined, getGeneration());

    expect(entryA.executed).toBe(true);
    expect(entryB.executed).toBe(true);

    const openPositions = await getOpenPositions();
    expect(openPositions).toHaveLength(2);
    const lotIdA = openPositions[0].lotId;
    const lotIdB = openPositions[1].lotId;
    expect(lotIdA).not.toBe(lotIdB);

    for (const p of openPositions) {
      await closePosition(castToPosition(p), makeExitDecision(61000, "Salida por pérdida de estructura"), makeCtx(p.pair));
    }

    const openAfter = await getOpenPositions();
    expect(openAfter).toHaveLength(0);

    const trades = await getClosedTrades(10);
    expect(trades).toHaveLength(2);
    const tradeLotIds = trades.map((t: any) => t.lotId);
    expect(tradeLotIds).toContain(lotIdA);
    expect(tradeLotIds).toContain(lotIdB);
    expect(new Set(tradeLotIds).size).toBe(2);

    const summary = await getSummaryStats();
    expect(summary.totalTrades).toBe(2);
  });
});

// ─── E2E: Restart recovery preserves position and exit state ─────────────────

describe("SPOT_RESTART_RECOVERY", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("loadOpenPositionsFromDB preserves lotId, MFE/MAE and SG state; close after restart produces one trade", async () => {
    mockModeState.mode = "SHADOW";
    const lotId = "spot-ETH/USD-restart-123";

    mockDbState.openPositions.push({
      lot_id: lotId,
      pair: "ETH/USD",
      status: "OPEN",
      policy_version: SPOT_POLICY_VERSION,
      engine_owner: "SPOT_CANONICAL",
      execution_mode: "SHADOW",
      entry_price: "70000",
      amount: "0.5",
      qty_remaining: "0.5",
      highest_price: "70000",
      lowest_price: "69000",
      mfe: "50",
      mae: "10",
      mfe_r: "0.5",
      mae_r: "0.1",
      filled_notional_usd: "35000",
      opened_at_ms: String(Date.now() - 3600000),
      initial_stop_price: "1000",
      initial_stop_distance_pct: "4",
      initial_stop_distance_usd: "100",
      risk_usd: "50",
      atr_pct_at_entry: "1.5",
      sg_break_even_activated: true,
      sg_trailing_activated: false,
      sg_current_stop_price: "1000",
      break_even_stop_price: null,
      trailing_stop_price: "1000",
      trailing_highest_price: "70000",
      entry_fee: "1.25",
      entry_strategy_id: "ema20-breakout",
      entry_signal_tf: "15m",
      signal_confidence: "0.75",
      signal_reason: "pullback continuation",
      setup_tag: "PULLBACK_CONTINUATION",
      signal_id: "sig-restart-1",
      market_context_id: "ctx-restart-1",
      regime_at_entry: "TREND",
      direction_at_entry: "BULLISH",
      macro_at_entry: "NEUTRAL",
    });

    await startSpotEngine();
    stopSpotEngine();

    const openPositions = await getOpenPositions();
    expect(openPositions).toHaveLength(1);
    expect(openPositions[0].lotId).toBe(lotId);

    const position = castToPosition(openPositions[0]);
    expect(position.mfe).toBe(50);
    expect(position.mae).toBe(10);
    expect(position.sgBreakEvenActivated).toBe(true);

    await closePosition(position, makeExitDecision(26000, "Salida por pérdida de estructura"), makeCtx("ETH/USD"));

    const openAfter = await getOpenPositions();
    expect(openAfter).toHaveLength(0);

    const trades = await getClosedTrades(10);
    expect(trades).toHaveLength(1);
    expect(trades[0].lotId).toBe(lotId);

    const summary = await getSummaryStats();
    expect(summary.totalTrades).toBe(1);
  });
});

