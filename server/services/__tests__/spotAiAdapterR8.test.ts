/**
 * spotAiAdapterR8.test.ts — R8 PRODUCTION ADAPTER tests.
 *
 * R8-08: Test the production repository adapter via mock db.execute.
 * The adapter must distinguish:
 * - INSERT ... RETURNING [] + SELECT same fingerprint → IDEMPOTENT_NOOP
 * - INSERT ... RETURNING [] + SELECT different fingerprint → FINGERPRINT_CONFLICT
 * - INSERT ... RETURNING [] + SELECT no row → INSERT_FAILED
 *
 * Repeated for both trade and giveback.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock db with a controllable execute function.
// Use vi.hoisted to avoid hoisting issues with vi.mock.
const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));
vi.mock("../../db", () => ({
  db: { execute: mockExecute },
}));

// Mock drizzle-orm to produce inspectable SQL strings.
vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: any[]) => {
    const sqlStr = strings.reduce((acc, str, i) => {
      if (i > 0) acc += `__PARAM_${i}__`;
      return acc + str;
    }, "");
    return { sql: sqlStr, strings, values };
  },
}));

import {
  setDurableRepository,
  _resetDurableStorageCache,
  persistCompletedTrade,
  persistGivebackSamples,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";
import type { CompletedTrade } from "../spotAiForwardTwin/spotAiCompletedTrades";
import type { SpotAiGivebackSample } from "../spotAiForwardTwin/spotAiForwardTwinTypes";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTrade(overrides: Partial<CompletedTrade> = {}): CompletedTrade {
  return {
    lotId: "lot-1", pair: "BTC/USD", entryScanId: "scan-1",
    entryTime: 1000, exitTime: 2000,
    entryPrice: 100, exitPrice: 110,
    initialStopPrice: 95, initialRiskUsd: 10,
    weightedAverageExitPrice: 110, weightedAverageEntryPrice: 100,
    totalEntryVolume: 1, totalExitVolume: 1, closedQty: 1,
    totalEntryFeeUsd: 1, entryFeeAllocatedUsd: 1, totalExitFeeUsd: 1,
    entryFeeUsd: 1, exitFeeUsd: 1,
    grossPnlUsd: 10, netPnlUsd: 8,
    mfe: 10, mae: -5, mfeR: 1, maeR: -0.5,
    exitReasonType: "TARGET",
    ...overrides,
  };
}

function makeGivebackSample(overrides: Partial<SpotAiGivebackSample> = {}): SpotAiGivebackSample {
  return {
    sampleId: "gb-1",
    split: "train",
    groupId: "lot-1",
    state: {
      lotId: "lot-1", pair: "BTC/USD", timestamp: 1000,
      entryPrice: 100, currentR: 1.5,
      runningMfeR: 1, runningMaeR: -0.5,
      mfeUsd: 10, maeUsd: -5, minutesInTrade: 30,
      breakEvenActivated: false, trailingActivated: false,
      currentStopPrice: 95, highestPrice: 110,
      currentRUnavailable: false,
    } as any,
    labels: { future_MFE_R: 2.0, future_MAE_R: -0.5 } as any,
    sourceForwardTwinSchemaVersion: 2,
    sourcePolicyVersion: "SPOT_POLICY_X",
    ...overrides,
  };
}

/**
 * Configure the mock db to simulate the production adapter behavior.
 * - isAvailable: SELECT 1 FROM spot_ai_forward_training_trades → returns a row
 * - INSERT ... ON CONFLICT DO NOTHING RETURNING → [] (no row inserted)
 * - SELECT dataset_fingerprint → returns the given fingerprint (or no row)
 */
function setupMockDb(existingFingerprint: string | null) {
  mockExecute.mockImplementation((query: any) => {
    const sqlStr = String(query?.sql ?? query ?? "");
    // isAvailable check
    if (sqlStr.includes("SELECT 1 FROM spot_ai_forward_training_trades")) {
      return Promise.resolve({ rows: [{ "?column?": 1 }] });
    }
    if (sqlStr.includes("SELECT 1 FROM spot_ai_forward_giveback_samples")) {
      return Promise.resolve({ rows: [{ "?column?": 1 }] });
    }
    if (sqlStr.includes("INSERT")) {
      // INSERT ... ON CONFLICT DO NOTHING RETURNING → no row (conflict)
      return Promise.resolve({ rows: [] });
    }
    if (sqlStr.includes("dataset_fingerprint")) {
      // SELECT dataset_fingerprint
      if (existingFingerprint === null) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [{ dataset_fingerprint: existingFingerprint }] });
    }
    if (sqlStr.includes("COUNT")) {
      return Promise.resolve({ rows: [{ count: "0", cnt: "0" }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe("R8 PRODUCTION ADAPTER tests — DO NOTHING conflict path", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    // Reset to production adapter (uses db.execute)
    setDurableRepository(null);
    _resetDurableStorageCache();
  });

  // ADAPTER_R8_01: trade — same fingerprint → IDEMPOTENT_NOOP
  it("ADAPTER_R8_01: trade — same fingerprint → IDEMPOTENT_NOOP", async () => {
    // We need to know what fingerprint the writer will compute.
    // First, do a successful insert to get the fingerprint.
    setupMockDb(null); // No existing row → INSERT succeeds
    // Actually, with RETURNING [] and no existing row, the adapter should
    // return INSERT_ERROR (no row returned, no existing fingerprint).
    // Let's test the IDEMPOTENT path: INSERT returns [], SELECT returns same FP.
    // We need to compute the fingerprint first. Let's use a fake repo to get it.
    //
    // Actually, the production adapter's insertTrade does:
    // 1. INSERT ... ON CONFLICT DO NOTHING RETURNING *
    // 2. If RETURNING has a row → INSERTED
    // 3. If RETURNING is empty → SELECT dataset_fingerprint
    //    a. If SELECT returns same FP → IDEMPOTENT_EXISTING
    //    b. If SELECT returns different FP → FINGERPRINT_CONFLICT
    //    c. If SELECT returns no row → INSERT_ERROR
    //
    // To test this, we need to know the computed fingerprint.
    // We can get it by doing a successful insert first with a fake repo.
    // But that's complex. Instead, let's test with a known fingerprint
    // by making the SELECT return a fingerprint that matches.
    //
    // The easiest way: do the insert with a fake repo first to get the FP,
    // then test the production adapter with that FP.

    // Step 1: Get the fingerprint using a fake repo
    const { setDurableRepository: setRepo } = await import("../spotAiForwardTwin/spotAiDurableTrainingStore");
    const fakeRepo = {
      trades: new Map(),
      async isAvailable() { return true; },
      async getExistingTradeFingerprint() { return null; },
      async insertTrade(row: any) { this.trades.set(`${row.lotId}|${row.pair}`, row); return "INSERTED"; },
      async getStoredTradeCount() { return 0; },
      async getTrainableTradeCount() { return 0; },
      async getAllTradeKeys() { return []; },
      async getExistingGivebackFingerprint() { return null; },
      async insertGiveback() { return "INSERTED"; },
      async getAllGivebackKeys() { return []; },
    };
    setRepo(fakeRepo as any);
    _resetDurableStorageCache();
    const result = await persistCompletedTrade(
      makeTrade(), { f: 1 }, { l: 1 }, "SPOT_POLICY_X",
    );
    expect(result.persisted).toBe(true);
    const computedFp = fakeRepo.trades.get("lot-1|BTC/USD")?.datasetFingerprint;
    expect(computedFp).toBeDefined();

    // Step 2: Test production adapter — INSERT returns [], SELECT returns same FP
    setDurableRepository(null);
    _resetDurableStorageCache();
    setupMockDb(computedFp!);

    const result2 = await persistCompletedTrade(
      makeTrade(), { f: 1 }, { l: 1 }, "SPOT_POLICY_X",
    );
    expect(result2.persisted).toBe(false);
    expect(result2.reason).toBe("IDEMPOTENT_NOOP");
  });

  // ADAPTER_R8_02: trade — different fingerprint → FINGERPRINT_CONFLICT
  it("ADAPTER_R8_02: trade — different fingerprint → FINGERPRINT_CONFLICT", async () => {
    setupMockDb("DIFFERENT_FINGERPRINT_VALUE");
    const result = await persistCompletedTrade(
      makeTrade(), { f: 1 }, { l: 1 }, "SPOT_POLICY_X",
    );
    expect(result.persisted).toBe(false);
    expect(result.reason).toBe("FINGERPRINT_CONFLICT");
  });

  // ADAPTER_R8_03: trade — INSERT returns [], SELECT no row → INSERT_FAILED
  it("ADAPTER_R8_03: trade — INSERT returns [], SELECT no row → INSERT_FAILED", async () => {
    setupMockDb(null);
    const result = await persistCompletedTrade(
      makeTrade(), { f: 1 }, { l: 1 }, "SPOT_POLICY_X",
    );
    expect(result.persisted).toBe(false);
    expect(result.reason).toBe("INSERT_FAILED");
  });

  // ADAPTER_R8_04: giveback — same fingerprint → IDEMPOTENT
  it("ADAPTER_R8_04: giveback — same fingerprint → IDEMPOTENT", async () => {
    // Get the giveback fingerprint using a fake repo
    const { setDurableRepository: setRepo } = await import("../spotAiForwardTwin/spotAiDurableTrainingStore");
    const fakeRepo = {
      givebacks: new Map(),
      async isAvailable() { return true; },
      async getExistingTradeFingerprint() { return null; },
      async insertTrade() { return "INSERTED"; },
      async getStoredTradeCount() { return 0; },
      async getTrainableTradeCount() { return 0; },
      async getAllTradeKeys() { return []; },
      async getExistingGivebackFingerprint() { return null; },
      async insertGiveback(row: any) { this.givebacks.set(`${row.lotId}|${row.timestamp}`, row); return "INSERTED"; },
      async getAllGivebackKeys() { return []; },
    };
    setRepo(fakeRepo as any);
    _resetDurableStorageCache();
    const sample = makeGivebackSample();
    const r1 = await persistGivebackSamples([sample]);
    expect(r1.persisted).toBe(1);
    const computedFp = fakeRepo.givebacks.get("lot-1|1000")?.datasetFingerprint;
    expect(computedFp).toBeDefined();

    // Test production adapter
    setDurableRepository(null);
    _resetDurableStorageCache();
    setupMockDb(computedFp!);

    const r2 = await persistGivebackSamples([sample]);
    expect(r2.persisted).toBe(0);
    expect(r2.idempotent).toBe(1);
  });

  // ADAPTER_R8_05: giveback — different fingerprint → FINGERPRINT_CONFLICT
  it("ADAPTER_R8_05: giveback — different fingerprint → FINGERPRINT_CONFLICT", async () => {
    setupMockDb("DIFFERENT_GIVEBACK_FP");
    const sample = makeGivebackSample();
    const r = await persistGivebackSamples([sample]);
    expect(r.persisted).toBe(0);
    expect(r.conflicts).toBe(1);
  });

  // ADAPTER_R8_06: giveback — INSERT returns [], SELECT no row → INSERT_ERROR
  it("ADAPTER_R8_06: giveback — INSERT returns [], SELECT no row → INSERT_ERROR", async () => {
    setupMockDb(null);
    const sample = makeGivebackSample();
    const r = await persistGivebackSamples([sample]);
    expect(r.persisted).toBe(0);
    expect(r.insertErrors).toBe(1);
  });
});
