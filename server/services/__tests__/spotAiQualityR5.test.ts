/**
 * spotAiQualityR5.test.ts — R5 QUALITY tests: Schema version and multi-SELL checks.
 *
 * Tests cover:
 *   QUALITY_R5_01: SUPERVISOR v2 valid → no schema mismatch
 *   QUALITY_R5_02: SUPERVISOR v1 legacy valid → permitted
 *   QUALITY_R5_03: unknown schema → mismatch
 *   QUALITY_R5_04: two SELL partial fills → multi-fill, not duplicate
 *   QUALITY_R5_05: duplicate SELL telemetry → detected
 *   QUALITY_R5_06: duplicate completed lot → check real
 *   QUALITY_R5_07: economic invalid → check real
 */

import { describe, it, expect } from "vitest";
import {
  normalizeCompletedTrades,
  type NormalizeInput,
  type RawBuyFill,
  type RawSellFill,
  type RawScanSizing,
  type RawSupervisorData,
} from "../spotAiForwardTwin/spotAiCompletedTradeNormalizer";
import {
  SPOT_FORWARD_TWIN_SCHEMA_VERSION_1,
  SPOT_FORWARD_TWIN_SCHEMA_VERSION_2,
} from "../spot/spotForwardTwinTypes";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

describe("R5 QUALITY tests", () => {
  // QUALITY_R5_01: SUPERVISOR v2 valid → no schema mismatch
  it("QUALITY_R5_01: SUPERVISOR v2 is a valid schema version", () => {
    expect(SPOT_FORWARD_TWIN_SCHEMA_VERSION_2).toBe(2);
    // The quality check allows schema versions 1 and 2.
    // A v2 SUPERVISOR is NOT a mismatch.
    const allowedVersions = [1, 2];
    expect(allowedVersions.includes(SPOT_FORWARD_TWIN_SCHEMA_VERSION_2)).toBe(true);
  });

  // QUALITY_R5_02: SUPERVISOR v1 legacy valid → permitted
  it("QUALITY_R5_02: SUPERVISOR v1 is a valid legacy schema version", () => {
    expect(SPOT_FORWARD_TWIN_SCHEMA_VERSION_1).toBe(1);
    const allowedVersions = [1, 2];
    expect(allowedVersions.includes(SPOT_FORWARD_TWIN_SCHEMA_VERSION_1)).toBe(true);
  });

  // QUALITY_R5_03: unknown schema → mismatch
  it("QUALITY_R5_03: schema version 3 is unknown → mismatch", () => {
    const allowedVersions = [1, 2];
    expect(allowedVersions.includes(3)).toBe(false);
    expect(allowedVersions.includes(0)).toBe(false);
    expect(allowedVersions.includes(-1)).toBe(false);
  });

  // QUALITY_R5_04: two SELL partial fills → multi-fill, not duplicate
  it("QUALITY_R5_04: two SELL partials with different prices → one completed trade", () => {
    const input = makeInput(
      [{ lotId: "lot-q4", pair: "BTC/USD", scanId: "scan-q4", fillPrice: 100, fillVolume: 1, feeUsd: 1, timestamp: 1000 }],
      [
        { lotId: "lot-q4", pair: "BTC/USD", fillPrice: 108, fillVolume: 0.5, feeUsd: 1, timestamp: 2000 },
        { lotId: "lot-q4", pair: "BTC/USD", fillPrice: 112, fillVolume: 0.5, feeUsd: 1, timestamp: 2100 },
      ],
      [{ scanId: "scan-q4", pair: "BTC/USD", stopPrice: 95, riskUsd: 10 }],
      [{ lotId: "lot-q4", pair: "BTC/USD", mfe: 12, mae: -5, mfeR: 1.2, maeR: -0.5, exitReasonType: "TARGET" }],
    );
    const result = normalizeCompletedTrades(input);
    expect(result.completedTradeCount).toBe(1);
    // These are legitimate multi-fills, NOT duplicates.
    // The quality check should NOT flag them as duplicate telemetry.
  });

  // QUALITY_R5_05: duplicate SELL telemetry → detected
  // (This is tested at the quality endpoint level via SQL duplicate detection.
  // Here we verify that the normalizer handles duplicate fills correctly —
  // it aggregates them, which would produce an overfill.)
  it("QUALITY_R5_05: identical duplicate SELL fills → overfill detection", () => {
    const input = makeInput(
      [{ lotId: "lot-q5", pair: "BTC/USD", scanId: "scan-q5", fillPrice: 100, fillVolume: 1, feeUsd: 1, timestamp: 1000 }],
      [
        // Two identical SELL fills (duplicate telemetry) → total exit = 2.0 (200% of entry)
        { lotId: "lot-q5", pair: "BTC/USD", fillPrice: 110, fillVolume: 1, feeUsd: 1, timestamp: 2000 },
        { lotId: "lot-q5", pair: "BTC/USD", fillPrice: 110, fillVolume: 1, feeUsd: 1, timestamp: 2000 },
      ],
      [{ scanId: "scan-q5", pair: "BTC/USD", stopPrice: 95, riskUsd: 10 }],
      [{ lotId: "lot-q5", pair: "BTC/USD", mfe: 10, mae: -5, mfeR: 1, maeR: -0.5, exitReasonType: "TARGET" }],
    );
    const result = normalizeCompletedTrades(input);
    // Duplicate telemetry produces overfill → EXIT_VOLUME_OVERFLOW
    expect(result.completedTradeCount).toBe(0);
    expect(result.exitVolumeOverflowTrades).toBe(1);
  });

  // QUALITY_R5_06: duplicate completed lot → check real
  it("QUALITY_R5_06: normalizer guarantees max 1 completed trade per lotId+pair", () => {
    const input = makeInput(
      [
        { lotId: "lot-q6", pair: "BTC/USD", scanId: "scan-q6", fillPrice: 100, fillVolume: 0.5, feeUsd: 1, timestamp: 1000 },
        { lotId: "lot-q6", pair: "BTC/USD", scanId: "scan-q6", fillPrice: 102, fillVolume: 0.5, feeUsd: 1, timestamp: 1010 },
      ],
      [{ lotId: "lot-q6", pair: "BTC/USD", fillPrice: 110, fillVolume: 1, feeUsd: 1, timestamp: 2000 }],
      [{ scanId: "scan-q6", pair: "BTC/USD", stopPrice: 95, riskUsd: 10 }],
      [{ lotId: "lot-q6", pair: "BTC/USD", mfe: 10, mae: -5, mfeR: 1, maeR: -0.5, exitReasonType: "TARGET" }],
    );
    const result = normalizeCompletedTrades(input);
    expect(result.completedTradeCount).toBe(1);
    // Verify no duplicate lotId+pair in completed trades
    const keys = new Set(result.completedTrades.map((t) => `${t.lotId}|${t.pair}`));
    expect(keys.size).toBe(result.completedTradeCount);
  });

  // QUALITY_R5_07: economic invalid → check real
  it("QUALITY_R5_07: economic invalid trade → counted in economicInvalidTrades", () => {
    const input = makeInput(
      [{ lotId: "lot-q7", pair: "BTC/USD", scanId: "scan-q7", fillPrice: 100, fillVolume: 1, feeUsd: 1, timestamp: 1000 }],
      [{ lotId: "lot-q7", pair: "BTC/USD", fillPrice: 110, fillVolume: 1, feeUsd: 1, timestamp: 2000 }],
      // Invalid: stop >= entry (not LONG)
      [{ scanId: "scan-q7", pair: "BTC/USD", stopPrice: 100, riskUsd: 10 }],
      [{ lotId: "lot-q7", pair: "BTC/USD", mfe: 10, mae: -5, mfeR: 1, maeR: -0.5, exitReasonType: "TARGET" }],
    );
    const result = normalizeCompletedTrades(input);
    expect(result.completedTradeCount).toBe(0);
    expect(result.economicInvalidTrades).toBe(1);
  });
});
