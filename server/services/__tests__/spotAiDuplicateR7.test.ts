/**
 * spotAiDuplicateR7.test.ts — R7 DUP tests: Duplicate fill identity.
 *
 * R7: Duplicate identity = strict tuple:
 *   (lotId, pair, side, orderId, executedAt, fillPrice, fillVolume, feeUsd)
 *
 * Same orderId + different executedAt/volume/price = legitimate multi-fill, NOT duplicate.
 * Exact copy of same snapshot = duplicate.
 */

import { describe, it, expect } from "vitest";
import { isDuplicateFill, type FillIdentityInput } from "../spotAiForwardTwin/spotAiDuplicateIdentity";

describe("R7 DUP tests — duplicate fill identity", () => {
  // QUALITY_R7_DUP_01: same orderId + different executedAt → NOT duplicate
  it("QUALITY_R7_DUP_01: same orderId + different executedAt → NOT duplicate", () => {
    const fill1: FillIdentityInput = {
      lotId: "lot-1", pair: "BTC/USD", side: "BUY",
      orderId: "ord-1", executedAt: 1000,
      fillPrice: 100, fillVolume: 0.5, feeUsd: 1,
    };
    const fill2: FillIdentityInput = {
      lotId: "lot-1", pair: "BTC/USD", side: "BUY",
      orderId: "ord-1", executedAt: 2000,
      fillPrice: 100, fillVolume: 0.5, feeUsd: 1,
    };
    expect(isDuplicateFill(fill1, fill2)).toBe(false);
  });

  // QUALITY_R7_DUP_02: same orderId + different volume → NOT duplicate
  it("QUALITY_R7_DUP_02: same orderId + different volume → NOT duplicate", () => {
    const fill1: FillIdentityInput = {
      lotId: "lot-1", pair: "BTC/USD", side: "BUY",
      orderId: "ord-1", executedAt: 1000,
      fillPrice: 100, fillVolume: 0.5, feeUsd: 1,
    };
    const fill2: FillIdentityInput = {
      lotId: "lot-1", pair: "BTC/USD", side: "BUY",
      orderId: "ord-1", executedAt: 1000,
      fillPrice: 100, fillVolume: 0.3, feeUsd: 1,
    };
    expect(isDuplicateFill(fill1, fill2)).toBe(false);
  });

  // QUALITY_R7_DUP_03: same orderId + exact same execution tuple → duplicate
  it("QUALITY_R7_DUP_03: exact same execution tuple → duplicate", () => {
    const fill1: FillIdentityInput = {
      lotId: "lot-1", pair: "BTC/USD", side: "BUY",
      orderId: "ord-1", executedAt: 1000,
      fillPrice: 100, fillVolume: 0.5, feeUsd: 1,
    };
    const fill2: FillIdentityInput = {
      lotId: "lot-1", pair: "BTC/USD", side: "BUY",
      orderId: "ord-1", executedAt: 1000,
      fillPrice: 100, fillVolume: 0.5, feeUsd: 1,
    };
    expect(isDuplicateFill(fill1, fill2)).toBe(true);
  });

  // QUALITY_R7_DUP_04: two BUY exact duplicates → duplicateEntry +1, duplicateExit +0
  it("QUALITY_R7_DUP_04: two BUY exact duplicates → entry+1, exit+0", () => {
    const fills: FillIdentityInput[] = [
      { lotId: "lot-1", pair: "BTC/USD", side: "BUY", orderId: "ord-1", executedAt: 1000, fillPrice: 100, fillVolume: 0.5, feeUsd: 1 },
      { lotId: "lot-1", pair: "BTC/USD", side: "BUY", orderId: "ord-1", executedAt: 1000, fillPrice: 100, fillVolume: 0.5, feeUsd: 1 },
    ];
    let duplicateEntry = 0;
    let duplicateExit = 0;
    for (let i = 0; i < fills.length; i++) {
      for (let j = i + 1; j < fills.length; j++) {
        if (isDuplicateFill(fills[i], fills[j])) {
          if (fills[i].side === "BUY") duplicateEntry++;
          if (fills[i].side === "SELL") duplicateExit++;
        }
      }
    }
    expect(duplicateEntry).toBe(1);
    expect(duplicateExit).toBe(0);
  });

  // QUALITY_R7_DUP_05: two SELL exact duplicates → duplicateExit +1, duplicateEntry +0
  it("QUALITY_R7_DUP_05: two SELL exact duplicates → exit+1, entry+0", () => {
    const fills: FillIdentityInput[] = [
      { lotId: "lot-1", pair: "BTC/USD", side: "SELL", orderId: "ord-s1", executedAt: 2000, fillPrice: 110, fillVolume: 1, feeUsd: 1 },
      { lotId: "lot-1", pair: "BTC/USD", side: "SELL", orderId: "ord-s1", executedAt: 2000, fillPrice: 110, fillVolume: 1, feeUsd: 1 },
    ];
    let duplicateEntry = 0;
    let duplicateExit = 0;
    for (let i = 0; i < fills.length; i++) {
      for (let j = i + 1; j < fills.length; j++) {
        if (isDuplicateFill(fills[i], fills[j])) {
          if (fills[i].side === "BUY") duplicateEntry++;
          if (fills[i].side === "SELL") duplicateExit++;
        }
      }
    }
    expect(duplicateEntry).toBe(0);
    expect(duplicateExit).toBe(1);
  });

  // QUALITY_R7_DUP_06: legit multi-BUY same orderId not duplicate
  it("QUALITY_R7_DUP_06: legit multi-BUY same orderId not duplicate", () => {
    const fills: FillIdentityInput[] = [
      { lotId: "lot-1", pair: "BTC/USD", side: "BUY", orderId: "ord-1", executedAt: 1000, fillPrice: 100, fillVolume: 0.5, feeUsd: 1 },
      { lotId: "lot-1", pair: "BTC/USD", side: "BUY", orderId: "ord-1", executedAt: 1100, fillPrice: 102, fillVolume: 0.3, feeUsd: 0.6 },
    ];
    expect(isDuplicateFill(fills[0], fills[1])).toBe(false);
  });

  // QUALITY_R7_DUP_07: legit multi-SELL same orderId not duplicate
  it("QUALITY_R7_DUP_07: legit multi-SELL same orderId not duplicate", () => {
    const fills: FillIdentityInput[] = [
      { lotId: "lot-1", pair: "BTC/USD", side: "SELL", orderId: "ord-s1", executedAt: 2000, fillPrice: 108, fillVolume: 0.5, feeUsd: 1 },
      { lotId: "lot-1", pair: "BTC/USD", side: "SELL", orderId: "ord-s1", executedAt: 2100, fillPrice: 112, fillVolume: 0.5, feeUsd: 1 },
    ];
    expect(isDuplicateFill(fills[0], fills[1])).toBe(false);
  });

  // QUALITY_R7_DUP_08: different lotId → not duplicate
  it("QUALITY_R7_DUP_08: different lotId → not duplicate", () => {
    const fill1: FillIdentityInput = {
      lotId: "lot-1", pair: "BTC/USD", side: "BUY",
      orderId: "ord-1", executedAt: 1000,
      fillPrice: 100, fillVolume: 0.5, feeUsd: 1,
    };
    const fill2: FillIdentityInput = {
      lotId: "lot-2", pair: "BTC/USD", side: "BUY",
      orderId: "ord-1", executedAt: 1000,
      fillPrice: 100, fillVolume: 0.5, feeUsd: 1,
    };
    expect(isDuplicateFill(fill1, fill2)).toBe(false);
  });

  // QUALITY_R7_DUP_09: different pair → not duplicate
  it("QUALITY_R7_DUP_09: different pair → not duplicate", () => {
    const fill1: FillIdentityInput = {
      lotId: "lot-1", pair: "BTC/USD", side: "BUY",
      orderId: "ord-1", executedAt: 1000,
      fillPrice: 100, fillVolume: 0.5, feeUsd: 1,
    };
    const fill2: FillIdentityInput = {
      lotId: "lot-1", pair: "ETH/USD", side: "BUY",
      orderId: "ord-1", executedAt: 1000,
      fillPrice: 100, fillVolume: 0.5, feeUsd: 1,
    };
    expect(isDuplicateFill(fill1, fill2)).toBe(false);
  });

  // QUALITY_R7_DUP_10: different feeUsd → not duplicate (different execution)
  it("QUALITY_R7_DUP_10: different feeUsd → not duplicate", () => {
    const fill1: FillIdentityInput = {
      lotId: "lot-1", pair: "BTC/USD", side: "BUY",
      orderId: "ord-1", executedAt: 1000,
      fillPrice: 100, fillVolume: 0.5, feeUsd: 1,
    };
    const fill2: FillIdentityInput = {
      lotId: "lot-1", pair: "BTC/USD", side: "BUY",
      orderId: "ord-1", executedAt: 1000,
      fillPrice: 100, fillVolume: 0.5, feeUsd: 2,
    };
    expect(isDuplicateFill(fill1, fill2)).toBe(false);
  });
});
