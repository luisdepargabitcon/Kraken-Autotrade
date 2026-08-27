/**
 * spotAiSqlContractR7.test.ts — R7 SQL contract tests.
 *
 * Verifies that the production repository adapter maps all migration 090
 * columns correctly. Tests the ACTUAL production insertTrade/insertGiveback
 * SQL by intercepting db.execute and inspecting the SQL string.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to intercept the db.execute calls to inspect the SQL.
// The production repository is created at module load time, so we need to
// mock the db module before importing the store.

// Track all execute calls
let executeCalls: { sql: string; params: any[] }[] = [];

// Mock the db module
vi.mock("../../db", () => ({
  db: {
    execute: vi.fn((query: any) => {
      // Extract the SQL string from the query object
      const sqlStr = typeof query === "string" ? query : (query?.sql ?? String(query));
      executeCalls.push({ sql: sqlStr, params: [] });
      // Return empty rows for SELECT, empty for INSERT (conflict → no RETURNING)
      if (sqlStr.includes("INSERT")) {
        // Simulate successful insert with RETURNING
        return Promise.resolve({ rows: [{ lot_id: "lot-1" }] });
      }
      return Promise.resolve({ rows: [] });
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: any[]) => {
    // Reconstruct a string representation for inspection
    const sqlStr = strings.join("${...}");
    return { sql: sqlStr, strings, values };
  },
}));

import {
  buildDurableEntryPayload,
  buildDurableGivebackPayload,
  setDurableRepository,
  _resetDurableStorageCache,
  persistCompletedTrade,
  persistGivebackSamples,
  type DurableTradeRow,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";
import type { CompletedTrade } from "../spotAiForwardTwin/spotAiCompletedTrades";
import type { SpotAiGivebackSample } from "../spotAiForwardTwin/spotAiForwardTwinTypes";

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

describe("R7 SQL CONTRACT tests — migration 090 ↔ writer", () => {
  beforeEach(() => {
    executeCalls = [];
    // Reset to production repository (which uses the mocked db)
    setDurableRepository(null);
    _resetDurableStorageCache();
  });

  afterEach(() => {
    setDurableRepository(null);
    _resetDurableStorageCache();
  });

  // DURABLE_R7_SQL_01: writer maps all economic columns
  it("DURABLE_R7_SQL_01: buildDurableEntryPayload maps all required columns", () => {
    const trade = makeTrade();
    const features = { f: 1 };
    const labels = { l: 1 };
    const r = buildDurableEntryPayload(trade, features, labels, "SPOT_POLICY_X");
    expect(r.ok).toBe(true);
    const row = (r as any).row;

    // Verify all migration 090 economic columns are present in the row
    expect(row.entryFeeUsd).toBeDefined();
    expect(row.totalEntryFeeUsd).toBeDefined();
    expect(row.entryFeeAllocatedUsd).toBeDefined();
    expect(row.exitFeeUsd).toBeDefined();
    expect(row.closedQty).toBeDefined();
    expect(row.residualQty).toBeDefined();
    expect(row.weightedAvgEntryPrice).toBeDefined();
    expect(row.weightedAvgExitPrice).toBeDefined();
    expect(row.totalEntryVolume).toBeDefined();
    expect(row.totalExitVolume).toBeDefined();

    // R7: entryFeeUsd === entryFeeAllocatedUsd
    expect(row.entryFeeUsd).toBe(row.entryFeeAllocatedUsd);
    // R7: residualQty = max(0, totalEntryVolume - closedQty)
    expect(row.residualQty).toBe(Math.max(0, row.totalEntryVolume - row.closedQty));
  });

  // DURABLE_R7_SQL_02: residualQty is real for partial close
  it("DURABLE_R7_SQL_02: residualQty is real for partial close", () => {
    const trade = makeTrade({
      totalEntryVolume: 2,
      closedQty: 1,
      totalExitVolume: 1,
    });
    const r = buildDurableEntryPayload(trade, { f: 1 }, { l: 1 }, "SPOT_POLICY_X");
    expect(r.ok).toBe(true);
    const row = (r as any).row;
    expect(row.residualQty).toBe(1); // 2 - 1 = 1
  });

  // DURABLE_R7_SQL_03: residualQty is 0 for exact close
  it("DURABLE_R7_SQL_03: residualQty is 0 for exact close", () => {
    const trade = makeTrade({
      totalEntryVolume: 1,
      closedQty: 1,
      totalExitVolume: 1,
    });
    const r = buildDurableEntryPayload(trade, { f: 1 }, { l: 1 }, "SPOT_POLICY_X");
    expect(r.ok).toBe(true);
    const row = (r as any).row;
    expect(row.residualQty).toBe(0);
  });

  // DURABLE_R7_SQL_04: entryFeeUsd is the allocated portion, not total
  it("DURABLE_R7_SQL_04: entryFeeUsd equals entryFeeAllocatedUsd, not totalEntryFeeUsd", () => {
    const trade = makeTrade({
      totalEntryVolume: 2,
      closedQty: 1,
      totalEntryFeeUsd: 2,
      entryFeeAllocatedUsd: 1, // 2 * (1/2) = 1
    });
    const r = buildDurableEntryPayload(trade, { f: 1 }, { l: 1 }, "SPOT_POLICY_X");
    expect(r.ok).toBe(true);
    const row = (r as any).row;
    expect(row.entryFeeUsd).toBe(1); // allocated
    expect(row.entryFeeAllocatedUsd).toBe(1);
    expect(row.totalEntryFeeUsd).toBe(2); // total
    expect(row.entryFeeUsd).not.toBe(row.totalEntryFeeUsd);
  });

  // DURABLE_R7_SQL_05: persistCompletedTrade calls insertTrade with all columns
  it("DURABLE_R7_SQL_05: persistCompletedTrade sends INSERT with all economic columns", async () => {
    // We need the mocked db to return available=true for isAvailable check
    const { db } = await import("../../db");
    (db.execute as any).mockImplementation((query: any) => {
      const sqlStr = typeof query === "string" ? query : (query?.sql ?? String(query));
      executeCalls.push({ sql: sqlStr, params: [] });
      if (sqlStr.includes("SELECT 1 FROM spot_ai_forward_training_trades")) {
        return Promise.resolve({ rows: [{ "?column?": 1 }] });
      }
      if (sqlStr.includes("INSERT INTO spot_ai_forward_training_trades")) {
        return Promise.resolve({ rows: [{ lot_id: "lot-1" }] });
      }
      if (sqlStr.includes("SELECT dataset_fingerprint")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const trade = makeTrade();
    const features = { f: 1 };
    const labels = { l: 1 };
    await persistCompletedTrade(trade, features, labels, "SPOT_POLICY_X");

    // Find the INSERT call
    const insertCall = executeCalls.find((c) => c.sql.includes("INSERT INTO spot_ai_forward_training_trades"));
    expect(insertCall).toBeDefined();
    // Verify key column names appear in the SQL
    expect(insertCall!.sql).toContain("entry_fee_usd");
    expect(insertCall!.sql).toContain("total_entry_fee_usd");
    expect(insertCall!.sql).toContain("entry_fee_allocated_usd");
    expect(insertCall!.sql).toContain("exit_fee_usd");
    expect(insertCall!.sql).toContain("closed_qty");
    expect(insertCall!.sql).toContain("residual_qty");
    expect(insertCall!.sql).toContain("weighted_avg_entry_price");
    expect(insertCall!.sql).toContain("weighted_avg_exit_price");
    expect(insertCall!.sql).toContain("total_entry_volume");
    expect(insertCall!.sql).toContain("total_exit_volume");
    expect(insertCall!.sql).toContain("policy_version");
    expect(insertCall!.sql).toContain("dataset_fingerprint");
    expect(insertCall!.sql).toContain("ON CONFLICT");
    expect(insertCall!.sql).toContain("RETURNING");
  });

  // DURABLE_R7_SQL_06: giveback INSERT includes all columns
  it("DURABLE_R7_SQL_06: persistGivebackSamples sends INSERT with all giveback columns", async () => {
    const { db } = await import("../../db");
    (db.execute as any).mockImplementation((query: any) => {
      const sqlStr = typeof query === "string" ? query : (query?.sql ?? String(query));
      executeCalls.push({ sql: sqlStr, params: [] });
      if (sqlStr.includes("SELECT 1 FROM spot_ai_forward_training_trades")) {
        return Promise.resolve({ rows: [{ "?column?": 1 }] });
      }
      if (sqlStr.includes("INSERT INTO spot_ai_forward_giveback_samples")) {
        return Promise.resolve({ rows: [{ lot_id: "lot-1" }] });
      }
      if (sqlStr.includes("SELECT dataset_fingerprint")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const sample: SpotAiGivebackSample = {
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
      labels: { future_MFE_R: 2.0 } as any,
      sourceForwardTwinSchemaVersion: 2,
      sourcePolicyVersion: "SPOT_POLICY_X",
    };

    await persistGivebackSamples([sample]);

    const insertCall = executeCalls.find((c) => c.sql.includes("INSERT INTO spot_ai_forward_giveback_samples"));
    expect(insertCall).toBeDefined();
    expect(insertCall!.sql).toContain("forward_twin_schema_version");
    expect(insertCall!.sql).toContain("policy_version");
    expect(insertCall!.sql).toContain("dataset_fingerprint");
    expect(insertCall!.sql).toContain("ON CONFLICT");
    expect(insertCall!.sql).toContain("RETURNING");
  });
});
