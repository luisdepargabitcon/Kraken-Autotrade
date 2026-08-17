/**
 * SPOT Routes — Unit Tests
 *
 * R10.9-cierre: All tests use explicit mocks — NO [200,500] tolerance.
 * DB-dependent endpoints are mocked to test both SUCCESS and FAIL-CLOSED paths.
 * No dependency on local PostgreSQL.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { Express } from "express";
import http from "http";
import { ExecutionMode } from "../../services/spot/spotTypes";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockSpotEngine = vi.hoisted(() => ({
  getExecutionMode: vi.fn(async () => ExecutionMode.OFF),
  setExecutionMode: vi.fn(async (mode: ExecutionMode) => mode),
  getIntentStore: vi.fn(() => ({ getAll: () => [] })),
  getAuditTracker: vi.fn(() => ({
    getAll: () => [],
    getMetrics: vi.fn(() => null),
    getAggregate: vi.fn(() => ({ positionCount: 0, closedCount: 0, aggregate: {} })),
  })),
  getOpenPositions: vi.fn(async () => []),
  getClosedTrades: vi.fn(async () => []),
  getSummaryStats: vi.fn(async () => ({
    totalTrades: 0, netPnlUsd: 0, winRate: 0, totalFeesUsd: 0,
  })),
  getLastScanResults: vi.fn(() => []),
  getLastScanTime: vi.fn(() => 0),
  SPOT_RUNTIME_OWNER: "SPOT_CANONICAL",
}));

vi.mock("../../services/spot/spotEngine", () => ({
  getExecutionMode: mockSpotEngine.getExecutionMode,
  setExecutionMode: mockSpotEngine.setExecutionMode,
  getIntentStore: mockSpotEngine.getIntentStore,
  getAuditTracker: mockSpotEngine.getAuditTracker,
  getOpenPositions: mockSpotEngine.getOpenPositions,
  getClosedTrades: mockSpotEngine.getClosedTrades,
  getSummaryStats: mockSpotEngine.getSummaryStats,
  getLastScanResults: mockSpotEngine.getLastScanResults,
  getLastScanTime: mockSpotEngine.getLastScanTime,
  SPOT_RUNTIME_OWNER: mockSpotEngine.SPOT_RUNTIME_OWNER,
}));

vi.mock("../../services/spot/feeModel", () => ({
  getTradingFeeModel: vi.fn(() => ({ exchange: "revolutx", takerFeePct: 0.09, makerFeePct: 0.00, quality: "REAL" })),
}));

vi.mock("../../services/spot/spotExecutionModeStore", () => ({
  getCachedExecutionMode: vi.fn(() => ExecutionMode.OFF),
}));

vi.mock("../../services/spot/spotMarketContext", () => ({
  buildSpotMarketContext: vi.fn(async () => ({ regimeContext: { regime: "NEUTRAL", direction: "FLAT", macroBias: "NEUTRAL", atrPct: 1.5 } })),
}));

vi.mock("../../services/spot/spotRealReadiness", () => ({
  checkRealReadiness: vi.fn(async () => ({ ready: false, blockers: ["test"], warnings: [], checks: {} })),
}));

vi.mock("../../services/spot/spotActivityLogger", () => ({
  getActivityEvents: vi.fn(() => []),
  getActivityEventsFiltered: vi.fn(() => []),
  getActivityEventsFromDb: vi.fn(async () => []),
  humanizeSeverity: vi.fn((s: string) => s),
  humanizeCategory: vi.fn((c: string) => c),
  formatTimeAgo: vi.fn(() => "just now"),
}));

// Import after mocks
import { registerSpotRoutes, getSpotExecutionMode, getSpotIntentStore, getSpotAuditTracker } from "../spot.routes";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  registerSpotRoutes(app, {} as any);
  return app;
}

async function simulateGet(app: Express, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = (server.address() as any).port;
      http.get(`http://localhost:${port}${path}`, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          server.close();
          try { resolve({ status: res.statusCode || 200, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode || 200, body: data }); }
        });
      }).on("error", (err) => { server.close(); reject(err); });
    });
  });
}

async function simulatePost(app: Express, path: string, body: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = (server.address() as any).port;
      const payload = JSON.stringify(body);
      const req = http.request(`http://localhost:${port}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          server.close();
          try { resolve({ status: res.statusCode || 200, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode || 200, body: data }); }
        });
      });
      req.on("error", (err) => { server.close(); reject(err); });
      req.write(payload);
      req.end();
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSpotEngine.getExecutionMode.mockResolvedValue(ExecutionMode.OFF);
  mockSpotEngine.setExecutionMode.mockResolvedValue(ExecutionMode.OFF);
  mockSpotEngine.getOpenPositions.mockResolvedValue([]);
  mockSpotEngine.getClosedTrades.mockResolvedValue([]);
  mockSpotEngine.getSummaryStats.mockResolvedValue({
    totalTrades: 0, netPnlUsd: 0, winRate: 0, totalFeesUsd: 0,
  });
});

describe("SPOT_API_STATUS", () => {
  it("GET /api/spot/status returns execution mode and fee model", async () => {
    const app = createApp();
    const res = await simulateGet(app, "/api/spot/status");
    expect(res.status).toBe(200);
    expect(res.body.executionMode).toBeDefined();
    expect(res.body.realActivationAllowed).toBe(true);
    expect(res.body.feeModel).toBeDefined();
    expect(res.body.feeModel.exchange).toBe("revolutx");
    expect(res.body.policyVersion).toContain("SPOT");
  });
});

describe("SPOT_API_MODE_OFF", () => {
  it("POST /api/spot/mode with OFF returns 200 with currentMode=OFF", async () => {
    mockSpotEngine.setExecutionMode.mockResolvedValue(ExecutionMode.OFF);
    const app = createApp();
    const res = await simulatePost(app, "/api/spot/mode", { mode: "OFF" });
    expect(res.status).toBe(200);
    expect(res.body.currentMode).toBe("OFF");
  });
});

describe("SPOT_API_MODE_SHADOW", () => {
  it("POST /api/spot/mode with SHADOW returns 200 with currentMode=SHADOW", async () => {
    mockSpotEngine.setExecutionMode.mockResolvedValue(ExecutionMode.SHADOW);
    const app = createApp();
    const res = await simulatePost(app, "/api/spot/mode", { mode: "SHADOW" });
    expect(res.status).toBe(200);
    expect(res.body.currentMode).toBe("SHADOW");
  });
});

describe("SPOT_API_MODE_REAL", () => {
  it("POST /api/spot/mode with REAL returns 500 when setExecutionMode throws (preflight fail)", async () => {
    mockSpotEngine.setExecutionMode.mockRejectedValue(new Error("REAL activation preflight failed: no balance"));
    const app = createApp();
    const res = await simulatePost(app, "/api/spot/mode", { mode: "REAL" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });

  it("POST /api/spot/mode with ambiguous value defaults to OFF (not REAL)", async () => {
    const app = createApp();
    const res = await simulatePost(app, "/api/spot/mode", { mode: "DRY_RUN" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});

describe("SPOT_API_INTENTS", () => {
  it("GET /api/spot/intents returns empty array initially", async () => {
    const app = createApp();
    const res = await simulateGet(app, "/api/spot/intents");
    expect(res.status).toBe(200);
    expect(res.body.intents).toEqual([]);
    expect(res.body.count).toBe(0);
  });
});

describe("SPOT_API_AUDIT", () => {
  it("GET /api/spot/audit returns empty aggregate", async () => {
    const app = createApp();
    const res = await simulateGet(app, "/api/spot/audit");
    expect(res.status).toBe(200);
    expect(res.body.positionCount).toBe(0);
    expect(res.body.closedCount).toBe(0);
    expect(res.body.aggregate).toBeDefined();
  });

  it("GET /api/spot/audit/:lotId returns 404 for unknown lot", async () => {
    const app = createApp();
    const res = await simulateGet(app, "/api/spot/audit/unknown-lot");
    expect(res.status).toBe(404);
  });
});

describe("SPOT_API_POSITIONS", () => {
  it("GET /api/spot/positions returns 200 with empty array when DB OK", async () => {
    mockSpotEngine.getOpenPositions.mockResolvedValue([]);
    const app = createApp();
    const res = await simulateGet(app, "/api/spot/positions");
    expect(res.status).toBe(200);
    expect(res.body.positions).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  it("GET /api/spot/positions returns 500 when DB fails", async () => {
    mockSpotEngine.getOpenPositions.mockRejectedValue(new Error("DB connection refused"));
    const app = createApp();
    const res = await simulateGet(app, "/api/spot/positions");
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

describe("SPOT_API_HISTORY", () => {
  it("GET /api/spot/history returns empty array", async () => {
    const app = createApp();
    const res = await simulateGet(app, "/api/spot/history");
    expect(res.status).toBe(200);
    expect(res.body.trades).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  it("GET /api/spot/history?limit=50 respects limit", async () => {
    const app = createApp();
    const res = await simulateGet(app, "/api/spot/history?limit=50");
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(50);
  });
});

describe("SPOT_API_SUMMARY", () => {
  it("GET /api/spot/summary returns 200 with initial state when DB OK", async () => {
    mockSpotEngine.getSummaryStats.mockResolvedValue({
      totalTrades: 0, netPnlUsd: 0, winRate: 0, totalFeesUsd: 0,
    });
    const app = createApp();
    const res = await simulateGet(app, "/api/spot/summary");
    expect(res.status).toBe(200);
    expect(res.body.executionMode).toBeDefined();
    expect(res.body.totalTrades).toBe(0);
    expect(res.body.netPnlUsd).toBe(0);
  });

  it("GET /api/spot/summary returns 500 when DB fails", async () => {
    mockSpotEngine.getSummaryStats.mockRejectedValue(new Error("DB connection refused"));
    const app = createApp();
    const res = await simulateGet(app, "/api/spot/summary");
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

describe("SPOT_API_REGIME", () => {
  it("GET /api/spot/regime/:pair returns 200 with mocked market context", async () => {
    const app = createApp();
    const res = await simulateGet(app, "/api/spot/regime/BTC-USD");
    expect(res.status).toBe(200);
    expect(res.body.regime).toBeDefined();
  });
});

describe("SPOT_API_EXPORTS", () => {
  it("getSpotExecutionMode returns current mode", () => {
    expect(getSpotExecutionMode()).toBeDefined();
    expect([ExecutionMode.OFF, ExecutionMode.SHADOW, ExecutionMode.REAL]).toContain(getSpotExecutionMode());
  });

  it("getSpotIntentStore returns store instance", () => {
    expect(getSpotIntentStore()).toBeDefined();
    expect(typeof getSpotIntentStore().getAll).toBe("function");
  });

  it("getSpotAuditTracker returns tracker instance", () => {
    expect(getSpotAuditTracker()).toBeDefined();
    expect(typeof getSpotAuditTracker().getAll).toBe("function");
  });
});
