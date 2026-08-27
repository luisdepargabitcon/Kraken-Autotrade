/**
 * spotAiAvailabilityR9.test.ts — R9-12 availability check both tables.
 *
 * R9-12: isDurableStorageAvailable() must check BOTH tables AND critical columns.
 * Not just spot_ai_forward_training_trades.
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
  isDurableStorageAvailable,
  _resetDurableStorageCache,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";

describe("R9-12 AVAILABILITY CHECK BOTH TABLES", () => {
  beforeEach(() => {
    mockDbExecute.mockReset();
    _resetDurableStorageCache();
  });

  // Both tables exist → available=true
  it("AVAIL_R9_01: both tables exist → available=true", async () => {
    mockDbExecute.mockResolvedValue({ rows: [] });
    const available = await isDurableStorageAvailable();
    expect(available).toBe(true);
  });

  // Training exists + giveback missing → available=false
  it("AVAIL_R9_02: training exists + giveback missing → available=false", async () => {
    mockDbExecute.mockImplementation((query: any) => {
      const sqlStr = String(query?.sql ?? query ?? "");
      // Training table query succeeds
      if (sqlStr.includes("spot_ai_forward_training_trades")) {
        return Promise.resolve({ rows: [] });
      }
      // Giveback table query fails
      if (sqlStr.includes("spot_ai_forward_giveback_samples")) {
        return Promise.reject(new Error("table does not exist"));
      }
      return Promise.resolve({ rows: [] });
    });
    const available = await isDurableStorageAvailable();
    expect(available).toBe(false);
  });

  // Training missing → available=false
  it("AVAIL_R9_03: training table missing → available=false", async () => {
    mockDbExecute.mockImplementation((query: any) => {
      const sqlStr = String(query?.sql ?? query ?? "");
      if (sqlStr.includes("spot_ai_forward_training_trades")) {
        return Promise.reject(new Error("table does not exist"));
      }
      return Promise.resolve({ rows: [] });
    });
    const available = await isDurableStorageAvailable();
    expect(available).toBe(false);
  });

  // Both missing → available=false
  it("AVAIL_R9_04: both tables missing → available=false", async () => {
    mockDbExecute.mockRejectedValue(new Error("tables do not exist"));
    const available = await isDurableStorageAvailable();
    expect(available).toBe(false);
  });
});
