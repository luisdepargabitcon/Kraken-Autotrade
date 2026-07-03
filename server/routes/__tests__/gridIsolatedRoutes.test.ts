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

vi.mock("../../db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
  },
}));

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

  it("unlock-status returns postOnlySupported=false", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/unlock-status");
    expect(res.body.postOnlySupported).toBe(false);
  });

  it("unlock-status blocks REAL_LIMITED and REAL_FULL when postOnlySupported=false", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/unlock-status");
    expect(res.body.canUnlockRealLimited).toBe(false);
    expect(res.body.canUnlockRealFull).toBe(false);
    expect(res.body.blockingReasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("post-only"),
      ])
    );
  });

  it("GET /api/grid-isolated/monitor/audit responds 200", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "ok");
    expect(res.body).toHaveProperty("mode");
    expect(res.body).toHaveProperty("summary");
    expect(res.body).toHaveProperty("safety");
  });

  it("monitor/audit returns summary with postOnlySupported and realModesBlocked", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.body.summary).toHaveProperty("postOnlySupported", false);
    expect(res.body.summary).toHaveProperty("realModesBlocked", true);
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
    expect(res.body).toHaveProperty("postOnlySupported", false);
  });

  it("GET /api/grid-isolated/events responds 200", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/events");
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
