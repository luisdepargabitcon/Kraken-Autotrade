/**
 * spotAiProductionOutageR12.test.ts — R12-02 production outage tests.
 *
 * Uses the REAL productionRepository by calling setDurableRepository(null).
 * Mocks ONLY db.execute to simulate connection loss / constraint violations.
 *
 * PROD_OUTAGE_R12_TRADE_01: INSERT throws → reprobe unavailable → STORAGE_UNAVAILABLE
 * PROD_OUTAGE_R12_TRADE_02: INSERT throws → reprobe healthy → INSERT_FAILED
 * PROD_OUTAGE_R12_GB_01: Giveback INSERT throws → reprobe unavailable → storageUnavailable=true
 * PROD_OUTAGE_R12_GB_02: Giveback INSERT throws → reprobe healthy → insertErrors=1
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
  isDurableStorageAvailable,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";
import type { CompletedTrade } from "../spotAiForwardTwin/spotAiCompletedTrades";
import type { SpotAiGivebackSample } from "../spotAiForwardTwin/spotAiForwardTwinTypes";

function makeTrade(): CompletedTrade {
  return {
    lotId: "lot-1",
    pair: "BTC/USD",
    entryScanId: "scan-1",
    entryTime: 1000,
    exitTime: 2000,
    entryPrice: 100,
    exitPrice: 110,
    initialStopPrice: 95,
    initialRiskUsd: 10,
    weightedAverageExitPrice: 110,
    weightedAverageEntryPrice: 100,
    totalEntryVolume: 1,
    totalExitVolume: 1,
    closedQty: 1,
    totalEntryFeeUsd: 1,
    entryFeeAllocatedUsd: 1,
    totalExitFeeUsd: 1,
    entryFeeUsd: 1,
    exitFeeUsd: 1,
    grossPnlUsd: 10,
    netPnlUsd: 8,
    mfe: 10,
    mae: -5,
    mfeR: 1,
    maeR: -0.5,
    exitReasonType: "TARGET",
  };
}

function makeGivebackSample(): SpotAiGivebackSample {
  return {
    sampleId: "gb-1",
    split: "train",
    groupId: "lot-1",
    state: {
      lotId: "lot-1",
      pair: "BTC/USD",
      timestamp: 1000,
      entryPrice: 100,
      currentR: 1.5,
      runningMfeR: 1,
      runningMaeR: -0.5,
      mfeUsd: 10,
      maeUsd: -5,
      minutesInTrade: 30,
      breakEvenActivated: false,
      trailingActivated: false,
      currentStopPrice: 95,
      highestPrice: 110,
      currentRUnavailable: false,
    } as any,
    labels: { future_MFE_R: 2.0 } as any,
    sourceForwardTwinSchemaVersion: 2,
    sourcePolicyVersion: "SPOT_POLICY_X",
  };
}

describe("R12-02 PRODUCTION OUTAGE (REAL productionRepository)", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    // Use the REAL production repository (not an injected fake)
    setDurableRepository(null);
    _resetDurableStorageCache();
  });

  // PROD_OUTAGE_R12_TRADE_01: INSERT throws → reprobe unavailable → STORAGE_UNAVAILABLE
  it("PROD_OUTAGE_R12_TRADE_01: INSERT throws → reprobe unavailable → STORAGE_UNAVAILABLE (not INSERT_FAILED)", async () => {
    let insertAttempted = false;

    mockExecute.mockImplementation((query: any) => {
      const sqlStr = String(query?.sql ?? query ?? "");

      // INSERT INTO training → throw "connection lost"
      if (sqlStr.includes("INSERT INTO spot_ai_forward_training_trades")) {
        insertAttempted = true;
        return Promise.reject(new Error("connection lost"));
      }
      // Availability checks (LIMIT 0) — BEFORE insert: success, AFTER insert: fail
      if (sqlStr.includes("LIMIT 0")) {
        if (insertAttempted) {
          // Reprobe after outage — connection still lost
          return Promise.reject(new Error("connection lost"));
        }
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const trade = makeTrade();
    const result = await persistCompletedTrade(trade, { f: 1 }, { l: 1 }, "SPOT_POLICY_X");

    expect(insertAttempted).toBe(true);
    expect(result.persisted).toBe(false);
    expect(result.reason).toBe("STORAGE_UNAVAILABLE");
    // Must NOT be INSERT_FAILED — the outage was detected via reprobe
    expect(result.reason).not.toBe("INSERT_FAILED");
  });

  // PROD_OUTAGE_R12_TRADE_02: INSERT throws → reprobe healthy → INSERT_FAILED
  it("PROD_OUTAGE_R12_TRADE_02: INSERT throws → reprobe healthy → INSERT_FAILED (not STORAGE_UNAVAILABLE)", async () => {
    let insertAttempted = false;

    mockExecute.mockImplementation((query: any) => {
      const sqlStr = String(query?.sql ?? query ?? "");

      // Training availability check (LIMIT 0) → success
      if (sqlStr.includes("FROM spot_ai_forward_training_trades") && sqlStr.includes("LIMIT 0")) {
        return Promise.resolve({ rows: [] });
      }
      // Giveback availability check (LIMIT 0) → success
      if (sqlStr.includes("FROM spot_ai_forward_giveback_samples") && sqlStr.includes("LIMIT 0")) {
        return Promise.resolve({ rows: [] });
      }
      // INSERT INTO training → throw "constraint violation"
      if (sqlStr.includes("INSERT INTO spot_ai_forward_training_trades")) {
        insertAttempted = true;
        return Promise.reject(new Error("constraint violation"));
      }
      // Reprobe: availability checks succeed (storage is healthy)
      if (sqlStr.includes("LIMIT 0")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const trade = makeTrade();
    const result = await persistCompletedTrade(trade, { f: 1 }, { l: 1 }, "SPOT_POLICY_X");

    expect(insertAttempted).toBe(true);
    expect(result.persisted).toBe(false);
    expect(result.reason).toBe("INSERT_FAILED");
    // Must NOT be STORAGE_UNAVAILABLE — the reprobe showed storage is healthy
    expect(result.reason).not.toBe("STORAGE_UNAVAILABLE");
  });

  // PROD_OUTAGE_R12_GB_01: Giveback INSERT throws → reprobe unavailable → storageUnavailable=true
  it("PROD_OUTAGE_R12_GB_01: Giveback INSERT throws → reprobe unavailable → storageUnavailable=true, insertErrors=0", async () => {
    let insertAttempted = false;

    mockExecute.mockImplementation((query: any) => {
      const sqlStr = String(query?.sql ?? query ?? "");

      // INSERT INTO giveback → throw "connection lost"
      if (sqlStr.includes("INSERT INTO spot_ai_forward_giveback_samples")) {
        insertAttempted = true;
        return Promise.reject(new Error("connection lost"));
      }
      // Availability checks (LIMIT 0) — BEFORE insert: success, AFTER insert: fail
      if (sqlStr.includes("LIMIT 0")) {
        if (insertAttempted) {
          // Reprobe after outage — connection still lost
          return Promise.reject(new Error("connection lost"));
        }
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const sample = makeGivebackSample();
    const result = await persistGivebackSamples([sample]);

    expect(insertAttempted).toBe(true);
    expect(result.storageUnavailable).toBe(true);
    expect(result.insertErrors).toBe(0);
  });

  // PROD_OUTAGE_R12_GB_02: Giveback INSERT throws → reprobe healthy → insertErrors=1
  it("PROD_OUTAGE_R12_GB_02: Giveback INSERT throws → reprobe healthy → insertErrors=1, storageUnavailable=false", async () => {
    let insertAttempted = false;

    mockExecute.mockImplementation((query: any) => {
      const sqlStr = String(query?.sql ?? query ?? "");

      // Training availability check (LIMIT 0) → success
      if (sqlStr.includes("FROM spot_ai_forward_training_trades") && sqlStr.includes("LIMIT 0")) {
        return Promise.resolve({ rows: [] });
      }
      // Giveback availability check (LIMIT 0) → success
      if (sqlStr.includes("FROM spot_ai_forward_giveback_samples") && sqlStr.includes("LIMIT 0")) {
        return Promise.resolve({ rows: [] });
      }
      // INSERT INTO giveback → throw "constraint violation"
      if (sqlStr.includes("INSERT INTO spot_ai_forward_giveback_samples")) {
        insertAttempted = true;
        return Promise.reject(new Error("constraint violation"));
      }
      // Reprobe: availability checks succeed (storage is healthy)
      if (sqlStr.includes("LIMIT 0")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const sample = makeGivebackSample();
    const result = await persistGivebackSamples([sample]);

    expect(insertAttempted).toBe(true);
    expect(result.storageUnavailable).toBe(false);
    expect(result.insertErrors).toBe(1);
  });
});
