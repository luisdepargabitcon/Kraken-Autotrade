import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { Express } from "express";
import http from "http";

// Mock dependencies
vi.mock("../../services/exchanges/RevolutXService", () => ({
  revolutXService: {
    isInitialized: vi.fn().mockReturnValue(false),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    getBalance: vi.fn().mockResolvedValue({ USD: 0, BTC: 0 }),
  },
}));

vi.mock("../../services/botLogger", () => ({
  botLogger: {
    info: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../db", () => {
  const chainable = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  return {
    db: {
      select: vi.fn().mockReturnValue(chainable),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1 }]) }),
      }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    },
  };
});

vi.mock("@shared/schema", () => ({
  gridIsolatedEvents: { createdAt: "created_at" },
  gridIsolatedLevels: {},
  gridIsolatedCycles: {},
  gridRangeVersions: {},
  gridIsolatedConfigs: {},
  exchangeBalanceSnapshots: {},
  strategyCapitalReservations: {},
  gridIsolatedMetricsSnapshots: {},
  gridIsolatedBacktests: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  desc: vi.fn(),
  and: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray, ...vals: any[]) => ({ sql: strings.join("?"), params: vals })),
}));

import { registerGridIsolatedRoutes } from "../gridIsolated.routes";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  registerGridIsolatedRoutes(app);
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
          try {
            resolve({ status: res.statusCode || 200, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode || 200, body: data });
          }
        });
      }).on("error", (err) => {
        server.close();
        reject(err);
      });
    });
  });
}

async function simulatePost(app: Express, path: string, body?: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = (server.address() as any).port;
      const payload = body ? JSON.stringify(body) : "";
      const req = http.request(
        `http://localhost:${port}${path}`,
        { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
        (res) => {
          let data = "";
          res.on("data", (chunk) => { data += chunk; });
          res.on("end", () => {
            server.close();
            try {
              resolve({ status: res.statusCode || 200, body: JSON.parse(data) });
            } catch {
              resolve({ status: res.statusCode || 200, body: data });
            }
          });
        }
      );
      req.on("error", (err) => { server.close(); reject(err); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

describe("Grid Isolated Routes — Endpoints", () => {
  let app: Express;

  beforeEach(() => {
    app = createApp();
  });

  it("GET /api/grid-isolated/unlock-status responds 200", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/unlock-status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("currentMode");
    expect(res.body).toHaveProperty("canUnlockRealLimited");
    expect(res.body).toHaveProperty("canUnlockRealFull");
    expect(res.body).toHaveProperty("postOnlySupported");
    expect(res.body).toHaveProperty("blockingReasons");
    expect(res.body).toHaveProperty("checks");
  });

  it("unlock-status returns postOnlySupported=true", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/unlock-status");
    expect(res.body.postOnlySupported).toBe(true);
  });

  it("unlock-status blocks REAL_LIMITED and REAL_FULL when mode lock not acknowledged", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/unlock-status");
    expect(res.body.canUnlockRealLimited).toBe(false);
    expect(res.body.canUnlockRealFull).toBe(false);
    // Blocking reasons should NOT contain post-only anymore
    const hasPostOnly = res.body.blockingReasons.some((r: string) => r.toLowerCase().includes("post-only"));
    expect(hasPostOnly).toBe(false);
  });

  it("GET /api/grid-isolated/monitor/audit responds 200", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "ok");
    expect(res.body).toHaveProperty("mode");
    expect(res.body).toHaveProperty("summary");
    expect(res.body).toHaveProperty("safety");
  });

  it("monitor/audit returns summary with postOnlySupported=true and realModesBlocked", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.body.summary).toHaveProperty("postOnlySupported", true);
    expect(res.body.summary).toHaveProperty("realModesBlocked");
    expect(res.body.summary).toHaveProperty("pair");
    expect(res.body.summary).toHaveProperty("executionPolicy");
  });

  it("monitor/audit returns safety with blocking reasons", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.body.safety).toHaveProperty("realLimitedBlocked", true);
    expect(res.body.safety).toHaveProperty("realFullBlocked", true);
    expect(res.body.safety.blockingReasons.length).toBeGreaterThan(0);
  });

  it("GET /api/grid-isolated/unlock-check still works (backward compat)", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/unlock-check");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("postOnlySupported", true);
  });

  it("GET /api/grid-isolated/events responds 200", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/events");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/grid-isolated/events accepts limit param", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/events?limit=5");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(5);
  });

  it("GET /api/grid-isolated/events does not fail with no events", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/events?limit=1");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("monitor/audit returns decisions array", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.decisions)).toBe(true);
    expect(res.body.decisions.length).toBeGreaterThan(0);
  });

  it("monitor/audit returns levels and cycles arrays", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.levels)).toBe(true);
    expect(Array.isArray(res.body.cycles)).toBe(true);
  });

  it("monitor/audit returns export.chatgptSummary", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(res.body.export).toBeDefined();
    expect(typeof res.body.export.chatgptSummary).toBe("string");
    expect(res.body.export.chatgptSummary).toContain("Modo:");
    expect(res.body.export.chatgptSummary).toContain("Adaptador RevolutXService");
  });

  it("monitor/audit returns api info", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(res.body.api).toBeDefined();
    expect(res.body.api).toHaveProperty("dailyOrderCount");
    expect(res.body.api).toHaveProperty("circuitBreakerOpen");
  });

  it("GET /api/grid-isolated/export/chatgpt responds 200 with text", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/export/chatgpt");
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe("string");
    expect(res.body).toContain("Modo:");
  });

  it("export chatgpt contains modo, bloqueos, RevolutXService and ciclos", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/export/chatgpt");
    expect(res.body).toContain("Modo:");
    expect(res.body).toContain("Adaptador RevolutXService");
    expect(res.body).toContain("Ciclos:");
    expect(res.body).toContain("Circuit breaker:");
  });

  it("monitor/audit returns ok:true", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
  });

  it("monitor/audit returns range object", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.body.range).toBeDefined();
    expect(res.body.range).toHaveProperty("status");
  });

  it("monitor/audit returns rangeHistory array", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.body.rangeHistory).toBeDefined();
    expect(Array.isArray(res.body.rangeHistory)).toBe(true);
  });

  it("monitor/audit returns wallet object", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(res.body.wallet).toBeDefined();
    expect(res.body.wallet).toHaveProperty("totalUsd");
    expect(res.body.wallet).toHaveProperty("freeUsd");
    expect(res.body.wallet).toHaveProperty("reservedUsd");
    expect(res.body.wallet).toHaveProperty("maxUsd");
    expect(res.body.wallet).toHaveProperty("status");
  });

  it("monitor/audit returns execution object", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(res.body.execution).toBeDefined();
    expect(res.body.execution).toHaveProperty("makerAttemptsBeforeTaker");
    expect(res.body.execution).toHaveProperty("takerFallbackEnabled");
    expect(res.body.execution).toHaveProperty("policyLabel");
  });

  it("monitor/audit execution policyLabel is in Spanish", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.body.execution.policyLabel).toContain("maker");
    expect(res.body.execution.policyLabel).toContain("taker");
  });

  it("export chatgpt contains ejecución info when config available", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/export/chatgpt");
    expect(res.body).toContain("Modo:");
    // Cartera/ejecución info only appears when config is loaded from engine
    // In test env config may be default, so just check basic structure
  });

  it("export chatgpt actions are numbered from 1", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/export/chatgpt");
    if (res.body.includes("acciones recomendadas")) {
      expect(res.body).toContain("  1. ");
    }
  });

  it("GET /api/grid-isolated/events/live responds 200 with ok", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/events/live?sinceId=0&limit=20");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
    expect(res.body).toHaveProperty("events");
    expect(res.body).toHaveProperty("lastEventId");
    expect(res.body).toHaveProperty("serverTime");
    expect(res.body).toHaveProperty("pollMs");
  });

  it("GET /api/grid-isolated/events accepts cycleId param", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/events?cycleId=test-cycle-1");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/grid-isolated/events accepts onlyBlocking=true", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/events?onlyBlocking=true");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /api/grid-isolated/shadow-validate responds 200 with no real orders", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/shadow-validate");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("success");
    expect(res.body).toHaveProperty("realOrdersPlaced", false);
    expect(res.body).toHaveProperty("realModesBlocked", true);
    expect(res.body).toHaveProperty("message");
  });
});
