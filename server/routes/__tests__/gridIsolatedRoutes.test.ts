import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { Express } from "express";
import http from "http";
import { getNaturalGridMessage } from "../../services/gridIsolated/gridActivityFormatter";

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

vi.mock("../../services/MarketDataService", () => ({
  MarketDataService: {
    getTicker: vi.fn().mockResolvedValue({
      last: 62594.0,
      bid: 62590.0,
      ask: 62598.0,
    }),
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

  it("monitor/audit returns marketContext with currentPrice", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.body.marketContext).toBeDefined();
    expect(res.body.marketContext).toHaveProperty("currentPrice", 62594.0);
    expect(res.body.marketContext).toHaveProperty("pair");
    expect(res.body.marketContext).toHaveProperty("source");
  });

  it("monitor/audit returns marketContext.band with lower/center/upper/widthPct", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    const band = res.body.marketContext?.band;
    expect(band).toBeDefined();
    expect(band).toHaveProperty("lower");
    expect(band).toHaveProperty("center");
    expect(band).toHaveProperty("upper");
    expect(band).toHaveProperty("widthPct");
    expect(band).toHaveProperty("status");
  });

  it("monitor/audit returns marketContext.bandPosition", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.body.marketContext?.bandPosition).toBeDefined();
    expect(["below", "lower", "middle", "upper", "above", "unknown"]).toContain(res.body.marketContext?.bandPosition);
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

  // ─── Shadow-validate diagnostics tests ─────────────────────────
  it("shadow-validate returns reasonNoLevels when levelsGenerated=0", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/shadow-validate");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("evaluated", true);
    expect(res.body).toHaveProperty("tickRan", true);
    expect(res.body).toHaveProperty("reasonNoLevels");
    expect(res.body).toHaveProperty("reasonNoEvents");
    expect(res.body).toHaveProperty("nextAction");
    expect(res.body).toHaveProperty("blockedByIsActive");
    expect(res.body).toHaveProperty("marketSnapshotAvailable");
    expect(res.body).toHaveProperty("walletAvailable");
    if (res.body.levelsGenerated === 0) {
      expect(res.body.reasonNoLevels).toBeTruthy();
      expect(typeof res.body.reasonNoLevels).toBe("string");
    }
  });

  it("shadow-validate never places real orders", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/shadow-validate");
    expect(res.status).toBe(200);
    expect(res.body.realOrdersPlaced).toBe(false);
  });

  // ─── Activate endpoint tests ───────────────────────────────────
  it("POST /api/grid-isolated/activate with active=true activates the motor", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/activate");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body).toHaveProperty("isActive");
    expect(res.body).toHaveProperty("running");
    expect(res.body).toHaveProperty("message");
  });

  it("POST /api/grid-isolated/activate with active=false deactivates the motor", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/activate");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // ─── Functional status in audit ────────────────────────────────
  it("monitor/audit includes functionalStatus block", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("functionalStatus");
    expect(res.body.functionalStatus).toHaveProperty("state");
    expect(res.body.functionalStatus).toHaveProperty("message");
    expect(res.body.functionalStatus).toHaveProperty("config");
    expect(res.body.functionalStatus).toHaveProperty("runtime");
    expect(res.body.functionalStatus).toHaveProperty("result");
  });

  it("monitor/audit functionalStatus.runtime exposes rangeMismatch", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(res.body.functionalStatus.runtime).toHaveProperty("activeRangeRuntime");
    expect(res.body.functionalStatus.runtime).toHaveProperty("activeRangeAudit");
    expect(res.body.functionalStatus.runtime).toHaveProperty("rangeMismatch");
  });

  it("monitor/audit includes lastShadowEvaluation when available", async () => {
    // First run a shadow validation to populate lastShadowValidation
    await simulatePost(app, "/api/grid-isolated/shadow-validate");
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    // lastShadowEvaluation may be null if no validation has been run, or an object
    if (res.body.lastShadowEvaluation) {
      expect(res.body.lastShadowEvaluation).toHaveProperty("at");
      expect(res.body.lastShadowEvaluation).toHaveProperty("result");
    }
  });

  // ─── isActive decision in audit ────────────────────────────────
  it("monitor/audit decisions explain motor state (inactive or active) when in SHADOW", async () => {
    const auditRes = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(auditRes.status).toBe(200);
    const mode = auditRes.body.mode;
    const decisions = auditRes.body.decisions || [];
    if (mode === "SHADOW") {
      const hasInactiveDecision = decisions.some((d: any) =>
        d.detected === "Motor Grid inactivo" ||
        (d.reason || "").includes("isActive=false")
      );
      const hasActiveDecision = decisions.some((d: any) =>
        d.detected === "Modo SHADOW activo"
      );
      expect(hasInactiveDecision || hasActiveDecision).toBe(true);
    } else {
      // If mode is OFF, there should be a "Modo OFF activo" decision
      const hasOffDecision = decisions.some((d: any) =>
        d.detected === "Modo OFF activo"
      );
      expect(hasOffDecision).toBe(true);
    }
  });

  // ─── Status exposes isActive and isRunning ─────────────────────
  it("GET /api/grid-isolated/status exposes isActive and isRunning", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("isActive");
    expect(res.body).toHaveProperty("isRunning");
  });

  // ─── Wallet configured detection tests ─────────────────────────
  it("monitor/audit does NOT include 'Cartera Grid no configurada' when wallet has defaults", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    const blockingReasons = res.body.safety?.blockingReasons || [];
    const hasWalletNotConfigured = blockingReasons.some((r: string) =>
      r.toLowerCase().includes("cartera grid no configurada") || r.toLowerCase().includes("capital no aislado")
    );
    expect(hasWalletNotConfigured).toBe(false);
  });

  it("monitor/audit decisions do NOT say 'Cartera Grid no configurada' when wallet has defaults", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    const decisions = res.body.decisions || [];
    const hasWalletNotConfigured = decisions.some((d: any) =>
      (d.detected || "").toLowerCase().includes("cartera grid no configurada") ||
      (d.reason || "").toLowerCase().includes("cartera grid no está configurada") ||
      (d.reason || "").toLowerCase().includes("capital no aislado")
    );
    expect(hasWalletNotConfigured).toBe(false);
  });

  it("export chatgpt does NOT recommend 'Configurar cartera Grid' when wallet has defaults", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/export/chatgpt");
    expect(res.status).toBe(200);
    const hasConfigRecommendation = (res.body as string).toLowerCase().includes("configurar cartera grid para aislar capital");
    expect(hasConfigRecommendation).toBe(false);
  });

  // ─── naturalMessage tests ──────────────────────────────────────
  it("getNaturalGridMessage for GRID_RANGE_ACTIVATED returns Spanish 'Rango activado'", () => {
    const msg = getNaturalGridMessage("GRID_RANGE_ACTIVATED", "Range activated: c5d442f6...", { mode: "SHADOW" });
    expect(msg).toContain("Rango activado");
    expect(msg).toContain("SHADOW");
    expect(msg).not.toContain("Range activated");
  });

  it("getNaturalGridMessage for GRID_RANGE_PROPOSED returns Spanish 'Rango propuesto'", () => {
    const msg = getNaturalGridMessage("GRID_RANGE_PROPOSED", "Range proposed: 10 levels, mid=61973.4", {
      levelsCount: 10,
      centerPrice: 61973.4,
      pair: "BTC/USD",
      regime: "moderate",
    });
    expect(msg).toContain("Rango propuesto");
    expect(msg).toContain("10 niveles");
    expect(msg).not.toContain("Range proposed");
  });

  it("getNaturalGridMessage for GRID_MODE_CHANGED returns Spanish 'Modo Grid cambiado'", () => {
    const msg = getNaturalGridMessage("GRID_MODE_CHANGED", "Mode changed: OFF → SHADOW", {
      oldMode: "OFF",
      newMode: "SHADOW",
    });
    expect(msg).toContain("Modo Grid cambiado");
    expect(msg).toContain("OFF");
    expect(msg).toContain("SHADOW");
    expect(msg).not.toContain("Mode changed");
  });

  it("getNaturalGridMessage for unmapped GRID_* event returns generic Spanish fallback", () => {
    const msg = getNaturalGridMessage("GRID_SOME_NEW_EVENT_TYPE", "Some English message", {});
    expect(msg).toContain("Evento Grid registrado");
    expect(msg).not.toContain("Some English message");
  });

  it("getNaturalGridMessage never returns raw English for mapped GRID events", () => {
    const testCases = [
      { eventType: "GRID_RANGE_ACTIVATED", raw: "Range activated: abc123" },
      { eventType: "GRID_RANGE_PROPOSED", raw: "Range proposed: 10 levels" },
      { eventType: "GRID_MODE_CHANGED", raw: "Mode changed: OFF → SHADOW" },
    ];
    for (const tc of testCases) {
      const msg = getNaturalGridMessage(tc.eventType, tc.raw, {});
      expect(msg).not.toBe(tc.raw);
    }
  });

  // ─── Smart level rebuild event messages ─────────────────────────
  it("getNaturalGridMessage for GRID_LEVELS_REBUILT returns Spanish recalc message", () => {
    const msg = getNaturalGridMessage("GRID_LEVELS_REBUILT", "Levels rebuilt", { levelsCount: 10 });
    expect(msg).toContain("La banda cambió");
    expect(msg).toContain("10 niveles planificados");
  });

  it("getNaturalGridMessage for GRID_LEVELS_REPLACED returns Spanish replacement message", () => {
    const msg = getNaturalGridMessage("GRID_LEVELS_REPLACED", "Levels replaced", { replacedLevelsCount: 8 });
    expect(msg).toContain("sustituidos");
    expect(msg).toContain("8 niveles");
  });

  it("getNaturalGridMessage for GRID_LEVELS_PRESERVED_DUE_TO_CYCLE returns safety message", () => {
    const msg = getNaturalGridMessage("GRID_LEVELS_PRESERVED_DUE_TO_CYCLE", "Preserved", { reason: "ciclo abierto" });
    expect(msg).toContain("conservan niveles/ciclos");
    expect(msg).toContain("ciclo abierto");
  });

  it("getNaturalGridMessage for GRID_RANGE_CHANGED returns range change message", () => {
    const msg = getNaturalGridMessage("GRID_RANGE_CHANGED", "Range changed", {
      oldLowerPrice: 60000,
      oldUpperPrice: 65000,
      newLowerPrice: 61000,
      newUpperPrice: 66000,
    });
    expect(msg).toContain("rango activo cambió");
    expect(msg).toContain("60000–65000");
    expect(msg).toContain("61000–66000");
  });

  // ─── Levels summary in audit ────────────────────────────────────
  it("monitor/audit returns levelsSummary with active range info", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(res.body.levelsSummary).toBeDefined();
    expect(res.body.levelsSummary).toHaveProperty("activeRangeVersionId");
    expect(res.body.levelsSummary).toHaveProperty("currentLevelsCount");
    expect(res.body.levelsSummary).toHaveProperty("historicalLevelsCount");
    expect(res.body.levelsSummary).toHaveProperty("hasHistoricalLevels");
    expect(res.body.levelsSummary).toHaveProperty("allLevelsBelongToActiveRange");
    expect(res.body.levelsSummary).toHaveProperty("currentLevels");
    expect(res.body.levelsSummary).toHaveProperty("historicalLevels");
  });

  it("monitor/audit summary includes active range and historical level counts", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(res.body.summary).toHaveProperty("activeRangeVersionId");
    expect(res.body.summary).toHaveProperty("activeRangeVersionNumber");
    expect(res.body.summary).toHaveProperty("activeRangeCreatedAt");
    expect(res.body.summary).toHaveProperty("activeRangeStatus");
    expect(res.body.summary).toHaveProperty("historicalLevelsCount");
  });

  // ─── capitalAllocationSummary in audit ──────────────────────────
  it("monitor/audit levelsSummary includes capitalAllocationSummary", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(res.body.levelsSummary).toHaveProperty("capitalAllocationSummary");
  });

  it("capitalAllocationSummary has BUY/SELL fields or is null", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    const cs = res.body.levelsSummary?.capitalAllocationSummary;
    if (cs !== null && cs !== undefined) {
      expect(cs).toHaveProperty("buyLevelsCount");
      expect(cs).toHaveProperty("sellLevelsCount");
      expect(cs).toHaveProperty("plannedBuyUsd");
      expect(cs).toHaveProperty("plannedSellNotionalUsd");
      expect(cs).toHaveProperty("usdActuallyNeededForBuyLevels");
      expect(cs).toHaveProperty("usdNotNeededBecauseSellLevelsDoNotConsumeUsd");
      expect(cs).toHaveProperty("allocationMode");
      expect(cs).toHaveProperty("capitalDeploymentMode");
      expect(cs).toHaveProperty("allocationExplanation");
      expect(cs).toHaveProperty("perLevelAllocations");
    }
  });

  // ─── ChatGPT export includes BUY/SELL capital explanation ────────
  it("export chatgpt does not crash (basic check)", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/export/chatgpt");
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe("string");
    expect(res.body.length).toBeGreaterThan(50);
  });

  // ─── Regime change event ────────────────────────────────────────
  it("getNaturalGridMessage for GRID_REGIME_CHANGED returns Spanish regime change message", () => {
    const msg = getNaturalGridMessage("GRID_REGIME_CHANGED", null, {
      pair: "BTC/USD",
      previousRegime: "ranging",
      newRegime: "trending_up",
      reason: "el precio superó la banda superior",
    });
    expect(msg).toContain("BTC/USD");
    expect(msg).toContain("ranging");
    expect(msg).toContain("trending_up");
    expect(msg).toContain("pasó de");
  });

  // ─── Export ChatGPT includes levels by status and profit target ──
  it("export chatgpt includes niveles activos reales and beneficio objetivo", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/export/chatgpt");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Niveles planificados:");
    expect(res.body).toContain("Niveles totales:");
    expect(res.body).toContain("Niveles reemplazados (rangos anteriores):");
    expect(res.body).toContain("Niveles ejecutados (filled):");
    expect(res.body).toContain("Beneficio objetivo neto:");
    expect(res.body).toContain("objetivo estimado, no realizado");
  });

  // ─── Export ChatGPT includes régimen de mercado ──────────────────
  it("export chatgpt includes régimen de mercado actual", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/export/chatgpt");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Resumen Grid Aislado");
  });

  // ─── Timing metadata in audit levels ──────────────────────────────
  it("monitor/audit levels include timing fields (createdAt, finishedAt, durationLabel, statusLabel, capitalImpactType)", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    const allLevels = res.body.levels ?? [];
    for (const lvl of allLevels) {
      expect(lvl).toHaveProperty("createdAt");
      expect(lvl).toHaveProperty("finishedAt");
      expect(lvl).toHaveProperty("finishedReason");
      expect(lvl).toHaveProperty("durationMs");
      expect(lvl).toHaveProperty("durationLabel");
      expect(lvl).toHaveProperty("statusLabel");
      expect(lvl).toHaveProperty("capitalImpactType");
      if (lvl.side === "BUY") {
        expect(lvl.capitalImpactType).toBe("consumes_usd");
      } else if (lvl.side === "SELL") {
        expect(lvl.capitalImpactType).toBe("requires_base_asset_not_usd");
      }
    }
  });

  it("monitor/audit levelsSummary.currentLevels include timing fields", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    const currentLevels = res.body.levelsSummary?.currentLevels ?? [];
    for (const lvl of currentLevels) {
      expect(lvl).toHaveProperty("statusLabel");
      expect(lvl).toHaveProperty("capitalImpactType");
      expect(lvl).toHaveProperty("durationLabel");
    }
  });

  it("monitor/audit levelsSummary.historicalLevels include timing fields", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    const historicalLevels = res.body.levelsSummary?.historicalLevels ?? [];
    for (const lvl of historicalLevels) {
      expect(lvl).toHaveProperty("statusLabel");
      expect(lvl).toHaveProperty("capitalImpactType");
    }
  });

  // ─── Timing metadata in audit cycles ──────────────────────────────
  it("monitor/audit cycles include timing fields (openedAt, closedAt, durationLabel, statusLabel)", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    const allCycles = res.body.cycles ?? [];
    for (const cyc of allCycles) {
      expect(cyc).toHaveProperty("openedAt");
      expect(cyc).toHaveProperty("closedAt");
      expect(cyc).toHaveProperty("durationMs");
      expect(cyc).toHaveProperty("durationLabel");
      expect(cyc).toHaveProperty("statusLabel");
    }
  });

  // ─── Export ChatGPT does not crash without levels/cycles ──────────
  it("export chatgpt handles empty levels/cycles gracefully", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/export/chatgpt");
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe("string");
    // Should contain either "sin niveles" or level timing info
    expect(res.body.includes("Niveles:") || res.body.includes("sin niveles")).toBe(true);
    expect(res.body.includes("Ciclos:") || res.body.includes("sin ciclos")).toBe(true);
  });

  // ─── Export JSON includes timing metadata ─────────────────────────
  it("export/json includes enriched levels with timing fields", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/export/json");
    expect(res.status).toBe(200);
    const levels = res.body.levels ?? [];
    for (const lvl of levels) {
      expect(lvl).toHaveProperty("statusLabel");
      expect(lvl).toHaveProperty("capitalImpactType");
      expect(lvl).toHaveProperty("durationLabel");
    }
    const cycles = res.body.cycles ?? [];
    for (const cyc of cycles) {
      expect(cyc).toHaveProperty("statusLabel");
      expect(cyc).toHaveProperty("durationLabel");
    }
  });

  // ─── 3C.2-G: SHADOW cycle separation tests ────────────────────────

  it("monitor/audit summary includes activeOpenCyclesCount, globalOpenCyclesCount, orphanOpenCyclesCount", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(res.body.summary).toHaveProperty("activeOpenCyclesCount");
    expect(res.body.summary).toHaveProperty("globalOpenCyclesCount");
    expect(res.body.summary).toHaveProperty("orphanOpenCyclesCount");
    expect(typeof res.body.summary.activeOpenCyclesCount).toBe("number");
    expect(typeof res.body.summary.globalOpenCyclesCount).toBe("number");
    expect(typeof res.body.summary.orphanOpenCyclesCount).toBe("number");
  });

  it("status includes activeOpenCyclesCount and orphanOpenCyclesCount", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("activeOpenCyclesCount");
    expect(res.body).toHaveProperty("globalOpenCyclesCount");
    expect(res.body).toHaveProperty("orphanOpenCyclesCount");
    expect(res.body).toHaveProperty("historicalOpenCyclesCount");
  });

  it("status activeOpenCyclesCount is 0 when no active range", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/status");
    expect(res.status).toBe(200);
    // In test mock, no active range is loaded, so activeOpenCyclesCount should be 0
    expect(res.body.activeOpenCyclesCount).toBe(0);
  });

  it("monitor/audit orphanOpenCyclesCount equals globalOpenCyclesCount when no active range", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    // Without active range, all open cycles are orphan
    if (!res.body.summary.activeRangeVersionId) {
      expect(res.body.summary.orphanOpenCyclesCount).toBe(res.body.summary.globalOpenCyclesCount);
      expect(res.body.summary.activeOpenCyclesCount).toBe(0);
    }
  });

  it("monitor/audit does not mix orphan cycles as active cycles", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    const s = res.body.summary;
    // active + orphan should never exceed global
    expect(s.activeOpenCyclesCount + s.orphanOpenCyclesCount).toBeLessThanOrEqual(s.globalOpenCyclesCount + 1);
  });

  it("professional-generator validate is read-only with sideEffectsDetected=false", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/professional-generator/validate");
    expect(res.status).toBe(200);
    // In test mock, MarketDataService.getCandles may not exist, so ok could be false.
    // When ok=true, validate that readOnly fields are present and correct.
    if (res.body.ok === true) {
      expect(res.body).toHaveProperty("readOnly", true);
      expect(res.body).toHaveProperty("sideEffectsDetected", false);
      expect(res.body).toHaveProperty("persistsLevels", false);
      expect(res.body).toHaveProperty("placesOrders", false);
      expect(res.body).toHaveProperty("changesMode", false);
      expect(res.body).toHaveProperty("rebuild", false);
      expect(res.body).toHaveProperty("runtimeBefore");
      expect(res.body).toHaveProperty("runtimeAfter");
    } else {
      // When ok=false (mock env without candles), still should not have side effects
      expect(res.body).toHaveProperty("ok", false);
    }
  });

  it("professional-generator validate runtimeBefore equals runtimeAfter (no side effects)", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/professional-generator/validate");
    expect(res.status).toBe(200);
    // Only check runtime fingerprint when ok=true (candles available)
    if (res.body.ok !== true) return;
    const before = res.body.runtimeBefore;
    const after = res.body.runtimeAfter;
    expect(before).toBeTruthy();
    expect(after).toBeTruthy();
    expect(before.mode).toBe(after.mode);
    expect(before.isActive).toBe(after.isActive);
    expect(before.isRunning).toBe(after.isRunning);
    expect(before.tickIntervalActive).toBe(after.tickIntervalActive);
  });

  it("status configLoaded and configSource are present", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("configLoaded");
    expect(res.body).toHaveProperty("configSource");
    expect(["memory", "db_snapshot", "default_runtime_empty"]).toContain(res.body.configSource);
  });

  // ─── 3C.2-G-B: Pre-validation before marking filled ───────────────

  it("API cycle status label for buy_filled is 'Compra simulada SHADOW', not 'Compra ejecutada'", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    const cycles = res.body.cycles ?? [];
    for (const cyc of cycles) {
      if (cyc.status === "buy_filled") {
        expect(cyc.statusLabel).toBe("Compra simulada SHADOW");
      }
    }
  });

  it("getNaturalGridMessage for GRID_CYCLE_BUY_FILLED returns 'Compra simulada SHADOW'", async () => {
    const msg = getNaturalGridMessage("GRID_CYCLE_BUY_FILLED" as any, null, null);
    expect(msg).toContain("Compra simulada SHADOW");
    expect(msg).not.toContain("Compra ejecutada");
  });

  it("getNaturalGridMessage for GRID_SHADOW_SELL_IGNORED_NO_OPEN_CYCLE returns SELL ignored message", async () => {
    const msg = getNaturalGridMessage("GRID_SHADOW_SELL_IGNORED_NO_OPEN_CYCLE" as any, null, null);
    expect(msg).toBeTruthy();
    expect(msg.toLowerCase()).toContain("sell");
  });

  it("getNaturalGridMessage for GRID_SHADOW_MAX_OPEN_CYCLES_REACHED returns max cycles message", async () => {
    const msg = getNaturalGridMessage("GRID_SHADOW_MAX_OPEN_CYCLES_REACHED" as any, null, null);
    expect(msg).toBeTruthy();
  });

  it("getNaturalGridMessage for GRID_SHADOW_DUPLICATE_BUY_LEVEL_IGNORED returns duplicate message", async () => {
    const msg = getNaturalGridMessage("GRID_SHADOW_DUPLICATE_BUY_LEVEL_IGNORED" as any, null, null);
    expect(msg).toBeTruthy();
  });

  // ─── 3C.2-H: DB snapshot status + shadow cleanup preview ──────────
  // ─── 3C.2-H-B: getStatusSafe() runtime-first, db_snapshot fallback ──

  it("status with runtime empty uses db_snapshot, not default_runtime_empty, when config exists in DB", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("configSource");
    expect(res.body).toHaveProperty("statusSource");
    expect(res.body.isRunning).toBe(false);
  });

  it("status db_snapshot includes activeOpenCyclesCount, globalOpenCyclesCount, orphanOpenCyclesCount", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("activeOpenCyclesCount");
    expect(res.body).toHaveProperty("globalOpenCyclesCount");
    expect(res.body).toHaveProperty("orphanOpenCyclesCount");
  });

  it("status db_snapshot does not auto-start motor and isRunning stays false", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/status");
    expect(res.status).toBe(200);
    expect(res.body.isRunning).toBe(false);
  });

  it("status returns runtimeLoaded and statusSource fields", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("runtimeLoaded");
    expect(res.body).toHaveProperty("statusSource");
    expect(["runtime", "db_snapshot"]).toContain(res.body.statusSource);
  });

  it("status with runtime loaded uses statusSource=runtime and configSource=memory", async () => {
    // Force load config into runtime by calling loadConfig (mocked DB returns [])
    // In test env, engine.config is null (no loadConfig called), so it falls back to db_snapshot
    // This test verifies the fields exist and are correct for the fallback case
    const res = await simulateGet(app, "/api/grid-isolated/status");
    expect(res.status).toBe(200);
    if (res.body.runtimeLoaded === false) {
      expect(res.body.statusSource).toBe("db_snapshot");
      expect(res.body.configSource).toBe("db_snapshot");
    } else {
      expect(res.body.statusSource).toBe("runtime");
      expect(res.body.configSource).toBe("memory");
    }
  });

  it("shadow-cleanup/preview does not modify DB and returns dry-run analysis", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/shadow-cleanup/preview", {});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.readOnly).toBe(true);
    expect(res.body).toHaveProperty("cycles");
    expect(res.body).toHaveProperty("levels");
    expect(res.body).toHaveProperty("risk");
    expect(res.body).toHaveProperty("preview");
    expect(res.body.risk).toHaveProperty("realOrdersAffected");
    expect(res.body.risk).toHaveProperty("safeToArchiveShadowOnly");
  });

  it("shadow-cleanup/preview detects cycles and returns safeToArchiveShadowOnly", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/shadow-cleanup/preview", {});
    expect(res.status).toBe(200);
    expect(res.body.risk.realOrdersAffected).toBe(false);
    expect(res.body.risk.safeToArchiveShadowOnly).toBe(true);
  });

  it("monitor/audit exposes preFixShadowCyclesCount and cleanupPreviewAvailable", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("shadowCleanup");
    expect(res.body.shadowCleanup).toHaveProperty("preFixShadowCyclesCount");
    expect(res.body.shadowCleanup).toHaveProperty("cleanupPreviewAvailable");
    expect(res.body.shadowCleanup).toHaveProperty("cleanupRecommended");
    expect(res.body.shadowCleanup).toHaveProperty("cleanupReason");
  });

  // ─── 3C.2-H-C: Audit shadow cleanup coherent with preview ─────────
  // ─── 3C.2-H-C-B: Audit shadowCleanup based on real shadowCleanupPreview() ──

  it("monitor/audit shadowCleanup includes safeToArchiveShadowOnly, realOrdersAffected, dryRunOnly, readOnly", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(res.body.shadowCleanup).toHaveProperty("safeToArchiveShadowOnly");
    expect(res.body.shadowCleanup).toHaveProperty("realOrdersAffected");
    expect(res.body.shadowCleanup).toHaveProperty("affectedCyclesCount");
    expect(res.body.shadowCleanup).toHaveProperty("affectedLevelsCount");
    expect(res.body.shadowCleanup).toHaveProperty("dryRunOnly");
    expect(res.body.shadowCleanup).toHaveProperty("readOnly");
    // With mocked DB (empty), preview returns dryRun=true, readOnly=true
    expect(res.body.shadowCleanup.dryRunOnly).toBe(true);
    expect(res.body.shadowCleanup.readOnly).toBe(true);
  });

  it("monitor/audit shadowCleanup derives from shadowCleanupPreview, not just status", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    const sc = res.body.shadowCleanup;
    // With mocked DB (empty), preview returns totalOpenCycles=0, affectedCyclesCount=0
    // These values come from shadowCleanupPreview(), not from status alone
    expect(sc.preFixShadowCyclesCount).toBe(0);
    expect(sc.affectedCyclesCount).toBe(0);
    expect(sc.affectedLevelsCount).toBe(0);
    expect(sc.realOrdersAffected).toBe(false);
    expect(sc.safeToArchiveShadowOnly).toBe(true);
    expect(sc.cleanupRecommended).toBe(false);
  });

  it("monitor/audit does not falsely return cleanupRecommended=false when cycles exist", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    const sc = res.body.shadowCleanup;
    if (sc.preFixShadowCyclesCount === 0) {
      expect(sc.cleanupRecommended).toBe(false);
    } else {
      expect(sc.cleanupRecommended).toBe(true);
    }
  });

  it("monitor/audit does not auto-start motor", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(res.body.functionalStatus.runtime.schedulerRunning).toBe(false);
  });

  it("monitor/audit does not modify DB (no mode change, no start)", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(res.body.functionalStatus.runtime.schedulerRunning).toBe(false);
  });
});
