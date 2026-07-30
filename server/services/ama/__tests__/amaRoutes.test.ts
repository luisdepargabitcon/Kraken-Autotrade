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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "http";
import { registerAmaRoutes } from "../../../routes/ama.routes";
import { amaService } from "../amaService";

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
    amaService.setMode("OFF");
    amaService.setKillSwitch(false);
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
      expect(res.body.data.modes).toHaveLength(5);
    });
  });

  describe("GET /api/ama/market-view", () => {
    it("responds 200 with stub market view", async () => {
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

    it("BLOCKS SHADOW with 403 (readiness not met in stub)", async () => {
      const res = await req(server, "POST", "/api/ama/mode", { mode: "SHADOW" });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("SHADOW mode blocked");
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
      expect(amaService.getMode()).toBe("OFF");
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
      await req(server, "POST", "/api/ama/mode", { mode: "REPLAY" });
      await req(server, "POST", "/api/ama/analyze-now");
      expect(amaService.getMode()).toBe("REPLAY");
    });

    it("does not change kill switch", async () => {
      amaService.setKillSwitch(false);
      await req(server, "POST", "/api/ama/analyze-now");
      expect(amaService.isKillSwitchActive()).toBe(false);
    });
  });

  describe("POST /api/ama/kill-switch", () => {
    it("activates kill switch", async () => {
      const res = await req(server, "POST", "/api/ama/kill-switch", { active: true });
      expect(res.status).toBe(200);
      expect(res.body.data.killSwitchActive).toBe(true);
      expect(amaService.isKillSwitchActive()).toBe(true);
    });

    it("deactivates kill switch", async () => {
      amaService.setKillSwitch(true);
      const res = await req(server, "POST", "/api/ama/kill-switch", { active: false });
      expect(res.status).toBe(200);
      expect(res.body.data.killSwitchActive).toBe(false);
    });

    it("rejects non-boolean with 400", async () => {
      const res = await req(server, "POST", "/api/ama/kill-switch", { active: "yes" });
      expect(res.status).toBe(400);
    });

    it("does NOT activate REAL when deactivated", async () => {
      amaService.setKillSwitch(true);
      await req(server, "POST", "/api/ama/kill-switch", { active: false });
      expect(amaService.getMode()).toBe("OFF");
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
      expect(res.body.data.status).toBe("QUEUED");
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
});
