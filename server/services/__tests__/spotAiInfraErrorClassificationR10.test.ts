/**
 * spotAiInfraErrorClassificationR10.test.ts — R10-03 infra error ≠ not-trainable.
 *
 * R10-03: RAW_SNAPSHOT_LOAD_FAILED and DATASET_BUILD_FAILED must NOT increment
 * skippedNotTrainableTrades. Use unprocessedCompletedTrades instead.
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

const { buyRows, sellRows, scanRows, supRows } = vi.hoisted(() => {
  // 100 completed trades
  const buy: any[] = [];
  const sell: any[] = [];
  const scan: any[] = [];
  const sup: any[] = [];
  for (let i = 0; i < 100; i++) {
    buy.push({ lot_id: `lot-${i}`, pair: "BTC/USD", scan_id: `scan-${i}`, fill_price: 100, fill_volume: 1, fee_usd: 1, ts: 1100 + i });
    sell.push({ lot_id: `lot-${i}`, pair: "BTC/USD", fill_price: 110, fill_volume: 1, fee_usd: 1, ts: 2000 + i });
    scan.push({ scan_id: `scan-${i}`, pair: "BTC/USD", stop_price: 95, risk_usd: 10 });
    sup.push({ lot_id: `lot-${i}`, pair: "BTC/USD", mfe: 10, mae: -5, mfe_r: 1, mae_r: -0.5, exit_reason_type: "TARGET" });
  }
  return { buyRows: buy, sellRows: sell, scanRows: scan, supRows: sup };
});

function setupMockDbForQueryOnly() {
  mockExecute.mockImplementation((query: any) => {
    const sqlStr = String(query?.sql ?? query ?? "");
    if (sqlStr.includes("FROM spot_ai_forward_training_trades") && sqlStr.includes("LIMIT 0")) {
      return Promise.resolve({ rows: [] });
    }
    if (sqlStr.includes("FROM spot_ai_forward_giveback_samples") && sqlStr.includes("LIMIT 0")) {
      return Promise.resolve({ rows: [] });
    }
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
    return Promise.resolve({ rows: [] });
  });
}

describe("R10-03 INFRA ERROR NOT NOT_TRAINABLE", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    _resetDurableStorageCache();
    _resetReconciliationMetrics();
    _resetReconciliationRunning();
    _setDurableDatasetBuilder(null);
  });

  // RECON_R10_CLASS_01: raw load failure => skippedNotTrainable=0, unprocessed=100
  it("RECON_R10_CLASS_01: raw load failure => skippedNotTrainable=0, unprocessed=100", async () => {
    setupMockDbForQueryOnly();
    setDurableRepository(new CapturingRepo());
    _resetDurableStorageCache();

    // Override: raw snapshot SELECT throws
    mockExecute.mockImplementation((query: any) => {
      const sqlStr = String(query?.sql ?? query ?? "");
      if (sqlStr.includes("FROM spot_ai_forward_training_trades") && sqlStr.includes("LIMIT 0")) {
        return Promise.resolve({ rows: [] });
      }
      if (sqlStr.includes("FROM spot_ai_forward_giveback_samples") && sqlStr.includes("LIMIT 0")) {
        return Promise.resolve({ rows: [] });
      }
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
      if (sqlStr.includes("SELECT data FROM spot_forward_twin_snapshots")) {
        throw new Error("raw snapshot load failure");
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await backfillDurableFromRaw();

    expect(result.errors).toBe(1);
    expect(result.errorCodes).toContain("RAW_SNAPSHOT_LOAD_FAILED");
    // R10-03: infra error is NOT trainability
    expect(result.skippedNotTrainableTrades).toBe(0);
    expect(result.unprocessedCompletedTrades).toBe(100);
  });

  // RECON_R10_CLASS_02: dataset build failure => skippedNotTrainable=0, unprocessed=100
  it("RECON_R10_CLASS_02: dataset build failure => skippedNotTrainable=0, unprocessed=100", async () => {
    setupMockDbForQueryOnly();
    setDurableRepository(new CapturingRepo());
    _resetDurableStorageCache();

    // Raw snapshot SELECT succeeds with minimal data
    mockExecute.mockImplementation((query: any) => {
      const sqlStr = String(query?.sql ?? query ?? "");
      if (sqlStr.includes("FROM spot_ai_forward_training_trades") && sqlStr.includes("LIMIT 0")) {
        return Promise.resolve({ rows: [] });
      }
      if (sqlStr.includes("FROM spot_ai_forward_giveback_samples") && sqlStr.includes("LIMIT 0")) {
        return Promise.resolve({ rows: [] });
      }
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
      if (sqlStr.includes("SELECT data FROM spot_forward_twin_snapshots")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    // R10-01: Inject a builder that throws.
    _setDurableDatasetBuilder({
      buildDataset: () => { throw new Error("dataset build failure"); },
      buildGivebackDataset: () => { throw new Error("dataset build failure"); },
    });

    const result = await backfillDurableFromRaw();

    expect(result.errors).toBe(1);
    expect(result.errorCodes).toContain("DATASET_BUILD_FAILED");
    // R10-03: infra error is NOT trainability
    expect(result.skippedNotTrainableTrades).toBe(0);
    expect(result.unprocessedCompletedTrades).toBe(100);
  });
});
