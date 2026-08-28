/**
 * spotAiBackfillParityR10.test.ts — R10-02 TRUE backfill E2E.
 *
 * R10-02: NO mock of spotAiCompletedTrades, queryCompletedTrades,
 * buildTradeOutcomeMap, buildDataset, or buildGivebackDataset.
 *
 * Only db.execute and DurableRepository are mocked.
 * The db.execute mock provides raw rows that the REAL queryCompletedTrades
 * processes through the REAL normalizer/correlation.
 *
 * CAMINO A (LIVE): queryCompletedTrades() REAL → buildTradeOutcomeMap() REAL
 *   → buildDataset() REAL → buildGivebackDataset() REAL → sync → Repo A
 *
 * CAMINO B (BACKFILL): backfillDurableFromRaw() REAL
 *   → internally uses queryCompletedTrades REAL, buildTradeOutcomeMap REAL,
 *     buildDataset REAL, buildGivebackDataset REAL, sync REAL → Repo B
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
  syncCompletedTradesToDurableStorage,
  backfillDurableFromRaw,
  type DurableRepository,
  type DurableTradeRow,
  type DurableGivebackRow,
  type DurableInsertResult,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";
import { queryCompletedTrades, buildTradeOutcomeMap } from "../spotAiForwardTwin/spotAiCompletedTrades";
import { buildDataset, buildGivebackDataset } from "../spotAiForwardTwin/spotAiDatasetBuilder";
import type { ForwardTwinSnapshot } from "../spot/spotForwardTwinTypes";
import {
  makeScanSnapshot,
  makeFillSnapshot,
  makeSupervisorSnapshot,
} from "./spotAiForwardTwinFactories";

// ─── Capturing repository ────────────────────────────────────────────────────

class CapturingRepo implements DurableRepository {
  trades: Map<string, DurableTradeRow> = new Map();
  givebacks: Map<string, DurableGivebackRow> = new Map();

  async isAvailable() { return true; }
  async getExistingTradeFingerprint() { return null; }
  async insertTrade(row: DurableTradeRow): Promise<DurableInsertResult> {
    const key = `${row.lotId}|${row.pair}`;
    if (this.trades.has(key)) {
      const existing = this.trades.get(key)!;
      if (existing.datasetFingerprint === row.datasetFingerprint) return "IDEMPOTENT_EXISTING";
      return "FINGERPRINT_CONFLICT";
    }
    this.trades.set(key, { ...row });
    return "INSERTED";
  }
  async getStoredTradeCount() { return this.trades.size; }
  async getTrainableTradeCount() { return this.trades.size; }
  async getAllTradeKeys() { return Array.from(this.trades.values()).map((r) => ({ lotId: r.lotId, pair: r.pair })); }
  async getExistingGivebackFingerprint() { return null; }
  async insertGiveback(row: DurableGivebackRow): Promise<DurableInsertResult> {
    const key = `${row.lotId}|${row.timestamp}`;
    if (this.givebacks.has(key)) {
      const existing = this.givebacks.get(key)!;
      if (existing.datasetFingerprint === row.datasetFingerprint) return "IDEMPOTENT_EXISTING";
      return "FINGERPRINT_CONFLICT";
    }
    this.givebacks.set(key, { ...row });
    return "INSERTED";
  }
  async getAllGivebackKeys() { return Array.from(this.givebacks.values()).map((r) => ({ lotId: r.lotId, timestamp: r.timestamp })); }
}

// ─── Raw DB rows for queryCompletedTrades ────────────────────────────────────
// These must match the SQL queries in spotAiCompletedTradeRepository.ts.

const POLICY_VERSION = "SPOT_POLICY_X";

const buyRows = [
  { lot_id: "lot-1", pair: "BTC/USD", scan_id: "scan-1", fill_price: 100, fill_volume: 1, fee_usd: 1, ts: 1100 },
];
const sellRows = [
  { lot_id: "lot-1", pair: "BTC/USD", fill_price: 110, fill_volume: 1, fee_usd: 1, ts: 2000 },
];
const scanRows = [
  { scan_id: "scan-1", pair: "BTC/USD", stop_price: 95, risk_usd: 10 },
];
const supRows = [
  { lot_id: "lot-1", pair: "BTC/USD", mfe: 10, mae: -5, mfe_r: 1, mae_r: -0.5, exit_reason_type: "TARGET" },
];

// R12-04: Typed ForwardTwinSnapshot fixtures via factories.
// NO `any`, NO `as ForwardTwinSnapshot[]` casts. TSC guarantees shape.
// R11-08/R12: TWO SUPERVISOR v2 snapshots for same lot with different currentR
// to test giveback labels on a future path (not just finalR).
const snapshotRows: Array<{ data: ForwardTwinSnapshot }> = [
  { data: makeScanSnapshot() },
  { data: makeFillSnapshot("BUY", "lot-1") },
  // SUPERVISOR v2 #1 — mid-trade, currentR=1.5
  { data: makeSupervisorSnapshot("lot-1", 1.5, 1500) },
  // SUPERVISOR v2 #2 — later, currentR=2.0 (different from #1)
  { data: makeSupervisorSnapshot("lot-1", 2.0, 1700) },
  { data: makeFillSnapshot("SELL", "lot-1") },
];

function setupMockDb() {
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

describe("R10-02 TRUE BACKFILL E2E (no mock of completedTrades)", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    _resetDurableStorageCache();
    _resetReconciliationMetrics();
    _resetReconciliationRunning();
  });

  // PARITY_R10_01_ENTRY_TRUE_E2E
  it("PARITY_R10_01_ENTRY_TRUE_E2E: live and backfill produce identical entry rows", async () => {
    // CAMINO A (LIVE): use REAL queryCompletedTrades, buildTradeOutcomeMap,
    // buildDataset, buildGivebackDataset, sync → Repo A
    setupMockDb();
    const queryResult = await queryCompletedTrades();
    expect(queryResult.completedTrades.length).toBe(1);

    const tradeOutcomes = buildTradeOutcomeMap(queryResult.completedTrades);
    const scanSnapshots = snapshotRows.map(r => r.data).filter(s => s.snapshotType === "SCAN");
    const supervisorSnapshots = snapshotRows.map(r => r.data).filter(s => s.snapshotType === "SUPERVISOR");
    const fillSnapshots = snapshotRows.map(r => r.data).filter(s => s.snapshotType === "FILL");

    const dataset = buildDataset({ scanSnapshots, supervisorSnapshots, fillSnapshots, tradeOutcomes });
    expect(dataset.samples.length).toBeGreaterThan(0);

    const repoA = new CapturingRepo();
    setDurableRepository(repoA);
    _resetDurableStorageCache();
    const gbDataset = buildGivebackDataset({ scanSnapshots, supervisorSnapshots, fillSnapshots, tradeOutcomes });
    const syncResultA = await syncCompletedTradesToDurableStorage(
      queryResult.completedTrades, dataset.samples, gbDataset.samples,
    );
    expect(syncResultA.syncedTrades).toBe(1);

    // CAMINO B (BACKFILL): backfillDurableFromRaw() REAL → Repo B
    setupMockDb();
    const repoB = new CapturingRepo();
    setDurableRepository(repoB);
    _resetDurableStorageCache();
    const backfillResult = await backfillDurableFromRaw();
    expect(backfillResult.syncedTrades).toBe(1);

    // Compare entry rows
    const rowA = repoA.trades.get("lot-1|BTC/USD")!;
    const rowB = repoB.trades.get("lot-1|BTC/USD")!;
    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();
    // Deep equal
    expect(rowA).toEqual(rowB);
    // Specific fields
    expect(rowA.datasetFingerprint).toBe(rowB.datasetFingerprint);
    expect(rowA.policyVersion).toBe(rowB.policyVersion);
    expect(rowA.entryFeaturesJson).toEqual(rowB.entryFeaturesJson);
    expect(rowA.entryLabelsJson).toEqual(rowB.entryLabelsJson);
    expect(rowA.entryFeeUsd).toBe(rowB.entryFeeUsd);
    expect(rowA.closedQty).toBe(rowB.closedQty);
    expect(rowA.residualQty).toBe(rowB.residualQty);
    expect(rowA.grossPnlUsd).toBe(rowB.grossPnlUsd);
    expect(rowA.netPnlUsd).toBe(rowB.netPnlUsd);
  });

  // PARITY_R10_02_GIVEBACK_TRUE_E2E
  it("PARITY_R10_02_GIVEBACK_TRUE_E2E: live and backfill produce identical giveback rows", async () => {
    // CAMINO A (LIVE)
    setupMockDb();
    const queryResult = await queryCompletedTrades();
    const tradeOutcomes = buildTradeOutcomeMap(queryResult.completedTrades);
    const scanSnapshots = snapshotRows.map(r => r.data).filter(s => s.snapshotType === "SCAN");
    const supervisorSnapshots = snapshotRows.map(r => r.data).filter(s => s.snapshotType === "SUPERVISOR");
    const fillSnapshots = snapshotRows.map(r => r.data).filter(s => s.snapshotType === "FILL");

    const gbDataset = buildGivebackDataset({ scanSnapshots, supervisorSnapshots, fillSnapshots, tradeOutcomes });
    const matureSamples = gbDataset.samples.filter(s => s.labels !== null);

    // R11-08: Assert mature samples exist — the test CANNOT pass with 0 rows.
    expect(matureSamples.length).toBeGreaterThan(0);

    const repoA = new CapturingRepo();
    setDurableRepository(repoA);
    _resetDurableStorageCache();
    const syncResultA = await syncCompletedTradesToDurableStorage(
      queryResult.completedTrades, [], matureSamples,
    );

    // R11-08: Assert giveback rows were actually persisted
    expect(repoA.givebacks.size).toBeGreaterThan(0);

    // CAMINO B (BACKFILL)
    setupMockDb();
    const repoB = new CapturingRepo();
    setDurableRepository(repoB);
    _resetDurableStorageCache();
    const backfillResult = await backfillDurableFromRaw();

    // R11-08: Assert backfill also persisted giveback rows
    expect(repoB.givebacks.size).toBeGreaterThan(0);

    // R11-08/R12-04: Comparison is UNCONDITIONAL — no `if (matureSamples.length > 0 ...)`
    expect(repoA.givebacks.size).toBe(repoB.givebacks.size);
    // R12-04: Assert supervisor count >= 2 (two v2 supervisors in fixture)
    expect(supervisorSnapshots.length).toBeGreaterThanOrEqual(2);
    for (const [key, rowA] of repoA.givebacks) {
      const rowB = repoB.givebacks.get(key);
      expect(rowB).toBeDefined();
      expect(rowA).toEqual(rowB);
      expect(rowA.datasetFingerprint).toBe(rowB!.datasetFingerprint);
      expect(rowA.policyVersion).toBe(rowB!.policyVersion);
      expect(rowA.labelsJson).toEqual(rowB!.labelsJson);
      expect(rowA.hasLabel).toBe(rowB!.hasLabel);
      expect(rowA.hasLabel).toBe(true);
      // R12-04: Require future_MFE_R and future_MAE_R keys to exist (no conditional)
      const labels = rowA.labelsJson as Record<string, unknown>;
      expect(labels).toHaveProperty("future_MFE_R");
      expect(labels).toHaveProperty("future_MAE_R");
      expect(labels.future_MFE_R).not.toBeNull();
      expect(labels.future_MAE_R).not.toBeNull();
      expect(labels.future_MFE_R).not.toBe(undefined);
      expect(labels.future_MAE_R).not.toBe(undefined);
    }
  });

  // PARITY_R10_03_SECOND_BACKFILL_IDEMPOTENT
  it("PARITY_R10_03_SECOND_BACKFILL_IDEMPOTENT: second backfill run is idempotent", async () => {
    setupMockDb();
    const repo = new CapturingRepo();
    setDurableRepository(repo);
    _resetDurableStorageCache();

    // First run
    const result1 = await backfillDurableFromRaw();
    expect(result1.errors).toBe(0);
    expect(result1.fingerprintConflicts).toBe(0);
    expect(result1.syncedTrades).toBeGreaterThan(0);

    // Second run — should be idempotent
    _resetDurableStorageCache();
    setupMockDb();
    const result2 = await backfillDurableFromRaw();
    expect(result2.errors).toBe(0);
    expect(result2.fingerprintConflicts).toBe(0);
    expect(result2.syncedTrades).toBe(0);
    expect(result2.idempotentTrades).toBeGreaterThan(0);
  });
});
