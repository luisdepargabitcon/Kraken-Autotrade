/**
 * spotAiEconomicR5.test.ts — R5 ECON_DB tests: Production economic validation.
 *
 * These tests exercise the SHARED `normalizeCompletedTrades()` core that both
 * `queryCompletedTrades()` (DB path) and `buildCompletedTradesFromSnapshots()`
 * (in-memory path) use. This guarantees DB ↔ builder parity.
 *
 * Tests cover:
 *   ECON_DB_01: SCAN stop/risk invalid → no CompletedTrade
 *   ECON_DB_02: two BUY partial fills → one trade, aggregated
 *   ECON_DB_03: two BUY fills with incompatible scanId → correlation incomplete
 *   ECON_DB_04: two SELL partial fills → one completed trade
 *   ECON_DB_05: SELL insufficient → PARTIAL_EXIT
 *   ECON_DB_06: SELL overfill → EXIT_VOLUME_OVERFLOW
 *   ECON_DB_07: dust tolerance → PnL uses closed quantity
 *   ECON_DB_08: invalid fee/price/qty/risk → fail closed
 *   ECON_DB_09: gross winner + fees → net loser
 *   ECON_DB_10: multiple BUY and SELL with distinct prices → weighted correct
 *   ECON_PARITY_01: same fixture → same semantics in both paths
 *   ECON_ONE_LOT_01: max 1 CompletedTrade per lotId+pair
 */

import { describe, it, expect } from "vitest";
import {
  normalizeCompletedTrades,
  validateEconomic,
  VOLUME_COVERAGE_TOLERANCE,
  VOLUME_OVERFILL_THRESHOLD,
  type NormalizeInput,
  type RawBuyFill,
  type RawSellFill,
  type RawScanSizing,
  type RawSupervisorData,
} from "../spotAiForwardTwin/spotAiCompletedTradeNormalizer";
import { buildCompletedTradesFromSnapshots } from "../spotAiForwardTwin/spotAiCompletedTrades";
import type { ForwardTwinSnapshot } from "../spot/spotForwardTwinTypes";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBuyFill(
  lotId: string, pair: string, scanId: string,
  price: number, volume: number, fee: number, ts: number,
): RawBuyFill {
  return { lotId, pair, scanId, fillPrice: price, fillVolume: volume, feeUsd: fee, timestamp: ts };
}

function makeSellFill(
  lotId: string, pair: string,
  price: number, volume: number, fee: number, ts: number,
): RawSellFill {
  return { lotId, pair, fillPrice: price, fillVolume: volume, feeUsd: fee, timestamp: ts };
}

function makeScan(scanId: string, pair: string, stop: number, risk: number): RawScanSizing {
  return { scanId, pair, stopPrice: stop, riskUsd: risk };
}

function makeSupervisor(
  lotId: string, pair: string,
  mfe: number, mae: number, mfeR: number, maeR: number,
): RawSupervisorData {
  return { lotId, pair, mfe, mae, mfeR, maeR, exitReasonType: "TARGET" };
}

function makeInput(
  buys: RawBuyFill[], sells: RawSellFill[],
  scans: RawScanSizing[], supervisors: RawSupervisorData[],
  legacyNullLot = 0,
): NormalizeInput {
  return {
    buyFills: buys, sellFills: sells, scanSizings: scans,
    supervisors, legacyNullLotBuyFillCount: legacyNullLot,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("R5 ECON_DB tests — production economic validation", () => {
  // ECON_DB_01: SCAN stop/risk invalid → no CompletedTrade
  it("ECON_DB_01: invalid SCAN stop/risk → no completed trade", () => {
    const input = makeInput(
      [makeBuyFill("lot-1", "BTC/USD", "scan-1", 100, 1, 1, 1000)],
      [makeSellFill("lot-1", "BTC/USD", 110, 1, 1, 2000)],
      [makeScan("scan-1", "BTC/USD", 0, 10)], // stop=0 invalid
      [makeSupervisor("lot-1", "BTC/USD", 10, -5, 1, -0.5)],
    );
    const result = normalizeCompletedTrades(input);
    expect(result.completedTradeCount).toBe(0);
    expect(result.economicInvalidTrades).toBe(1);
  });

  // ECON_DB_02: two BUY partial fills → one trade, aggregated
  it("ECON_DB_02: two BUY partial fills → one trade with weighted entry", () => {
    const input = makeInput(
      [
        makeBuyFill("lot-2", "BTC/USD", "scan-2", 100, 0.5, 1, 1000),
        makeBuyFill("lot-2", "BTC/USD", "scan-2", 102, 0.5, 1, 1010),
      ],
      [makeSellFill("lot-2", "BTC/USD", 110, 1, 1, 2000)],
      [makeScan("scan-2", "BTC/USD", 95, 10)],
      [makeSupervisor("lot-2", "BTC/USD", 10, -5, 1, -0.5)],
    );
    const result = normalizeCompletedTrades(input);
    expect(result.completedTradeCount).toBe(1);
    const trade = result.completedTrades[0];
    // Weighted entry: (100*0.5 + 102*0.5) / 1 = 101
    expect(trade.entryPrice).toBe(101);
    expect(trade.totalEntryVolume).toBe(1);
    expect(trade.entryFeeUsd).toBe(2);
  });

  // ECON_DB_03: two BUY fills with incompatible scanId → correlation incomplete
  it("ECON_DB_03: incompatible scanIds → CORRELATION_INCOMPLETE", () => {
    const input = makeInput(
      [
        makeBuyFill("lot-3", "BTC/USD", "scan-a", 100, 0.5, 1, 1000),
        makeBuyFill("lot-3", "BTC/USD", "scan-b", 102, 0.5, 1, 1010),
      ],
      [makeSellFill("lot-3", "BTC/USD", 110, 1, 1, 2000)],
      [
        makeScan("scan-a", "BTC/USD", 95, 10),
        makeScan("scan-b", "BTC/USD", 95, 10),
      ],
      [makeSupervisor("lot-3", "BTC/USD", 10, -5, 1, -0.5)],
    );
    const result = normalizeCompletedTrades(input);
    expect(result.completedTradeCount).toBe(0);
    expect(result.correlationIncompleteTrades).toBe(1);
  });

  // ECON_DB_04: two SELL partial fills → one completed trade
  it("ECON_DB_04: two SELL partial fills → one completed trade", () => {
    const input = makeInput(
      [makeBuyFill("lot-4", "BTC/USD", "scan-4", 100, 1, 1, 1000)],
      [
        makeSellFill("lot-4", "BTC/USD", 108, 0.5, 1, 2000),
        makeSellFill("lot-4", "BTC/USD", 112, 0.5, 1, 2100),
      ],
      [makeScan("scan-4", "BTC/USD", 95, 10)],
      [makeSupervisor("lot-4", "BTC/USD", 12, -5, 1.2, -0.5)],
    );
    const result = normalizeCompletedTrades(input);
    expect(result.completedTradeCount).toBe(1);
    const trade = result.completedTrades[0];
    // Weighted exit: (108*0.5 + 112*0.5) / 1 = 110
    expect(trade.exitPrice).toBe(110);
    expect(trade.exitFeeUsd).toBe(2);
  });

  // ECON_DB_05: SELL insufficient → PARTIAL_EXIT
  it("ECON_DB_05: SELL insufficient → PARTIAL_EXIT", () => {
    const input = makeInput(
      [makeBuyFill("lot-5", "BTC/USD", "scan-5", 100, 1, 1, 1000)],
      [makeSellFill("lot-5", "BTC/USD", 110, 0.5, 1, 2000)], // only 50%
      [makeScan("scan-5", "BTC/USD", 95, 10)],
      [makeSupervisor("lot-5", "BTC/USD", 10, -5, 1, -0.5)],
    );
    const result = normalizeCompletedTrades(input);
    expect(result.completedTradeCount).toBe(0);
    expect(result.partialExitTrades).toBe(1);
  });

  // ECON_DB_06: SELL overfill → EXIT_VOLUME_OVERFLOW
  it("ECON_DB_06: SELL overfill → EXIT_VOLUME_OVERFLOW", () => {
    const input = makeInput(
      [makeBuyFill("lot-6", "BTC/USD", "scan-6", 100, 1, 1, 1000)],
      [makeSellFill("lot-6", "BTC/USD", 110, 1.5, 1, 2000)], // 150% overfill
      [makeScan("scan-6", "BTC/USD", 95, 10)],
      [makeSupervisor("lot-6", "BTC/USD", 10, -5, 1, -0.5)],
    );
    const result = normalizeCompletedTrades(input);
    expect(result.completedTradeCount).toBe(0);
    expect(result.exitVolumeOverflowTrades).toBe(1);
  });

  // ECON_DB_07: R6 — 99.5% sold is PARTIAL_EXIT (no phantom exit qty)
  it("ECON_DB_07: 99.5% sold → PARTIAL_EXIT (no phantom exit qty)", () => {
    const input = makeInput(
      [makeBuyFill("lot-7", "BTC/USD", "scan-7", 100, 1, 1, 1000)],
      [makeSellFill("lot-7", "BTC/USD", 110, 0.995, 1, 2000)], // 99.5% — NOT within epsilon
      [makeScan("scan-7", "BTC/USD", 95, 10)],
      [makeSupervisor("lot-7", "BTC/USD", 10, -5, 1, -0.5)],
    );
    const result = normalizeCompletedTrades(input);
    // R6: 99.5% is NOT completed — no relative tolerance.
    expect(result.completedTradeCount).toBe(0);
    expect(result.partialExitTrades).toBe(1);
  });

  // ECON_DB_08: invalid fee/price/qty/risk → fail closed
  it("ECON_DB_08: negative fee → ECONOMIC_INVALID", () => {
    const input = makeInput(
      [makeBuyFill("lot-8", "BTC/USD", "scan-8", 100, 1, -1, 1000)], // negative fee
      [makeSellFill("lot-8", "BTC/USD", 110, 1, 1, 2000)],
      [makeScan("scan-8", "BTC/USD", 95, 10)],
      [makeSupervisor("lot-8", "BTC/USD", 10, -5, 1, -0.5)],
    );
    const result = normalizeCompletedTrades(input);
    expect(result.completedTradeCount).toBe(0);
    expect(result.economicInvalidTrades).toBe(1);
  });

  it("ECON_DB_08b: stop >= entry → ECONOMIC_INVALID (not LONG)", () => {
    const input = makeInput(
      [makeBuyFill("lot-8b", "BTC/USD", "scan-8b", 100, 1, 1, 1000)],
      [makeSellFill("lot-8b", "BTC/USD", 110, 1, 1, 2000)],
      [makeScan("scan-8b", "BTC/USD", 100, 10)], // stop = entry (not < entry)
      [makeSupervisor("lot-8b", "BTC/USD", 10, -5, 1, -0.5)],
    );
    const result = normalizeCompletedTrades(input);
    expect(result.completedTradeCount).toBe(0);
    expect(result.economicInvalidTrades).toBe(1);
  });

  // ECON_DB_09: gross winner + fees → net loser
  it("ECON_DB_09: gross winner + fees → net loser", () => {
    const input = makeInput(
      [makeBuyFill("lot-9", "BTC/USD", "scan-9", 100, 1, 3, 1000)],
      [makeSellFill("lot-9", "BTC/USD", 101, 1, 3, 2000)], // gross +1, fees -6
      [makeScan("scan-9", "BTC/USD", 95, 10)],
      [makeSupervisor("lot-9", "BTC/USD", 1, -1, 0.1, -0.1)],
    );
    const result = normalizeCompletedTrades(input);
    expect(result.completedTradeCount).toBe(1);
    const trade = result.completedTrades[0];
    expect(trade.grossPnlUsd).toBe(1);
    expect(trade.netPnlUsd).toBe(-5); // 1 - 3 - 3 = -5
  });

  // ECON_DB_10: multiple BUY and SELL with distinct prices → weighted correct
  it("ECON_DB_10: multiple BUY and SELL → weighted entry/exit and PnL", () => {
    const input = makeInput(
      [
        makeBuyFill("lot-10", "BTC/USD", "scan-10", 100, 0.3, 1, 1000),
        makeBuyFill("lot-10", "BTC/USD", "scan-10", 105, 0.7, 2, 1010),
      ],
      [
        makeSellFill("lot-10", "BTC/USD", 110, 0.4, 1, 2000),
        makeSellFill("lot-10", "BTC/USD", 115, 0.6, 2, 2100),
      ],
      [makeScan("scan-10", "BTC/USD", 95, 10)],
      [makeSupervisor("lot-10", "BTC/USD", 15, -5, 1.5, -0.5)],
    );
    const result = normalizeCompletedTrades(input);
    expect(result.completedTradeCount).toBe(1);
    const trade = result.completedTrades[0];
    // Weighted entry: (100*0.3 + 105*0.7) / 1 = 103.5
    expect(trade.entryPrice).toBe(103.5);
    // Weighted exit: (110*0.4 + 115*0.6) / 1 = 113
    expect(trade.exitPrice).toBe(113);
    // gross = (113 - 103.5) * 1 = 9.5
    expect(trade.grossPnlUsd).toBe(9.5);
    // net = 9.5 - 3 - 3 = 3.5
    expect(trade.netPnlUsd).toBe(3.5);
  });

  // ECON_PARITY_01: same fixture → same semantics in both paths
  it("ECON_PARITY_01: normalizer and snapshot builder produce same result", () => {
    // Build the same data as snapshots and as raw input
    const scanSnapshot: ForwardTwinSnapshot = {
      schemaVersion: 1, snapshotType: "SCAN", pair: "BTC/USD", scanId: "scan-p",
      timestamp: 1000, ticker: { bid: 100, ask: 100, last: 100 } as any,
      regime: { atrPct: 1, adx: 20 } as any, volume: {} as any,
      signal: {} as any, capital: {} as any,
      sizing: { stopPrice: 95, riskUsd: 10, positionSizeUsd: 1000, notionalUsd: 1000 },
    } as any;
    const supSnapshot: ForwardTwinSnapshot = {
      schemaVersion: 2, snapshotType: "SUPERVISOR", pair: "BTC/USD", scanId: "scan-p",
      timestamp: 1500,
      position: { lotId: "lot-p", pair: "BTC/USD", entryPrice: 100, mfe: 10, mae: -5, mfeR: 1, maeR: -0.5 } as any,
      exitDecision: { shouldExit: false, reasonType: null } as any,
      auditMetrics: { mfeUsd: 10, maeUsd: -5, mfeR: 1, maeR: -0.5 } as any,
    } as any;
    const buyFill: ForwardTwinSnapshot = {
      schemaVersion: 1, snapshotType: "FILL", pair: "BTC/USD", scanId: "scan-p",
      timestamp: 1100,
      fill: { lotId: "lot-p", side: "BUY", fillPrice: 100, fillVolume: 1, feeUsd: 1, notionalUsd: 100 } as any,
    } as any;
    const sellFill: ForwardTwinSnapshot = {
      schemaVersion: 1, snapshotType: "FILL", pair: "BTC/USD", scanId: "scan-p",
      timestamp: 2000,
      fill: { lotId: "lot-p", side: "SELL", fillPrice: 110, fillVolume: 1, feeUsd: 1, notionalUsd: 110 } as any,
    } as any;

    const snapResult = buildCompletedTradesFromSnapshots({
      scans: [scanSnapshot], supervisors: [supSnapshot], fills: [buyFill, sellFill],
    });
    const rawResult = normalizeCompletedTrades(makeInput(
      [makeBuyFill("lot-p", "BTC/USD", "scan-p", 100, 1, 1, 1100)],
      [makeSellFill("lot-p", "BTC/USD", 110, 1, 1, 2000)],
      [makeScan("scan-p", "BTC/USD", 95, 10)],
      [makeSupervisor("lot-p", "BTC/USD", 10, -5, 1, -0.5)],
    ));

    expect(snapResult.completedTradeCount).toBe(rawResult.completedTradeCount);
    expect(snapResult.partialExitTrades).toBe(rawResult.partialExitTrades);
    if (snapResult.completedTrades.length > 0 && rawResult.completedTrades.length > 0) {
      const s = snapResult.completedTrades[0];
      const r = rawResult.completedTrades[0];
      expect(s.entryPrice).toBe(r.entryPrice);
      expect(s.exitPrice).toBe(r.exitPrice);
      expect(s.grossPnlUsd).toBe(r.grossPnlUsd);
      expect(s.netPnlUsd).toBe(r.netPnlUsd);
      expect(s.closedQty).toBe(r.closedQty);
    }
  });

  // ECON_ONE_LOT_01: max 1 CompletedTrade per lotId+pair
  it("ECON_ONE_LOT_01: maximum one completed trade per lotId+pair", () => {
    const input = makeInput(
      [
        makeBuyFill("lot-x", "BTC/USD", "scan-x", 100, 0.5, 1, 1000),
        makeBuyFill("lot-x", "BTC/USD", "scan-x", 102, 0.5, 1, 1010),
      ],
      [
        makeSellFill("lot-x", "BTC/USD", 108, 0.3, 1, 2000),
        makeSellFill("lot-x", "BTC/USD", 110, 0.3, 1, 2100),
        makeSellFill("lot-x", "BTC/USD", 112, 0.4, 1, 2200),
      ],
      [makeScan("scan-x", "BTC/USD", 95, 10)],
      [makeSupervisor("lot-x", "BTC/USD", 12, -5, 1.2, -0.5)],
    );
    const result = normalizeCompletedTrades(input);
    expect(result.completedTradeCount).toBe(1);
    // Verify no duplicate lotId+pair
    const keys = new Set(result.completedTrades.map((t) => `${t.lotId}|${t.pair}`));
    expect(keys.size).toBe(result.completedTradeCount);
  });

  // R5: validateEconomic unit tests
  it("validateEconomic: valid inputs → null", () => {
    expect(validateEconomic(100, 110, 1, 1, 1, 1, 95, 10, 1000, 2000)).toBeNull();
  });

  it("validateEconomic: NaN entry price → ECONOMIC_INVALID", () => {
    expect(validateEconomic(NaN, 110, 1, 1, 1, 1, 95, 10, 1000, 2000)).toBe("ECONOMIC_INVALID");
  });

  it("validateEconomic: zero risk → ECONOMIC_INVALID", () => {
    expect(validateEconomic(100, 110, 1, 1, 1, 1, 95, 0, 1000, 2000)).toBe("ECONOMIC_INVALID");
  });

  it("validateEconomic: stop >= entry → ECONOMIC_INVALID", () => {
    expect(validateEconomic(100, 110, 1, 1, 1, 1, 100, 10, 1000, 2000)).toBe("ECONOMIC_INVALID");
  });

  // R5: risk fallback eliminated
  it("R5_RISK_FALLBACK: invalid risk → fail closed (no fallback to 1)", () => {
    const input = makeInput(
      [makeBuyFill("lot-rf", "BTC/USD", "scan-rf", 100, 1, 1, 1000)],
      [makeSellFill("lot-rf", "BTC/USD", 110, 1, 1, 2000)],
      [makeScan("scan-rf", "BTC/USD", 95, 0)], // risk=0 invalid
      [makeSupervisor("lot-rf", "BTC/USD", 10, -5, 1, -0.5)],
    );
    const result = normalizeCompletedTrades(input);
    expect(result.completedTradeCount).toBe(0);
    expect(result.economicInvalidTrades).toBe(1);
  });
});
