/**
 * spotAiR16Cutover.test.ts — R16 cutover sequence test.
 *
 * Demonstrates the pre-backfill + deploy + catch-up backfill flow:
 * 1. Migration applied, historical rows have projection=NULL
 * 2. Old collector inserts another SCAN with projection=NULL
 * 3. Pre-backfill marks historical + existing as v1
 * 4. Another old-app row arrives with projection=NULL
 * 5. Endpoint: available=false (pending > 0)
 * 6. R16 collector inserts new SCAN with projection=1
 * 7. Catch-up backfill covers remaining old row
 * 8. pending=0, available=true
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock state ───────────────────────────────────────────────────────────────

interface FakeRow {
  id: number;
  snapshot_type: string;
  data: any;
  regime: string | null;
  direction: string | null;
  regime_projection_version: number | null;
}

let nextId = 1;
let fakeRows: FakeRow[] = [];

function resetFakeRows() {
  nextId = 1;
  fakeRows = [];
}

function insertOldAppScan(data: any): FakeRow {
  const row: FakeRow = {
    id: nextId++,
    snapshot_type: "SCAN",
    data,
    regime: null,
    direction: null,
    regime_projection_version: null, // old app doesn't know about columns
  };
  fakeRows.push(row);
  return row;
}

function insertR16Scan(data: any): FakeRow {
  const row: FakeRow = {
    id: nextId++,
    snapshot_type: "SCAN",
    data,
    regime: data?.regime?.regime ?? null,
    direction: data?.regime?.direction ?? null,
    regime_projection_version: 1, // R16 collector projects
  };
  fakeRows.push(row);
  return row;
}

function simulateBackfillBatch(batchSize: number): number {
  const pending = fakeRows
    .filter(r => r.snapshot_type === "SCAN" && r.regime_projection_version !== 1)
    .sort((a, b) => a.id - b.id)
    .slice(0, batchSize);
  for (const row of pending) {
    row.regime = row.data?.regime?.regime ?? null;
    row.direction = row.data?.regime?.direction ?? null;
    row.regime_projection_version = 1;
  }
  return pending.length;
}

function getPendingCount(): number {
  return fakeRows.filter(r => r.snapshot_type === "SCAN" && r.regime_projection_version !== 1).length;
}

function getRegimesDistribution(): { regime: string; direction: string; count: number }[] {
  const projected = fakeRows.filter(r => r.snapshot_type === "SCAN" && r.regime_projection_version === 1);
  const map = new Map<string, number>();
  for (const row of projected) {
    const key = `${row.regime ?? "NULL"}|${row.direction ?? "NULL"}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([key, count]) => {
    const [regime, direction] = key.split("|");
    return { regime: regime === "NULL" ? "UNKNOWN" : regime, direction: direction === "NULL" ? "NEUTRAL" : direction, count };
  }).sort((a, b) => b.count - a.count);
}

function endpointResult(): { available: boolean; reason?: string; regimes: any[] } {
  const pending = getPendingCount();
  if (pending > 0) {
    return { available: false, reason: "PHYSICAL_REGIME_BACKFILL_PENDING", regimes: [] };
  }
  return { available: true, regimes: getRegimesDistribution() };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("R16 CUTOVER SEQUENCE — PRE-BACKFILL + DEPLOY + CATCH-UP", () => {
  beforeEach(() => {
    resetFakeRows();
  });

  it("R16_CUTOVER_01: full pre-backfill → deploy → catch-up sequence", () => {
    // ── PHASE 0: Migration applied, historical rows exist with projection=NULL ──
    insertOldAppScan({ regime: { regime: "TREND", direction: "BULLISH" } });
    insertOldAppScan({ regime: { regime: "RANGE", direction: "NEUTRAL" } });
    insertOldAppScan({ regime: { regime: "TREND", direction: "BEARISH" } });

    expect(getPendingCount()).toBe(3);
    expect(endpointResult().available).toBe(false);

    // ── PHASE A: Old app still running, inserts another SCAN with projection=NULL ──
    insertOldAppScan({ regime: { regime: "RANGE", direction: "NEUTRAL" } });
    expect(getPendingCount()).toBe(4);

    // ── PHASE B: Pre-backfill with old app still alive ──
    let updated = simulateBackfillBatch(250);
    expect(updated).toBe(4);
    expect(getPendingCount()).toBe(0);

    // At this point, pre-backfill is complete
    let result = endpointResult();
    expect(result.available).toBe(true);
    expect(result.regimes).toHaveLength(3); // TREND/BULLISH, RANGE/NEUTRAL, TREND/BEARISH

    // ── PHASE C: Old app inserts ANOTHER SCAN after pre-backfill ──
    // This is the key scenario: pre-backfill doesn't guarantee completeness
    insertOldAppScan({ regime: { regime: "TRANSITION", direction: "NEUTRAL" } });
    expect(getPendingCount()).toBe(1);

    // Endpoint should now show pending
    result = endpointResult();
    expect(result.available).toBe(false);
    expect(result.reason).toBe("PHYSICAL_REGIME_BACKFILL_PENDING");

    // ── PHASE D: Deploy R16 collector ──
    // New SCAN from R16 collector has projection_version=1
    insertR16Scan({ regime: { regime: "TREND", direction: "BULLISH" } });
    // The old-app row is still pending
    expect(getPendingCount()).toBe(1);
    result = endpointResult();
    expect(result.available).toBe(false);

    // ── PHASE E: Catch-up backfill covers the remaining old-app row ──
    updated = simulateBackfillBatch(250);
    expect(updated).toBe(1);
    expect(getPendingCount()).toBe(0);

    // ── PHASE F: Now endpoint is available ──
    result = endpointResult();
    expect(result.available).toBe(true);
    // Distribution: TREND/BULLISH=2, RANGE/NEUTRAL=2, TREND/BEARISH=1, TRANSITION/NEUTRAL=1
    expect(result.regimes).toHaveLength(4);
    const trendBullish = result.regimes.find(r => r.regime === "TREND" && r.direction === "BULLISH");
    expect(trendBullish?.count).toBe(2);
    const rangeNeutral = result.regimes.find(r => r.regime === "RANGE" && r.direction === "NEUTRAL");
    expect(rangeNeutral?.count).toBe(2);
  });

  it("R16_CUTOVER_02: pre-backfill does NOT guarantee completeness (old app continues)", () => {
    // Historical rows
    insertOldAppScan({ regime: { regime: "TREND", direction: "BULLISH" } });
    insertOldAppScan({ regime: { regime: "RANGE", direction: "NEUTRAL" } });

    // Pre-backfill
    simulateBackfillBatch(250);
    expect(getPendingCount()).toBe(0);

    // Old app inserts new row AFTER pre-backfill
    insertOldAppScan({ regime: { regime: "TREND", direction: "BULLISH" } });
    expect(getPendingCount()).toBe(1);

    // Endpoint must show pending — pre-backfill alone is NOT sufficient
    const result = endpointResult();
    expect(result.available).toBe(false);
    expect(result.reason).toBe("PHYSICAL_REGIME_BACKFILL_PENDING");
  });

  it("R16_CUTOVER_03: R16 collector rows are born with projection_version=1", () => {
    insertR16Scan({ regime: { regime: "TREND", direction: "BULLISH" } });
    expect(getPendingCount()).toBe(0);
    const result = endpointResult();
    expect(result.available).toBe(true);
  });

  it("R16_CUTOVER_04: NULL regime in R16 collector is valid (version=1, regime=NULL)", () => {
    insertR16Scan({}); // no regime key
    expect(getPendingCount()).toBe(0);
    const result = endpointResult();
    expect(result.available).toBe(true);
    expect(result.regimes[0].regime).toBe("UNKNOWN");
    expect(result.regimes[0].direction).toBe("NEUTRAL");
  });

  it("R16_CUTOVER_05: catch-up backfill is idempotent", () => {
    insertOldAppScan({ regime: { regime: "TREND", direction: "BULLISH" } });
    // First catch-up
    simulateBackfillBatch(250);
    expect(getPendingCount()).toBe(0);
    // Second catch-up — 0 updates
    const updated = simulateBackfillBatch(250);
    expect(updated).toBe(0);
  });
});
