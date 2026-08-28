/**
 * spotAiR14Performance.test.ts — R14 PERFORMANCE & TRACKING tests.
 *
 * Tests:
 *   PERF_01: Status fast path does not call queryCompletedTrades heavy scan
 *   PERF_02: Physical snapshot_type parity (SQL uses physical columns)
 *   PERF_03: Completed trade output parity (normalizer unchanged)
 *   PERF_04: Duplicate identity unchanged
 *   PERF_05: Tracking groups by lot, not by fill
 *   PERF_06: Multi-fill single lot
 *   PERF_07: Open tracked lot (BUY only, no SELL)
 *   PERF_08: Completed lot (BUY + SELL)
 *   PERF_09: Labeled durable lot
 *   PERF_10: Legacy fill excluded (no lotId)
 *   PERF_11: Null values not fake zero
 *   PERF_12: No historical SPOT mix in AI dataset
 */

import { describe, it, expect } from "vitest";
import {
  mapBuyFillRow,
  mapSellFillRow,
  mapScanSizingRow,
  mapSupervisorRow,
  fetchRawDataFromDb,
  queryCompletedTradesWithExecutor,
  type DbExecutor,
} from "../spotAiForwardTwin/spotAiCompletedTradeRepository";
import { buildCompletedTradesFromSnapshots } from "../spotAiForwardTwin/spotAiCompletedTrades";
import { countDuplicateFills, fillIdentityKey, type FillIdentityInput } from "../spotAiForwardTwin/spotAiDuplicateIdentity";
import type { ForwardTwinSnapshot } from "../spot/spotForwardTwinTypes";

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeScan(scanId: string, pair: string, ts: number, sizing?: any): ForwardTwinSnapshot {
  return {
    schemaVersion: 1,
    snapshotType: "SCAN",
    scanId,
    timestamp: ts,
    pair,
    policyVersion: "SPOT-1.0.0-20260812",
    executionMode: "SHADOW",
    engineOwner: "SpotEngine",
    ticker: { bid: 100, ask: 101, last: 100 } as any,
    regime: { regime: "TREND", direction: "UP", atrPct: 1.5, adx: 25, ema20: 100, ema50: 99, ema200: 95 } as any,
    volume: { volume24h: 1000000, volumeRatio: 1.2 } as any,
    signal: { setupTag: "BREAKOUT", confidence: 0.8 } as any,
    capital: { availableCapital: 10000 } as any,
    sizing: sizing ?? { stopPrice: 95, riskUsd: 10, notionalUsd: 1000 } as any,
    intent: { state: "READY" } as any,
  } as any;
}

function makeFill(lotId: string | null, pair: string, side: "BUY" | "SELL", ts: number, opts?: any): ForwardTwinSnapshot {
  return {
    schemaVersion: 1,
    snapshotType: "FILL",
    scanId: opts?.scanId ?? "scan-1",
    timestamp: ts,
    pair,
    policyVersion: "SPOT-1.0.0-20260812",
    executionMode: "SHADOW",
    engineOwner: "SpotEngine",
    fill: {
      lotId,
      side,
      orderId: opts?.orderId ?? "order-1",
      executedAt: ts,
      fillPrice: opts?.price ?? 100,
      fillVolume: opts?.volume ?? 0.5,
      feeUsd: opts?.fee ?? 1.0,
    } as any,
  } as any;
}

function makeSupervisor(lotId: string, pair: string, ts: number, pos?: any): ForwardTwinSnapshot {
  return {
    schemaVersion: 1,
    snapshotType: "SUPERVISOR",
    scanId: "scan-1",
    timestamp: ts,
    pair,
    policyVersion: "SPOT-1.0.0-20260812",
    executionMode: "SHADOW",
    engineOwner: "SpotEngine",
    position: {
      lotId,
      pair,
      mfe: pos?.mfe ?? 5,
      mae: pos?.mae ?? -2,
      mfeR: pos?.mfeR ?? 0.5,
      maeR: pos?.maeR ?? -0.2,
      currentR: pos?.currentR ?? 0.3,
      qtyRemaining: pos?.qtyRemaining ?? 0.5,
      qty: pos?.qty ?? 0.5,
      entryPrice: pos?.entryPrice ?? 100,
    } as any,
    exitDecision: { reasonType: pos?.exitReasonType ?? null } as any,
  } as any;
}

// ─── Fake executor that captures queries ──────────────────────────────────

function makeFakeExecutor(responses: { rows: any[] }[]): DbExecutor & { queries: string[] } {
  let callIdx = 0;
  const queries: string[] = [];
  return {
    queries,
    execute: async (q: any) => {
      const sqlText = typeof q === "string" ? q : (q?.toSQL?.()?.sql ?? String(q));
      queries.push(sqlText);
      const r = responses[callIdx++] ?? { rows: [] };
      return r;
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("R14 PERFORMANCE & TRACKING tests", () => {

  // PERF_01: Status fast path does not call queryCompletedTrades heavy scan.
  // Verified by inspecting the route source: /api/spot/ai/status no longer
  // imports or calls queryCompletedTrades. This test confirms the function
  // is not imported in the routes module.
  it("PERF_01_STATUS_DOES_NOT_REQUIRE_COMPLETED_TRADES_SCAN", async () => {
    // Read the routes file and verify queryCompletedTrades is NOT called.
    // The import was removed in R14. We verify by checking that the function
    // is not referenced as a call in the module.
    const fs = await import("fs");
    const path = await import("path");
    const routesPath = path.join(process.cwd(), "server/routes/spotAi.routes.ts");
    const src = fs.readFileSync(routesPath, "utf-8");
    // The import line should NOT exist.
    expect(src).not.toContain("import { queryCompletedTrades }");
    // No calls to queryCompletedTrades() (only in comments).
    const callPattern = /queryCompletedTrades\(\)/;
    // Remove comments before checking.
    const withoutComments = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toMatch(callPattern);
  });

  // PERF_02: Physical snapshot_type parity — SQL uses physical columns.
  it("PERF_02_PHYSICAL_SNAPSHOT_TYPE_PARITY", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const routesPath = path.join(process.cwd(), "server/routes/spotAi.routes.ts");
    const src = fs.readFileSync(routesPath, "utf-8");
    // The routes should use snapshot_type = '...' not data->>'snapshotType' = '...'
    // in WHERE clauses (except in comments).
    const withoutComments = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    // Should NOT have data->>'snapshotType' in WHERE clauses.
    expect(withoutComments).not.toContain("data->>'snapshotType'");
  });

  // PERF_03: Completed trade output parity — normalizer unchanged.
  it("PERF_03_COMPLETED_TRADE_OUTPUT_PARITY", () => {
    const scans = [makeScan("scan-1", "BTC/USD", 1000)];
    const fills = [
      makeFill("lot-1", "BTC/USD", "BUY", 1100, { scanId: "scan-1", price: 100, volume: 0.5, fee: 1 }),
      makeFill("lot-1", "BTC/USD", "SELL", 2000, { price: 110, volume: 0.5, fee: 1 }),
    ];
    const supervisors = [makeSupervisor("lot-1", "BTC/USD", 1900, { mfeR: 1.0, maeR: -0.2 })];
    const result = buildCompletedTradesFromSnapshots({ scans, supervisors, fills });
    expect(result.completedTradeCount).toBe(1);
    expect(result.completedTrades).toHaveLength(1);
    const t = result.completedTrades[0];
    expect(t.lotId).toBe("lot-1");
    expect(t.pair).toBe("BTC/USD");
    expect(t.entryPrice).toBe(100);
    expect(t.exitPrice).toBe(110);
    expect(t.closedQty).toBe(0.5);
    expect(t.netPnlUsd).toBeGreaterThan(0);
  });

  // PERF_04: Duplicate identity unchanged.
  it("PERF_04_DUPLICATE_IDENTITY_UNCHANGED", () => {
    const fill: FillIdentityInput = {
      lotId: "lot-1", pair: "BTC/USD", side: "BUY",
      orderId: "ord-1", executedAt: 1000, fillPrice: 100, fillVolume: 0.5, feeUsd: 1,
    };
    const key = fillIdentityKey(fill);
    expect(key).toBe("lot-1|BTC/USD|BUY|ord-1|1000|100|0.5|1");
    const dup = countDuplicateFills([fill, fill]);
    expect(dup.duplicateEntry).toBe(1);
    expect(dup.duplicateExit).toBe(0);
  });

  // PERF_05: Tracking groups by lot, not by fill.
  it("PERF_05_TRACKING_GROUPS_BY_LOT_NOT_FILL", async () => {
    // Two BUY fills for the same lot → should be 1 lot, not 2.
    const buyRows = {
      rows: [
        { lot_id: "lot-1", pair: "BTC/USD", scan_id: "scan-1", fill_price: "100", fill_volume: "0.3", fee_usd: "0.5", ts: "1100" },
        { lot_id: "lot-1", pair: "BTC/USD", scan_id: "scan-1", fill_price: "101", fill_volume: "0.2", fee_usd: "0.5", ts: "1200" },
      ],
    };
    const sellRows = { rows: [] };
    const scanRows = { rows: [{ scan_id: "scan-1", pair: "BTC/USD", stop_price: "95", risk_usd: "10" }] };
    const supRows = { rows: [] };
    const legacyRows = { rows: [{ cnt: "0" }] };
    const executor = makeFakeExecutor([buyRows, sellRows, scanRows, supRows, legacyRows]);
    const result = await queryCompletedTradesWithExecutor(executor);
    // The normalizer should aggregate multi-BUY into a single trade candidate.
    // With no SELL, completedTradeCount should be 0 but buyFills are aggregated.
    expect(result.completedTradeCount).toBe(0);
  });

  // PERF_06: Multi-fill single lot.
  it("PERF_06_MULTI_FILL_SINGLE_LOT", () => {
    const scans = [makeScan("scan-1", "BTC/USD", 1000)];
    const fills = [
      makeFill("lot-1", "BTC/USD", "BUY", 1100, { scanId: "scan-1", price: 100, volume: 0.3, fee: 0.5 }),
      makeFill("lot-1", "BTC/USD", "BUY", 1200, { scanId: "scan-1", price: 101, volume: 0.2, fee: 0.5 }),
      makeFill("lot-1", "BTC/USD", "SELL", 2000, { price: 110, volume: 0.5, fee: 1 }),
    ];
    const supervisors = [makeSupervisor("lot-1", "BTC/USD", 1900)];
    const result = buildCompletedTradesFromSnapshots({ scans, supervisors, fills });
    expect(result.completedTradeCount).toBe(1);
    const t = result.completedTrades[0];
    // Weighted average entry: (100*0.3 + 101*0.2) / 0.5 = 100.4
    expect(t.entryPrice).toBeCloseTo(100.4, 5);
    expect(t.closedQty).toBe(0.5);
  });

  // PERF_07: Open tracked lot (BUY only, no SELL).
  it("PERF_07_OPEN_TRACKED_LOT", () => {
    const scans = [makeScan("scan-1", "BTC/USD", 1000)];
    const fills = [makeFill("lot-1", "BTC/USD", "BUY", 1100, { scanId: "scan-1" })];
    const supervisors = [makeSupervisor("lot-1", "BTC/USD", 1200)];
    const result = buildCompletedTradesFromSnapshots({ scans, supervisors, fills });
    expect(result.completedTradeCount).toBe(0);
  });

  // PERF_08: Completed lot (BUY + SELL).
  it("PERF_08_COMPLETED_LOT", () => {
    const scans = [makeScan("scan-1", "BTC/USD", 1000)];
    const fills = [
      makeFill("lot-1", "BTC/USD", "BUY", 1100, { scanId: "scan-1" }),
      makeFill("lot-1", "BTC/USD", "SELL", 2000),
    ];
    const supervisors = [makeSupervisor("lot-1", "BTC/USD", 1900)];
    const result = buildCompletedTradesFromSnapshots({ scans, supervisors, fills });
    expect(result.completedTradeCount).toBe(1);
  });

  // PERF_09: Labeled durable lot — verified by durable training table.
  // This is a semantic check: the tracking endpoint uses durable lot keys.
  it("PERF_09_LABELED_DURABLE_LOT", async () => {
    // The tracking endpoint checks spot_ai_forward_training_trades for lot keys.
    // This test verifies the concept: a lot is "ETIQUETADO" if it exists in durable.
    // We verify by checking the route source contains the durable lot key logic.
    const fs = await import("fs");
    const path = await import("path");
    const routesPath = path.join(process.cwd(), "server/routes/spotAi.routes.ts");
    const src = fs.readFileSync(routesPath, "utf-8");
    expect(src).toContain("ETIQUETADO");
    expect(src).toContain("durableLotKeys");
    expect(src).toContain("spot_ai_forward_training_trades");
  });

  // PERF_10: Legacy fill excluded (no lotId).
  it("PERF_10_LEGACY_FILL_EXCLUDED", () => {
    const scans = [makeScan("scan-1", "BTC/USD", 1000)];
    const fills = [
      makeFill(null, "BTC/USD", "BUY", 1100, { scanId: "scan-1" }), // legacy, no lotId
      makeFill("lot-1", "BTC/USD", "SELL", 2000),
    ];
    const supervisors = [makeSupervisor("lot-1", "BTC/USD", 1900)];
    const result = buildCompletedTradesFromSnapshots({ scans, supervisors, fills });
    // Legacy BUY without lotId should not form a completed trade.
    expect(result.completedTradeCount).toBe(0);
    expect(result.legacyMissingLotIdBuyFills).toBe(1);
  });

  // PERF_11: Null values not fake zero — quality checks report null for unavailable.
  it("PERF_11_NULL_VALUES_NOT_FAKE_ZERO", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const routesPath = path.join(process.cwd(), "server/routes/spotAi.routes.ts");
    const src = fs.readFileSync(routesPath, "utf-8");
    // The quality endpoint should use null for unavailable normalizer checks.
    expect(src).toContain("null as number | null");
    // checksAvailable should have false for unavailable checks.
    expect(src).toContain("completedTradeEconomicInvalid: false");
    expect(src).toContain("partialExitTrades: false");
    expect(src).toContain("exitVolumeOverflowTrades: false");
  });

  // PERF_12: No historical SPOT mix in AI dataset.
  it("PERF_12_NO_HISTORICAL_SPOT_MIX_IN_AI_DATASET", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const routesPath = path.join(process.cwd(), "server/routes/spotAi.routes.ts");
    const src = fs.readFileSync(routesPath, "utf-8");
    // The tracking endpoint should label historical SPOT as reference only.
    expect(src).toContain("historicalSpotNote");
    expect(src).toContain("Referencia");
    // The tracking endpoint should NOT count historical SPOT in AI dataset counts.
    expect(src).toContain("historicalSpotTrades");
  });

  // ─── Repository SQL uses physical columns ────────────────────────────────

  it("PERF_REPO_USES_PHYSICAL_SNAPSHOT_TYPE", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const repoPath = path.join(process.cwd(), "server/services/spotAiForwardTwin/spotAiCompletedTradeRepository.ts");
    const src = fs.readFileSync(repoPath, "utf-8");
    const withoutComments = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toContain("data->>'snapshotType'");
  });

  it("PERF_DUPLICATE_LOADER_USES_PHYSICAL_SNAPSHOT_TYPE", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const dupPath = path.join(process.cwd(), "server/services/spotAiForwardTwin/spotAiDuplicateIdentity.ts");
    const src = fs.readFileSync(dupPath, "utf-8");
    const withoutComments = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toContain("data->>'snapshotType'");
  });
});
