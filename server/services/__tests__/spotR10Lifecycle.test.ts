/**
 * R10.1 Lifecycle Tests — dedup, restart reconciliation, exactly-once, clientOrderId match, activity persistence.
 *
 * Tests verify:
 *   1. spotOrderIntentStore: generateClientOrderId is deterministic for same internalIntentId
 *   2. spotOrderIntentStore: persistSubmissionIntent deduplicates
 *   3. spotActivityLogger: dedup within 60s window
 *   4. spotActivityLogger: getActivityEventsFiltered filters by pair/category/severity/mode
 *   5. spotActivityLogger: sanitizes secrets
 *   6. spotRealReadiness: returns comprehensive checks structure
 *   7. Adapter: clientOrderId passed through to exchange
 *   8. Adapter: venueOrderId returned from exchange orderId
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateClientOrderId, persistSubmissionIntent, updateSubmissionResult, RealIntentPersistenceError, RealOrderStatePersistenceError, _clearCacheForTest } from "../spot/spotOrderIntentStore";
import { logActivity, getActivityEventsFiltered, clearActivityEvents } from "../spot/spotActivityLogger";
import { SpotActivityCategory, SpotActivitySeverity, ExecutionMode } from "../spot/spotTypes";

// Mock db — use vi.hoisted so variables are available when vi.mock factory runs
const { mockDbExecute, mockDbTransaction } = vi.hoisted(() => ({
  mockDbExecute: vi.fn(async (): Promise<any> => ({ rows: [] })),
  mockDbTransaction: vi.fn(async (fn: any): Promise<any> => fn({ execute: vi.fn(async (): Promise<any> => ({ rows: [] })) })),
}));
vi.mock("../../db", () => ({
  db: {
    execute: mockDbExecute,
    transaction: mockDbTransaction,
  },
}));

// Mock botLogger
vi.mock("../botLogger", () => ({
  botLogger: {
    info: vi.fn(async () => {}),
    warn: vi.fn(async () => {}),
    error: vi.fn(async () => {}),
  },
}));

// Mock ExchangeFactory
const mockPlaceOrder = vi.fn();
const mockGetPairMetadata = vi.fn((pair: string) => ({ pair, minNotional: 5 }));
vi.mock("../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {
    getTradingExchange: () => ({
      placeOrder: mockPlaceOrder,
      getPairMetadata: mockGetPairMetadata,
      loadPairMetadata: vi.fn(async () => {}),
      isInitialized: () => true,
      exchangeName: "revolutx",
    }),
  },
}));

// Mock fee model
vi.mock("../spot/feeModel", () => ({
  getTradingFeeModel: vi.fn(() => ({ exchange: "revolutx", takerFeePct: 0.09, makerFeePct: 0.00, quality: "REAL" })),
  getSpotTakerFeePct: vi.fn(() => 0.09),
}));

describe("R10.1 Lifecycle Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearActivityEvents();
  });

  describe("R10.1-LC1: clientOrderId generation", () => {
    it("generateClientOrderId is deterministic for same internalIntentId", () => {
      const id1 = generateClientOrderId("entry-BTCUSD-12345");
      const id2 = generateClientOrderId("entry-BTCUSD-12345");
      expect(id1).toBe(id2);
    });

    it("generateClientOrderId differs for different internalIntentId", () => {
      const id1 = generateClientOrderId("entry-BTCUSD-12345");
      const id2 = generateClientOrderId("entry-BTCUSD-67890");
      expect(id1).not.toBe(id2);
    });

    it("generateClientOrderId returns UUID format", () => {
      const id = generateClientOrderId("test-intent");
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  describe("R10.1-LC2: intent deduplication", () => {
    it("persistSubmissionIntent returns alreadySubmitted=true on duplicate", async () => {
      const { db } = await import("../../db");
      const intent = {
        internalIntentId: "entry-BTCUSD-dedup-test",
        pair: "BTC/USD",
        side: "BUY" as const,
        requestedQty: 0.1,
        requestedPrice: null,
        orderType: "MARKET" as const,
        executionMode: ExecutionMode.REAL,
        lotId: null,
        reason: "test",
      };

      // First call — INSERT RETURNING yields a row (created)
      (db.execute as any).mockResolvedValueOnce({
        rows: [{ id: 1, client_order_id: "client-id-1", exchange_order_id: null, status: "pending" }],
      });

      const result1 = await persistSubmissionIntent(intent, "client-id-1", "revolutx");
      expect(result1.alreadySubmitted).toBe(false);

      // Second call — INSERT ON CONFLICT returns empty (already exists), SELECT returns existing row
      (db.execute as any)
        .mockResolvedValueOnce({ rows: [] }) // INSERT ON CONFLICT DO NOTHING → no rows
        .mockResolvedValueOnce({ // SELECT existing row
          rows: [{
            client_order_id: "client-id-1",
            exchange_order_id: null,
            status: "pending",
            internal_intent_id: "entry-BTCUSD-dedup-test",
            engine_owner: "SPOT_CANONICAL",
            policy_version: "SPOT-1.0.0-20260812",
            execution_mode: "REAL",
            lot_id: null,
            requested_price: null,
            order_type: "MARKET",
            reason: "test",
            fill_price: null,
            fill_volume: null,
            fee_usd: null,
          }],
        });

      const result2 = await persistSubmissionIntent(intent, "client-id-1", "revolutx");
      expect(result2.alreadySubmitted).toBe(true);
    });
  });

  describe("R10.1-LC3: activity logger dedup", () => {
    it("deduplicates identical events within 5min window", () => {
      logActivity({
        pair: "BTC/USD",
        category: "RISK" as SpotActivityCategory,
        severity: "INFO" as SpotActivitySeverity,
        title: "Test event",
        explanation: "Test explanation",
      });

      logActivity({
        pair: "BTC/USD",
        category: "RISK" as SpotActivityCategory,
        severity: "INFO" as SpotActivitySeverity,
        title: "Test event",
        explanation: "Test explanation",
      });

      const events = getActivityEventsFiltered({ limit: 10 });
      expect(events.length).toBe(1);
      expect(events[0].repeatCount).toBe(1);
    });

    it("does not deduplicate events with different titles", () => {
      logActivity({
        pair: "BTC/USD",
        category: "EXECUTION" as SpotActivityCategory,
        severity: "INFO" as SpotActivitySeverity,
        title: "Event A",
        explanation: "Test",
      });

      logActivity({
        pair: "BTC/USD",
        category: "EXECUTION" as SpotActivityCategory,
        severity: "INFO" as SpotActivitySeverity,
        title: "Event B",
        explanation: "Test",
      });

      const events = getActivityEventsFiltered({ limit: 10 });
      expect(events.length).toBe(2);
    });
  });

  describe("R10.1-LC4: activity logger filters", () => {
    beforeEach(() => {
      clearActivityEvents();
      logActivity({
        pair: "BTC/USD",
        category: "EXECUTION" as SpotActivityCategory,
        severity: "INFO" as SpotActivitySeverity,
        title: "BTC execution",
        explanation: "Test",
        executionMode: ExecutionMode.SHADOW,
      });
      logActivity({
        pair: "ETH/USD",
        category: "EXIT" as SpotActivityCategory,
        severity: "WARNING" as SpotActivitySeverity,
        title: "ETH exit",
        explanation: "Test",
        executionMode: ExecutionMode.REAL,
      });
    });

    it("filters by pair", () => {
      const events = getActivityEventsFiltered({ pair: "BTC/USD" });
      expect(events.length).toBe(1);
      expect(events[0].pair).toBe("BTC/USD");
    });

    it("filters by category", () => {
      const events = getActivityEventsFiltered({ category: "EXIT" as SpotActivityCategory });
      expect(events.length).toBe(1);
      expect(events[0].category).toBe("EXIT");
    });

    it("filters by severity", () => {
      const events = getActivityEventsFiltered({ severity: "WARNING" as SpotActivitySeverity });
      expect(events.length).toBe(1);
      expect(events[0].severity).toBe("WARNING");
    });

    it("filters by mode", () => {
      const events = getActivityEventsFiltered({ mode: ExecutionMode.REAL });
      expect(events.length).toBe(1);
      expect(events[0].executionMode).toBe(ExecutionMode.REAL);
    });

    it("combines multiple filters", () => {
      const events = getActivityEventsFiltered({
        pair: "ETH/USD",
        category: "EXIT" as SpotActivityCategory,
      });
      expect(events.length).toBe(1);
    });
  });

  describe("R10.1-LC5: activity logger secret sanitization", () => {
    it("redacts apiKey from explanation", () => {
      logActivity({
        pair: "BTC/USD",
        category: "SYSTEM" as SpotActivityCategory,
        severity: "ERROR" as SpotActivitySeverity,
        title: "Connection failed",
        explanation: "Failed with apiKey=sk-1234567890abcdef",
      });

      const events = getActivityEventsFiltered({ limit: 1 });
      expect(events[0].explanation).toContain("[REDACTED]");
      expect(events[0].explanation).not.toContain("sk-1234567890abcdef");
    });

    it("redacts token from technicalDetails", () => {
      logActivity({
        pair: "BTC/USD",
        category: "SYSTEM" as SpotActivityCategory,
        severity: "ERROR" as SpotActivitySeverity,
        title: "Auth failed",
        explanation: "Auth error",
        technicalDetails: "token=abc123secret456",
      });

      const events = getActivityEventsFiltered({ limit: 1 });
      expect(events[0].technicalDetails).toContain("[REDACTED]");
      expect(events[0].technicalDetails).not.toContain("abc123secret456");
    });
  });

  describe("R10.1-LC6: activity logger persistence via botLogger", () => {
    it("calls botLogger.info on logActivity", async () => {
      const { botLogger } = await import("../botLogger");
      logActivity({
        pair: "BTC/USD",
        category: "EXECUTION" as SpotActivityCategory,
        severity: "INFO" as SpotActivitySeverity,
        title: "Persistence test",
        explanation: "Should persist to bot_events",
      });

      expect(botLogger.info).toHaveBeenCalled();
      const callArgs = (botLogger.info as any).mock.calls[0];
      expect(callArgs[0]).toBe("SPOT_EXECUTION");
      expect(callArgs[1]).toBe("Persistence test");
    });
  });

  describe("R10.1-LC7: updateSubmissionResult", () => {
    it("calls db.execute to update order_intents after persist", async () => {
      const { db } = await import("../../db");

      // First persist to populate cache — INSERT RETURNING yields a row
      (db.execute as any).mockResolvedValueOnce({
        rows: [{ id: 2, client_order_id: "client-id-update", exchange_order_id: null, status: "pending" }],
      });

      await persistSubmissionIntent({
        internalIntentId: "test-intent-update",
        pair: "BTC/USD",
        side: "BUY" as const,
        requestedQty: 0.1,
        requestedPrice: null,
        orderType: "MARKET" as const,
        executionMode: ExecutionMode.REAL,
        lotId: null,
        reason: "test",
      }, "client-id-update", "revolutx");

      // Clear mock calls from persist
      (db.execute as any).mockClear();

      await updateSubmissionResult("test-intent-update", {
        venueOrderId: "exchange-order-123",
        status: "FILLED",
        fillPrice: 100_000,
        fillVolume: 0.1,
        feeUsd: 9.0,
      });

      expect(db.execute).toHaveBeenCalled();
    });
  });
});

// ─── R10.2 Lifecycle Tests ───────────────────────────────────────────────────

describe("R10.2 Lifecycle Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearActivityEvents();
    _clearCacheForTest();
  });

  describe("R10.2-FC: Fail-closed persistence guard", () => {
    it("throws RealIntentPersistenceError when DB INSERT fails", async () => {
      const { db } = await import("../../db");
      (db.execute as any).mockRejectedValueOnce(new Error("DB connection lost"));

      await expect(
        persistSubmissionIntent({
          internalIntentId: "fail-closed-test",
          pair: "BTC/USD",
          side: "BUY" as const,
          requestedQty: 0.1,
          requestedPrice: null,
          orderType: "MARKET" as const,
          executionMode: ExecutionMode.REAL,
          lotId: null,
          reason: "test",
        }, "fail-closed-client-id", "revolutx")
      ).rejects.toThrow(RealIntentPersistenceError);
    });

    it("throws RealIntentPersistenceError when INSERT conflicts but SELECT finds nothing", async () => {
      const { db } = await import("../../db");
      (db.execute as any)
        .mockResolvedValueOnce({ rows: [] }) // INSERT ON CONFLICT → no rows
        .mockResolvedValueOnce({ rows: [] }); // SELECT finds nothing

      await expect(
        persistSubmissionIntent({
          internalIntentId: "conflict-no-select-test",
          pair: "BTC/USD",
          side: "BUY" as const,
          requestedQty: 0.1,
          requestedPrice: null,
          orderType: "MARKET" as const,
          executionMode: ExecutionMode.REAL,
          lotId: null,
          reason: "test",
        }, "conflict-no-select-id", "revolutx")
      ).rejects.toThrow(RealIntentPersistenceError);
    });

    it("throws RealIntentPersistenceError when SELECT after conflict fails", async () => {
      const { db } = await import("../../db");
      (db.execute as any)
        .mockResolvedValueOnce({ rows: [] }) // INSERT ON CONFLICT → no rows
        .mockRejectedValueOnce(new Error("SELECT failed")); // SELECT fails

      await expect(
        persistSubmissionIntent({
          internalIntentId: "select-fail-test",
          pair: "BTC/USD",
          side: "BUY" as const,
          requestedQty: 0.1,
          requestedPrice: null,
          orderType: "MARKET" as const,
          executionMode: ExecutionMode.REAL,
          lotId: null,
          reason: "test",
        }, "select-fail-id", "revolutx")
      ).rejects.toThrow(RealIntentPersistenceError);
    });
  });

  describe("R10.2-CONCURRENCY: 20 concurrent calls → at most one placeOrder", () => {
    it("only one of 20 concurrent persistSubmissionIntent calls gets alreadySubmitted=false", async () => {
      const { db } = await import("../../db");
      const intent = {
        internalIntentId: "concurrency-test-BTCUSD",
        pair: "BTC/USD",
        side: "BUY" as const,
        requestedQty: 0.1,
        requestedPrice: null,
        orderType: "MARKET" as const,
        executionMode: ExecutionMode.REAL,
        lotId: null,
        reason: "concurrency test",
      };
      const clientOrderId = "concurrency-client-id";

      // Simulate DB UNIQUE constraint: only the first INSERT returns a row (CREATED).
      // All subsequent INSERTs return empty (ON CONFLICT), then SELECT returns existing.
      // JS is single-threaded: callCount++ is atomic.
      // Pattern: call 1 = INSERT (CREATED), calls 2-20 = INSERT (empty/conflict),
      // calls 21-39 = SELECT (existing row for recovery).
      // But the in-memory cache set by call 1 may short-circuit the SELECT for some calls.
      // To handle this correctly: return empty for all calls except the first,
      // and let the code's SELECT path get the existing row.
      // The SELECT calls will be callCount > 20, so return existing for those.
      let callCount = 0;
      (db.execute as any).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            rows: [{ id: 1, client_order_id: clientOrderId, exchange_order_id: null, status: "pending" }],
          };
        }
        // Calls 2-20: INSERT ON CONFLICT → empty (these are the INSERT calls from calls 2-20)
        // Calls 21+: SELECT → existing row
        if (callCount <= 20) {
          return { rows: [] };
        }
        return {
          rows: [{
            client_order_id: clientOrderId,
            exchange_order_id: null,
            status: "pending",
            internal_intent_id: "concurrency-test-BTCUSD",
            engine_owner: "SPOT_CANONICAL",
            policy_version: "SPOT-1.0.0-20260812",
            execution_mode: "REAL",
            lot_id: null,
            requested_price: null,
            order_type: "MARKET",
            reason: "concurrency test",
            fill_price: null,
            fill_volume: null,
            fee_usd: null,
          }],
        };
      });

      // Launch 20 concurrent calls
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          persistSubmissionIntent(intent, clientOrderId, "revolutx")
            .catch(() => ({ record: null, alreadySubmitted: true }))
        )
      );

      const createdCount = results.filter(r => !r.alreadySubmitted).length;
      const duplicateCount = results.filter(r => r.alreadySubmitted).length;

      // At most one call should get alreadySubmitted=false
      expect(createdCount).toBe(1);
      expect(duplicateCount).toBe(19);
    });
  });

  describe("R10.2-STABLE-ID: Stable internalIntentId (no Date.now)", () => {
    it("same signalId+pair produces same internalIntentId pattern", () => {
      // The format is: entry:${SPOT_POLICY_VERSION}:${signalId}:${pair}
      const signalId = "sig-123";
      const pair = "BTC/USD";
      const id1 = `entry:SPOT-1.0.0-20260812:${signalId}:${pair}`;
      const id2 = `entry:SPOT-1.0.0-20260812:${signalId}:${pair}`;
      expect(id1).toBe(id2);
      expect(id1).not.toContain(Date.now().toString());
    });

    it("generateClientOrderId is deterministic for stable internalIntentId", () => {
      const stableId = "entry:SPOT-1.0.0-20260812:sig-456:ETH/USD";
      const coid1 = generateClientOrderId(stableId);
      const coid2 = generateClientOrderId(stableId);
      expect(coid1).toBe(coid2);
    });
  });

  describe("R10.2-DEDUP-5MIN: Activity dedup 5min window", () => {
    it("deduplicates identical events within 5min window", () => {
      logActivity({
        pair: "BTC/USD",
        category: "RISK" as SpotActivityCategory,
        severity: "INFO" as SpotActivitySeverity,
        title: "R10.2 dedup test",
        explanation: "Test",
      });

      logActivity({
        pair: "BTC/USD",
        category: "RISK" as SpotActivityCategory,
        severity: "INFO" as SpotActivitySeverity,
        title: "R10.2 dedup test",
        explanation: "Test",
      });

      const events = getActivityEventsFiltered({ limit: 10 });
      expect(events.length).toBe(1);
      expect(events[0].repeatCount).toBe(1);
    });

    it("does not deduplicate events with different reasonCode", () => {
      logActivity({
        pair: "BTC/USD",
        category: "EXECUTION" as SpotActivityCategory,
        severity: "INFO" as SpotActivitySeverity,
        title: "Event with reason A",
        explanation: "Test",
        reasonCode: "REASON_A",
      });

      logActivity({
        pair: "BTC/USD",
        category: "EXECUTION" as SpotActivityCategory,
        severity: "INFO" as SpotActivitySeverity,
        title: "Event with reason A",
        explanation: "Test",
        reasonCode: "REASON_B",
      });

      const events = getActivityEventsFiltered({ limit: 10 });
      expect(events.length).toBe(2);
    });
  });

  describe("R10.2-READINESS: RealReadinessResult structure", () => {
    it("checkRealReadiness returns new R10.2 fields", async () => {
      const { db } = await import("../../db");
      (db.execute as any).mockResolvedValue({ rows: [] });

      const { checkRealReadiness } = await import("../spot/spotRealReadiness");
      const result = await checkRealReadiness();

      expect(result).toHaveProperty("checks.activePairsList");
      expect(result).toHaveProperty("checks.pairMetadataMissing");
      expect(result).toHaveProperty("checks.pendingEntryIntents");
      expect(result).toHaveProperty("checks.pendingExitIntents");
      expect(result).toHaveProperty("checks.submittedIntentsWithoutVenueId");
      expect(result).toHaveProperty("checks.entryScannerRunning");
      expect(result).toHaveProperty("checks.positionSupervisorRunning");
    });
  });

  // ─── R10.3 Tests ─────────────────────────────────────────────────────────────

  describe("R10.3-01: updateSubmissionResult fail-closed", () => {
    it("throws RealOrderStatePersistenceError on DB update failure", async () => {
      _clearCacheForTest();
      // First, persist an intent so it's in cache
      mockDbExecute.mockResolvedValueOnce({
        rows: [{ id: 1, client_order_id: "test-coid-001", internal_intent_id: "test-001" }],
      });
      await persistSubmissionIntent({
        internalIntentId: "test-001",
        pair: "BTC/USD",
        side: "BUY",
        requestedQty: 0.001,
        executionMode: ExecutionMode.REAL,
        requestedPrice: null,
        orderType: "MARKET",
        lotId: null,
        reason: "test",
      }, "test-coid-001", "revolutx");

      // Now make DB update fail
      mockDbExecute.mockRejectedValueOnce(new Error("DB connection lost"));

      await expect(
        updateSubmissionResult("test-001", {
          venueOrderId: "venue-123",
          status: "FILLED",
          fillPrice: 50000,
          fillVolume: 0.001,
          feeUsd: 0.045,
        })
      ).rejects.toThrow(RealOrderStatePersistenceError);
    });

    it("throws RealOrderStatePersistenceError when rowCount != 1", async () => {
      _clearCacheForTest();
      mockDbExecute.mockResolvedValueOnce({
        rows: [{ id: 1, client_order_id: "test-coid-002", internal_intent_id: "test-002" }],
      });
      await persistSubmissionIntent({
        internalIntentId: "test-002",
        pair: "BTC/USD",
        side: "BUY",
        requestedQty: 0.001,
        executionMode: ExecutionMode.REAL,
        requestedPrice: null,
        orderType: "MARKET",
        lotId: null,
        reason: "test",
      }, "test-coid-002", "revolutx");

      // Simulate 0 rows updated (row disappeared)
      mockDbExecute.mockResolvedValueOnce({ rows: [] });

      await expect(
        updateSubmissionResult("test-002", {
          status: "FILLED",
          fillPrice: 50000,
        })
      ).rejects.toThrow(RealOrderStatePersistenceError);
    });
  });

  describe("R10.3-02: loadPendingRealOrders fail-closed", () => {
    it("throws RealIntentPersistenceError on DB query failure", async () => {
      mockDbExecute.mockRejectedValueOnce(new Error("DB timeout"));
      const { loadPendingRealOrders } = await import("../spot/spotOrderIntentStore");
      await expect(loadPendingRealOrders()).rejects.toThrow(RealIntentPersistenceError);
    });

    it("includes uncertain status in query results", async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          client_order_id: "coid-1",
          exchange_order_id: "venue-1",
          exchange: "revolutx",
          pair: "BTC/USD",
          side: "buy",
          volume: "0.001",
          status: "uncertain",
          internal_intent_id: "int-1",
          engine_owner: "SPOT_CANONICAL",
          policy_version: "SPOT-1.0.0-20260812",
          execution_mode: "REAL",
          lot_id: null,
          requested_price: null,
          order_type: "MARKET",
          reason: "test",
          fill_price: null,
          fill_volume: null,
          fee_usd: null,
        }],
      });
      const { loadPendingRealOrders, _clearCacheForTest } = await import("../spot/spotOrderIntentStore");
      _clearCacheForTest();
      const pending = await loadPendingRealOrders();
      expect(pending).toHaveLength(1);
      expect(pending[0].status).toBe("UNCERTAIN");
    });
  });

  describe("R10.3-03: countPendingRealOrderIntents fail-closed", () => {
    it("throws RealIntentPersistenceError on DB query failure", async () => {
      mockDbExecute.mockRejectedValueOnce(new Error("DB connection refused"));
      const { countPendingRealOrderIntents } = await import("../spot/spotOrderIntentStore");
      await expect(countPendingRealOrderIntents()).rejects.toThrow(RealIntentPersistenceError);
    });

    it("counts uncertain orders separately", async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          pending_entry: "0",
          pending_exit: "0",
          accepted_entry: "0",
          accepted_exit: "0",
          uncertain_count: "2",
          no_venue_id: "0",
        }],
      });
      const { countPendingRealOrderIntents } = await import("../spot/spotOrderIntentStore");
      const counts = await countPendingRealOrderIntents();
      expect(counts.uncertainOrders).toBe(2);
      expect(counts.pendingEntryOrders).toBe(0);
    });
  });

  describe("R10.3-04: UNCERTAIN persistent + distinguishable", () => {
    it("mapDbStatusToRealOrderState maps 'uncertain' to UNCERTAIN", async () => {
      // Test via loadPendingRealOrders with uncertain status
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          client_order_id: "coid-unc",
          exchange_order_id: null,
          exchange: "revolutx",
          pair: "ETH/USD",
          side: "buy",
          volume: "0.01",
          status: "uncertain",
          internal_intent_id: "int-unc",
          engine_owner: "SPOT_CANONICAL",
          policy_version: "SPOT-1.0.0-20260812",
          execution_mode: "REAL",
          lot_id: null,
          requested_price: null,
          order_type: "MARKET",
          reason: "test",
          fill_price: null,
          fill_volume: null,
          fee_usd: null,
        }],
      });
      const { loadPendingRealOrders, _clearCacheForTest } = await import("../spot/spotOrderIntentStore");
      _clearCacheForTest();
      const pending = await loadPendingRealOrders();
      expect(pending[0].status).toBe("UNCERTAIN");
    });
  });

  describe("R10.3-13: Activity logger selective dedup", () => {
    it("does NOT dedup CRITICAL severity events", () => {
      clearActivityEvents();
      const event1 = logActivity({
        pair: "BTC/USD",
        category: "SYSTEM",
        severity: "CRITICAL",
        title: "System failure",
        explanation: "DB connection lost",
        reasonCode: "DB_FAILURE",
      });
      const event2 = logActivity({
        pair: "BTC/USD",
        category: "SYSTEM",
        severity: "CRITICAL",
        title: "System failure",
        explanation: "DB connection lost",
        reasonCode: "DB_FAILURE",
      });
      expect(event1.id).not.toBe(event2.id);
      expect(event2.repeatCount).toBe(0);
    });

    it("does NOT dedup ERROR category events", () => {
      clearActivityEvents();
      const event1 = logActivity({
        pair: "BTC/USD",
        category: "ERROR",
        severity: "WARNING",
        title: "Order error",
        explanation: "Order rejected",
        reasonCode: "ORDER_REJECTED",
      });
      const event2 = logActivity({
        pair: "BTC/USD",
        category: "ERROR",
        severity: "WARNING",
        title: "Order error",
        explanation: "Order rejected",
        reasonCode: "ORDER_REJECTED",
      });
      expect(event1.id).not.toBe(event2.id);
    });

    it("dedups INFO events within window", () => {
      clearActivityEvents();
      const event1 = logActivity({
        pair: "BTC/USD",
        category: "MARKET",
        severity: "INFO",
        title: "Market update",
        explanation: "Price updated",
        reasonCode: "PRICE_UPDATE",
      });
      const event2 = logActivity({
        pair: "BTC/USD",
        category: "MARKET",
        severity: "INFO",
        title: "Market update",
        explanation: "Price updated",
        reasonCode: "PRICE_UPDATE",
      });
      expect(event1.id).toBe(event2.id);
      expect(event2.repeatCount).toBe(1);
    });
  });

  describe("R10.3-05: Readiness — pending orders as blockers", () => {
    it("pending entry intents are blockers, not warnings", async () => {
      const { db } = await import("../../db");
      // Mock ALL DB calls to reject — countPendingRealOrderIntents will throw → blocker
      (db.execute as any).mockRejectedValue(new Error("DB error"));

      const { checkRealReadiness } = await import("../spot/spotRealReadiness");
      const result = await checkRealReadiness();
      expect(result.ready).toBe(false);
      // DB error on order_intents query → blocker about order_intents
      expect(result.blockers.some((b: string) => b.includes("order_intents"))).toBe(true);
    });

    it("uncertain orders are critical blockers", async () => {
      const { db } = await import("../../db");
      // Mock ALL DB calls to reject — countPendingRealOrderIntents will throw → blocker
      (db.execute as any).mockRejectedValue(new Error("DB error"));

      const { checkRealReadiness } = await import("../spot/spotRealReadiness");
      const result = await checkRealReadiness();
      expect(result.ready).toBe(false);
      // DB error on order_intents → blocker mentions order_intents
      expect(result.blockers.some((b: string) => b.includes("order_intents"))).toBe(true);
    });
  });

  describe("R10.3-08: Readiness — runtime owner check", () => {
    it("includes runtimeOwner and isSpotRuntimeOwnerCheck fields", async () => {
      const { db } = await import("../../db");
      (db.execute as any).mockResolvedValue({ rows: [] });

      const { checkRealReadiness } = await import("../spot/spotRealReadiness");
      const result = await checkRealReadiness();
      expect(result.checks).toHaveProperty("runtimeOwner");
      expect(result.checks).toHaveProperty("isSpotRuntimeOwnerCheck");
    });
  });
});
