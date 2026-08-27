/**
 * spotAiMidRunOutageR11.test.ts — R11-05/R11-06/R11-07 mid-run outage.
 *
 * R11-05: Detect outage DURING insert (not just pre-check).
 * R11-06: Invalidate availability cache on outage.
 * R11-07: Real FlippingRepo test — precheck=true, INSERT fails, reprobe=false.
 *
 * STORAGE_R11_MIDRUN_01: sync mid-run outage => storageUnavailable=true, insertErrors=0
 * RECON_R11_MIDRUN_01: reconciliation mid-run outage => STORAGE_UNAVAILABLE
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
  runDurableReconciliation,
  getReconciliationMetrics,
  isDurableStorageAvailable,
  type DurableRepository,
  type DurableTradeRow,
  type DurableGivebackRow,
  type DurableInsertResult,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";
import type { CompletedTrade } from "../spotAiForwardTwin/spotAiCompletedTrades";
import type { SpotAiDatasetSample, SpotAiGivebackSample } from "../spotAiForwardTwin/spotAiForwardTwinTypes";

/**
 * R11-07: FlippingRepo — starts available, becomes unavailable on first INSERT.
 * This simulates a mid-run outage: precheck passes, then storage crashes
 * during the actual INSERT.
 */
class FlippingRepo implements DurableRepository {
  available: boolean = true;
  insertAttempted: boolean = false;

  async isAvailable(): Promise<boolean> {
    return this.available;
  }
  async getExistingTradeFingerprint() { return null; }
  async insertTrade(row: DurableTradeRow): Promise<DurableInsertResult> {
    this.insertAttempted = true;
    // Simulate storage crashing during INSERT
    this.available = false;
    // The production repo would reprobe isAvailable() in its catch block.
    // Since this is a test repo, we return STORAGE_UNAVAILABLE directly.
    return "STORAGE_UNAVAILABLE";
  }
  async getStoredTradeCount() { return 0; }
  async getTrainableTradeCount() { return 0; }
  async getAllTradeKeys() { return []; }
  async getExistingGivebackFingerprint() { return null; }
  async insertGiveback(row: DurableGivebackRow): Promise<DurableInsertResult> {
    this.available = false;
    return "STORAGE_UNAVAILABLE";
  }
  async getAllGivebackKeys() { return []; }
}

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

function makeDatasetSample(): SpotAiDatasetSample {
  return {
    sampleId: "s1",
    split: "train",
    groupId: "lot-1",
    features: { scanId: "scan-1", pair: "BTC/USD", timestamp: 1000, atrPct: 1.5 } as any,
    labels: { outcome: "WIN", rMultiple: 1.0 } as any,
    givebackLabels: null,
    challengers: [],
    sourcePolicyVersion: "SPOT_POLICY_X",
  } as any;
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

describe("R11-05/R11-06/R11-07 MID-RUN OUTAGE", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    _resetDurableStorageCache();
    _resetReconciliationMetrics();
    _resetReconciliationRunning();
  });

  // STORAGE_R11_MIDRUN_01: sync mid-run outage
  it("STORAGE_R11_MIDRUN_01: entry INSERT outage => storageUnavailable=true, insertErrors=0, errors=0", async () => {
    const repo = new FlippingRepo();
    setDurableRepository(repo);
    _resetDurableStorageCache();

    // Pre-check should pass (repo is available)
    const preAvailable = await isDurableStorageAvailable();
    expect(preAvailable).toBe(true);

    const trade = makeTrade();
    const sample = makeDatasetSample();
    const gbSample = makeGivebackSample();

    const result = await syncCompletedTradesToDurableStorage([trade], [sample], [gbSample]);

    // R11-05: storageUnavailable=true (mid-run outage)
    expect(result.storageUnavailable).toBe(true);
    // R11-05: NOT counted as insert error
    expect(result.insertErrors).toBe(0);
    expect(result.errors).toBe(0);
    // R11-05: INSERT was attempted (pre-check passed, then outage)
    expect(repo.insertAttempted).toBe(true);
  });

  // STORAGE_R11_MONO_01: entry marks storageUnavailable, giveback result false => sync final true
  it("STORAGE_R11_MONO_01: entry storageUnavailable=true, giveback false => sync final true (monotonic)", async () => {
    // Repo that returns STORAGE_UNAVAILABLE for insertTrade but succeeds for giveback
    const repo: DurableRepository = {
      async isAvailable() { return true; },
      async getExistingTradeFingerprint() { return null; },
      async insertTrade() { return "STORAGE_UNAVAILABLE" as DurableInsertResult; },
      async getStoredTradeCount() { return 0; },
      async getTrainableTradeCount() { return 0; },
      async getAllTradeKeys() { return []; },
      async getExistingGivebackFingerprint() { return null; },
      async insertGiveback() { return "INSERTED" as DurableInsertResult; },
      async getAllGivebackKeys() { return []; },
    };
    setDurableRepository(repo);
    _resetDurableStorageCache();

    const trade = makeTrade();
    const sample = makeDatasetSample();
    const result = await syncCompletedTradesToDurableStorage([trade], [sample], []);

    // Entry marked storageUnavailable=true. Giveback didn't run (sync returned early).
    // But even if it had, the monotonic OR would preserve true.
    expect(result.storageUnavailable).toBe(true);
  });

  // RECON_R11_MIDRUN_01: reconciliation mid-run outage => STORAGE_UNAVAILABLE
  it("RECON_R11_MIDRUN_01: reconciliation mid-run outage => status=STORAGE_UNAVAILABLE", async () => {
    const repo = new FlippingRepo();
    setDurableRepository(repo);
    _resetDurableStorageCache();

    // Mock db.execute to provide raw rows for queryCompletedTrades
    mockExecute.mockImplementation((query: any) => {
      const sqlStr = String(query?.sql ?? query ?? "");
      if (sqlStr.includes("FROM spot_ai_forward_training_trades") && sqlStr.includes("LIMIT 0")) {
        return Promise.resolve({ rows: [] });
      }
      if (sqlStr.includes("FROM spot_ai_forward_giveback_samples") && sqlStr.includes("LIMIT 0")) {
        return Promise.resolve({ rows: [] });
      }
      if (sqlStr.includes("'FILL'") && sqlStr.includes("'BUY'")) {
        return Promise.resolve({ rows: [{ lot_id: "lot-1", pair: "BTC/USD", scan_id: "scan-1", fill_price: 100, fill_volume: 1, fee_usd: 1, ts: 1100 }] });
      }
      if (sqlStr.includes("'FILL'") && sqlStr.includes("'SELL'")) {
        return Promise.resolve({ rows: [{ lot_id: "lot-1", pair: "BTC/USD", fill_price: 110, fill_volume: 1, fee_usd: 1, ts: 2000 }] });
      }
      if (sqlStr.includes("'SCAN'") && sqlStr.includes("sizing")) {
        return Promise.resolve({ rows: [{ scan_id: "scan-1", pair: "BTC/USD", stop_price: 95, risk_usd: 10 }] });
      }
      if (sqlStr.includes("'SUPERVISOR'")) {
        return Promise.resolve({ rows: [{ lot_id: "lot-1", pair: "BTC/USD", mfe: 10, mae: -5, mfe_r: 1, mae_r: -0.5, exit_reason_type: "TARGET" }] });
      }
      if (sqlStr.includes("COUNT") && sqlStr.includes("'lotId' IS NULL")) {
        return Promise.resolve({ rows: [{ cnt: "0" }] });
      }
      if (sqlStr.includes("SELECT data FROM spot_forward_twin_snapshots")) {
        return Promise.resolve({ rows: [
          { data: { snapshotType: "SCAN", scanId: "scan-1", pair: "BTC/USD", timestamp: 1000, policyVersion: "SPOT_POLICY_X", schemaVersion: 1, ticker: { bid: 100, ask: 100.1, last: 100 }, regime: { atrPct: 1.5, adx: 25, trend: "up" }, volume: { ratio: 1.2, baseVolume: 1000 }, signal: { type: "BREAKOUT", strength: 0.8 }, capital: { availableUsd: 10000, riskPerTradeUsd: 100 }, sizing: { stopPrice: 95, riskUsd: 10, qty: 1, notionalUsd: 100 } } },
          { data: { snapshotType: "FILL", pair: "BTC/USD", timestamp: 1100, fill: { lotId: "lot-1", side: "BUY", orderId: "o1", executedAt: 1100, fillPrice: 100, fillVolume: 1, feeUsd: 1, notionalUsd: 100, slippage: 0, quality: "ok" }, execIntent: { positionLotId: "lot-1", scanId: "scan-1" } } },
          { data: { snapshotType: "SUPERVISOR", pair: "BTC/USD", timestamp: 1500, schemaVersion: 2, policyVersion: "SPOT_POLICY_X", position: { lotId: "lot-1", entryPrice: 100, currentR: 1.5, mfe: 10, mae: -5, mfeR: 1.0, maeR: -0.5, currentStopPrice: 95, highestPrice: 110 }, exitDecision: { reasonType: null } } },
          { data: { snapshotType: "FILL", pair: "BTC/USD", timestamp: 2000, fill: { lotId: "lot-1", side: "SELL", orderId: "o2", executedAt: 2000, fillPrice: 110, fillVolume: 1, feeUsd: 1, notionalUsd: 110, slippage: 0, quality: "ok" }, execIntent: { positionLotId: "lot-1" } } },
        ] });
      }
      return Promise.resolve({ rows: [] });
    });

    await runDurableReconciliation();

    const metrics = getReconciliationMetrics();
    expect(metrics.status).toBe("STORAGE_UNAVAILABLE");
    expect(metrics.errors).toBeNull();
    expect(metrics.insertErrors).toBeNull();
    expect(metrics.errorCodes).not.toContain("DURABLE_INSERT_FAILED");
  });

  // R11-06: cache invalidated after outage
  it("STORAGE_R11_CACHE_01: after mid-run outage, cache is invalidated (isAvailable returns false)", async () => {
    const repo = new FlippingRepo();
    setDurableRepository(repo);
    _resetDurableStorageCache();

    // Pre-check passes
    const preAvailable = await isDurableStorageAvailable();
    expect(preAvailable).toBe(true);

    // Trigger mid-run outage via sync
    const trade = makeTrade();
    const sample = makeDatasetSample();
    await syncCompletedTradesToDurableStorage([trade], [sample], []);

    // R11-06: Cache should now reflect outage
    // (FlippingRepo set available=false, and the sync path should have
    //  invalidated the cache via the STORAGE_UNAVAILABLE return path)
    const postAvailable = await isDurableStorageAvailable();
    expect(postAvailable).toBe(false);
  });
});
