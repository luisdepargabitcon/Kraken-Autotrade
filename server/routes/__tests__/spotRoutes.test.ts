/**
 * SPOT Routes — Unit Tests (FASE 16)
 *
 * Tests the API endpoints using http.createServer (no supertest dependency).
 * Required by PLAN:
 *   SPOT_API_STATUS
 *   SPOT_API_MODE_OFF
 *   SPOT_API_MODE_SHADOW
 *   SPOT_API_MODE_REAL_BLOCKED
 *   SPOT_API_INTENTS
 *   SPOT_API_AUDIT
 */

import { describe, it, expect, vi } from "vitest";
import express, { Express } from "express";
import http from "http";
import { registerSpotRoutes, getSpotExecutionMode, getSpotIntentStore, getSpotAuditTracker } from "../spot.routes";
import { ExecutionMode } from "../../services/spot/spotTypes";

vi.mock("../../services/spot/feeModel", () => ({
  getTradingFeeModel: vi.fn(() => ({ exchange: "revolutx", takerFeePct: 0.09, makerFeePct: 0.00, quality: "REAL" })),
}));

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

describe("SPOT_API_STATUS", () => {
  it("GET /api/spot/status returns execution mode and fee model", async () => {
    const app = createApp();
    const res = await simulateGet(app, "/api/spot/status");
    expect(res.status).toBe(200);
    expect(res.body.executionMode).toBeDefined();
    expect(res.body.realActivationAllowed).toBe(false);
    expect(res.body.feeModel).toBeDefined();
    expect(res.body.feeModel.exchange).toBe("revolutx");
    expect(res.body.policyVersion).toContain("SPOT");
  });
});

describe("SPOT_API_MODE_OFF", () => {
  it("POST /api/spot/mode with OFF succeeds", async () => {
    const app = createApp();
    const res = await simulatePost(app, "/api/spot/mode", { mode: "OFF" });
    expect(res.status).toBe(200);
    expect(res.body.currentMode).toBe("OFF");
  });
});

describe("SPOT_API_MODE_SHADOW", () => {
  it("POST /api/spot/mode with SHADOW succeeds", async () => {
    const app = createApp();
    const res = await simulatePost(app, "/api/spot/mode", { mode: "SHADOW" });
    expect(res.status).toBe(200);
    expect(res.body.currentMode).toBe("SHADOW");
  });
});

describe("SPOT_API_MODE_REAL_BLOCKED", () => {
  it("POST /api/spot/mode with REAL returns 403", async () => {
    const app = createApp();
    const res = await simulatePost(app, "/api/spot/mode", { mode: "REAL" });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("not authorized");
    expect(res.body.realActivationAllowed).toBe(false);
  });

  it("POST /api/spot/mode with ambiguous value defaults to OFF (not REAL)", async () => {
    const app = createApp();
    const res = await simulatePost(app, "/api/spot/mode", { mode: "DRY_RUN" });
    expect(res.status).toBe(200);
    expect(res.body.currentMode).toBe("OFF");
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
  it("GET /api/spot/positions returns empty array", async () => {
    const app = createApp();
    const res = await simulateGet(app, "/api/spot/positions");
    expect(res.status).toBe(200);
    expect(res.body.positions).toEqual([]);
    expect(res.body.count).toBe(0);
  });
});

describe("SPOT_API_HISTORY", () => {
  it("GET /api/spot/history returns empty array", async () => {
    const app = createApp();
    const res = await simulateGet(app, "/api/spot/history");
    expect(res.status).toBe(200);
    expect(res.body.trades).toEqual([]);
  });

  it("GET /api/spot/history?limit=50 respects limit", async () => {
    const app = createApp();
    const res = await simulateGet(app, "/api/spot/history?limit=50");
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(50);
  });
});

describe("SPOT_API_SUMMARY", () => {
  it("GET /api/spot/summary returns initial state", async () => {
    const app = createApp();
    const res = await simulateGet(app, "/api/spot/summary");
    expect(res.status).toBe(200);
    expect(res.body.executionMode).toBeDefined();
    expect(res.body.totalTrades).toBe(0);
    expect(res.body.netPnlUsd).toBe(0);
  });
});

describe("SPOT_API_REGIME", () => {
  it("GET /api/spot/regime/:pair returns placeholder", async () => {
    const app = createApp();
    const res = await simulateGet(app, "/api/spot/regime/BTC-USD");
    expect(res.status).toBe(200);
    expect(res.body.pair).toBe("BTC-USD");
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
