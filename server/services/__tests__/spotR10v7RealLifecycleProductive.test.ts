/**
 * R10.7 Tests — Real Lifecycle Productive: calls REAL production functions via
 * minimal test-only hooks (_..ForTest), with a transactional DB mock that
 * simulates ACID commit/rollback semantics (FOR UPDATE locks, aggregate updates).
 *
 * These tests exercise the ACTUAL fixed production code — no logic is
 * re-implemented in the test itself.
 *
 * Covers:
 *   A. Reservation release: REJECTED_BUY, CANCELLED_BUY, TERMINATE_TWICE, ALREADY_MATERIALIZED
 *   B. Balance/concurrency: two concurrent reservations, missing balance, non-USD quote currency
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── extractSql helper (drizzle sql`` template → sql text + bound params) ────

function extractSql(query: any): { sql: string; params: any[] } {
  if (typeof query === "string") return { sql: query, params: [] };
  if (query?.sql) return { sql: query.sql, params: [] };
  if (query?.queryChunks) {
    const params: any[] = [];
    const walk = (chunks: any[]): string => chunks.map((chunk: any) => {
      // StringChunk — literal SQL text
      if (chunk !== null && typeof chunk === "object" && chunk.value !== undefined) {
        return Array.isArray(chunk.value) ? chunk.value.join("") : chunk.value;
      }
      // Nested SQL object (e.g. from sql.raw()) — recurse and inline as literal text,
      // it must NOT be treated as a bound param.
      if (chunk !== null && typeof chunk === "object" && Array.isArray(chunk.queryChunks)) {
        return walk(chunk.queryChunks);
      }
      // Actual bound param value
      params.push(chunk);
      return "?";
    }).join("");
    const sqlText = walk(query.queryChunks);
    return { sql: sqlText, params };
  }
  return { sql: String(query), params: [] };
}

// ─── Hoisted mock DB state (ACID transaction simulation) ─────────────────────

const { mockDbState, dbExecuteMock, dbTransactionMock } = vi.hoisted(() => {
  const state = {
    botConfig: { spot_real_reserved_capital_usd: 0, trading_exchange: "revolutx" },
    orderIntents: [] as any[],
    openPositions: [] as any[],
  };

  const executeFn = vi.fn(async (query: any) => {
    const { sql: sqlText } = extractSql(query);
    if (sqlText.includes("trading_exchange") && sqlText.includes("api_config")) {
      return { rows: [{ trading_exchange: state.botConfig.trading_exchange }] };
    }
    return { rows: [] };
  });

  // Serialize transactions to simulate row-level FOR UPDATE locking
  let txQueue: Promise<any> = Promise.resolve();

  const transactionFn = vi.fn(async (callback: (tx: any) => Promise<any>) => {
    const run = txQueue.then(async () => {
      const snapshot = JSON.parse(JSON.stringify({
        botConfig: state.botConfig,
        orderIntents: state.orderIntents,
        openPositions: state.openPositions,
      }));

      const tx = {
        execute: async (query: any) => {
          const { sql: sqlText, params } = extractSql(query);

          // persistAndReserve: SELECT COALESCE(spot_real_reserved_capital_usd, 0) AS reserved FROM bot_config FOR UPDATE
          if (sqlText.includes("FOR UPDATE") && sqlText.includes("bot_config") && sqlText.includes("as reserved")) {
            return { rows: [{ reserved: String(state.botConfig.spot_real_reserved_capital_usd) }] };
          }
          // releaseReservationInTx: SELECT spot_real_reserved_capital_usd FROM bot_config FOR UPDATE
          if (sqlText.includes("FOR UPDATE") && sqlText.includes("bot_config")) {
            return { rows: [{ spot_real_reserved_capital_usd: String(state.botConfig.spot_real_reserved_capital_usd) }] };
          }

          // UPDATE bot_config SET spot_real_reserved_capital_usd
          if (sqlText.includes("UPDATE bot_config") && sqlText.includes("spot_real_reserved_capital_usd")) {
            const newReserved = params[0];
            state.botConfig.spot_real_reserved_capital_usd = Number(newReserved);
            return { rows: [] };
          }

          // INSERT INTO order_intents ... ON CONFLICT DO NOTHING RETURNING id, client_order_id
          // NOTE: the literal 'pending' status is embedded directly in the SQL text (not a
          // ${} interpolation), so it does NOT occupy a params[] slot — all params after it
          // are shifted down by one relative to the column list.
          if (sqlText.includes("INSERT INTO order_intents")) {
            const clientOrderId = params[0];
            const existing = state.orderIntents.find((r: any) => r.client_order_id === clientOrderId);
            if (existing) {
              return { rows: [] }; // ON CONFLICT DO NOTHING
            }
            const row = {
              id: state.orderIntents.length + 1,
              client_order_id: clientOrderId,
              exchange: params[1],
              pair: params[2],
              side: params[3],
              volume: params[4],
              status: "pending",
              internal_intent_id: params[5],
              engine_owner: params[6],
              policy_version: params[7],
              execution_mode: params[8],
              lot_id: params[9],
              requested_price: params[10],
              order_type: params[11],
              reason: params[12],
              reserved_quote_usd: params[13] != null ? Number(params[13]) : null,
              reserved_quote_currency: params[14] ?? null,
            };
            state.orderIntents.push(row);
            return { rows: [{ id: row.id, client_order_id: row.client_order_id }] };
          }

          // SELECT reserved_quote_usd FROM order_intents WHERE internal_intent_id/client_order_id = ? FOR UPDATE
          if (sqlText.includes("FOR UPDATE") && sqlText.includes("order_intents") && sqlText.includes("reserved_quote_usd")) {
            const identifier = params[0];
            const row = state.orderIntents.find((r: any) => r.internal_intent_id === identifier || r.client_order_id === identifier);
            return { rows: row ? [{ reserved_quote_usd: row.reserved_quote_usd }] : [] };
          }

          // SELECT id FROM order_intents WHERE internal_intent_id/client_order_id = ? FOR UPDATE
          if (sqlText.includes("FOR UPDATE") && sqlText.includes("order_intents")) {
            const identifier = params[0];
            const row = state.orderIntents.find((r: any) => r.internal_intent_id === identifier || r.client_order_id === identifier);
            return { rows: row ? [{ id: row.id }] : [] };
          }

          // UPDATE order_intents SET reserved_quote_usd = NULL, reserved_quote_currency = NULL WHERE ... = ?
          if (sqlText.includes("UPDATE order_intents") && sqlText.includes("reserved_quote_usd = NULL")) {
            const identifier = params[params.length - 1];
            const row = state.orderIntents.find((r: any) => r.internal_intent_id === identifier || r.client_order_id === identifier);
            if (row) {
              row.reserved_quote_usd = null;
              row.reserved_quote_currency = null;
            }
            return { rows: [] };
          }

          // UPDATE order_intents SET status = 'filled', ... WHERE client_order_id = ? (finalizeRealEntryFillAtomic)
          // status is a LITERAL in the SQL text here, not a bound param.
          if (sqlText.includes("UPDATE order_intents") && sqlText.includes("status = 'filled'")) {
            const identifier = params[params.length - 1];
            const row = state.orderIntents.find((r: any) => r.internal_intent_id === identifier || r.client_order_id === identifier);
            if (row) row.status = "filled";
            return { rows: row ? [{ id: row.id, reserved_quote_usd: row.reserved_quote_usd }] : [] };
          }

          // UPDATE order_intents SET status = ? WHERE internal_intent_id = ? (terminateIntentAndReleaseReservationAtomic)
          if (sqlText.includes("UPDATE order_intents") && sqlText.includes("status")) {
            const status = params[0];
            const identifier = params[params.length - 1];
            const row = state.orderIntents.find((r: any) => r.internal_intent_id === identifier || r.client_order_id === identifier);
            if (row) row.status = status;
            return { rows: row ? [{ id: row.id, reserved_quote_usd: row.reserved_quote_usd }] : [] };
          }

          // SELECT lot_id FROM open_positions WHERE client_order_id = ? AND status != 'CLOSED' FOR UPDATE
          if (sqlText.includes("FOR UPDATE") && sqlText.includes("open_positions") && sqlText.includes("client_order_id")) {
            const clientOrderId = params[0];
            const match = state.openPositions.find((p: any) => p.client_order_id === clientOrderId && p.status !== "CLOSED");
            return { rows: match ? [{ lot_id: match.lot_id }] : [] };
          }

          // INSERT INTO open_positions
          if (sqlText.includes("INSERT INTO open_positions")) {
            const row = { lot_id: params[0], client_order_id: state.orderIntents.length ? undefined : undefined, status: "OPEN" };
            state.openPositions.push(row);
            return { rows: [{ lot_id: row.lot_id }] };
          }

          return { rows: [] };
        },
      };

      try {
        const result = await callback(tx);
        return result;
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
  db: {
    execute: dbExecuteMock,
    transaction: dbTransactionMock,
  },
}));

vi.mock("../spot/spotActivityLogger", () => ({
  logActivity: vi.fn(() => ({})),
}));

import {
  _persistAndReserveRealEntryIntentAtomicForTest as persistAndReserve,
  _terminateIntentAndReleaseReservationAtomicForTest as terminateIntent,
  _finalizeRealEntryFillAtomicForTest as finalizeEntryFill,
} from "../spot/spotEngine";
import {
  ExecutionMode, SetupTag, Regime, RegimeDirection, MacroBias,
  type SpotPosition, type SpotExecutionResult,
} from "../spot/spotTypes";
import type { CreateSubmissionIntentParams } from "../spot/spotOrderIntentStore";

function resetDbState() {
  mockDbState.botConfig.spot_real_reserved_capital_usd = 0;
  mockDbState.orderIntents.length = 0;
  mockDbState.openPositions.length = 0;
}

function makeIntentParams(overrides: Partial<CreateSubmissionIntentParams> = {}): CreateSubmissionIntentParams {
  return {
    internalIntentId: "intent-1",
    pair: "BTC/USD",
    side: "BUY",
    requestedQty: 0.01,
    requestedPrice: null,
    orderType: "MARKET",
    executionMode: ExecutionMode.REAL,
    lotId: null,
    reason: "test entry",
    ...overrides,
  };
}

function makePosition(overrides: Partial<SpotPosition> = {}): SpotPosition {
  return {
    lotId: "lot-1", pair: "BTC/USD", amount: 0.01, qtyRemaining: 0.01,
    entryPrice: 60000, entryFee: 0, entryFeeQuality: "ESTIMATED" as any,
    highestPrice: 60000, openedAt: Date.now(),
    entryStrategyId: "SPOT_CANONICAL", entrySignalTf: "15m", signalConfidence: 0,
    signalReason: "test", setupTag: SetupTag.PULLBACK_CONTINUATION, signalId: "",
    marketContextId: "", regimeAtEntry: Regime.RANGE, directionAtEntry: RegimeDirection.NEUTRAL,
    macroAtEntry: MacroBias.NEUTRAL, atrPctAtEntry: 0, initialStopPrice: 0,
    initialStopDistancePct: 0, initialStopDistanceUsd: 0, riskUsd: 0, notionalUsd: 600,
    executionMode: ExecutionMode.REAL, policyVersion: "SPOT-1.0.0",
    sgBreakEvenActivated: false, sgTrailingActivated: false, sgScaleOutDone: false,
    sgCurrentStopPrice: 0, mfe: 0, mae: 0, mfeR: 0, maeR: 0,
    ...overrides,
  };
}

function makeExecResult(overrides: Partial<SpotExecutionResult> = {}): SpotExecutionResult {
  return {
    success: true, orderId: "venue-1", clientOrderId: "client-1", venueOrderId: "venue-1",
    fillPrice: 60000, fillVolume: 0.01, fillQuality: "ESTIMATED" as any,
    feeUsd: 0, slippageUsd: 0, error: null, pendingFill: false, executedAt: Date.now(),
    submissionState: "ACCEPTED",
    ...overrides,
  };
}

// ─── A. Reservation Release ───────────────────────────────────────────────────

describe("R10.7-A: Reservation release (REAL production functions)", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("A1: REJECTED_BUY — reserve 600, aggregate=600, terminate(FAILED) → released, aggregate=0", async () => {
    await persistAndReserve(
      makeIntentParams({ internalIntentId: "intent-a1" }),
      "client-a1", "revolutx", 600, 1000, "USD",
    );
    expect(mockDbState.botConfig.spot_real_reserved_capital_usd).toBe(600);
    const intentBefore = mockDbState.orderIntents.find((r: any) => r.internal_intent_id === "intent-a1");
    expect(Number(intentBefore.reserved_quote_usd)).toBe(600);

    await terminateIntent("intent-a1", "FAILED");

    const intentAfter = mockDbState.orderIntents.find((r: any) => r.internal_intent_id === "intent-a1");
    expect(intentAfter.reserved_quote_usd).toBeNull();
    expect(intentAfter.reserved_quote_currency).toBeNull();
    expect(intentAfter.status).toBe("failed");
    expect(mockDbState.botConfig.spot_real_reserved_capital_usd).toBe(0);
  });

  it("A2: CANCELLED_BUY — same lifecycle with CANCELLED", async () => {
    await persistAndReserve(
      makeIntentParams({ internalIntentId: "intent-a2" }),
      "client-a2", "revolutx", 600, 1000, "USD",
    );
    expect(mockDbState.botConfig.spot_real_reserved_capital_usd).toBe(600);

    await terminateIntent("intent-a2", "CANCELLED");

    const intentAfter = mockDbState.orderIntents.find((r: any) => r.internal_intent_id === "intent-a2");
    expect(intentAfter.reserved_quote_usd).toBeNull();
    expect(intentAfter.status).toBe("cancelled");
    expect(mockDbState.botConfig.spot_real_reserved_capital_usd).toBe(0);
  });

  it("A3: TERMINATE_TWICE — aggregate never goes negative on repeated termination", async () => {
    await persistAndReserve(
      makeIntentParams({ internalIntentId: "intent-a3" }),
      "client-a3", "revolutx", 600, 1000, "USD",
    );
    await terminateIntent("intent-a3", "FAILED");
    expect(mockDbState.botConfig.spot_real_reserved_capital_usd).toBe(0);

    // Second terminate call — reserved_quote_usd already NULL, must no-op (idempotent)
    await terminateIntent("intent-a3", "FAILED");
    expect(mockDbState.botConfig.spot_real_reserved_capital_usd).toBe(0);
    expect(mockDbState.botConfig.spot_real_reserved_capital_usd).toBeGreaterThanOrEqual(0);
  });

  it("A4: ALREADY_MATERIALIZED — position already exists, finalize releases reservation without duplicating", async () => {
    // Pre-seed: intent reserved 600, aggregate 600
    await persistAndReserve(
      makeIntentParams({ internalIntentId: "intent-a4" }),
      "client-a4", "revolutx", 600, 1000, "USD",
    );
    expect(mockDbState.botConfig.spot_real_reserved_capital_usd).toBe(600);

    // Pre-seed: open_position already exists for this clientOrderId (simulates a prior partial run)
    mockDbState.openPositions.push({ lot_id: "lot-a4", client_order_id: "client-a4", status: "OPEN" });

    const position = makePosition({ lotId: "lot-a4" });
    const execResult = makeExecResult({ clientOrderId: "client-a4" });

    await finalizeEntryFill(position, execResult, 600, "intent-a4", "client-a4");

    // Position count unchanged (no duplicate insert)
    expect(mockDbState.openPositions.length).toBe(1);
    // Intent marked filled
    const intentAfter = mockDbState.orderIntents.find((r: any) => r.internal_intent_id === "intent-a4");
    expect(intentAfter.status).toBe("filled");
    // R10.7-2: Reservation MUST be released even on the already-materialized path
    expect(intentAfter.reserved_quote_usd).toBeNull();
    expect(mockDbState.botConfig.spot_real_reserved_capital_usd).toBe(0);
  });
});

// ─── B. Balance / Concurrency ─────────────────────────────────────────────────

describe("R10.7-B: Balance and concurrency (REAL production functions)", () => {
  beforeEach(() => {
    resetDbState();
    vi.clearAllMocks();
  });

  it("B1: concurrent reservations — USD balance=1000, two 700 reservations race, only one succeeds, aggregate<=1000", async () => {
    const results = await Promise.allSettled([
      persistAndReserve(
        makeIntentParams({ internalIntentId: "intent-btc", pair: "BTC/USD" }),
        "client-btc", "revolutx", 700, 1000, "USD",
      ),
      persistAndReserve(
        makeIntentParams({ internalIntentId: "intent-eth", pair: "ETH/USD" }),
        "client-eth", "revolutx", 700, 1000, "USD",
      ),
    ]);

    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(mockDbState.botConfig.spot_real_reserved_capital_usd).toBeLessThanOrEqual(1000);
  });

  it("B2: missing balance (grossQuoteBalance=0) — reservation throws, nothing persisted", async () => {
    await expect(
      persistAndReserve(
        makeIntentParams({ internalIntentId: "intent-b2" }),
        "client-b2", "revolutx", 600, 0, "USD",
      )
    ).rejects.toThrow();

    expect(mockDbState.orderIntents.find((r: any) => r.internal_intent_id === "intent-b2")).toBeUndefined();
    expect(mockDbState.botConfig.spot_real_reserved_capital_usd).toBe(0);
  });

  it("B3: non-USD quote currency — reservation throws before touching DB (fail-closed)", async () => {
    await expect(
      persistAndReserve(
        makeIntentParams({ internalIntentId: "intent-b3" }),
        "client-b3", "revolutx", 600, 1000, "EUR",
      )
    ).rejects.toThrow(/USD/);

    expect(mockDbState.orderIntents.find((r: any) => r.internal_intent_id === "intent-b3")).toBeUndefined();
    expect(mockDbState.botConfig.spot_real_reserved_capital_usd).toBe(0);
  });

  it("B4: invalid grossQuoteBalance (NaN) — reservation throws (mandatory validation)", async () => {
    await expect(
      persistAndReserve(
        makeIntentParams({ internalIntentId: "intent-b4" }),
        "client-b4", "revolutx", 600, NaN, "USD",
      )
    ).rejects.toThrow();
  });
});
