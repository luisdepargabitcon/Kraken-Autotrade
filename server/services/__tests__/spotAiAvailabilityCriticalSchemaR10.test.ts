/**
 * spotAiAvailabilityCriticalSchemaR10.test.ts — R10-12 critical schema test.
 *
 * R10-12: Test that isAvailable returns false when a critical column is missing,
 * not just when the table is missing.
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
  _resetDurableStorageCache,
  isDurableStorageAvailable,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";

describe("R10-12 AVAILABILITY CRITICAL SCHEMA", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    _resetDurableStorageCache();
  });

  // Both tables exist with all critical columns => available
  it("AVAIL_R10_01: both tables + all critical columns => available=true", async () => {
    mockExecute.mockResolvedValue({ rows: [] });
    const available = await isDurableStorageAvailable();
    expect(available).toBe(true);
  });

  // Training table exists but dataset_fingerprint column missing => false
  it("AVAIL_R10_02: training table missing dataset_fingerprint => available=false", async () => {
    mockExecute.mockImplementation((query: any) => {
      const sqlStr = String(query?.sql ?? query ?? "");
      if (sqlStr.includes("FROM spot_ai_forward_training_trades") && sqlStr.includes("LIMIT 0")) {
        // Simulate column does not exist — Postgres throws
        throw new Error('column "dataset_fingerprint" does not exist');
      }
      return Promise.resolve({ rows: [] });
    });
    const available = await isDurableStorageAvailable();
    expect(available).toBe(false);
  });

  // Giveback table exists but labels_json column missing => false
  it("AVAIL_R10_03: giveback table missing labels_json => available=false", async () => {
    mockExecute.mockImplementation((query: any) => {
      const sqlStr = String(query?.sql ?? query ?? "");
      if (sqlStr.includes("FROM spot_ai_forward_training_trades") && sqlStr.includes("LIMIT 0")) {
        return Promise.resolve({ rows: [] });
      }
      if (sqlStr.includes("FROM spot_ai_forward_giveback_samples") && sqlStr.includes("LIMIT 0")) {
        throw new Error('column "labels_json" does not exist');
      }
      return Promise.resolve({ rows: [] });
    });
    const available = await isDurableStorageAvailable();
    expect(available).toBe(false);
  });

  // Training table missing (entire table) => false
  it("AVAIL_R10_04: training table missing entirely => available=false", async () => {
    mockExecute.mockImplementation(() => {
      throw new Error('relation "spot_ai_forward_training_trades" does not exist');
    });
    const available = await isDurableStorageAvailable();
    expect(available).toBe(false);
  });

  // Giveback table missing policy_version => false
  it("AVAIL_R10_05: giveback table missing policy_version => available=false", async () => {
    mockExecute.mockImplementation((query: any) => {
      const sqlStr = String(query?.sql ?? query ?? "");
      if (sqlStr.includes("FROM spot_ai_forward_training_trades") && sqlStr.includes("LIMIT 0")) {
        return Promise.resolve({ rows: [] });
      }
      if (sqlStr.includes("FROM spot_ai_forward_giveback_samples") && sqlStr.includes("LIMIT 0")) {
        throw new Error('column "policy_version" does not exist');
      }
      return Promise.resolve({ rows: [] });
    });
    const available = await isDurableStorageAvailable();
    expect(available).toBe(false);
  });
});
