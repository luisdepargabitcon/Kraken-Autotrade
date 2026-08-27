/**
 * spotAiDbMappingR6.test.ts — R6 DB MAPPING tests.
 *
 * R6: Tests the repository mapping layer that transforms DB rows into
 * RawBuyFill, RawSellFill, RawScanSizing, RawSupervisorData.
 * Uses a fake DbExecutor with deterministic rows.
 */

import { describe, it, expect } from "vitest";
import {
  mapBuyFillRow,
  mapSellFillRow,
  mapScanSizingRow,
  mapSupervisorRow,
  fetchRawDataFromDb,
  queryCompletedTradesWithExecutor,
  type BuyFillRow,
  type SellFillRow,
  type ScanSizingRow,
  type SupervisorRow,
  type DbExecutor,
} from "../spotAiForwardTwin/spotAiCompletedTradeRepository";

describe("R6 DB MAPPING tests", () => {
  // ─── Mapping function tests ───────────────────────────────────────────────

  it("DB_MAP_01: mapBuyFillRow transforms DB row correctly", () => {
    const row: BuyFillRow = {
      lot_id: "lot-1", pair: "BTC/USD", scan_id: "scan-1",
      fill_price: "100.5", fill_volume: "0.5", fee_usd: "1.5", ts: "1000",
    };
    const fill = mapBuyFillRow(row);
    expect(fill.lotId).toBe("lot-1");
    expect(fill.pair).toBe("BTC/USD");
    expect(fill.scanId).toBe("scan-1");
    expect(fill.fillPrice).toBe(100.5);
    expect(fill.fillVolume).toBe(0.5);
    expect(fill.feeUsd).toBe(1.5);
    expect(fill.timestamp).toBe(1000);
  });

  it("DB_MAP_02: mapSellFillRow transforms DB row correctly", () => {
    const row: SellFillRow = {
      lot_id: "lot-1", pair: "BTC/USD",
      fill_price: "110", fill_volume: "0.5", fee_usd: "1", ts: "2000",
    };
    const fill = mapSellFillRow(row);
    expect(fill.lotId).toBe("lot-1");
    expect(fill.fillPrice).toBe(110);
    expect(fill.fillVolume).toBe(0.5);
  });

  it("DB_MAP_03: mapScanSizingRow transforms DB row correctly", () => {
    const row: ScanSizingRow = {
      scan_id: "scan-1", pair: "BTC/USD", stop_price: "95", risk_usd: "10",
    };
    const sizing = mapScanSizingRow(row);
    expect(sizing.scanId).toBe("scan-1");
    expect(sizing.stopPrice).toBe(95);
    expect(sizing.riskUsd).toBe(10);
  });

  it("DB_MAP_04: mapSupervisorRow transforms DB row correctly", () => {
    const row: SupervisorRow = {
      lot_id: "lot-1", pair: "BTC/USD",
      mfe: "10", mae: "-5", mfe_r: "1", mae_r: "-0.5",
      exit_reason_type: "TARGET",
    };
    const sup = mapSupervisorRow(row);
    expect(sup.lotId).toBe("lot-1");
    expect(sup.mfe).toBe(10);
    expect(sup.mae).toBe(-5);
    expect(sup.exitReasonType).toBe("TARGET");
  });

  it("DB_MAP_05: mapSupervisorRow with null exit_reason_type", () => {
    const row: SupervisorRow = {
      lot_id: "lot-1", pair: "BTC/USD",
      mfe: "10", mae: "-5", mfe_r: "1", mae_r: "-0.5",
      exit_reason_type: null,
    };
    const sup = mapSupervisorRow(row);
    expect(sup.exitReasonType).toBeNull();
  });

  // ─── Fake executor integration ────────────────────────────────────────────

  /**
   * Fake executor that returns deterministic rows based on call order.
   * The repository calls execute() in a fixed order:
   *   0: BUY fills, 1: SELL fills, 2: SCAN sizings, 3: SUPERVISOR, 4: legacy count.
   */
  function makeFakeExecutor(rows: {
    buys?: BuyFillRow[];
    sells?: SellFillRow[];
    scans?: ScanSizingRow[];
    supervisors?: SupervisorRow[];
    legacyCount?: number;
  }): DbExecutor {
    let callIndex = 0;
    const responses = [
      rows.buys ?? [],
      rows.sells ?? [],
      rows.scans ?? [],
      rows.supervisors ?? [],
      [{ cnt: String(rows.legacyCount ?? 0) }],
    ];
    return {
      async execute(_q: any): Promise<{ rows: any[] }> {
        return { rows: responses[callIndex++] ?? [] };
      },
    };
  }

  it("DB_MAP_06: fetchRawDataFromDb maps all row types correctly", async () => {
    const executor = makeFakeExecutor({
      buys: [{
        lot_id: "lot-a", pair: "BTC/USD", scan_id: "scan-a",
        fill_price: "100", fill_volume: "1", fee_usd: "1", ts: "1000",
      }],
      sells: [{
        lot_id: "lot-a", pair: "BTC/USD",
        fill_price: "110", fill_volume: "1", fee_usd: "1", ts: "2000",
      }],
      scans: [{
        scan_id: "scan-a", pair: "BTC/USD", stop_price: "95", risk_usd: "10",
      }],
      supervisors: [{
        lot_id: "lot-a", pair: "BTC/USD",
        mfe: "10", mae: "-5", mfe_r: "1", mae_r: "-0.5",
        exit_reason_type: "TARGET",
      }],
      legacyCount: 0,
    });
    const rawData = await fetchRawDataFromDb(executor);
    expect(rawData.buyFills.length).toBe(1);
    expect(rawData.buyFills[0].lotId).toBe("lot-a");
    expect(rawData.sellFills.length).toBe(1);
    expect(rawData.scanSizings.length).toBe(1);
    expect(rawData.supervisors.length).toBe(1);
    expect(rawData.legacyNullLotBuyFillCount).toBe(0);
  });

  it("DB_MAP_07: queryCompletedTradesWithExecutor produces completed trade", async () => {
    const executor = makeFakeExecutor({
      buys: [{
        lot_id: "lot-b", pair: "BTC/USD", scan_id: "scan-b",
        fill_price: "100", fill_volume: "1", fee_usd: "1", ts: "1000",
      }],
      sells: [{
        lot_id: "lot-b", pair: "BTC/USD",
        fill_price: "110", fill_volume: "1", fee_usd: "1", ts: "2000",
      }],
      scans: [{
        scan_id: "scan-b", pair: "BTC/USD", stop_price: "95", risk_usd: "10",
      }],
      supervisors: [{
        lot_id: "lot-b", pair: "BTC/USD",
        mfe: "10", mae: "-5", mfe_r: "1", mae_r: "-0.5",
        exit_reason_type: "TARGET",
      }],
      legacyCount: 0,
    });
    const result = await queryCompletedTradesWithExecutor(executor);
    expect(result.completedTradeCount).toBe(1);
    expect(result.completedTrades[0].lotId).toBe("lot-b");
    expect(result.completedTrades[0].entryPrice).toBe(100);
    expect(result.completedTrades[0].exitPrice).toBe(110);
  });

  it("DB_MAP_08: legacy null-lot BUY fills counted separately", async () => {
    const executor = makeFakeExecutor({
      buys: [], sells: [], scans: [], supervisors: [],
      legacyCount: 3,
    });
    const rawData = await fetchRawDataFromDb(executor);
    expect(rawData.legacyNullLotBuyFillCount).toBe(3);
  });
});
