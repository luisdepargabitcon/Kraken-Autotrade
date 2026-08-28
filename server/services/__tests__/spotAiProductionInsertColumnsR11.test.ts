/**
 * spotAiProductionInsertColumnsR11.test.ts — R11-10 production INSERT contract.
 *
 * R11-10: Test the REAL INSERT query sent by the production repository.
 * Capture the SQL from db.execute and verify all WRITTEN_EXPLICITLY columns
 * are present. Not just the row object — the actual SQL.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));
vi.mock("../../db", () => ({
  db: { execute: mockExecute },
}));
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
  type DurableRepository,
  type DurableTradeRow,
  type DurableGivebackRow,
  type DurableInsertResult,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";
import type { CompletedTrade } from "../spotAiForwardTwin/spotAiCompletedTrades";
import type { SpotAiGivebackSample } from "../spotAiForwardTwin/spotAiForwardTwinTypes";

function makeTrade(): CompletedTrade {
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
  };
}

function makeGivebackSample(): SpotAiGivebackSample {
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
    labels: { future_MFE_R: 2.0 } as any,
    sourceForwardTwinSchemaVersion: 2,
    sourcePolicyVersion: "SPOT_POLICY_X",
  };
}

// Use the PRODUCTION repository (not injected) by ensuring setDurableRepository(null)
// and mocking db.execute to capture the INSERT SQL.

// WRITTEN_EXPLICITLY columns for training table (from migration 090 contract)
const TRAINING_WRITTEN_COLUMNS = [
  "feature_schema_version", "forward_twin_schema_version",
  "lot_id", "pair", "entry_scan_id",
  "entry_time", "exit_time", "entry_price", "exit_price",
  "stop_price", "risk_usd", "mfe", "mae", "mfe_r", "mae_r",
  "net_pnl_usd", "gross_pnl_usd",
  "entry_fee_usd", "total_entry_fee_usd", "entry_fee_allocated_usd", "exit_fee_usd",
  "executed_qty", "closed_qty", "residual_qty",
  "weighted_avg_exit_price", "weighted_avg_entry_price",
  "total_entry_volume", "total_exit_volume",
  "is_trainable",
  "exit_reason_type", "entry_features_json", "entry_labels_json",
  "policy_version", "dataset_fingerprint",
];

// WRITTEN_EXPLICITLY columns for giveback table
const GIVEBACK_WRITTEN_COLUMNS = [
  "feature_schema_version", "forward_twin_schema_version",
  "lot_id", "pair", "timestamp",
  "state_json", "labels_json", "has_label",
  "policy_version", "dataset_fingerprint",
];

/**
 * R12-06: Parse the exact column set from the INSERT INTO ... (...) clause
 * and compare as a Set. Not just substring contains — exact set equality.
 */
function parseInsertColumns(sql: string): Set<string> {
  // Match "INSERT INTO table (col1, col2, ...) VALUES"
  const match = sql.match(/INSERT\s+INTO\s+\w+\s*\(([^)]+)\)\s*VALUES/i);
  if (!match) throw new Error("Could not parse INSERT columns from SQL: " + sql.slice(0, 100));
  const cols = match[1].split(",").map((c) => c.trim()).filter((c) => c.length > 0);
  return new Set(cols);
}

describe("R12-06 PRODUCTION INSERT COLUMNS (exact set)", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    // Use production repository
    setDurableRepository(null);
    _resetDurableStorageCache();
  });

  // SQL_R12_PROD_ENTRY_COLUMNS: exact column set comparison
  it("SQL_R12_PROD_ENTRY_COLUMNS: production INSERT column set is exact", async () => {
    let capturedSql = "";
    mockExecute.mockImplementation((query: any) => {
      const sqlStr = String(query?.sql ?? query ?? "");
      if (sqlStr.includes("FROM spot_ai_forward_training_trades") && sqlStr.includes("LIMIT 0")) {
        return Promise.resolve({ rows: [] });
      }
      if (sqlStr.includes("FROM spot_ai_forward_giveback_samples") && sqlStr.includes("LIMIT 0")) {
        return Promise.resolve({ rows: [] });
      }
      if (sqlStr.includes("INSERT INTO spot_ai_forward_training_trades")) {
        capturedSql = sqlStr;
        return Promise.resolve({ rows: [{ lot_id: "lot-1" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const trade = makeTrade();
    await persistCompletedTrade(trade, { f: 1 }, { l: 1 }, "SPOT_POLICY_X");

    expect(capturedSql).toContain("INSERT INTO spot_ai_forward_training_trades");
    // R12-06: Parse exact column set from INSERT and compare as Set
    const actualCols = parseInsertColumns(capturedSql);
    const expectedCols = new Set(TRAINING_WRITTEN_COLUMNS);
    expect(actualCols).toEqual(expectedCols);
    // Verify no id or created_at
    expect(actualCols.has("id")).toBe(false);
    expect(actualCols.has("created_at")).toBe(false);
  });

  // SQL_R12_PROD_GIVEBACK_COLUMNS: exact column set comparison
  it("SQL_R12_PROD_GIVEBACK_COLUMNS: production INSERT column set is exact", async () => {
    let capturedSql = "";
    mockExecute.mockImplementation((query: any) => {
      const sqlStr = String(query?.sql ?? query ?? "");
      if (sqlStr.includes("FROM spot_ai_forward_training_trades") && sqlStr.includes("LIMIT 0")) {
        return Promise.resolve({ rows: [] });
      }
      if (sqlStr.includes("FROM spot_ai_forward_giveback_samples") && sqlStr.includes("LIMIT 0")) {
        return Promise.resolve({ rows: [] });
      }
      if (sqlStr.includes("INSERT INTO spot_ai_forward_giveback_samples")) {
        capturedSql = sqlStr;
        return Promise.resolve({ rows: [{ lot_id: "lot-1" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const sample = makeGivebackSample();
    await persistGivebackSamples([sample]);

    expect(capturedSql).toContain("INSERT INTO spot_ai_forward_giveback_samples");
    // R12-06: Parse exact column set from INSERT and compare as Set
    const actualCols = parseInsertColumns(capturedSql);
    const expectedCols = new Set(GIVEBACK_WRITTEN_COLUMNS);
    expect(actualCols).toEqual(expectedCols);
    // Verify no id or created_at
    expect(actualCols.has("id")).toBe(false);
    expect(actualCols.has("created_at")).toBe(false);
  });

  // Verify no duplicates in the column list
  it("SQL_R12_PROD_ENTRY_02: no duplicate columns in entry INSERT", async () => {
    let capturedSql = "";
    mockExecute.mockImplementation((query: any) => {
      const sqlStr = String(query?.sql ?? query ?? "");
      if (sqlStr.includes("LIMIT 0")) return Promise.resolve({ rows: [] });
      if (sqlStr.includes("INSERT INTO spot_ai_forward_training_trades")) {
        capturedSql = sqlStr;
        return Promise.resolve({ rows: [{ lot_id: "lot-1" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const trade = makeTrade();
    await persistCompletedTrade(trade, { f: 1 }, { l: 1 }, "SPOT_POLICY_X");

    const actualCols = parseInsertColumns(capturedSql);
    // No duplicates: Set size should match the raw split count
    const match = capturedSql.match(/INSERT\s+INTO\s+\w+\s*\(([^)]+)\)\s*VALUES/i);
    const rawCols = match![1].split(",").map((c) => c.trim()).filter((c) => c.length > 0);
    expect(actualCols.size).toBe(rawCols.length);
  });
});
