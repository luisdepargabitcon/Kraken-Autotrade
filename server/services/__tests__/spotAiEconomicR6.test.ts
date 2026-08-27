/**
 * spotAiEconomicR6.test.ts — R6 ECON_R6 tests: Exact fill quantity and PnL.
 *
 * R6 fixes:
 *   - No phantom exit qty (no relative 1% tolerance).
 *   - closedQty = min(entry, exit) only when within QTY_EPSILON.
 *   - Entry fee allocated proportionally to closed portion.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeCompletedTrades,
  validateEconomic,
  QTY_EPSILON,
  type NormalizeInput,
  type RawBuyFill,
  type RawSellFill,
  type RawScanSizing,
  type RawSupervisorData,
} from "../spotAiForwardTwin/spotAiCompletedTradeNormalizer";

function makeBuyFill(lotId: string, pair: string, scanId: string, price: number, volume: number, fee: number, ts: number): RawBuyFill {
  return { lotId, pair, scanId, fillPrice: price, fillVolume: volume, feeUsd: fee, timestamp: ts };
}
function makeSellFill(lotId: string, pair: string, price: number, volume: number, fee: number, ts: number): RawSellFill {
  return { lotId, pair, fillPrice: price, fillVolume: volume, feeUsd: fee, timestamp: ts };
}
function makeScan(scanId: string, pair: string, stop: number, risk: number): RawScanSizing {
  return { scanId, pair, stopPrice: stop, riskUsd: risk };
}
function makeSupervisor(lotId: string, pair: string, mfe: number, mae: number, mfeR: number, maeR: number): RawSupervisorData {
  return { lotId, pair, mfe, mae, mfeR, maeR, exitReasonType: "TARGET" };
}
function makeInput(buys: RawBuyFill[], sells: RawSellFill[], scans: RawScanSizing[], supervisors: RawSupervisorData[], legacyNullLot = 0): NormalizeInput {
  return { buyFills: buys, sellFills: sells, scanSizings: scans, supervisors, legacyNullLotBuyFillCount: legacyNullLot };
}

describe("R6 ECON_R6 tests — exact fill quantity and PnL", () => {
  // ECON_R6_01: entry=1, exit=0.995 → PARTIAL_EXIT
  it("ECON_R6_01: entry=1, exit=0.995 → PARTIAL_EXIT, no PnL", () => {
    const result = normalizeCompletedTrades(makeInput(
      [makeBuyFill("lot-r6-1", "BTC/USD", "scan-1", 100, 1, 1, 1000)],
      [makeSellFill("lot-r6-1", "BTC/USD", 110, 0.995, 1, 2000)],
      [makeScan("scan-1", "BTC/USD", 95, 10)],
      [makeSupervisor("lot-r6-1", "BTC/USD", 10, -5, 1, -0.5)],
    ));
    expect(result.completedTradeCount).toBe(0);
    expect(result.partialExitTrades).toBe(1);
  });

  // ECON_R6_02: entry=1, exit=1 exactly → COMPLETED, closedQty=1
  it("ECON_R6_02: entry=1, exit=1 → COMPLETED, closedQty=1", () => {
    const result = normalizeCompletedTrades(makeInput(
      [makeBuyFill("lot-r6-2", "BTC/USD", "scan-2", 100, 1, 1, 1000)],
      [makeSellFill("lot-r6-2", "BTC/USD", 110, 1, 1, 2000)],
      [makeScan("scan-2", "BTC/USD", 95, 10)],
      [makeSupervisor("lot-r6-2", "BTC/USD", 10, -5, 1, -0.5)],
    ));
    expect(result.completedTradeCount).toBe(1);
    expect(result.completedTrades[0].closedQty).toBe(1);
  });

  // ECON_R6_03: entry=1, exit=1.005 → EXIT_VOLUME_OVERFLOW
  it("ECON_R6_03: entry=1, exit=1.005 → EXIT_VOLUME_OVERFLOW", () => {
    const result = normalizeCompletedTrades(makeInput(
      [makeBuyFill("lot-r6-3", "BTC/USD", "scan-3", 100, 1, 1, 1000)],
      [makeSellFill("lot-r6-3", "BTC/USD", 110, 1.005, 1, 2000)],
      [makeScan("scan-3", "BTC/USD", 95, 10)],
      [makeSupervisor("lot-r6-3", "BTC/USD", 10, -5, 1, -0.5)],
    ));
    expect(result.completedTradeCount).toBe(0);
    expect(result.exitVolumeOverflowTrades).toBe(1);
  });

  // ECON_R6_04: difference within epsilon → COMPLETED, PnL uses min(entry, exit)
  it("ECON_R6_04: within epsilon → COMPLETED, closedQty = min(entry, exit)", () => {
    // Use a difference smaller than QTY_EPSILON
    const entry = 1.0;
    const exit = entry + QTY_EPSILON / 2; // within epsilon
    const result = normalizeCompletedTrades(makeInput(
      [makeBuyFill("lot-r6-4", "BTC/USD", "scan-4", 100, entry, 1, 1000)],
      [makeSellFill("lot-r6-4", "BTC/USD", 110, exit, 1, 2000)],
      [makeScan("scan-4", "BTC/USD", 95, 10)],
      [makeSupervisor("lot-r6-4", "BTC/USD", 10, -5, 1, -0.5)],
    ));
    expect(result.completedTradeCount).toBe(1);
    const trade = result.completedTrades[0];
    // closedQty = min(entry, exit) = entry (since exit is slightly larger)
    expect(trade.closedQty).toBeCloseTo(entry, 10);
    // gross = (110 - 100) * closedQty ≈ 10 * 1 = 10
    expect(trade.grossPnlUsd).toBeCloseTo(10, 5);
  });

  // ECON_R6_05: no nonexistent quantity receives SELL price
  it("ECON_R6_05: no nonexistent quantity receives SELL price", () => {
    // entry=2, exit=1 → PARTIAL_EXIT, no completed trade, no PnL
    const result = normalizeCompletedTrades(makeInput(
      [makeBuyFill("lot-r6-5", "BTC/USD", "scan-5", 100, 2, 2, 1000)],
      [makeSellFill("lot-r6-5", "BTC/USD", 110, 1, 1, 2000)],
      [makeScan("scan-5", "BTC/USD", 95, 10)],
      [makeSupervisor("lot-r6-5", "BTC/USD", 10, -5, 1, -0.5)],
    ));
    expect(result.completedTradeCount).toBe(0);
    expect(result.partialExitTrades).toBe(1);
    // No trade exists → no PnL at all, no phantom quantity.
  });

  // ECON_R6_06: entry fees not imputed to unclosed quantity
  it("ECON_R6_06: entry fee allocated proportionally to closed qty", () => {
    // entry=1, exit=1 (exact), entry fee=4
    // allocated = 4 * (1/1) = 4 (full allocation since fully closed)
    const result = normalizeCompletedTrades(makeInput(
      [makeBuyFill("lot-r6-6", "BTC/USD", "scan-6", 100, 1, 4, 1000)],
      [makeSellFill("lot-r6-6", "BTC/USD", 101, 1, 2, 2000)],
      [makeScan("scan-6", "BTC/USD", 95, 10)],
      [makeSupervisor("lot-r6-6", "BTC/USD", 1, -1, 0.1, -0.1)],
    ));
    expect(result.completedTradeCount).toBe(1);
    const trade = result.completedTrades[0];
    // totalEntryFeeUsd = 4, allocated = 4 * (1/1) = 4
    expect(trade.totalEntryFeeUsd).toBe(4);
    expect(trade.entryFeeAllocatedUsd).toBe(4);
    // gross = (101-100)*1 = 1, net = 1 - 4 - 2 = -5
    expect(trade.grossPnlUsd).toBe(1);
    expect(trade.netPnlUsd).toBe(-5);
  });

  // R6: verify QTY_EPSILON is a pure numeric epsilon, not a business tolerance
  it("R6_QTY_EPSILON: epsilon is pure numeric (<= 1e-8)", () => {
    expect(QTY_EPSILON).toBeLessThanOrEqual(1e-8);
    expect(QTY_EPSILON).toBeGreaterThan(0);
  });
});
