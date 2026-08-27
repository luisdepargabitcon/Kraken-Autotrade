/**
 * spotAiQualityDuplicatesR9.test.ts — R9-01 FAIL-CLOSED duplicate quality.
 *
 * R9-01: loadDuplicateFillQuality must be fail-closed.
 * - DB failure → null values, available=false.
 * - Success with 0 duplicates → 0, available=true.
 * - Success with real duplicates → real counts, available=true.
 */

import { describe, it, expect, vi } from "vitest";

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

import { loadDuplicateFillQuality, countDuplicateFills } from "../spotAiForwardTwin/spotAiDuplicateIdentity";

describe("R9-01 QUALITY DUPLICATES FAIL-CLOSED", () => {
  // QUALITY_R9_DUP_FAIL_01: db.execute throws → null/false
  it("QUALITY_R9_DUP_FAIL_01: db/executor throws → entry=null, exit=null, available=false", async () => {
    const failingExecutor = {
      execute: vi.fn().mockRejectedValue(new Error("DB connection lost")),
    };
    const result = await loadDuplicateFillQuality(failingExecutor);
    expect(result.available).toBe(false);
    expect(result.duplicateEntryFills).toBeNull();
    expect(result.duplicateExitFills).toBeNull();
    expect(result.error).not.toBeNull();
  });

  // QUALITY_R9_DUP_FAIL_02: correct load, no duplicates → 0/true
  it("QUALITY_R9_DUP_FAIL_02: correct load without duplicates → entry=0, exit=0, available=true", async () => {
    const executor = {
      execute: vi.fn().mockResolvedValue({
        rows: [
          { data: { pair: "BTC/USD", fill: { lotId: "lot-1", side: "BUY", orderId: "o1", executedAt: 100, fillPrice: 100, fillVolume: 1, feeUsd: 1 } } },
          { data: { pair: "BTC/USD", fill: { lotId: "lot-1", side: "SELL", orderId: "o2", executedAt: 200, fillPrice: 110, fillVolume: 1, feeUsd: 1 } } },
        ],
      }),
    };
    const result = await loadDuplicateFillQuality(executor);
    expect(result.available).toBe(true);
    expect(result.duplicateEntryFills).toBe(0);
    expect(result.duplicateExitFills).toBe(0);
    expect(result.error).toBeNull();
  });

  // QUALITY_R9_DUP_FAIL_03: real duplicates → real counts, available=true
  it("QUALITY_R9_DUP_FAIL_03: real BUY/SELL duplicates → real counts, available=true", async () => {
    const executor = {
      execute: vi.fn().mockResolvedValue({
        rows: [
          // Two identical BUY fills (same identity tuple)
          { data: { pair: "BTC/USD", fill: { lotId: "lot-1", side: "BUY", orderId: "o1", executedAt: 100, fillPrice: 100, fillVolume: 1, feeUsd: 1 } } },
          { data: { pair: "BTC/USD", fill: { lotId: "lot-1", side: "BUY", orderId: "o1", executedAt: 100, fillPrice: 100, fillVolume: 1, feeUsd: 1 } } },
          // Two identical SELL fills
          { data: { pair: "BTC/USD", fill: { lotId: "lot-1", side: "SELL", orderId: "o2", executedAt: 200, fillPrice: 110, fillVolume: 1, feeUsd: 1 } } },
          { data: { pair: "BTC/USD", fill: { lotId: "lot-1", side: "SELL", orderId: "o2", executedAt: 200, fillPrice: 110, fillVolume: 1, feeUsd: 1 } } },
        ],
      }),
    };
    const result = await loadDuplicateFillQuality(executor);
    expect(result.available).toBe(true);
    expect(result.duplicateEntryFills).toBe(1);
    expect(result.duplicateExitFills).toBe(1);
    expect(result.error).toBeNull();
  });
});
