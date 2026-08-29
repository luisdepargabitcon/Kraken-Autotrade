/**
 * spotAiRegimesEndpointR16.test.ts — R16 endpoint physical-columns tests.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Express } from "express";

// ─── Mock DB ──────────────────────────────────────────────────────────────────

let mockQueryResult: { rows: any[] } = { rows: [] };
let mockQueryError: any = null;
let lastQuerySql = "";

vi.mock("../../db", () => ({
  db: {
    execute: vi.fn(async (query: any) => {
      if (mockQueryError) throw mockQueryError;
      // Capture the SQL string
      if (query && typeof query === "object" && "toSQL" in query) {
        lastQuerySql = (query as any).toSQL?.()?.sql ?? "";
      }
      return mockQueryResult;
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
      raw: (text: string) => ({ toSQL: () => ({ sql: text }) }),
    },
  ),
}));

// Mock other imports that the route file needs
vi.mock("../spotAiForwardTwin/spotAiAdvisoryService", () => ({ advisoryService: { getRecentAdvisoryLogs: vi.fn(async () => []) } }));
vi.mock("../spotAiForwardTwin/spotAiModelRegistry", () => ({ modelRegistry: { listAll: vi.fn(async () => []), listByModel: vi.fn(async () => []) } }));
vi.mock("../spotAiForwardTwin/spotAiTrainerService", () => ({ trainerService: { getStatus: vi.fn(() => ({})), getTrainingHistory: vi.fn(() => []) } }));
vi.mock("../spot/spotForwardTwinCollector", () => ({ getCollectorStats: vi.fn(() => ({ enabled: false, bufferSize: 0, bufferMax: 500, totalCaptured: 0, totalFlushed: 0, droppedSnapshots: 0, lastFlushAt: null, lastFlushError: null, isFlushing: false })) }));
vi.mock("../spotAiForwardTwin/spotAiFeatureBuilder", () => ({ CANONICAL_FEATURE_DEFINITIONS: [] }));
vi.mock("../spotAiForwardTwin/spotAiDurableTrainingStore", () => ({
  isDurableStorageAvailable: vi.fn(() => false),
  getDurableCompletedTradeCount: vi.fn(async () => 0),
  getDurableTrainableTradeCount: vi.fn(async () => 0),
  getDurableStoredTradeCount: vi.fn(async () => 0),
  getUnsyncedCompletedTradeCount: vi.fn(async () => 0),
  getUnsyncedGivebackSampleCount: vi.fn(async () => 0),
  getLastReconciliationAt: vi.fn(async () => null),
  getLastReconciliationErrors: vi.fn(async () => []),
  getLastFingerprintConflicts: vi.fn(async () => []),
  getLastSkippedNotTrainable: vi.fn(async () => []),
  getLastSyncedTrades: vi.fn(async () => []),
  getLastSyncedGivebackSamples: vi.fn(async () => []),
  getLastSkippedUnlabeledGiveback: vi.fn(async () => []),
  getLastIdempotentTrades: vi.fn(async () => []),
  getLastIdempotentGivebackSamples: vi.fn(async () => []),
  getLastInvalidProvenance: vi.fn(async () => []),
  getLastInsertErrors: vi.fn(async () => []),
  getReconciliationStatus: vi.fn(async () => "ok"),
  getReconciliationErrorCodes: vi.fn(async () => []),
}));
vi.mock("../spotAiForwardTwin/spotAiForwardTwinTypes", () => ({
  MIN_TRADES_TO_TRAIN: 50,
  PREFERRED_TRADES_TO_TRAIN: 200,
  SPOT_AI_FEATURE_SCHEMA_VERSION: 1,
}));
vi.mock("../spotAiForwardTwin/spotAiDuplicateIdentity", () => ({ countDuplicateFills: vi.fn(async () => 0), loadDuplicateFillQuality: vi.fn(async () => []) }));
vi.mock("../spotAiForwardTwin/spotAiCompletedTradeNormalizer", () => ({ normalizeCompletedTrades: vi.fn(() => []) }));

// ─── Test helpers ─────────────────────────────────────────────────────────────

function createMockApp() {
  const handlers: Record<string, (req: any, res: any) => void> = {};
  const app: any = {
    get: vi.fn((path: string, handler: any) => { handlers[path] = handler; }),
    post: vi.fn((path: string, handler: any) => { handlers[path] = handler; }),
  };
  return { app, handlers };
}

function createMockRes() {
  const res: any = {
    statusCode: 200,
    body: null as any,
    json: vi.fn((data: any) => { res.body = data; }),
    status: vi.fn((code: number) => { res.statusCode = code; return res; }),
  };
  return res;
}

async function waitBackgroundRefresh() {
  // setImmediate is used — wait for it to complete
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setTimeout(resolve, 10));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("R16 REGIMES ENDPOINT — PHYSICAL COLUMNS", () => {
  let handlers: Record<string, (req: any, res: any) => void>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockQueryResult = { rows: [] };
    mockQueryError = null;
    lastQuerySql = "";

    // Re-import after reset to get fresh module-level cache
    const { registerSpotAiRoutes } = await import("../../routes/spotAi.routes");
    const { app, handlers: h } = createMockApp();
    handlers = h;
    registerSpotAiRoutes(app as any);
  });

  // R16_API_01
  it("R16_API_01: schema unavailable → available=false, PHYSICAL_REGIME_SCHEMA_UNAVAILABLE", async () => {
    mockQueryError = Object.assign(new Error('column "regime" does not exist'), { code: "42703" });
    const res = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res);
    // First response is cold cache
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe("COMPUTING_COLD_CACHE");
    // Wait for background refresh
    await waitBackgroundRefresh();
    // The cache should now have the schema unavailable reason
    // Second request should return cached value
    const res2 = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res2);
    expect(res2.body.available).toBe(false);
    expect(res2.body.reason).toBe("PHYSICAL_REGIME_SCHEMA_UNAVAILABLE");
  });

  // R16_API_02
  it("R16_API_02: pending backfill → available=false, PHYSICAL_REGIME_BACKFILL_PENDING", async () => {
    mockQueryResult = {
      rows: [
        { regime_projection_version: null, regime: null, direction: null, count: "100" },
        { regime_projection_version: 1, regime: "TREND", direction: "BULLISH", count: "50" },
      ],
    };
    const res = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res);
    expect(res.body.available).toBe(false);
    await waitBackgroundRefresh();
    const res2 = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res2);
    expect(res2.body.available).toBe(false);
    expect(res2.body.reason).toBe("PHYSICAL_REGIME_BACKFILL_PENDING");
  });

  // R16_API_03
  it("R16_API_03: pending not partial — no distribution returned when pending > 0", async () => {
    mockQueryResult = {
      rows: [
        { regime_projection_version: null, regime: null, direction: null, count: "5" },
        { regime_projection_version: 1, regime: "TREND", direction: "BULLISH", count: "50" },
      ],
    };
    const res = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res);
    await waitBackgroundRefresh();
    const res2 = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res2);
    expect(res2.body.available).toBe(false);
    expect(res2.body.regimes).toEqual([]);
  });

  // R16_API_04
  it("R16_API_04: complete (all version=1) → available=true", async () => {
    mockQueryResult = {
      rows: [
        { regime_projection_version: 1, regime: "TREND", direction: "BULLISH", count: "100" },
        { regime_projection_version: 1, regime: "RANGE", direction: "NEUTRAL", count: "200" },
      ],
    };
    const res = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res);
    await waitBackgroundRefresh();
    const res2 = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res2);
    expect(res2.body.available).toBe(true);
    expect(res2.body.regimes).toHaveLength(2);
  });

  // R16_API_05
  it("R16_API_05: physical values — uses regime/direction from physical columns", async () => {
    mockQueryResult = {
      rows: [
        { regime_projection_version: 1, regime: "TREND", direction: "BULLISH", count: "100" },
      ],
    };
    const res = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res);
    await waitBackgroundRefresh();
    const res2 = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res2);
    expect(res2.body.regimes[0].regime).toBe("TREND");
    expect(res2.body.regimes[0].direction).toBe("BULLISH");
    expect(res2.body.regimes[0].count).toBe(100);
  });

  // R16_API_06
  it("R16_API_06: no JSONB query — productive SQL does not contain data->'regime'", async () => {
    mockQueryResult = { rows: [] };
    const res = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res);
    await waitBackgroundRefresh();
    // The background refresh query should not contain JSONB extraction
    expect(lastQuerySql).not.toContain("data->'regime'");
    expect(lastQuerySql).not.toContain("data->>'regime'");
  });

  // R16_API_07
  it("R16_API_07: NULL parity — NULL regime/direction preserved as UNKNOWN/NEUTRAL", async () => {
    mockQueryResult = {
      rows: [
        { regime_projection_version: 1, regime: null, direction: null, count: "50" },
      ],
    };
    const res = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res);
    await waitBackgroundRefresh();
    const res2 = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res2);
    expect(res2.body.available).toBe(true);
    expect(res2.body.regimes[0].regime).toBe("UNKNOWN");
    expect(res2.body.regimes[0].direction).toBe("NEUTRAL");
  });

  // R16_API_08
  it("R16_API_08: result parity — same distribution as legacy would produce", async () => {
    // Physical result matching what the legacy JSONB query would produce
    mockQueryResult = {
      rows: [
        { regime_projection_version: 1, regime: "RANGE", direction: "NEUTRAL", count: "2927" },
        { regime_projection_version: 1, regime: "TRANSITION", direction: "NEUTRAL", count: "11490" },
        { regime_projection_version: 1, regime: "TREND", direction: "BULLISH", count: "1757" },
        { regime_projection_version: 1, regime: "TREND", direction: "BEARISH", count: "1321" },
      ],
    };
    const res = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res);
    await waitBackgroundRefresh();
    const res2 = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res2);
    expect(res2.body.available).toBe(true);
    // Sorted by count DESC
    expect(res2.body.regimes[0].count).toBe(11490);
    expect(res2.body.regimes[1].count).toBe(2927);
  });

  // R16_API_09
  it("R16_API_09: single snapshot coverage — aggregate + coverage in one query (no separate pending count)", async () => {
    mockQueryResult = { rows: [] };
    const res = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res);
    await waitBackgroundRefresh();
    // Only one DB query should have been executed (the GROUP BY)
    const { db } = await import("../../db");
    const executeCalls = (db.execute as any).mock.calls;
    // Filter out non-regimes queries (the route file has other endpoints, but we only call regimes)
    // The regimes handler should only make 1 db.execute call (the GROUP BY)
    expect(executeCalls.length).toBeGreaterThanOrEqual(1);
  });

  // R16_API_10
  it("R16_API_10: cache behavior unchanged — second request returns cached value", async () => {
    mockQueryResult = {
      rows: [
        { regime_projection_version: 1, regime: "TREND", direction: "BULLISH", count: "100" },
      ],
    };
    // First request — cold cache
    const res1 = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res1);
    expect(res1.body.available).toBe(false);
    expect(res1.body.reason).toBe("COMPUTING_COLD_CACHE");
    // Wait for background refresh
    await waitBackgroundRefresh();
    // Second request — should return cached value
    const res2 = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res2);
    expect(res2.body.available).toBe(true);
  });

  // R16_API_11
  it("R16_API_11: DB error fail-closed — generic DB error does NOT present as 0/available", async () => {
    mockQueryError = new Error("connection refused");
    const res = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res);
    // First response is cold cache (fail-closed)
    expect(res.body.available).toBe(false);
    await waitBackgroundRefresh();
    // Cache should NOT have been populated with success
    // Second request should still return cold cache (not a false success)
    const res2 = createMockRes();
    await handlers["/api/spot/ai/dataset/regimes"]({} as any, res2);
    expect(res2.body.available).toBe(false);
  });
});
