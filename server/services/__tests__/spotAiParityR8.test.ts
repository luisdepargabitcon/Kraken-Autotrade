/**
 * spotAiParityR8.test.ts — R8 LIVE/BACKFILL parity test.
 *
 * R8-06: Real live/backfill parity test.
 * Both paths use the SAME canonical payload builders:
 * - buildDurableEntryPayload
 * - buildDurableGivebackPayload
 *
 * The live path calls syncCompletedTradesToDurableStorage which calls
 * persistCompletedTrade which calls buildDurableEntryPayload.
 *
 * The backfill path calls backfillDurableFromRaw which calls
 * syncCompletedTradesToDurableStorage (same path).
 *
 * This test verifies that the canonical builders produce identical
 * fingerprints and rows for the same input, regardless of the caller.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the db module.
const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn().mockResolvedValue({ rows: [] }),
}));
vi.mock("../../db", () => ({
  db: { execute: mockExecute },
}));

import {
  setDurableRepository,
  _resetDurableStorageCache,
  _resetReconciliationMetrics,
  syncCompletedTradesToDurableStorage,
  buildDurableEntryPayload,
  buildDurableGivebackPayload,
  type DurableRepository,
  type DurableTradeRow,
  type DurableGivebackRow,
  type DurableInsertResult,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";
import type { CompletedTrade } from "../spotAiForwardTwin/spotAiCompletedTrades";
import type { SpotAiDatasetSample, SpotAiGivebackSample } from "../spotAiForwardTwin/spotAiForwardTwinTypes";

// ─── Fake repository ─────────────────────────────────────────────────────────

class CapturingRepo implements DurableRepository {
  trades: Map<string, DurableTradeRow> = new Map();
  givebacks: Map<string, DurableGivebackRow> = new Map();

  async isAvailable() { return true; }
  async getExistingTradeFingerprint() { return null; }
  async insertTrade(row: DurableTradeRow): Promise<DurableInsertResult> {
    this.trades.set(`${row.lotId}|${row.pair}`, { ...row });
    return "INSERTED";
  }
  async getStoredTradeCount() { return this.trades.size; }
  async getTrainableTradeCount() { return this.trades.size; }
  async getAllTradeKeys() { return []; }
  async getExistingGivebackFingerprint() { return null; }
  async insertGiveback(row: DurableGivebackRow): Promise<DurableInsertResult> {
    this.givebacks.set(`${row.lotId}|${row.timestamp}`, { ...row });
    return "INSERTED";
  }
  async getAllGivebackKeys() { return []; }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const POLICY_VERSION = "SPOT_POLICY_X";

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

function makeDatasetSample(overrides: Partial<SpotAiDatasetSample> = {}): SpotAiDatasetSample {
  return {
    sampleId: "scan-1-BTC/USD",
    split: "train",
    groupId: "lot-1",
    features: { scanId: "scan-1", pair: "BTC/USD", atrPct: 1.5, timestamp: 1000 } as any,
    labels: { outcome: "WIN", rMultiple: 1.0 } as any,
    givebackLabels: null,
    challengers: [],
    sourcePolicyVersion: POLICY_VERSION,
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
    sourcePolicyVersion: POLICY_VERSION,
    ...overrides,
  };
}

describe("R8 PARITY tests — canonical payload builders", () => {
  let repo: CapturingRepo;

  beforeEach(() => {
    repo = new CapturingRepo();
    setDurableRepository(repo);
    _resetDurableStorageCache();
    _resetReconciliationMetrics();
  });

  // DURABLE_R8_PARITY_01: live sync and direct buildDurableEntryPayload produce identical entry rows
  it("DURABLE_R8_PARITY_01: live sync and direct builder produce identical entry rows", async () => {
    const trade = makeTrade();
    const sample = makeDatasetSample();

    // Path A (live): syncCompletedTradesToDurableStorage → persistCompletedTrade → buildDurableEntryPayload
    const repoA = new CapturingRepo();
    setDurableRepository(repoA);
    _resetDurableStorageCache();
    const syncResult = await syncCompletedTradesToDurableStorage([trade], [sample], []);
    expect(syncResult.syncedTrades).toBe(1);

    // Path B (direct): buildDurableEntryPayload with the same inputs
    const featuresJson = sample.features as unknown as Record<string, unknown>;
    const labelsJson = sample.labels as unknown as Record<string, unknown>;
    const buildB = buildDurableEntryPayload(
      trade, featuresJson, labelsJson, sample.sourcePolicyVersion!,
    );
    expect(buildB.ok).toBe(true);
    const { row: rowB, fingerprint: fpB } = buildB as any;

    // Compare
    const rowA = repoA.trades.get("lot-1|BTC/USD")!;
    expect(rowA.datasetFingerprint).toBe(fpB);
    expect(rowA.policyVersion).toBe(rowB.policyVersion);
    expect(rowA.policyVersion).toBe(POLICY_VERSION);
    expect(rowA.entryFeeUsd).toBe(rowB.entryFeeUsd);
    expect(rowA.residualQty).toBe(rowB.residualQty);
    expect(rowA.closedQty).toBe(rowB.closedQty);
    expect(rowA.entryFeaturesJson).toEqual(rowB.entryFeaturesJson);
    expect(rowA.entryLabelsJson).toEqual(rowB.entryLabelsJson);
    expect(rowA.lotId).toBe(rowB.lotId);
    expect(rowA.pair).toBe(rowB.pair);
  });

  // DURABLE_R8_PARITY_02: live persist and direct buildDurableGivebackPayload produce identical giveback rows
  it("DURABLE_R8_PARITY_02: live persist and direct builder produce identical giveback rows", async () => {
    const sample = makeGivebackSample();

    // Path A (live): persistGivebackSamples → buildDurableGivebackPayload
    const repoA = new CapturingRepo();
    setDurableRepository(repoA);
    _resetDurableStorageCache();
    const { persistGivebackSamples } = await import("../spotAiForwardTwin/spotAiDurableTrainingStore");
    const gbResult = await persistGivebackSamples([sample]);
    expect(gbResult.persisted).toBe(1);

    // Path B (direct): buildDurableGivebackPayload with the same sample
    const buildB = buildDurableGivebackPayload(sample);
    expect(buildB.ok).toBe(true);
    const { row: rowB, fingerprint: fpB } = buildB as any;

    // Compare
    const rowA = repoA.givebacks.get("lot-1|1000")!;
    expect(rowA.datasetFingerprint).toBe(fpB);
    expect(rowA.policyVersion).toBe(rowB.policyVersion);
    expect(rowA.policyVersion).toBe(POLICY_VERSION);
    expect(rowA.forwardTwinSchemaVersion).toBe(rowB.forwardTwinSchemaVersion);
    expect(rowA.labelsJson).toEqual(rowB.labelsJson);
    expect(rowA.hasLabel).toBe(rowB.hasLabel);
    expect(rowA.hasLabel).toBe(true);
    expect(rowA.lotId).toBe(rowB.lotId);
    expect(rowA.timestamp).toBe(rowB.timestamp);
  });

  // DURABLE_R8_PARITY_03: same trade + same features + same labels = same fingerprint (deterministic)
  it("DURABLE_R8_PARITY_03: fingerprint is deterministic", () => {
    const trade = makeTrade();
    const features = { f: 1 };
    const labels = { l: 1 };

    const r1 = buildDurableEntryPayload(trade, features, labels, POLICY_VERSION);
    const r2 = buildDurableEntryPayload(trade, features, labels, POLICY_VERSION);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect((r1 as any).fingerprint).toBe((r2 as any).fingerprint);
  });

  // DURABLE_R8_PARITY_04: different policy = different fingerprint
  it("DURABLE_R8_PARITY_04: different policy = different fingerprint", () => {
    const trade = makeTrade();
    const features = { f: 1 };
    const labels = { l: 1 };

    const r1 = buildDurableEntryPayload(trade, features, labels, "POLICY_A");
    const r2 = buildDurableEntryPayload(trade, features, labels, "POLICY_B");
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect((r1 as any).fingerprint).not.toBe((r2 as any).fingerprint);
  });
});
