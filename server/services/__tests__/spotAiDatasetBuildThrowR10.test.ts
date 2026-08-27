/**
 * spotAiDatasetBuildThrowR10.test.ts — R10-01 real dataset build throw.
 *
 * R10-01: RECON_R9_03 did not provoke a real throw. This test uses the
 * injectable DurableDatasetBuilder boundary to make buildDataset throw
 * for real, and verifies DATASET_BUILD_FAILED is reported.
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
  _resetReconciliationMetrics,
  _resetReconciliationRunning,
  _setDurableDatasetBuilder,
  backfillDurableFromRaw,
  type DurableRepository,
  type DurableTradeRow,
  type DurableGivebackRow,
  type DurableInsertResult,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";

class CapturingRepo implements DurableRepository {
  async isAvailable() { return true; }
  async getExistingTradeFingerprint() { return null; }
  async insertTrade(): Promise<DurableInsertResult> { return "INSERTED"; }
  async getStoredTradeCount() { return 0; }
  async getTrainableTradeCount() { return 0; }
  async getAllTradeKeys() { return []; }
  async getExistingGivebackFingerprint() { return null; }
  async insertGiveback(): Promise<DurableInsertResult> { return "INSERTED"; }
  async getAllGivebackKeys() { return []; }
}

// Hoisted test data — raw DB rows that queryCompletedTrades will process.
const { buyRows, sellRows, scanRows, supRows, snapshotRows } = vi.hoisted(() => {
  const buy = [
    { lot_id: "lot-1", pair: "BTC/USD", scan_id: "scan-1", fill_price: 100, fill_volume: 1, fee_usd: 1, ts: 1100 },
  ];
  const sell = [
    { lot_id: "lot-1", pair: "BTC/USD", fill_price: 110, fill_volume: 1, fee_usd: 1, ts: 2000 },
  ];
  const scan = [
    { scan_id: "scan-1", pair: "BTC/USD", stop_price: 95, risk_usd: 10 },
  ];
  const sup = [
    { lot_id: "lot-1", pair: "BTC/USD", mfe: 10, mae: -5, mfe_r: 1, mae_r: -0.5, exit_reason_type: "TARGET" },
  ];
  const snapshots = [
    { data: { snapshotType: "SCAN", scanId: "scan-1", pair: "BTC/USD", timestamp: 1000, policyVersion: "SPOT_POLICY_X", schemaVersion: 1, ticker: { bid: 100, ask: 100.1, last: 100 }, regime: { atrPct: 1.5, adx: 25, trend: "up" }, volume: { ratio: 1.2, baseVolume: 1000 }, signal: { type: "BREAKOUT", strength: 0.8 }, capital: { availableUsd: 10000, riskPerTradeUsd: 100 }, sizing: { stopPrice: 95, riskUsd: 10, qty: 1, notionalUsd: 100 } } },
    { data: { snapshotType: "FILL", pair: "BTC/USD", timestamp: 1100, fill: { lotId: "lot-1", side: "BUY", orderId: "o1", executedAt: 1100, fillPrice: 100, fillVolume: 1, feeUsd: 1, notionalUsd: 100, slippage: 0, quality: "ok" }, execIntent: { positionLotId: "lot-1", scanId: "scan-1" } } },
    { data: { snapshotType: "SUPERVISOR", pair: "BTC/USD", timestamp: 1500, schemaVersion: 2, policyVersion: "SPOT_POLICY_X", position: { lotId: "lot-1", entryPrice: 100, currentR: 1.5, mfe: 10, mae: -5, mfeR: 1.0, maeR: -0.5, currentStopPrice: 95, highestPrice: 110 }, exitDecision: { reasonType: null } } },
    { data: { snapshotType: "FILL", pair: "BTC/USD", timestamp: 2000, fill: { lotId: "lot-1", side: "SELL", orderId: "o2", executedAt: 2000, fillPrice: 110, fillVolume: 1, feeUsd: 1, notionalUsd: 110, slippage: 0, quality: "ok" }, execIntent: { positionLotId: "lot-1" } } },
  ];
  return { buyRows: buy, sellRows: sell, scanRows: scan, supRows: sup, snapshotRows: snapshots };
});

function setupMockDbForBackfill() {
  mockExecute.mockImplementation((query: any) => {
    const sqlStr = String(query?.sql ?? query ?? "");
    // isAvailable checks
    if (sqlStr.includes("FROM spot_ai_forward_training_trades") && sqlStr.includes("LIMIT 0")) {
      return Promise.resolve({ rows: [] });
    }
    if (sqlStr.includes("FROM spot_ai_forward_giveback_samples") && sqlStr.includes("LIMIT 0")) {
      return Promise.resolve({ rows: [] });
    }
    // queryCompletedTrades queries
    if (sqlStr.includes("'FILL'") && sqlStr.includes("'BUY'")) {
      return Promise.resolve({ rows: buyRows });
    }
    if (sqlStr.includes("'FILL'") && sqlStr.includes("'SELL'")) {
      return Promise.resolve({ rows: sellRows });
    }
    if (sqlStr.includes("'SCAN'") && sqlStr.includes("sizing")) {
      return Promise.resolve({ rows: scanRows });
    }
    if (sqlStr.includes("'SUPERVISOR'")) {
      return Promise.resolve({ rows: supRows });
    }
    if (sqlStr.includes("COUNT") && sqlStr.includes("'lotId' IS NULL")) {
      return Promise.resolve({ rows: [{ cnt: "0" }] });
    }
    // Raw snapshot SELECT for backfill
    if (sqlStr.includes("SELECT data FROM spot_forward_twin_snapshots")) {
      return Promise.resolve({ rows: snapshotRows });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe("R10-01 DATASET BUILD REAL THROW", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    _resetDurableStorageCache();
    _resetReconciliationMetrics();
    _resetReconciliationRunning();
    _setDurableDatasetBuilder(null);
  });

  // RECON_R10_DATASET_01: buildDataset throws => DATASET_BUILD_FAILED
  it("RECON_R10_DATASET_01: buildDataset throws => DATASET_BUILD_FAILED, errors=1", async () => {
    setupMockDbForBackfill();
    setDurableRepository(new CapturingRepo());
    _resetDurableStorageCache();

    // R10-01: Inject a builder that throws on buildDataset.
    _setDurableDatasetBuilder({
      buildDataset: () => { throw new Error("synthetic dataset build failure"); },
      buildGivebackDataset: () => ({ samples: [], featureSchemaVersion: 1, totalSnapshotCount: 0, labeledGivebackCount: 0 }),
    });

    const result = await backfillDurableFromRaw();

    expect(result.errors).toBe(1);
    expect(result.errorCodes).toContain("DATASET_BUILD_FAILED");
    expect(result.errorCodes).not.toContain("RAW_SNAPSHOT_LOAD_FAILED");
    // R10-03: infra error is NOT trainability
    expect(result.skippedNotTrainableTrades).toBe(0);
    expect(result.unprocessedCompletedTrades).toBe(1);
  });

  // RECON_R10_DATASET_02: buildGivebackDataset throws => DATASET_BUILD_FAILED
  it("RECON_R10_DATASET_02: buildGivebackDataset throws => DATASET_BUILD_FAILED", async () => {
    setupMockDbForBackfill();
    setDurableRepository(new CapturingRepo());
    _resetDurableStorageCache();

    // R10-01: buildDataset succeeds, buildGivebackDataset throws.
    _setDurableDatasetBuilder({
      buildDataset: () => ({ samples: [], featureSchemaVersion: 1, totalSnapshotCount: 0, trainCount: 0, validationCount: 0, testCount: 0, labeledTradeCount: 0, groupSplitByTrade: true, temporalSplit: true }),
      buildGivebackDataset: () => { throw new Error("synthetic giveback build failure"); },
    });

    const result = await backfillDurableFromRaw();

    expect(result.errors).toBe(1);
    expect(result.errorCodes).toContain("DATASET_BUILD_FAILED");
    expect(result.unprocessedCompletedTrades).toBe(1);
  });
});
