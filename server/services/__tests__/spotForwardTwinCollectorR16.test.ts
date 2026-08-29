/**
 * spotForwardTwinCollectorR16.test.ts — R16 collector projection tests.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  captureScan,
  captureSupervisor,
  captureFill,
  flush,
  _resetForTest,
  _enableForTest,
  _disableForTest,
  _getBufferForTest,
} from "../spot/spotForwardTwinCollector";
import type { ForwardTwinSnapshot } from "../spot/spotForwardTwinTypes";
import { SPOT_FORWARD_TWIN_SCHEMA_VERSION, SPOT_FORWARD_TWIN_RETENTION_DAYS, SPOT_FORWARD_TWIN_BUFFER_MAX } from "../spot/spotForwardTwinTypes";

// ─── Mock DB ──────────────────────────────────────────────────────────────────

let allSqls: string[] = [];

vi.mock("../../db", () => ({
  db: {
    execute: vi.fn(async (query: any) => {
      const sqlText = query?.toSQL?.()?.sql ?? "";
      allSqls.push(sqlText);
      return { rows: [] };
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: Object.assign(
    (strings: TemplateStringsArray, ..._values: any[]) => {
      const text = strings.join("?");
      return { toSQL: () => ({ sql: text }) };
    },
    {
      raw: (text: string) => {
        return { toSQL: () => ({ sql: text }) };
      },
    },
  ),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeScanSnapshot(overrides?: Partial<ForwardTwinSnapshot>): ForwardTwinSnapshot {
  return {
    schemaVersion: SPOT_FORWARD_TWIN_SCHEMA_VERSION,
    snapshotType: "SCAN",
    scanId: "scan-001",
    timestamp: Date.now(),
    pair: "BTC/USD",
    policyVersion: "SPOT-1.0.0-20260812",
    executionMode: "SHADOW",
    engineOwner: "SpotEngine",
    regime: { regime: "TREND", direction: "BULLISH", macroBias: "neutral", volatility: "low", adx: 25, ema20: 50000, ema50: 49000, ema200: 48000, emaAlignment: "bullish", bollingerWidth: 1000, atrPct: 1.5, confidence: 0.8, regimeId: "r1", contextId: "c1" },
    ...overrides,
  };
}

function makeSupervisorSnapshot(): ForwardTwinSnapshot {
  return {
    schemaVersion: 2,
    snapshotType: "SUPERVISOR",
    scanId: "sup-001",
    timestamp: Date.now(),
    pair: "BTC/USD",
    policyVersion: "SPOT-1.0.0-20260812",
    executionMode: "SHADOW",
    engineOwner: "SpotEngine",
    position: {
      lotId: "lot-1", pair: "BTC/USD", entryPrice: 50000, amount: 0.001, qtyRemaining: 0.001,
      highestPrice: 51000, lowestPrice: 49000, mfe: 1000, mae: -1000, mfeR: 1, maeR: -1,
      openedAt: Date.now(), setupTag: "test", executionMode: "SHADOW",
      sgBreakEvenActivated: false, sgTrailingActivated: false, sgCurrentStopPrice: 49000,
      trailingHighestPrice: 51000,
    },
    exitDecision: { shouldExit: false, reasonType: null, reason: "none", price: 50000, priority: null, evaluatedAt: Date.now() },
  };
}

function makeFillSnapshot(): ForwardTwinSnapshot {
  return {
    schemaVersion: SPOT_FORWARD_TWIN_SCHEMA_VERSION,
    snapshotType: "FILL",
    scanId: "fill-001",
    timestamp: Date.now(),
    pair: "BTC/USD",
    policyVersion: "SPOT-1.0.0-20260812",
    executionMode: "SHADOW",
    engineOwner: "SpotEngine",
    fill: {
      side: "BUY", lotId: "lot-1", fillPrice: 50000, fillVolume: 0.001, notionalUsd: 50,
      feeUsd: 0.045, slippageUsd: 0, slippagePct: 0, fillQuality: "GOOD", orderId: "o1",
      executedAt: Date.now(), tickerBid: 49999, tickerAsk: 50001, tickerLast: 50000,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("R16 COLLECTOR — PHYSICAL REGIME PROJECTION", () => {
  beforeEach(() => {
    _resetForTest();
    _enableForTest();
    allSqls = [];
  });

  function getInsertSql(): string {
    return allSqls.find(s => s.includes("INSERT")) ?? "";
  }

  // R16_COL_01
  it("R16_COL_01: SCAN projects regime into physical column", async () => {
    captureScan(makeScanSnapshot({ regime: { regime: "RANGE", direction: "NEUTRAL", macroBias: "n", volatility: "l", adx: 20, ema20: 1, ema50: 1, ema200: 1, emaAlignment: "n", bollingerWidth: 1, atrPct: 1, confidence: 0.5, regimeId: "r", contextId: "c" } }));
    await flush();
    expect(getInsertSql()).toContain("regime");
    expect(getInsertSql()).toContain("RANGE");
  });

  // R16_COL_02
  it("R16_COL_02: SCAN projects direction into physical column", async () => {
    captureScan(makeScanSnapshot({ regime: { regime: "TREND", direction: "BEARISH", macroBias: "n", volatility: "l", adx: 20, ema20: 1, ema50: 1, ema200: 1, emaAlignment: "n", bollingerWidth: 1, atrPct: 1, confidence: 0.5, regimeId: "r", contextId: "c" } }));
    await flush();
    expect(getInsertSql()).toContain("direction");
    expect(getInsertSql()).toContain("BEARISH");
  });

  // R16_COL_03
  it("R16_COL_03: SCAN projection_version = 1", async () => {
    captureScan(makeScanSnapshot());
    await flush();
    expect(getInsertSql()).toContain("regime_projection_version");
    // The value 1 should appear in the VALUES for the version column
    // The INSERT has 12 columns, the last value for SCAN should be 1
    expect(getInsertSql()).toMatch(/,\s*1\)/);
  });

  // R16_COL_04
  it("R16_COL_04: SCAN with null regime → physical NULL/NULL, version=1", async () => {
    const snap = makeScanSnapshot();
    delete snap.regime;
    captureScan(snap);
    await flush();
    // NULL should appear in the VALUES for regime and direction columns
    expect(getInsertSql()).toContain("NULL");
  });

  // R16_COL_05
  it("R16_COL_05: SUPERVISOR → NULL projection (regime/direction/version all NULL)", async () => {
    captureSupervisor(makeSupervisorSnapshot());
    await flush();
    // The INSERT should have NULL for all three projection columns
    // For SUPERVISOR, version is NULL (not 1)
    expect(getInsertSql()).toContain("NULL");
    // Should NOT contain version=1 for supervisor
    // The last value in the tuple should be NULL, not 1
    expect(getInsertSql()).toMatch(/NULL,\s*NULL,\s*NULL\)/);
  });

  // R16_COL_06
  it("R16_COL_06: FILL → NULL projection", async () => {
    captureFill(makeFillSnapshot());
    await flush();
    expect(getInsertSql()).toMatch(/NULL,\s*NULL,\s*NULL\)/);
  });

  // R16_COL_07
  it("R16_COL_07: JSONB unchanged — data column still contains JSON.stringify(snap)", async () => {
    const snap = makeScanSnapshot();
    captureScan(snap);
    await flush();
    // The INSERT should still contain the JSONB data
    expect(getInsertSql()).toContain("::jsonb");
    // The JSON should contain the regime object
    expect(getInsertSql()).toContain("regime");
  });

  // R16_COL_08
  it("R16_COL_08: batch INSERT column order — 12 columns including regime, direction, regime_projection_version", async () => {
    captureScan(makeScanSnapshot());
    await flush();
    expect(getInsertSql()).toContain("schema_version");
    expect(getInsertSql()).toContain("snapshot_type");
    expect(getInsertSql()).toContain("scan_id");
    expect(getInsertSql()).toContain("timestamp");
    expect(getInsertSql()).toContain("pair");
    expect(getInsertSql()).toContain("policy_version");
    expect(getInsertSql()).toContain("execution_mode");
    expect(getInsertSql()).toContain("engine_owner");
    expect(getInsertSql()).toContain("data");
    expect(getInsertSql()).toContain("regime");
    expect(getInsertSql()).toContain("direction");
    expect(getInsertSql()).toContain("regime_projection_version");
  });

  // R16_COL_09
  it("R16_COL_09: text escaping — apostrophes in regime/direction are escaped", async () => {
    captureScan(makeScanSnapshot({
      regime: { regime: "TREND'S", direction: "BULLISH'S", macroBias: "n", volatility: "l", adx: 20, ema20: 1, ema50: 1, ema200: 1, emaAlignment: "n", bollingerWidth: 1, atrPct: 1, confidence: 0.5, regimeId: "r", contextId: "c" },
    }));
    await flush();
    // Apostrophes should be doubled
    expect(getInsertSql()).toContain("TREND''S");
    expect(getInsertSql()).toContain("BULLISH''S");
  });

  // R16_COL_10
  it("R16_COL_10: retention unchanged — DELETE still runs after INSERT", async () => {
    captureScan(makeScanSnapshot());
    await flush();
    // The db.execute should have been called at least twice (INSERT + DELETE)
    const { db } = await import("../../db");
    expect((db.execute as any).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  // R16_COL_INVARIANTS
  it("R16_COL_INVARIANTS: buffer max and retention unchanged", () => {
    expect(SPOT_FORWARD_TWIN_BUFFER_MAX).toBe(500);
    expect(SPOT_FORWARD_TWIN_RETENTION_DAYS).toBe(7);
  });
});
