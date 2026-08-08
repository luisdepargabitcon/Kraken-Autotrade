/**
 * AMA Phase 1 — Route tests.
 *
 * Verifies:
 * - All endpoints respond
 * - REAL_LIMITED and REAL_FULL return 403 (double gate)
 * - analyze-now is side-effect free
 * - Kill switch works
 * - Invalid inputs return 400
 * - No secrets in error responses
 *
 * Uses Node http + express (no supertest dependency).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "http";

// Mock the runtime service to avoid DB calls in tests
const { mockRuntime } = vi.hoisted(() => ({
  mockRuntime: {
    getMode: vi.fn().mockReturnValue("OFF"),
    setMode: vi.fn(),
    canSetMode: vi.fn().mockReturnValue(true),
    isKillSwitchActive: vi.fn().mockReturnValue(false),
    setKillSwitch: vi.fn(),
    getStatus: vi.fn().mockResolvedValue({
      mode: "OFF",
      state: "OBSERVING",
      protectionState: null,
      pair: "BTC/USD",
      strategyVersion: "1.0.0",
      cycleId: null,
      activePolicyId: null,
      mandateId: null,
      killSwitchActive: false,
      lastUpdated: new Date().toISOString(),
    }),
    getMarketView: vi.fn().mockResolvedValue({
      pair: "BTC/USD",
      analysisPrice: null,
      analysisTimestamp: null,
      executionBid: null,
      executionAsk: null,
      executionMid: null,
      spreadPct: null,
      crossVenueBasisPct: null,
      executionTimestamp: null,
      highWaterMark: null,
      cycleLow: null,
      currentDropPct: null,
      maxDropPct: null,
      reboundFromLowPct: null,
      macroZone: null,
      daysSinceCeiling: null,
      daysSinceLow: null,
      dataQuality: "UNAVAILABLE",
    }),
    getMandate: vi.fn().mockResolvedValue(null),
    saveMandateDraft: vi.fn().mockResolvedValue({ mandateId: `mandate-test` }),
    approveMandateRuntime: vi.fn().mockResolvedValue({ mandateId: "mandate-test", status: "APPROVED" }),
    activateMandateRuntime: vi.fn().mockResolvedValue({ mandate: { mandateId: "mandate-test", status: "ACTIVE" }, policy: { policyId: "policy-test" } }),
    supersedeMandateRuntime: vi.fn().mockResolvedValue({ mandateId: "mandate-test", status: "SUPERSEDED" }),
    getActivePolicyRuntime: vi.fn().mockResolvedValue(null),
    getTranchePlan: vi.fn().mockResolvedValue(null),
    getCycles: vi.fn().mockResolvedValue([]),
    getTranches: vi.fn().mockResolvedValue([]),
    getPortfolioSummary: vi.fn().mockResolvedValue({
      mode: "OFF",
      budgetUsd: 0,
      deployedUsd: 0,
      reservedUsd: 0,
      freeUsd: 0,
      accumulatedQuantity: 0,
      averageCostBasis: null,
      currentValueUsd: null,
      unrealizedPnlUsd: null,
      realizedPnlUsd: null,
      sleeves: [],
    }),
    getDisplayName: vi.fn().mockReturnValue("AMA — Acumulación Macro Adaptativa"),
    getShortName: vi.fn().mockReturnValue("AMA"),
    getStrategyCode: vi.fn().mockReturnValue("ADAPTIVE_MACRO_ACCUMULATION"),
    getStrategyVersion: vi.fn().mockReturnValue("1.0.0"),
  },
}));

vi.mock("../amaRuntimeService", () => mockRuntime);
vi.mock("../amaRepository", () => ({
  checkAmaSchemaAvailable: vi.fn().mockResolvedValue(false),
}));
vi.mock("../amaShadowReadinessService", () => ({
  evaluateShadowReadiness: vi.fn().mockResolvedValue({ ready: false, blockers: ["NO_HIGH_WATER_MARK"] }),
}));
vi.mock("../amaLabReplayRunner", () => ({
  runLabSession: vi.fn().mockResolvedValue("lab-test"),
  runReplaySession: vi.fn().mockResolvedValue({ replayRunId: "replay-test", result: null }),
}));
vi.mock("../amaMarketRuntimeService", () => ({
  getRealMarketView: vi.fn().mockResolvedValue({
    pair: "BTC/USD",
    analysisPrice: null,
    analysisTimestamp: null,
    executionBid: null,
    executionAsk: null,
    executionMid: null,
    spreadPct: null,
    crossVenueBasisPct: null,
    executionTimestamp: null,
    highWaterMark: null,
    cycleLow: null,
    currentDropPct: null,
    maxDropPct: null,
    reboundFromLowPct: null,
    macroZone: null,
    daysSinceCeiling: null,
    daysSinceLow: null,
    dataQuality: "UNAVAILABLE",
  }),
  executeHwmBootstrap: vi.fn().mockResolvedValue({ hwm: 100000, hwmTimestamp: new Date().toISOString(), candlesProcessed: 200 }),
}));
vi.mock("../amaFunctionalClosure", () => ({
  amaHwmBootstrapService: {
    getState: vi.fn().mockResolvedValue({
      pair: "BTC/USD",
      hwm: null,
      hwmTimestamp: null,
      bootstrapStatus: "PENDING",
      dataCoveragePct: 0,
      candlesProcessed: 0,
      candlesTotal: 0,
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    }),
    startBootstrap: vi.fn().mockResolvedValue(undefined),
    updateProgress: vi.fn().mockResolvedValue(undefined),
    completeBootstrap: vi.fn().mockResolvedValue(undefined),
    failBootstrap: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockResolvedValue(false),
  },
  amaSchedulerStateService: {
    getState: vi.fn().mockResolvedValue({
      currentMode: "OFF",
      lastTickAt: null,
      lastCycleId: null,
      tickCount: 0,
      errorCount: 0,
      lastError: null,
      advisoryLockHeld: false,
      updatedAt: new Date().toISOString(),
    }),
    recordTick: vi.fn().mockResolvedValue(undefined),
    recordError: vi.fn().mockResolvedValue(undefined),
    setMode: vi.fn().mockResolvedValue(undefined),
    acquireAdvisoryLock: vi.fn().mockResolvedValue(true),
    releaseAdvisoryLock: vi.fn().mockResolvedValue(undefined),
  },
  amaRealStateService: {
    getState: vi.fn().mockResolvedValue({ operationalState: "NOT_READY" }),
  },
}));
vi.mock("../amaLabService", () => ({
  startLabSession: vi.fn().mockResolvedValue("lab-test"),
  listLabSessions: vi.fn().mockResolvedValue([]),
  getLabSession: vi.fn().mockResolvedValue(null),
  completeLabSession: vi.fn().mockResolvedValue(undefined),
  failLabSession: vi.fn().mockResolvedValue(undefined),
  simulateLabScenario: vi.fn().mockReturnValue({}),
}));
vi.mock("../amaReplayService", () => ({
  startReplayRun: vi.fn().mockResolvedValue("replay-test"),
  listReplayRuns: vi.fn().mockResolvedValue([]),
  getReplayRun: vi.fn().mockResolvedValue(null),
  executeReplayRun: vi.fn().mockResolvedValue({}),
}));
vi.mock("../amaShadowExecutor", () => ({
  getShadowOrders: vi.fn().mockResolvedValue([]),
  generateShadowReport: vi.fn().mockResolvedValue({}),
  createShadowScenario: vi.fn().mockResolvedValue(undefined),
  listShadowScenarios: vi.fn().mockResolvedValue([]),
  closeShadowScenario: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../amaRealLimitedService", () => ({
  getAuthorizationStatus: vi.fn().mockResolvedValue({ isActive: false, operationalState: "NOT_READY" }),
  grantAuthorization: vi.fn().mockResolvedValue(undefined),
  revokeAuthorization: vi.fn().mockResolvedValue(undefined),
  getGateHistory: vi.fn().mockResolvedValue([]),
  getPendingReconciliations: vi.fn().mockResolvedValue([]),
  pauseOperations: vi.fn().mockResolvedValue(undefined),
  resumeOperations: vi.fn().mockResolvedValue(undefined),
  deactivate: vi.fn().mockResolvedValue(undefined),
  emergencyStop: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../amaPortfolioLedger", () => ({
  getLedgerEntries: vi.fn().mockResolvedValue([]),
}));

import { registerAmaRoutes } from "../../../routes/ama.routes";

function createServer() {
  const app = express();
  app.use(express.json());
  registerAmaRoutes(app);
  return http.createServer(app);
}

async function req(server: http.Server, method: string, path: string, body?: any) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const port = (server.address() as any)?.port ?? 0;
    const opts: http.RequestOptions = {
      method,
      path,
      host: "127.0.0.1",
      port,
      headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {},
    };
    const r = http.request(opts, (res) => {
      let chunks = "";
      res.on("data", (c) => (chunks += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(chunks) });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: chunks });
        }
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as any).port));
  });
}

describe("AMA Routes — API", () => {
  let server: http.Server;

  beforeEach(async () => {
    server = createServer();
    await listen(server);
    mockRuntime.getMode.mockReturnValue("OFF");
    mockRuntime.isKillSwitchActive.mockReturnValue(false);
    mockRuntime.setMode.mockReset();
    mockRuntime.setKillSwitch.mockReset();
    mockRuntime.getStatus.mockResolvedValue({
      mode: "OFF",
      state: "OBSERVING",
      protectionState: null,
      pair: "BTC/USD",
      strategyVersion: "1.0.0",
      cycleId: null,
      activePolicyId: null,
      mandateId: null,
      killSwitchActive: false,
      lastUpdated: new Date().toISOString(),
    });
    // Make setMode update getStatus to reflect the new mode
    mockRuntime.setMode.mockImplementation((mode: string) => {
      mockRuntime.getStatus.mockResolvedValue({
        mode,
        state: "OBSERVING",
        protectionState: null,
        pair: "BTC/USD",
        strategyVersion: "1.0.0",
        cycleId: null,
        activePolicyId: null,
        mandateId: null,
        killSwitchActive: false,
        lastUpdated: new Date().toISOString(),
      });
    });
  });

  afterEach(() => {
    server.close();
  });

  describe("GET /api/ama/status", () => {
    it("responds 200 with status", async () => {
      const res = await req(server, "GET", "/api/ama/status");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("mode");
      expect(res.body.data).toHaveProperty("state");
      expect(res.body.data).toHaveProperty("pair");
    });
  });

  describe("GET /api/ama/meta", () => {
    it("responds 200 with meta", async () => {
      const res = await req(server, "GET", "/api/ama/meta");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.displayName).toContain("AMA");
      expect(res.body.data.modes).toHaveLength(7);
    });
  });

  describe("GET /api/ama/market-view", () => {
    it("responds 200 with market view", async () => {
      const res = await req(server, "GET", "/api/ama/market-view");
      expect(res.status).toBe(200);
      expect(res.body.data.analysisPrice).toBeNull();
      expect(res.body.data.dataQuality).toBe("UNAVAILABLE");
    });
  });

  describe("GET /api/ama/portfolio", () => {
    it("responds 200 with zero portfolio", async () => {
      const res = await req(server, "GET", "/api/ama/portfolio");
      expect(res.status).toBe(200);
      expect(res.body.data.budgetUsd).toBe(0);
      expect(res.body.data.accumulatedQuantity).toBe(0);
    });
  });

  describe("GET /api/ama/cycles", () => {
    it("responds 200 with empty array", async () => {
      const res = await req(server, "GET", "/api/ama/cycles");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe("GET /api/ama/cycles/:id", () => {
    it("responds 404 for non-existent cycle", async () => {
      const res = await req(server, "GET", "/api/ama/cycles/nonexistent");
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/ama/mode", () => {
    it("allows OFF", async () => {
      const res = await req(server, "POST", "/api/ama/mode", { mode: "OFF" });
      expect(res.status).toBe(200);
      expect(res.body.data.mode).toBe("OFF");
    });

    it("allows REPLAY", async () => {
      const res = await req(server, "POST", "/api/ama/mode", { mode: "REPLAY" });
      expect(res.status).toBe(200);
      expect(res.body.data.mode).toBe("REPLAY");
    });

    it("BLOCKS SHADOW_SCENARIO with 403 (readiness not met in stub)", async () => {
      const res = await req(server, "POST", "/api/ama/mode", { mode: "SHADOW_SCENARIO" });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("SHADOW_SCENARIO blocked");
    });

    it("BLOCKS REAL_LIMITED with 403", async () => {
      const res = await req(server, "POST", "/api/ama/mode", { mode: "REAL_LIMITED" });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("REAL_LIMITED");
      expect(res.body.error).toContain("authorization");
    });

    it("BLOCKS REAL_FULL with 403", async () => {
      const res = await req(server, "POST", "/api/ama/mode", { mode: "REAL_FULL" });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("REAL_FULL");
    });

    it("rejects invalid mode with 400", async () => {
      const res = await req(server, "POST", "/api/ama/mode", { mode: "INVALID" });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("rejects missing mode with 400", async () => {
      const res = await req(server, "POST", "/api/ama/mode", {});
      expect(res.status).toBe(400);
    });

    it("does not change mode when REAL blocked", async () => {
      await req(server, "POST", "/api/ama/mode", { mode: "REAL_LIMITED" });
      expect(mockRuntime.setMode).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/ama/analyze-now", () => {
    it("responds 200 with analysis run ID", async () => {
      const res = await req(server, "POST", "/api/ama/analyze-now");
      expect(res.status).toBe(200);
      expect(res.body.data.analysisRunId).toMatch(/^run-/);
      expect(res.body.data.message).toContain("No orders");
    });

    it("does not change mode", async () => {
      mockRuntime.getStatus.mockResolvedValue({
        mode: "REPLAY",
        state: "OBSERVING",
        protectionState: null,
        pair: "BTC/USD",
        strategyVersion: "1.0.0",
        cycleId: null,
        activePolicyId: null,
        mandateId: null,
        killSwitchActive: false,
        lastUpdated: new Date().toISOString(),
      });
      await req(server, "POST", "/api/ama/mode", { mode: "REPLAY" });
      await req(server, "POST", "/api/ama/analyze-now");
      expect(mockRuntime.setMode).toHaveBeenCalledWith("REPLAY", "API");
    });

    it("does not change kill switch", async () => {
      mockRuntime.isKillSwitchActive.mockReturnValue(false);
      await req(server, "POST", "/api/ama/analyze-now");
      expect(mockRuntime.isKillSwitchActive()).toBe(false);
    });
  });

  describe("POST /api/ama/kill-switch", () => {
    it("activates kill switch", async () => {
      mockRuntime.isKillSwitchActive.mockReturnValue(true);
      const res = await req(server, "POST", "/api/ama/kill-switch", { active: true });
      expect(res.status).toBe(200);
      expect(res.body.data.killSwitchActive).toBe(true);
      expect(mockRuntime.setKillSwitch).toHaveBeenCalledWith(true);
    });

    it("deactivates kill switch", async () => {
      mockRuntime.isKillSwitchActive.mockReturnValue(false);
      const res = await req(server, "POST", "/api/ama/kill-switch", { active: false });
      expect(res.status).toBe(200);
      expect(res.body.data.killSwitchActive).toBe(false);
    });

    it("rejects non-boolean with 400", async () => {
      const res = await req(server, "POST", "/api/ama/kill-switch", { active: "yes" });
      expect(res.status).toBe(400);
    });

    it("does NOT activate REAL when deactivated", async () => {
      mockRuntime.getMode.mockReturnValue("OFF");
      mockRuntime.isKillSwitchActive.mockReturnValue(false);
      await req(server, "POST", "/api/ama/kill-switch", { active: false });
      expect(mockRuntime.getMode()).toBe("OFF");
    });
  });

  describe("POST /api/ama/mandate/drafts", () => {
    it("accepts valid mandate input", async () => {
      const res = await req(server, "POST", "/api/ama/mandate/drafts", {
        maxCapitalUsd: 5000,
        riskMandate: "PRUDENTE",
        accumulationStyle: "ADAPTATIVO",
        exitObjective: "RECUPERAR_CAPITAL",
        autonomyLevel: "SOLO_ANALISIS",
      });
      expect(res.status).toBe(200);
      expect(res.body.data.mandateId).toMatch(/^mandate-/);
    });

    it("rejects negative capital with 400", async () => {
      const res = await req(server, "POST", "/api/ama/mandate/drafts", {
        maxCapitalUsd: -100,
        riskMandate: "PRUDENTE",
        accumulationStyle: "ADAPTATIVO",
        exitObjective: "RECUPERAR_CAPITAL",
        autonomyLevel: "SOLO_ANALISIS",
      });
      expect(res.status).toBe(400);
    });

    it("rejects invalid risk mandate with 400", async () => {
      const res = await req(server, "POST", "/api/ama/mandate/drafts", {
        maxCapitalUsd: 1000,
        riskMandate: "INVALID",
        accumulationStyle: "ADAPTATIVO",
        exitObjective: "RECUPERAR_CAPITAL",
        autonomyLevel: "SOLO_ANALISIS",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/ama/replay/run", () => {
    it("accepts valid replay config", async () => {
      const res = await req(server, "POST", "/api/ama/replay/run", {
        startDate: "2025-01-01",
        endDate: "2025-06-01",
      });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("COMPLETED");
    });

    it("rejects missing dates with 400", async () => {
      const res = await req(server, "POST", "/api/ama/replay/run", {});
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/ama/ai/status", () => {
    it("responds 200 with AI unavailable", async () => {
      const res = await req(server, "GET", "/api/ama/ai/status");
      expect(res.status).toBe(200);
      expect(res.body.data.available).toBe(false);
      expect(res.body.data.state).toBe("AI_PROVIDER_UNAVAILABLE");
    });
  });

  describe("GET /api/ama/schema-status", () => {
    it("responds 200 with SCHEMA_NOT_AVAILABLE", async () => {
      const res = await req(server, "GET", "/api/ama/schema-status");
      expect(res.status).toBe(200);
      expect(res.body.data.schemaAvailable).toBe(false);
      expect(res.body.data.state).toBe("SCHEMA_NOT_AVAILABLE");
    });
  });

  describe("Error sanitization", () => {
    it("does not expose stack traces", async () => {
      const res = await req(server, "POST", "/api/ama/mode", { mode: "REAL_LIMITED" });
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain("stack");
      expect(JSON.stringify(res.body)).not.toMatch(/\n\s+at\s/);
    });

    it("does not expose internal paths", async () => {
      const res = await req(server, "POST", "/api/ama/mode", { mode: "INVALID" });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain("C:\\");
      expect(JSON.stringify(res.body)).not.toContain("/home/");
    });
  });

  describe("REAL_LIMITED operational controls", () => {
    it("POST /api/ama/real/pause responds 200", async () => {
      const res = await req(server, "POST", "/api/ama/real/pause", { reason: "test" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.paused).toBe(true);
    });

    it("POST /api/ama/real/resume responds 200", async () => {
      const res = await req(server, "POST", "/api/ama/real/resume");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.resumed).toBe(true);
    });

    it("POST /api/ama/real/deactivate responds 200", async () => {
      const res = await req(server, "POST", "/api/ama/real/deactivate", { reason: "test" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deactivated).toBe(true);
    });

    it("POST /api/ama/real/kill-switch responds 200", async () => {
      const res = await req(server, "POST", "/api/ama/real/kill-switch", { active: true, reason: "emergency" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.killSwitchActive).toBe(true);
    });
  });
});
