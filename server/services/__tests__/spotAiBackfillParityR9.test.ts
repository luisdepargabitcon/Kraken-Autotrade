/**
 * spotAiBackfillParityR9.test.ts — R9-04 TRUE live vs backfill end-to-end.
 *
 * R9-04: This test ACTUALLY calls backfillDurableFromRaw().
 * It does NOT substitute backfillDurableFromRaw with a direct builder.
 *
 * CAMINO A (LIVE): buildDataset + syncCompletedTradesToDurableStorage → Repo A
 * CAMINO B (BACKFILL): backfillDurableFromRaw() → Repo B
 *
 * Compares entry rows, giveback rows, and fingerprints.
 * Also tests second-run idempotency.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock db with hoisted execute.
const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));
vi.mock("../../db", () => ({
  db: { execute: mockExecute },
}));

// Mock drizzle-orm for inspectable SQL.
vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: any[]) => {
    const sqlStr = strings.reduce((acc, str, i) => {
      if (i > 0) acc += `__PARAM_${i}__`;
      return acc + str;
    }, "");
    return { sql: sqlStr, strings, values };
  },
}));

// Hoisted snapshots for use in mocks
const { testSnapshots, testCompletedTrade } = vi.hoisted(() => {
  const POLICY_VERSION = "SPOT_POLICY_X";
  const snapshots = [
    {
      snapshotType: "SCAN", schemaVersion: 1, policyVersion: POLICY_VERSION,
      pair: "BTC/USD", timestamp: 1000, scanId: "scan-1",
      signalId: "sig-1", intentId: "intent-1",
      ticker: { bid: 100, ask: 100.1, last: 100 },
      regime: { atrPct: 1.5, adx: 25, trend: "up" },
      volume: { ratio: 1.2, baseVolume: 1000 },
      signal: { type: "BREAKOUT", strength: 0.8 },
      capital: { availableUsd: 10000, riskPerTradeUsd: 100 },
      sizing: { stopPrice: 95, riskUsd: 10, qty: 1, notionalUsd: 100 },
    },
    {
      snapshotType: "FILL", schemaVersion: 1, pair: "BTC/USD", timestamp: 1100,
      fill: { lotId: "lot-1", side: "BUY", orderId: "o1", executedAt: 1100, fillPrice: 100, fillVolume: 1, feeUsd: 1, notionalUsd: 100, slippage: 0, quality: "ok" },
      execIntent: { positionLotId: "lot-1", scanId: "scan-1" },
    },
    {
      snapshotType: "SUPERVISOR", schemaVersion: 2, policyVersion: POLICY_VERSION,
      pair: "BTC/USD", timestamp: 1500,
      position: { lotId: "lot-1", entryPrice: 100, currentR: 1.5, mfe: 10, mae: -5, mfeR: 1.0, maeR: -0.5, currentStopPrice: 95, highestPrice: 110 },
      exitDecision: { reasonType: null },
    },
    {
      snapshotType: "FILL", schemaVersion: 1, pair: "BTC/USD", timestamp: 2000,
      fill: { lotId: "lot-1", side: "SELL", orderId: "o2", executedAt: 2000, fillPrice: 110, fillVolume: 1, feeUsd: 1, notionalUsd: 110, slippage: 0, quality: "ok" },
      execIntent: { positionLotId: "lot-1" },
    },
  ];
  const completedTrade = {
    lotId: "lot-1", pair: "BTC/USD", entryScanId: "scan-1",
    entryTime: 1100, exitTime: 2000,
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
  return { testSnapshots: snapshots, testCompletedTrade: completedTrade };
});

// Mock queryCompletedTrades to return the trade computed from the same snapshots.
// This is acceptable because backfillDurableFromRaw() is STILL called —
// the test exercises the real backfill path, not a direct builder.
vi.mock("../spotAiForwardTwin/spotAiCompletedTrades", () => ({
  queryCompletedTrades: vi.fn().mockResolvedValue({
    completedTrades: [testCompletedTrade],
    partialExitTrades: 0,
    legacyMissingLotIdBuyFills: 0,
    correlationIncompleteTrades: 0,
    economicInvalidTrades: 0,
    exitVolumeOverflowTrades: 0,
  }),
  buildTradeOutcomeMap: vi.fn((trades: any[]) => {
    const map = new Map();
    for (const t of trades) {
      map.set(t.lotId, {
        lotId: t.lotId, pair: t.pair, entryScanId: t.entryScanId,
        entryPrice: t.entryPrice, exitPrice: t.exitPrice,
        stopPrice: t.initialStopPrice, riskUsd: t.initialRiskUsd,
        mfe: t.mfe, mae: t.mae, mfeR: t.mfeR, maeR: t.maeR,
        entryTime: t.entryTime, exitTime: t.exitTime,
        netPnlUsd: t.netPnlUsd, grossPnlUsd: t.grossPnlUsd,
        entryFeeUsd: t.entryFeeUsd, exitFeeUsd: t.exitFeeUsd,
        executedQty: t.closedQty,
      });
    }
    return map;
  }),
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
import { buildDataset, buildGivebackDataset } from "../spotAiForwardTwin/spotAiDatasetBuilder";
import { buildTradeOutcomeMap } from "../spotAiForwardTwin/spotAiCompletedTrades";

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

// ─── Helper: configure mock db for backfill raw SELECT ───────────────────────

function setupMockDbForBackfill(snapshots: any[]) {
  mockExecute.mockImplementation((query: any) => {
    const sqlStr = String(query?.sql ?? query ?? "");
    // isAvailable checks (R9-12: SELECT columns LIMIT 0)
    if (sqlStr.includes("FROM spot_ai_forward_training_trades") && sqlStr.includes("LIMIT 0")) {
      return Promise.resolve({ rows: [] });
    }
    if (sqlStr.includes("FROM spot_ai_forward_giveback_samples") && sqlStr.includes("LIMIT 0")) {
      return Promise.resolve({ rows: [] });
    }
    // Raw snapshot SELECT for backfill
    if (sqlStr.includes("SELECT data FROM spot_forward_twin_snapshots")) {
      return Promise.resolve({ rows: snapshots.map((s) => ({ data: s })) });
    }
    // COUNT queries
    if (sqlStr.includes("COUNT")) {
      return Promise.resolve({ rows: [{ cnt: "0", count: "0" }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

const trade = testCompletedTrade as any;
const allSnapshots = testSnapshots;

describe("R9-04 TRUE LIVE vs BACKFILL end-to-end parity", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    _resetDurableStorageCache();
    _resetReconciliationMetrics();
    _resetReconciliationRunning();
  });

  // PARITY_R9_01_ENTRY_END_TO_END
  it("PARITY_R9_01_ENTRY_END_TO_END: live sync and backfill produce identical entry rows", async () => {
    const tradeOutcomes = buildTradeOutcomeMap([trade]);
    const scanSnapshots = allSnapshots.filter((s) => s.snapshotType === "SCAN");
    const supervisorSnapshots = allSnapshots.filter((s) => s.snapshotType === "SUPERVISOR");
    const fillSnapshots = allSnapshots.filter((s) => s.snapshotType === "FILL");

    // CAMINO A (LIVE): buildDataset → syncCompletedTradesToDurableStorage → Repo A
    const datasetA = buildDataset({ scanSnapshots, supervisorSnapshots, fillSnapshots, tradeOutcomes });
    expect(datasetA.samples.length).toBeGreaterThan(0);
    const repoA = new CapturingRepo();
    setDurableRepository(repoA);
    _resetDurableStorageCache();
    const syncResultA = await syncCompletedTradesToDurableStorage([trade], datasetA.samples, []);
    expect(syncResultA.syncedTrades).toBe(1);

    // CAMINO B (BACKFILL): backfillDurableFromRaw() → Repo B
    setupMockDbForBackfill(allSnapshots);
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
    expect(rowA.datasetFingerprint).toBe(rowB.datasetFingerprint);
    expect(rowA.policyVersion).toBe(rowB.policyVersion);
    expect(rowA.entryFeeUsd).toBe(rowB.entryFeeUsd);
    expect(rowA.residualQty).toBe(rowB.residualQty);
    expect(rowA.closedQty).toBe(rowB.closedQty);
    expect(rowA.entryFeaturesJson).toEqual(rowB.entryFeaturesJson);
    expect(rowA.entryLabelsJson).toEqual(rowB.entryLabelsJson);
  });

  // PARITY_R9_02_GIVEBACK_END_TO_END
  it("PARITY_R9_02_GIVEBACK_END_TO_END: live sync and backfill produce identical giveback rows", async () => {
    const tradeOutcomes = buildTradeOutcomeMap([trade]);
    const scanSnapshots = allSnapshots.filter((s) => s.snapshotType === "SCAN");
    const supervisorSnapshots = allSnapshots.filter((s) => s.snapshotType === "SUPERVISOR");
    const fillSnapshots = allSnapshots.filter((s) => s.snapshotType === "FILL");

    // CAMINO A (LIVE): buildGivebackDataset → sync → Repo A
    const gbDatasetA = buildGivebackDataset({ scanSnapshots, supervisorSnapshots, fillSnapshots, tradeOutcomes });
    const matureSamples = gbDatasetA.samples.filter((s) => s.labels !== null);
    expect(matureSamples.length).toBeGreaterThan(0);
    const repoA = new CapturingRepo();
    setDurableRepository(repoA);
    _resetDurableStorageCache();
    const syncResultA = await syncCompletedTradesToDurableStorage([trade], [], matureSamples);
    expect(syncResultA.syncedGivebackSamples).toBeGreaterThan(0);

    // CAMINO B (BACKFILL): backfillDurableFromRaw() → Repo B
    setupMockDbForBackfill(allSnapshots);
    const repoB = new CapturingRepo();
    setDurableRepository(repoB);
    _resetDurableStorageCache();
    const backfillResult = await backfillDurableFromRaw();
    expect(backfillResult.syncedGivebackSamples).toBeGreaterThan(0);

    // Compare giveback rows
    for (const [key, rowA] of repoA.givebacks) {
      const rowB = repoB.givebacks.get(key);
      expect(rowB).toBeDefined();
      expect(rowA.datasetFingerprint).toBe(rowB!.datasetFingerprint);
      expect(rowA.policyVersion).toBe(rowB!.policyVersion);
      expect(rowA.forwardTwinSchemaVersion).toBe(rowB!.forwardTwinSchemaVersion);
      expect(rowA.labelsJson).toEqual(rowB!.labelsJson);
      expect(rowA.hasLabel).toBe(rowB!.hasLabel);
    }
  });

  // PARITY_R9_03_RESTART_IDEMPOTENT
  it("PARITY_R9_03_RESTART_IDEMPOTENT: second backfill run is idempotent", async () => {
    setupMockDbForBackfill(allSnapshots);
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
    setupMockDbForBackfill(allSnapshots);
    const result2 = await backfillDurableFromRaw();
    expect(result2.errors).toBe(0);
    expect(result2.fingerprintConflicts).toBe(0);
    expect(result2.idempotentTrades).toBeGreaterThan(0);
  });
});
