/**
 * spotAiR14FCorrectness.test.ts — R14F CORRECTNESS CLOSURE tests.
 *
 * Tests the actual route logic for the defects found by the R14
 * counter-audit. Uses mock req/res and mock db to invoke the
 * productive route handlers directly.
 *
 * Tests:
 *   QUALITY_FALSE_ZERO_01: invalidSnapshots=null (not 0) when not computable
 *   QUALITY_NESTED_MISSING_02: missingFeatures=null (not 0)
 *   FEATURE_NULL_INTENT_03: intent=null does not produce missingPct=0
 *   FEATURE_NULL_SIZING_04: sizing=null does not produce missingPct=0
 *   DURABLE_OUTAGE_STATUS_05: durable=null => labeledTrades=null, available=false
 *   DURABLE_OUTAGE_TRACKING_06: durable=null => tracking shows NO_DISPONIBLE
 *   TRACKING_PARTIAL_EXIT_07: BUY 1.0 / SELL 0.2 => not COMPLETO
 *   TRACKING_OVERFLOW_08: BUY 1.0 / SELL 1.2 => not COMPLETO
 *   TRACKING_CANONICAL_COMPLETE_09: BUY 1.0 / SELL 1.0 valid => COMPLETO
 *   TRACKING_LIMIT_SUMMARY_10: 60 lots, limit=50 => uniqueLots=60, lots.length=50
 *   REGIMES_RESULT_PARITY_11: regimes cache hit returns same data as cold
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));

vi.mock("../../db", () => ({
  db: { execute: mockExecute },
}));

vi.mock("../spotAiForwardTwin/spotAiDurableTrainingStore", () => ({
  isDurableStorageAvailable: vi.fn().mockResolvedValue(true),
  getDurableStoredTradeCount: vi.fn().mockResolvedValue(0),
  getDurableTrainableTradeCount: vi.fn().mockResolvedValue(0),
  getDurableCompletedTradeCount: vi.fn().mockResolvedValue(0),
  getUnsyncedCompletedTradeCount: vi.fn().mockResolvedValue(0),
  getUnsyncedGivebackSampleCount: vi.fn().mockResolvedValue(0),
  getReconciliationMetrics: vi.fn().mockReturnValue({
    lastAttemptAt: 1000, lastCompletedAt: 2000, status: "SUCCESS",
    errors: 0, fingerprintConflicts: 0, skippedNotTrainable: 0,
    skippedUnlabeledGiveback: 0, syncedTrades: 0, syncedGivebackSamples: 0,
    idempotentTrades: 0, idempotentGivebackSamples: 0,
    invalidProvenance: 0, insertErrors: 0, errorCodes: [],
  }),
  getLastReconciliationAt: vi.fn().mockReturnValue(1000),
  getLastReconciliationErrors: vi.fn().mockReturnValue(0),
  getLastFingerprintConflicts: vi.fn().mockReturnValue(0),
  getLastSkippedNotTrainable: vi.fn().mockReturnValue(0),
  getLastSyncedTrades: vi.fn().mockReturnValue(0),
  getLastSyncedGivebackSamples: vi.fn().mockReturnValue(0),
  getLastSkippedUnlabeledGiveback: vi.fn().mockReturnValue(0),
  getLastIdempotentTrades: vi.fn().mockReturnValue(0),
  getLastIdempotentGivebackSamples: vi.fn().mockReturnValue(0),
  getLastInvalidProvenance: vi.fn().mockReturnValue(0),
  getLastInsertErrors: vi.fn().mockReturnValue(0),
  getReconciliationStatus: vi.fn().mockReturnValue("SUCCESS"),
  getReconciliationErrorCodes: vi.fn().mockReturnValue([]),
  DURABLE_RETENTION_POLICY: "NO_AUTO_DELETE_UNTIL_VALIDATED",
}));

vi.mock("../spot/spotEngine", () => ({
  getSummaryStats: vi.fn().mockResolvedValue({ totalTrades: 41 }),
}));

vi.mock("../spot/spotForwardTwinCollector", () => ({
  getCollectorStats: vi.fn().mockReturnValue({
    enabled: true, bufferSize: 0, bufferMax: 500,
    totalCaptured: 5, totalFlushed: 5, droppedSnapshots: 0,
  }),
}));

vi.mock("../spotAiForwardTwin/spotAiDuplicateIdentity", () => ({
  countDuplicateFills: vi.fn().mockReturnValue(0),
  loadDuplicateFillQuality: vi.fn().mockResolvedValue({
    available: true,
    duplicateEntryFills: 0,
    duplicateExitFills: 0,
    error: null,
  }),
}));

vi.mock("../spotAiForwardTwin/spotAiAdvisoryService", () => ({
  advisoryService: {
    getStatus: vi.fn().mockResolvedValue({
      status: "COLLECTING",
      featureSchemaVersion: 1,
      totalSnapshots: 0,
      labeledTrades: 0,
      minTradesToTrain: 100,
      preferredTradesToTrain: 200,
      entryModelVersion: null,
      givebackModelVersion: null,
      entryModelStatus: null,
      givebackModelStatus: null,
      autoRetrain: false,
      aiTradingControl: "NONE",
      legacyDataMixed: false,
      trainingPipelineReady: false,
    }),
    getRecentAdvisoryLogs: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../spotAiForwardTwin/spotAiModelRegistry", () => ({
  modelRegistry: { listAll: vi.fn().mockReturnValue([]) },
}));

vi.mock("../spotAiForwardTwin/spotAiTrainerService", () => ({
  trainerService: {
    train: vi.fn(),
    getTrainingStatus: vi.fn().mockReturnValue(null),
  },
}));

vi.mock("../spotAiForwardTwin/spotAiFeatureBuilder", () => ({
  CANONICAL_FEATURE_DEFINITIONS: [
    { name: "bid", category: "ticker", description: "Bid price" },
    { name: "atrPct", category: "regime", description: "ATR %" },
    { name: "adx", category: "regime", description: "ADX" },
    { name: "ema20", category: "regime", description: "EMA 20" },
    { name: "ema50", category: "regime", description: "EMA 50" },
    { name: "ema200", category: "regime", description: "EMA 200" },
    { name: "volume", category: "volume", description: "Volume 24h" },
    { name: "volumeRatio", category: "volume", description: "Volume ratio" },
    { name: "setupTag", category: "signal", description: "Setup tag" },
    { name: "signalConfidence", category: "signal", description: "Signal confidence" },
    { name: "intentState", category: "intent", description: "Intent state" },
    { name: "notionalUsd", category: "sizing", description: "Notional USD" },
    { name: "initialRiskUsd", category: "sizing", description: "Initial risk USD" },
    { name: "availableCapital", category: "capital", description: "Available capital" },
  ],
}));

vi.mock("../spotAiForwardTwin/spotAiForwardTwinTypes", () => ({
  MIN_TRADES_TO_TRAIN: 100,
  PREFERRED_TRADES_TO_TRAIN: 200,
  SPOT_AI_FEATURE_SCHEMA_VERSION: 1,
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockApp(): any {
  const handlers: Record<string, Function> = {};
  const app: any = {
    get: (path: string, handler: Function) => { handlers["GET " + path] = handler; },
    post: (path: string, handler: Function) => { handlers["POST " + path] = handler; },
    _handlers: handlers,
  };
  return app;
}

async function callRoute(app: any, method: string, path: string, query: any = {}): Promise<{ status: number; body: any }> {
  const key = `${method} ${path}`;
  const handler = app._handlers[key];
  if (!handler) throw new Error(`No route for ${key}`);
  const req: any = { query };
  const res: any = {
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._body = body; },
    _status: 200,
    _body: null,
  };
  await handler(req, res);
  return { status: res._status, body: res._body };
}

// Helper: create a DB mock that returns different rows for different queries
// based on a matcher function.
function setupDbMock(matcher: (qs: string) => any[] | Promise<{ rows: any[] }>): void {
  mockExecute.mockImplementation((query: any) => {
    // Extract SQL string from drizzle-orm sql template object.
    // The query is a complex object with queryChunks containing SQL fragments.
    // We stringify it and match on substrings.
    let qs: string;
    if (typeof query === "string") {
      qs = query;
    } else if (query?.sql) {
      qs = query.sql;
    } else if (query?.query?.text) {
      qs = query.query.text;
    } else {
      // Drizzle SQL object — extract SQL from queryChunks
      const chunks = query?.queryChunks;
      if (Array.isArray(chunks)) {
        qs = chunks.map((c: any) => {
          if (typeof c === "string") return c;
          if (c?.value && Array.isArray(c.value)) return c.value.join("");
          return String(c ?? "");
        }).join(" ");
      } else {
        qs = JSON.stringify(query);
      }
    }
    const result = matcher(qs);
    if (result instanceof Promise) return result;
    return Promise.resolve({ rows: result });
  });
}

// ─── Quality endpoint helpers ───────────────────────────────────────────────

// Helper: quality endpoint runs multiple SQL queries. We need to return
// appropriate rows for each one based on the SQL content.
function qualityDbMatcher(_query: any): any[] {
  const queryStr = String(_query);
  // schema_mismatches
  if (queryStr.includes("schema_mismatches")) return [{ schema_mismatches: "0" }];
  // orphan_supervisor
  if (queryStr.includes("orphan_supervisor")) return [{ orphan_supervisor: "0" }];
  // orphan_fills
  if (queryStr.includes("orphan_fills")) return [{ orphan_fills: "0" }];
  // dup fills
  if (queryStr.includes("multi_buy_fills")) return [{ multi_buy_fills: "0", multi_sell_fills: "0", incomplete_trades: "0" }];
  // legacy
  if (queryStr.includes("lotId") && queryStr.includes("IS NULL") && queryStr.includes("BUY")) return [{ cnt: "0" }];
  // schema version
  if (queryStr.includes("v1_count")) return [{ v1_count: "100", v2_count: "0" }];
  // default
  return [];
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("R14F QUALITY_FALSE_ZERO_01 — invalidSnapshots=null", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("invalidSnapshots should be null (not 0) when not computable", async () => {
    setupDbMock(qualityDbMatcher);
    const app = createMockApp();
    const { registerSpotAiRoutes } = await import("../../routes/spotAi.routes");
    registerSpotAiRoutes(app);

    const response = await callRoute(app, "GET", "/api/spot/ai/dataset/quality");
    expect(response.status).toBe(200);
    expect(response.body.checks.invalidSnapshots).toBeNull();
    expect(response.body.checksAvailable.invalidSnapshots).toBe(false);
  });
});

describe("R14F QUALITY_NESTED_MISSING_02 — missingFeatures=null", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("missingFeatures should be null (not 0) when not computable", async () => {
    setupDbMock(qualityDbMatcher);
    const app = createMockApp();
    const { registerSpotAiRoutes } = await import("../../routes/spotAi.routes");
    registerSpotAiRoutes(app);

    const response = await callRoute(app, "GET", "/api/spot/ai/dataset/quality");
    expect(response.status).toBe(200);
    expect(response.body.checks.missingFeatures).toBeNull();
    expect(response.body.checksAvailable.missingFeatures).toBe(false);
  });
});

describe("R14F FEATURE_NULL_INTENT_03 — intent=null does not produce 0%", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("features endpoint should return missingPct=null for intentState (not 0)", async () => {
    // The features endpoint should return null for all missingPct values
    // because we cannot compute them without JSONB extraction.
    setupDbMock((qs: string) => {
      
      if (qs.includes("COUNT(*) AS total") && qs.includes("SCAN")) return [{ total: "100" }];
      return [];
    });

    const app = createMockApp();
    const { registerSpotAiRoutes } = await import("../../routes/spotAi.routes");
    registerSpotAiRoutes(app);

    const response = await callRoute(app, "GET", "/api/spot/ai/features");
    expect(response.status).toBe(200);
    const intentFeature = response.body.features.find((f: any) => f.name === "intentState");
    expect(intentFeature).toBeDefined();
    expect(intentFeature.missingPct).toBeNull();
  });
});

describe("R14F FEATURE_NULL_SIZING_04 — sizing=null does not produce 0%", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("features endpoint should return missingPct=null for notionalUsd and initialRiskUsd", async () => {
    setupDbMock((qs: string) => {
      
      if (qs.includes("COUNT(*) AS total") && qs.includes("SCAN")) return [{ total: "100" }];
      return [];
    });

    const app = createMockApp();
    const { registerSpotAiRoutes } = await import("../../routes/spotAi.routes");
    registerSpotAiRoutes(app);

    const response = await callRoute(app, "GET", "/api/spot/ai/features");
    expect(response.status).toBe(200);
    const notionalFeature = response.body.features.find((f: any) => f.name === "notionalUsd");
    expect(notionalFeature).toBeDefined();
    expect(notionalFeature.missingPct).toBeNull();

    const riskFeature = response.body.features.find((f: any) => f.name === "initialRiskUsd");
    expect(riskFeature).toBeDefined();
    expect(riskFeature.missingPct).toBeNull();
  });
});

describe("R14F DURABLE_OUTAGE_STATUS_05 — durable=null => labeledTrades=null", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("status endpoint should report labeledTrades=null when durable is unavailable", async () => {
    const { getDurableCompletedTradeCount } = await import("../spotAiForwardTwin/spotAiDurableTrainingStore");
    (getDurableCompletedTradeCount as any).mockResolvedValue(null);

    setupDbMock((qs: string) => {
      
      if (qs.includes("COUNT(*) AS total") && !qs.includes("SCAN")) return [{ total: "100" }];
      return [];
    });

    const app = createMockApp();
    const { registerSpotAiRoutes } = await import("../../routes/spotAi.routes");
    registerSpotAiRoutes(app);

    const response = await callRoute(app, "GET", "/api/spot/ai/status");
    expect(response.status).toBe(200);
    expect(response.body.labeledTrades).toBeNull();
    expect(response.body.labeledTradesAvailable).toBe(false);
  });
});

describe("R14F DURABLE_OUTAGE_TRACKING_06 — durable=null => NO_DISPONIBLE", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("tracking endpoint should report labelStatus=NO_DISPONIBLE when durable fails", async () => {
    const { getDurableCompletedTradeCount, isDurableStorageAvailable } = await import("../spotAiForwardTwin/spotAiDurableTrainingStore");
    (getDurableCompletedTradeCount as any).mockResolvedValue(null);
    (isDurableStorageAvailable as any).mockResolvedValue(false);

    // Mock DB for tracking endpoint
    setupDbMock((qs: string) => {
      
      // overview
      if (qs.includes("scan_count") && qs.includes("supervisor_count")) {
        return [{ total: "100", scan_count: "80", supervisor_count: "10", fill_count: "10" }];
      }
      // fill breakdown
      if (qs.includes("legacy_count") && qs.includes("valid_count")) {
        return [{ legacy_count: "5", valid_count: "5" }];
      }
      // global lot rows
      if (qs.includes("buy_fills") && qs.includes("sell_fills") && !qs.includes("last_sup") && !qs.includes("mfe_r")) {
        return [
          { lot_id: "lot-1", pair: "SOL/USD", buy_fills: "1", sell_fills: "1" },
        ];
      }
      // BUY fills
      if (qs.includes("'BUY'") && qs.includes("fillPrice")) {
        return [{ lot_id: "lot-1", pair: "SOL/USD", scan_id: "scan-1", fill_price: "100", fill_volume: "1.0", fee_usd: "1", ts: "1000" }];
      }
      // SELL fills
      if (qs.includes("'SELL'") && qs.includes("fillPrice")) {
        return [{ lot_id: "lot-1", pair: "SOL/USD", fill_price: "110", fill_volume: "1.0", fee_usd: "1", ts: "2000" }];
      }
      // SCAN sizings
      if (qs.includes("stop_price") && qs.includes("risk_usd")) {
        return [{ scan_id: "scan-1", pair: "SOL/USD", stop_price: "95", risk_usd: "10" }];
      }
      // supervisors
      if (qs.includes("mfe_r") && qs.includes("exit_reason_type")) {
        return [{ lot_id: "lot-1", pair: "SOL/USD", mfe: "2", mae: "1", mfe_r: "0.5", mae_r: "0.2", exit_reason_type: "PROFIT" }];
      }
      // legacy count
      if (qs.includes("COUNT(*) AS cnt") && qs.includes("IS NULL")) {
        return [{ cnt: "0" }];
      }
      // page lots (trackedLotRows) — the big CTE
      if (qs.includes("last_sup") || qs.includes("supervision_count")) {
        return [{ lot_id: "lot-1", pair: "SOL/USD", buy_fills: "1", sell_fills: "1", first_ts: "1000", last_ts: "2000",
          mfe_r: "0.5", mae_r: "0.2", current_r: null, qty_remaining: "0", initial_qty: "1", entry_price: "100",
          sup_ts: "1500", supervision_count: "5" }];
      }
      return [];
    });

    const app = createMockApp();
    const { registerSpotAiRoutes } = await import("../../routes/spotAi.routes");
    registerSpotAiRoutes(app);

    const response = await callRoute(app, "GET", "/api/spot/ai/tracking", { limit: "50" });
    expect(response.status).toBe(200);
    expect(response.body.labeledTrades).toBeNull();
    expect(response.body.labeledTradesAvailable).toBe(false);
    // At least one lot should have labelStatus=NO_DISPONIBLE
    const lot = response.body.lots?.find((l: any) => l.lotId === "lot-1");
    expect(lot).toBeDefined();
    expect(lot.labelStatus).toBe("NO_DISPONIBLE");
  });
});

describe("R14F TRACKING_PARTIAL_EXIT_07 — BUY 1.0 / SELL 0.2 => not COMPLETO", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("partial exit should be EN_SEGUIMIENTO, not COMPLETO", async () => {
    const { getDurableCompletedTradeCount, isDurableStorageAvailable } = await import("../spotAiForwardTwin/spotAiDurableTrainingStore");
    (getDurableCompletedTradeCount as any).mockResolvedValue(0);
    (isDurableStorageAvailable as any).mockResolvedValue(true);

    setupDbMock((qs: string) => {
      
      if (qs.includes("scan_count") && qs.includes("supervisor_count")) {
        return [{ total: "100", scan_count: "80", supervisor_count: "10", fill_count: "10" }];
      }
      if (qs.includes("legacy_count") && qs.includes("valid_count")) {
        return [{ legacy_count: "0", valid_count: "2" }];
      }
      // global lots
      if (qs.includes("buy_fills") && qs.includes("sell_fills") && !qs.includes("last_sup") && !qs.includes("mfe_r")) {
        return [{ lot_id: "lot-partial", pair: "SOL/USD", buy_fills: "1", sell_fills: "1" }];
      }
      // BUY fills — 1.0 volume
      if (qs.includes("'BUY'") && qs.includes("fillPrice")) {
        return [{ lot_id: "lot-partial", pair: "SOL/USD", scan_id: "scan-1", fill_price: "100", fill_volume: "1.0", fee_usd: "1", ts: "1000" }];
      }
      // SELL fills — 0.2 volume (partial)
      if (qs.includes("'SELL'") && qs.includes("fillPrice")) {
        return [{ lot_id: "lot-partial", pair: "SOL/USD", fill_price: "110", fill_volume: "0.2", fee_usd: "0.2", ts: "2000" }];
      }
      // SCAN sizings
      if (qs.includes("stop_price") && qs.includes("risk_usd")) {
        return [{ scan_id: "scan-1", pair: "SOL/USD", stop_price: "95", risk_usd: "10" }];
      }
      // supervisors
      if (qs.includes("mfe_r") && qs.includes("exit_reason_type")) {
        return [{ lot_id: "lot-partial", pair: "SOL/USD", mfe: "2", mae: "1", mfe_r: "0.5", mae_r: "0.2", exit_reason_type: "PROFIT" }];
      }
      if (qs.includes("COUNT(*) AS cnt") && qs.includes("IS NULL")) return [{ cnt: "0" }];
      // page lots
      if (qs.includes("last_sup") || qs.includes("supervision_count")) {
        return [{ lot_id: "lot-partial", pair: "SOL/USD", buy_fills: "1", sell_fills: "1", first_ts: "1000", last_ts: "2000",
          mfe_r: "0.5", mae_r: "0.2", current_r: null, qty_remaining: "0.8", initial_qty: "1", entry_price: "100",
          sup_ts: "1500", supervision_count: "5" }];
      }
      // durable lot keys
      if (qs.includes("spot_ai_forward_training_trades")) return [];
      return [];
    });

    const app = createMockApp();
    const { registerSpotAiRoutes } = await import("../../routes/spotAi.routes");
    registerSpotAiRoutes(app);

    const response = await callRoute(app, "GET", "/api/spot/ai/tracking", { limit: "50" });
    expect(response.status).toBe(200);
    const lot = response.body.lots.find((l: any) => l.lotId === "lot-partial");
    expect(lot).toBeDefined();
    expect(lot.lifecycleStatus).toBe("EN_SEGUIMIENTO");
    expect(lot.status).not.toBe("COMPLETO");
    // Global KPIs: completedTrades should be 0 (partial exit is not completed)
    expect(response.body.completedTrades).toBe(0);
  });
});

describe("R14F TRACKING_OVERFLOW_08 — BUY 1.0 / SELL 1.2 => not COMPLETO", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("exit volume overflow should be EN_SEGUIMIENTO, not COMPLETO", async () => {
    const { getDurableCompletedTradeCount, isDurableStorageAvailable } = await import("../spotAiForwardTwin/spotAiDurableTrainingStore");
    (getDurableCompletedTradeCount as any).mockResolvedValue(0);
    (isDurableStorageAvailable as any).mockResolvedValue(true);

    setupDbMock((qs: string) => {
      
      if (qs.includes("scan_count") && qs.includes("supervisor_count")) {
        return [{ total: "100", scan_count: "80", supervisor_count: "10", fill_count: "10" }];
      }
      if (qs.includes("legacy_count") && qs.includes("valid_count")) {
        return [{ legacy_count: "0", valid_count: "2" }];
      }
      if (qs.includes("buy_fills") && qs.includes("sell_fills") && !qs.includes("last_sup") && !qs.includes("mfe_r")) {
        return [{ lot_id: "lot-overflow", pair: "SOL/USD", buy_fills: "1", sell_fills: "1" }];
      }
      // BUY — 1.0 volume
      if (qs.includes("'BUY'") && qs.includes("fillPrice")) {
        return [{ lot_id: "lot-overflow", pair: "SOL/USD", scan_id: "scan-1", fill_price: "100", fill_volume: "1.0", fee_usd: "1", ts: "1000" }];
      }
      // SELL — 1.2 volume (overflow)
      if (qs.includes("'SELL'") && qs.includes("fillPrice")) {
        return [{ lot_id: "lot-overflow", pair: "SOL/USD", fill_price: "110", fill_volume: "1.2", fee_usd: "1.2", ts: "2000" }];
      }
      if (qs.includes("stop_price") && qs.includes("risk_usd")) {
        return [{ scan_id: "scan-1", pair: "SOL/USD", stop_price: "95", risk_usd: "10" }];
      }
      if (qs.includes("mfe_r") && qs.includes("exit_reason_type")) {
        return [{ lot_id: "lot-overflow", pair: "SOL/USD", mfe: "2", mae: "1", mfe_r: "0.5", mae_r: "0.2", exit_reason_type: "PROFIT" }];
      }
      if (qs.includes("COUNT(*) AS cnt") && qs.includes("IS NULL")) return [{ cnt: "0" }];
      if (qs.includes("last_sup") || qs.includes("supervision_count")) {
        return [{ lot_id: "lot-overflow", pair: "SOL/USD", buy_fills: "1", sell_fills: "1", first_ts: "1000", last_ts: "2000",
          mfe_r: "0.5", mae_r: "0.2", current_r: null, qty_remaining: "0", initial_qty: "1", entry_price: "100",
          sup_ts: "1500", supervision_count: "5" }];
      }
      if (qs.includes("spot_ai_forward_training_trades")) return [];
      return [];
    });

    const app = createMockApp();
    const { registerSpotAiRoutes } = await import("../../routes/spotAi.routes");
    registerSpotAiRoutes(app);

    const response = await callRoute(app, "GET", "/api/spot/ai/tracking", { limit: "50" });
    expect(response.status).toBe(200);
    const lot = response.body.lots.find((l: any) => l.lotId === "lot-overflow");
    expect(lot).toBeDefined();
    expect(lot.lifecycleStatus).toBe("EN_SEGUIMIENTO");
    expect(lot.status).not.toBe("COMPLETO");
    expect(response.body.completedTrades).toBe(0);
  });
});

describe("R14F TRACKING_CANONICAL_COMPLETE_09 — BUY 1.0 / SELL 1.0 valid => COMPLETO", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("valid BUY+SELL with matching volume and supervisor => COMPLETO", async () => {
    const { getDurableCompletedTradeCount, isDurableStorageAvailable } = await import("../spotAiForwardTwin/spotAiDurableTrainingStore");
    (getDurableCompletedTradeCount as any).mockResolvedValue(0);
    (isDurableStorageAvailable as any).mockResolvedValue(true);

    setupDbMock((qs: string) => {
      
      if (qs.includes("scan_count") && qs.includes("supervisor_count")) {
        return [{ total: "100", scan_count: "80", supervisor_count: "10", fill_count: "10" }];
      }
      if (qs.includes("legacy_count") && qs.includes("valid_count")) {
        return [{ legacy_count: "0", valid_count: "2" }];
      }
      if (qs.includes("buy_fills") && qs.includes("sell_fills") && !qs.includes("last_sup") && !qs.includes("mfe_r")) {
        return [{ lot_id: "lot-complete", pair: "SOL/USD", buy_fills: "1", sell_fills: "1" }];
      }
      // BUY — 1.0 volume
      if (qs.includes("'BUY'") && qs.includes("fillPrice")) {
        return [{ lot_id: "lot-complete", pair: "SOL/USD", scan_id: "scan-1", fill_price: "100", fill_volume: "1.0", fee_usd: "1", ts: "1000" }];
      }
      // SELL — 1.0 volume (exact match)
      if (qs.includes("'SELL'") && qs.includes("fillPrice")) {
        return [{ lot_id: "lot-complete", pair: "SOL/USD", fill_price: "110", fill_volume: "1.0", fee_usd: "1", ts: "2000" }];
      }
      if (qs.includes("stop_price") && qs.includes("risk_usd")) {
        return [{ scan_id: "scan-1", pair: "SOL/USD", stop_price: "95", risk_usd: "10" }];
      }
      if (qs.includes("mfe_r") && qs.includes("exit_reason_type")) {
        return [{ lot_id: "lot-complete", pair: "SOL/USD", mfe: "2", mae: "1", mfe_r: "0.5", mae_r: "0.2", exit_reason_type: "PROFIT" }];
      }
      if (qs.includes("COUNT(*) AS cnt") && qs.includes("IS NULL")) return [{ cnt: "0" }];
      if (qs.includes("last_sup") || qs.includes("supervision_count")) {
        return [{ lot_id: "lot-complete", pair: "SOL/USD", buy_fills: "1", sell_fills: "1", first_ts: "1000", last_ts: "2000",
          mfe_r: "0.5", mae_r: "0.2", current_r: null, qty_remaining: "0", initial_qty: "1", entry_price: "100",
          sup_ts: "1500", supervision_count: "5" }];
      }
      if (qs.includes("spot_ai_forward_training_trades")) return [];
      return [];
    });

    const app = createMockApp();
    const { registerSpotAiRoutes } = await import("../../routes/spotAi.routes");
    registerSpotAiRoutes(app);

    const response = await callRoute(app, "GET", "/api/spot/ai/tracking", { limit: "50" });
    expect(response.status).toBe(200);
    const lot = response.body.lots.find((l: any) => l.lotId === "lot-complete");
    expect(lot).toBeDefined();
    expect(lot.lifecycleStatus).toBe("COMPLETO");
    expect(response.body.completedTrades).toBe(1);
  });
});

describe("R14F TRACKING_LIMIT_SUMMARY_10 — 60 lots, limit=50 => uniqueLots=60", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("global KPIs should be independent of LIMIT", async () => {
    const { getDurableCompletedTradeCount, isDurableStorageAvailable } = await import("../spotAiForwardTwin/spotAiDurableTrainingStore");
    (getDurableCompletedTradeCount as any).mockResolvedValue(0);
    (isDurableStorageAvailable as any).mockResolvedValue(true);

    // Generate 60 lots
    const sixtyLots = Array.from({ length: 60 }, (_, i) => ({
      lot_id: `lot-${i}`, pair: "SOL/USD", buy_fills: "1", sell_fills: "0",
    }));
    const sixtyBuyFills = Array.from({ length: 60 }, (_, i) => ({
      lot_id: `lot-${i}`, pair: "SOL/USD", scan_id: `scan-${i}`, fill_price: "100", fill_volume: "1.0", fee_usd: "1", ts: "1000",
    }));
    // Only 50 page lots (LIMIT 50)
    const fiftyPageLots = Array.from({ length: 50 }, (_, i) => ({
      lot_id: `lot-${i}`, pair: "SOL/USD", buy_fills: "1", sell_fills: "0", first_ts: "1000", last_ts: "2000",
      mfe_r: null, mae_r: null, current_r: null, qty_remaining: "1", initial_qty: "1", entry_price: "100",
      sup_ts: "1500", supervision_count: "1",
    }));

    setupDbMock((qs: string) => {
      
      if (qs.includes("scan_count") && qs.includes("supervisor_count")) {
        return [{ total: "100", scan_count: "80", supervisor_count: "10", fill_count: "10" }];
      }
      if (qs.includes("legacy_count") && qs.includes("valid_count")) {
        return [{ legacy_count: "0", valid_count: "60" }];
      }
      // global lot rows — returns ALL 60 lots
      if (qs.includes("buy_fills") && qs.includes("sell_fills") && !qs.includes("last_sup") && !qs.includes("mfe_r")) {
        return sixtyLots;
      }
      if (qs.includes("'BUY'") && qs.includes("fillPrice")) return sixtyBuyFills;
      if (qs.includes("'SELL'") && qs.includes("fillPrice")) return [];
      if (qs.includes("stop_price") && qs.includes("risk_usd")) {
        return Array.from({ length: 60 }, (_, i) => ({ scan_id: `scan-${i}`, pair: "SOL/USD", stop_price: "95", risk_usd: "10" }));
      }
      if (qs.includes("mfe_r") && qs.includes("exit_reason_type")) return [];
      if (qs.includes("COUNT(*) AS cnt") && qs.includes("IS NULL")) return [{ cnt: "0" }];
      // page lots — returns only 50 (LIMIT)
      if (qs.includes("last_sup") || qs.includes("supervision_count")) return fiftyPageLots;
      if (qs.includes("spot_ai_forward_training_trades")) return [];
      return [];
    });

    const app = createMockApp();
    const { registerSpotAiRoutes } = await import("../../routes/spotAi.routes");
    registerSpotAiRoutes(app);

    const response = await callRoute(app, "GET", "/api/spot/ai/tracking", { limit: "50" });
    expect(response.status).toBe(200);
    expect(response.body.uniqueLots).toBe(60);
    expect(response.body.lots.length).toBe(50);
    expect(response.body.trackedLotsCount).toBe(60);
    expect(response.body.completedTrades).toBe(0);
  });
});

describe("R14F REGIMES_RESULT_PARITY_11 — cache hit returns same structure", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it("regimes cold cache should return available=false, then cache hit returns data", async () => {
    // First call: cold cache => available=false
    setupDbMock((qs: string) => {
      
      if (qs.includes("regime") && qs.includes("direction")) {
        return [
          { regime: "TREND", direction: "BULLISH", count: "100" },
        ];
      }
      return [];
    });

    const app = createMockApp();
    const { registerSpotAiRoutes } = await import("../../routes/spotAi.routes");
    registerSpotAiRoutes(app);

    const response = await callRoute(app, "GET", "/api/spot/ai/dataset/regimes");
    expect(response.status).toBe(200);
    // Cold cache: available=false, empty regimes
    expect(response.body.available).toBe(false);
    expect(response.body.regimes).toEqual([]);
    expect(response.body.reason).toBe("COMPUTING_COLD_CACHE");

    // Wait for background refresh to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Second call: cache hit => available=true, data present
    const response2 = await callRoute(app, "GET", "/api/spot/ai/dataset/regimes");
    expect(response2.status).toBe(200);
    expect(response2.body.available).toBe(true);
    expect(response2.body.regimes).toHaveLength(1);
    expect(response2.body.regimes[0].regime).toBe("TREND");
    expect(response2.body.regimes[0].direction).toBe("BULLISH");
    expect(response2.body.regimes[0].count).toBe(100);
  });
});


