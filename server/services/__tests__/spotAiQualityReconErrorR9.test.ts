/**
 * spotAiQualityReconErrorR9.test.ts — R9-11 quality metrics real recon ERROR.
 *
 * R9-11: Test that invokes runDurableReconciliation() with a repo that
 * produces a real error. Verify status=ERROR, errors>0.
 * Do NOT use sync directo as substitute for reconciliation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockDbExecute } = vi.hoisted(() => ({
  mockDbExecute: vi.fn(),
}));
vi.mock("../../db", () => ({
  db: { execute: mockDbExecute },
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
  runDurableReconciliation,
  getReconciliationStatus,
  getLastReconciliationErrors,
  getLastInsertErrors,
  getReconciliationErrorCodes,
  type DurableRepository,
  type DurableInsertResult,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";

class ErrorRepo implements DurableRepository {
  async isAvailable() { return true; }
  async getExistingTradeFingerprint() { return null; }
  async insertTrade() { return "INSERT_ERROR" as DurableInsertResult; }
  async getStoredTradeCount() { return 0; }
  async getTrainableTradeCount() { return 0; }
  async getAllTradeKeys() { return []; }
  async getExistingGivebackFingerprint() { return null; }
  async insertGiveback() { return "INSERT_ERROR" as DurableInsertResult; }
  async getAllGivebackKeys() { return []; }
}

describe("R9-11 QUALITY REAL RECON ERROR", () => {
  beforeEach(() => {
    mockDbExecute.mockReset();
    _resetDurableStorageCache();
    _resetReconciliationMetrics();
    _resetReconciliationRunning();
  });

  it("QUALITY_R9_RECON_ERROR_01: runDurableReconciliation with insert errors → status=ERROR", async () => {
    setDurableRepository(new ErrorRepo());
    _resetDurableStorageCache();

    // Mock db to return valid snapshots so backfill reaches sync
    mockDbExecute.mockImplementation((query: any) => {
      const sqlStr = String(query?.sql ?? query ?? "");
      if (sqlStr.includes("LIMIT 0")) return Promise.resolve({ rows: [] });
      if (sqlStr.includes("SELECT data FROM spot_forward_twin_snapshots") && sqlStr.includes("ORDER BY")) {
        return Promise.resolve({
          rows: [
            { data: { snapshotType: "SCAN", schemaVersion: 1, policyVersion: "SPOT_POLICY_X", pair: "BTC/USD", timestamp: 1000, scanId: "scan-1", signalId: "sig-1", intentId: "intent-1", ticker: { bid: 100, ask: 100.1, last: 100 }, regime: { atrPct: 1.5, adx: 25, trend: "up" }, volume: { ratio: 1.2, baseVolume: 1000 }, signal: { type: "BREAKOUT", strength: 0.8 }, capital: { availableUsd: 10000, riskPerTradeUsd: 100 }, sizing: { stopPrice: 95, riskUsd: 10, qty: 1, notionalUsd: 100 } } },
            { data: { snapshotType: "FILL", schemaVersion: 1, pair: "BTC/USD", timestamp: 1100, fill: { lotId: "lot-1", side: "BUY", orderId: "o1", executedAt: 1100, fillPrice: 100, fillVolume: 1, feeUsd: 1, notionalUsd: 100, slippage: 0, quality: "ok" }, execIntent: { positionLotId: "lot-1", scanId: "scan-1" } } },
            { data: { snapshotType: "SUPERVISOR", schemaVersion: 2, policyVersion: "SPOT_POLICY_X", pair: "BTC/USD", timestamp: 1500, position: { lotId: "lot-1", entryPrice: 100, currentR: 1.5, mfe: 10, mae: -5, mfeR: 1.0, maeR: -0.5, currentStopPrice: 95, highestPrice: 110 }, exitDecision: { reasonType: null } } },
            { data: { snapshotType: "FILL", schemaVersion: 1, pair: "BTC/USD", timestamp: 2000, fill: { lotId: "lot-1", side: "SELL", orderId: "o2", executedAt: 2000, fillPrice: 110, fillVolume: 1, feeUsd: 1, notionalUsd: 110, slippage: 0, quality: "ok" }, execIntent: { positionLotId: "lot-1" } } },
          ],
        });
      }
      if (sqlStr.includes("'FILL'") && sqlStr.includes("'BUY'")) {
        return Promise.resolve({ rows: [{ lot_id: "lot-1", pair: "BTC/USD", scan_id: "scan-1", fill_price: 100, fill_volume: 1, fee_usd: 1, ts: 1100 }] });
      }
      if (sqlStr.includes("'FILL'") && sqlStr.includes("'SELL'")) {
        return Promise.resolve({ rows: [{ lot_id: "lot-1", pair: "BTC/USD", fill_price: 110, fill_volume: 1, fee_usd: 1, ts: 2000 }] });
      }
      if (sqlStr.includes("'SCAN'")) {
        return Promise.resolve({ rows: [{ scan_id: "scan-1", pair: "BTC/USD", stop_price: 95, risk_usd: 10 }] });
      }
      if (sqlStr.includes("'SUPERVISOR'")) {
        return Promise.resolve({ rows: [{ lot_id: "lot-1", pair: "BTC/USD", mfe: 10, mae: -5, mfe_r: 1, mae_r: -0.5, exit_reason_type: "TARGET" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await runDurableReconciliation();

    expect(getReconciliationStatus()).toBe("ERROR");
    expect(getLastReconciliationErrors()).not.toBeNull();
    expect(getLastReconciliationErrors()!).toBeGreaterThan(0);
    // Insert errors should be reflected
    expect(getLastInsertErrors()).not.toBeNull();
    expect(getLastInsertErrors()!).toBeGreaterThan(0);
    // Error codes should contain DURABLE_INSERT_FAILED
    expect(getReconciliationErrorCodes()).toContain("DURABLE_INSERT_FAILED");
  });
});
