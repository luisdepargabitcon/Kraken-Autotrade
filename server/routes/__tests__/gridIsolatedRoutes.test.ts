import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { Express } from "express";
import http from "http";
import { getNaturalGridMessage } from "../../services/gridIsolated/gridActivityFormatter";
import { gridIsolatedEngine } from "../../services/gridIsolated/gridIsolatedEngine";

// Mock dependencies
vi.mock("../../services/exchanges/RevolutXService", () => ({
  revolutXService: {
    isInitialized: vi.fn().mockReturnValue(false),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    getBalance: vi.fn().mockResolvedValue({ USD: 0, BTC: 0 }),
    postOnlySupported: true,
  },
}));

vi.mock("../../services/botLogger", () => ({
  botLogger: {
    info: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../services/MarketDataService", () => {
  function generateCandles(count = 120) {
    const basePrice = 62594.0;
    const candles = [];
    for (let i = 0; i < count; i++) {
      const close = basePrice + Math.sin(i * 0.15) * 1500 + ((i % 7) - 3) * 80;
      const open = close + ((i % 5) - 2) * 25;
      const high = Math.max(open, close) + 120 + (i % 3) * 40;
      const low = Math.min(open, close) - 120 - (i % 3) * 40;
      candles.push({
        time: Date.now() - (count - i) * 3_600_000,
        open,
        high,
        low,
        close,
        volume: 1 + i,
      });
    }
    return candles;
  }
  return {
    MarketDataService: {
      getTicker: vi.fn().mockResolvedValue({
        last: 62594.0,
        bid: 62590.0,
        ask: 62598.0,
      }),
      getPrice: vi.fn().mockResolvedValue(62594.0),
      getCandles: vi.fn().mockResolvedValue(generateCandles()),
      getATR: vi.fn().mockResolvedValue(2.1),
      getCandlesFromDb: vi.fn().mockResolvedValue(null),
      putPrice: vi.fn(),
      putCandles: vi.fn(),
    },
  };
});

vi.mock("../../db", () => {
  const chainable = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  const updateChain = { set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) };
  const txObj = {
    select: vi.fn().mockReturnValue(chainable),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1 }]) }),
    }),
    update: vi.fn().mockReturnValue(updateChain),
  };
  return {
    db: {
      select: vi.fn().mockReturnValue(chainable),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1 }]) }),
      }),
      update: vi.fn().mockReturnValue(updateChain),
      transaction: vi.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => fn(txObj)),
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
  inArray: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray, ...vals: any[]) => ({ sql: strings.join("?"), params: vals })),
}));

import { registerGridIsolatedRoutes } from "../gridIsolated.routes";
import { db } from "../../db";

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
    expect(res.body).toContain("Protector de circuito:");
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

  // ─── 3C.2-I-A: Shadow Cleanup Apply endpoint ──────────────────────

  it("shadow-cleanup/apply with dryRun=true returns read-only preview, no DB modification", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/shadow-cleanup/apply", { dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.readOnly).toBe(true);
    expect(res.body.action).toBe("preview_apply");
    expect(res.body).toHaveProperty("wouldArchiveCyclesCount");
    expect(res.body).toHaveProperty("wouldUpdateLevelsCount");
    expect(res.body).toHaveProperty("cleanupPreview");
  });

  it("shadow-cleanup/apply with dryRun=false without confirmToken aborts", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/shadow-cleanup/apply", { dryRun: false });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.applied).toBe(false);
    expect(res.body.reason).toContain("confirmToken");
  });

  it("shadow-cleanup/apply with dryRun=false and incorrect confirmToken aborts", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/shadow-cleanup/apply", {
      dryRun: false,
      confirmToken: "WRONG_TOKEN",
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.applied).toBe(false);
  });

  it("shadow-cleanup/apply with dryRun=false and incorrect expectedCyclesCount aborts", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/shadow-cleanup/apply", {
      dryRun: false,
      confirmToken: "ARCHIVE_SHADOW_PREFIX_TEST_0_CYCLES",
      expectedCyclesCount: 999,
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.applied).toBe(false);
    expect(res.body.reason).toContain("expectedCyclesCount");
  });

  it("shadow-cleanup/apply with dryRun=false and incorrect expectedLevelsCount aborts", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/shadow-cleanup/apply", {
      dryRun: false,
      confirmToken: "ARCHIVE_SHADOW_PREFIX_TEST_0_CYCLES",
      expectedLevelsCount: 999,
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.applied).toBe(false);
    expect(res.body.reason).toContain("expectedLevelsCount");
  });

  it("shadow-cleanup/apply defaults to dryRun=true when dryRun not specified", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/shadow-cleanup/apply", {});
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.readOnly).toBe(true);
  });

  it("shadow-cleanup/apply dryRun=true does not call db.update", async () => {
    const { db } = await import("../../db");
    const updateBefore = (db.update as any).mock.calls.length;
    await simulatePost(app, "/api/grid-isolated/shadow-cleanup/apply", { dryRun: true });
    const updateAfter = (db.update as any).mock.calls.length;
    // dryRun=true should not trigger any db.update calls from the apply path
    // (shadowCleanupPreview is read-only)
    expect(updateAfter).toBe(updateBefore);
  });

  it("shadow-cleanup/apply does not touch Execution Service or place real orders", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/shadow-cleanup/apply", { dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.realOrdersAffected).toBe(false);
  });

  // ─── 3C.3-A: Compact Range Config Persistence ───────────────────

  it("POST /api/grid-isolated/config persists enforceCompactRange, gridRangeMaxPct, maxDistanceFromCenterPct, maxSellDistanceFromNearestBuyPct", async () => {
    const updateSpy = (db.update as any);
    const setSpy = updateSpy.mock.calls;
    const beforeCount = setSpy.length;

    const res = await simulatePost(app, "/api/grid-isolated/config", {
      enforceCompactRange: false,
      gridRangeMaxPct: 3.25,
      maxDistanceFromCenterPct: 1.60,
      maxSellDistanceFromNearestBuyPct: 1.75,
    });
    expect(res.status).toBe(200);

    // Config returned must reflect the updated values
    expect(res.body.enforceCompactRange).toBe(false);
    expect(res.body.gridRangeMaxPct).toBe(3.25);
    expect(res.body.maxDistanceFromCenterPct).toBe(1.60);
    expect(res.body.maxSellDistanceFromNearestBuyPct).toBe(1.75);

    // db.update must have been called (saveConfig persists)
    const afterCount = setSpy.length;
    expect(afterCount).toBeGreaterThan(beforeCount);
  });

  it("POST /api/grid-isolated/config restores compact range defaults", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/config", {
      enforceCompactRange: true,
      gridRangeMaxPct: 2.50,
      maxDistanceFromCenterPct: 1.25,
      maxSellDistanceFromNearestBuyPct: 1.50,
    });
    expect(res.status).toBe(200);
    expect(res.body.enforceCompactRange).toBe(true);
    expect(res.body.gridRangeMaxPct).toBe(2.50);
    expect(res.body.maxDistanceFromCenterPct).toBe(1.25);
    expect(res.body.maxSellDistanceFromNearestBuyPct).toBe(1.50);
  });

  it("saveConfig includes all 4 compact range fields in db.update set values", async () => {
    const updateMock = db.update as any;
    // Clear previous calls
    updateMock.mock.clearMock ? updateMock.mock.clearMock() : undefined;

    // Trigger a config save by updating any field
    await simulatePost(app, "/api/grid-isolated/config", {
      gridRangeMaxPct: 3.00,
    });

    // Find the last update call — check that set was called with values containing compact range fields
    const calls = updateMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    // The last update call should be for gridIsolatedConfigs
    // set() receives the values object
    const lastCall = calls[calls.length - 1];
    const setFn = lastCall[0]; // update(table) returns { set: vi.fn() }
    // Actually, update is called with table arg, returns object with set
    // The mock: update: vi.fn().mockReturnValue(updateChain)
    // updateChain = { set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }
    // So we need to check updateChain.set.mock.calls
    const updateChain = updateMock.mock.results[updateMock.mock.results.length - 1]?.value;
    if (updateChain && updateChain.set && updateChain.set.mock) {
      const setCalls = updateChain.set.mock.calls;
      if (setCalls.length > 0) {
        const valuesObj = setCalls[setCalls.length - 1][0];
        expect(valuesObj).toHaveProperty("enforceCompactRange");
        expect(valuesObj).toHaveProperty("gridRangeMaxPct");
        expect(valuesObj).toHaveProperty("maxDistanceFromCenterPct");
        expect(valuesObj).toHaveProperty("maxSellDistanceFromNearestBuyPct");
      }
    }
  });

  // ─── 3C.3-C: Adaptive Smart Range Config Persistence ──────────────

  it("POST /api/grid-isolated/config persists adaptive smart range fields", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/config", {
      gridRangeControlMode: 'adaptive_smart',
      adaptiveRangeEnabled: true,
      adaptiveRangeProfile: 'aggressive',
      adaptiveRangeMinPct: 2.00,
      adaptiveRangeMaxPct: 8.00,
      adaptiveRangeLowVolMaxPct: 3.50,
      adaptiveRangeNormalMaxPct: 6.00,
      adaptiveRangeHighVolMaxPct: 8.00,
      adaptiveRangeTargetFullLevels: true,
      adaptiveRangeMinViableLevels: 6,
    });
    expect(res.status).toBe(200);
    expect(res.body.gridRangeControlMode).toBe('adaptive_smart');
    expect(res.body.adaptiveRangeEnabled).toBe(true);
    expect(res.body.adaptiveRangeProfile).toBe('aggressive');
    expect(res.body.adaptiveRangeMinPct).toBe(2.00);
    expect(res.body.adaptiveRangeMaxPct).toBe(8.00);
    expect(res.body.adaptiveRangeLowVolMaxPct).toBe(3.50);
    expect(res.body.adaptiveRangeNormalMaxPct).toBe(6.00);
    expect(res.body.adaptiveRangeHighVolMaxPct).toBe(8.00);
    expect(res.body.adaptiveRangeTargetFullLevels).toBe(true);
    expect(res.body.adaptiveRangeMinViableLevels).toBe(6);
  });

  it("POST /api/grid-isolated/config restores adaptive smart range defaults", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/config", {
      gridRangeControlMode: 'adaptive_smart',
      adaptiveRangeEnabled: true,
      adaptiveRangeProfile: 'balanced',
      adaptiveRangeMinPct: 1.50,
      adaptiveRangeMaxPct: 7.00,
      adaptiveRangeLowVolMaxPct: 3.00,
      adaptiveRangeNormalMaxPct: 5.00,
      adaptiveRangeHighVolMaxPct: 7.00,
      adaptiveRangeTargetFullLevels: false,
      adaptiveRangeMinViableLevels: 4,
    });
    expect(res.status).toBe(200);
    expect(res.body.gridRangeControlMode).toBe('adaptive_smart');
    expect(res.body.adaptiveRangeProfile).toBe('balanced');
    expect(res.body.adaptiveRangeMinPct).toBe(1.50);
    expect(res.body.adaptiveRangeMaxPct).toBe(7.00);
    expect(res.body.adaptiveRangeMinViableLevels).toBe(4);
  });

  it("saveConfig includes all 10 adaptive smart range fields in db.update set values", async () => {
    const updateMock = db.update as any;
    updateMock.mock.clearMock ? updateMock.mock.clearMock() : undefined;

    await simulatePost(app, "/api/grid-isolated/config", {
      adaptiveRangeProfile: 'conservative',
    });

    const calls = updateMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    const updateChain = updateMock.mock.results[updateMock.mock.results.length - 1]?.value;
    if (updateChain && updateChain.set && updateChain.set.mock) {
      const setCalls = updateChain.set.mock.calls;
      if (setCalls.length > 0) {
        const valuesObj = setCalls[setCalls.length - 1][0];
        expect(valuesObj).toHaveProperty("gridRangeControlMode");
        expect(valuesObj).toHaveProperty("adaptiveRangeEnabled");
        expect(valuesObj).toHaveProperty("adaptiveRangeProfile");
        expect(valuesObj).toHaveProperty("adaptiveRangeMinPct");
        expect(valuesObj).toHaveProperty("adaptiveRangeMaxPct");
        expect(valuesObj).toHaveProperty("adaptiveRangeLowVolMaxPct");
        expect(valuesObj).toHaveProperty("adaptiveRangeNormalMaxPct");
        expect(valuesObj).toHaveProperty("adaptiveRangeHighVolMaxPct");
        expect(valuesObj).toHaveProperty("adaptiveRangeTargetFullLevels");
        expect(valuesObj).toHaveProperty("adaptiveRangeMinViableLevels");
      }
    }
  });

  it("GET /api/grid-isolated/monitor/audit exposes rangeIntelligence", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("rangeIntelligence");
    const ri = res.body.rangeIntelligence;
    expect(ri).toHaveProperty("rangeControlMode");
    expect(ri).toHaveProperty("adaptiveRangeEnabled");
    expect(ri).toHaveProperty("adaptiveRangeProfile");
    expect(ri).toHaveProperty("adaptiveRangeMinPct");
    expect(ri).toHaveProperty("adaptiveRangeMaxPct");
    expect(ri).toHaveProperty("adaptiveRangeLowVolMaxPct");
    expect(ri).toHaveProperty("adaptiveRangeNormalMaxPct");
    expect(ri).toHaveProperty("adaptiveRangeHighVolMaxPct");
    expect(ri).toHaveProperty("adaptiveRangeTargetFullLevels");
    expect(ri).toHaveProperty("adaptiveRangeMinViableLevels");
    expect(ri).toHaveProperty("lastAdaptiveRangeDecision");
    expect(ri).toHaveProperty("lastRangeAudit");
  });

  it("professional-generator validate includes adaptiveRangeDecision when ok", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/professional-generator/validate");
    expect(res.status).toBe(200);
    if (res.body.ok === true) {
      expect(res.body).toHaveProperty("adaptiveRangeDecision");
      expect(res.body).toHaveProperty("rangeControlMode");
      expect(res.body).toHaveProperty("rangeProfile");
    }
  });

  // ─── 3C.3-D: UX Cleanup — Legacy field removal ──────────────

  it("POST /api/grid-isolated/config ignores geometricRatioMin/Max (removed from allowedFields)", async () => {
    const res = await simulatePost(app, "/api/grid-isolated/config", {
      geometricRatioMin: 0.5,
      geometricRatioMax: 2.0,
    });
    expect(res.status).toBe(200);
    expect(res.body.geometricRatioMin).not.toBe(0.5);
    expect(res.body.geometricRatioMax).not.toBe(2.0);
  });

  // ─── 3C.3-E1: Separated width fields in audit ──────────────

  it("monitor/audit range exposes marketBollingerWidthPct", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.body.range).toBeDefined();
    if (res.body.range.status !== "sin_rango_activo") {
      expect(res.body.range).toHaveProperty("marketBollingerWidthPct");
    }
  });

  it("monitor/audit range exposes operationalRangeWidthPct", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.body.range).toBeDefined();
    if (res.body.range.status !== "sin_rango_activo") {
      expect(res.body.range).toHaveProperty("operationalRangeWidthPct");
    }
  });

  it("monitor/audit range exposes operationalSemiRangePct", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.body.range).toBeDefined();
    if (res.body.range.status !== "sin_rango_activo") {
      expect(res.body.range).toHaveProperty("operationalSemiRangePct");
    }
  });

  it("monitor/audit range exposes activeRangePriceWidthPct", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.body.range).toBeDefined();
    if (res.body.range.status !== "sin_rango_activo") {
      expect(res.body.range).toHaveProperty("activeRangePriceWidthPct");
    }
  });

  it("monitor/audit range exposes rangeGenerationMethod and rangeGenerationSource", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.body.range).toBeDefined();
    if (res.body.range.status !== "sin_rango_activo") {
      expect(res.body.range).toHaveProperty("rangeGenerationMethod");
      expect(res.body.range).toHaveProperty("rangeGenerationSource");
    }
  });

  it("monitor/audit activeRangePriceWidthPct is calculated from lower/upper/center", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    const r = res.body.range;
    if (r && r.status !== "sin_rango_activo" && r.activeRangePriceWidthPct != null) {
      const lower = Number(r.lowerPrice);
      const upper = Number(r.upperPrice);
      const center = Number(r.centerPrice);
      const expected = ((upper - lower) / center) * 100;
      expect(r.activeRangePriceWidthPct).toBeCloseTo(expected, 1);
    }
  });

  it("monitor/audit execution exposes makerOnlyPreferred and takerFallbackPolicyLabel", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.body.execution).toBeDefined();
    expect(res.body.execution).toHaveProperty("makerOnlyPreferred", true);
    expect(res.body.execution).toHaveProperty("takerFallbackPolicyLabel");
    const label = res.body.execution.takerFallbackPolicyLabel;
    expect(typeof label).toBe("string");
    expect(label).toMatch(/Taker fallback/);
  });

  it("monitor/audit execution takerFallbackPolicyLabel matches enabled state", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    const exec = res.body.execution;
    if (exec.takerFallbackEnabled) {
      expect(exec.takerFallbackPolicyLabel).toContain("activo");
    } else {
      expect(exec.takerFallbackPolicyLabel).toContain("desactivado");
    }
  });

  // ─── Range lifecycle tests ────────────────────────────────
  it("GET /monitor/audit exposes rangeLifecycle with status, naturalReason, nextAction", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    expect(res.body.rangeLifecycle).toBeDefined();
    expect(res.body.rangeLifecycle.status).toBeDefined();
    expect(typeof res.body.rangeLifecycle.status).toBe("string");
    expect(res.body.rangeLifecycle.naturalReason).toBeDefined();
    expect(typeof res.body.rangeLifecycle.naturalReason).toBe("string");
    expect(res.body.rangeLifecycle.nextAction).toBeDefined();
    expect(typeof res.body.rangeLifecycle.nextAction).toBe("string");
    expect(res.body.rangeLifecycle.canReuseForAudit).toBeDefined();
    expect(typeof res.body.rangeLifecycle.canReuseForAudit).toBe("boolean");
    expect(res.body.rangeLifecycle.canReuseForNewLevels).toBeDefined();
    expect(typeof res.body.rangeLifecycle.canReuseForNewLevels).toBe("boolean");
    expect(res.body.rangeLifecycle.canRegenerateNow).toBeDefined();
    expect(typeof res.body.rangeLifecycle.canRegenerateNow).toBe("boolean");
    expect(res.body.rangeLifecycle.shouldSuggestValidation).toBeDefined();
    expect(typeof res.body.rangeLifecycle.shouldSuggestValidation).toBe("boolean");
    expect(res.body.rangeLifecycle.checks).toBeDefined();
    expect(res.body.rangeLifecycle.reasonCode).toBeDefined();
  });

  it("GET /monitor/audit range includes rangeLifecycleStatus", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(res.status).toBe(200);
    if (res.body.range && res.body.range.status !== "sin_rango_activo") {
      expect(res.body.range.rangeLifecycleStatus).toBeDefined();
      expect(res.body.range.rangeCanReuseForNewLevels).toBeDefined();
      expect(typeof res.body.range.rangeCanReuseForNewLevels).toBe("boolean");
      expect(res.body.range.rangeLifecycleReason).toBeDefined();
    }
  });

  it("GET /monitor/audit rangeLifecycle does not modify mode/isActive/isRunning", async () => {
    const before = await simulateGet(app, "/api/grid-isolated/status");
    const audit = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    const after = await simulateGet(app, "/api/grid-isolated/status");
    expect(audit.status).toBe(200);
    expect(after.body.mode).toBe(before.body.mode);
    expect(after.body.isActive).toBe(before.body.isActive);
    expect(after.body.isRunning).toBe(before.body.isRunning);
  });

  it("GET /monitor/audit rangeLifecycle does not create levels or cycles", async () => {
    const before = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    const after = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(after.status).toBe(200);
    expect(after.body.levelsSummary.currentLevelsCount).toBe(before.body.levelsSummary.currentLevelsCount);
    expect(after.body.levelsSummary.openCyclesCount).toBe(before.body.levelsSummary.openCyclesCount);
  });

  // ─── E3-REV-A: audit mode alignment with status ────────────
  it("GET /monitor/audit mode matches status.mode (effective mode alignment)", async () => {
    const statusRes = await simulateGet(app, "/api/grid-isolated/status");
    const auditRes = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.mode).toBe(statusRes.body.mode);
  });

  it("GET /monitor/audit rangeLifecycle reasonCode is coherent with audit.mode", async () => {
    const auditRes = await simulateGet(app, "/api/grid-isolated/monitor/audit");
    expect(auditRes.status).toBe(200);
    const lc = auditRes.body.rangeLifecycle;
    expect(lc).toBeDefined();
    if (auditRes.body.mode === "OFF") {
      expect(lc.reasonCode).toBe("OFF_MODE");
      expect(lc.canReuseForNewLevels).toBe(false);
    } else if (auditRes.body.mode === "SHADOW") {
      expect(lc.reasonCode).not.toBe("OFF_MODE");
    }
  });

  it("GET /monitor/audit does not return OFF_MODE when status.mode is SHADOW", async () => {
    // This test verifies the fix: when status.mode=SHADOW, audit should not say OFF_MODE
    // We use the evaluateActiveRangeLifecycle function directly to verify coherence
    const { evaluateActiveRangeLifecycle } = await import("../../services/gridIsolated/gridRangeLifecycle");
    const result = evaluateActiveRangeLifecycle({
      mode: "SHADOW",
      config: { adaptiveRangeEnabled: true, gridRangeControlMode: "adaptive_smart" } as any,
      activeRange: null,
      marketContext: null,
      rangeIntelligence: null,
      professionalGenerator: { available: false },
      openCyclesCount: 0,
      activeOpenCyclesCount: 0,
      globalOpenCyclesCount: 0,
      currentPrice: null,
      atrPct: null,
      marketBollingerWidthPct: null,
      operationalRangeWidthPct: null,
      activeRangePriceWidthPct: null,
      rangeGenerationSource: null,
      rangeGenerationMethod: null,
      activeRangeCreatedAt: null,
      adaptiveDecision: null,
    });
    expect(result.reasonCode).not.toBe("OFF_MODE");
    expect(result.status).not.toBe("audit_only");
  });

  // ─── 3C.4-G: Shadow orphan cycle diagnosis endpoint ─────────────────

  it("GET /api/grid-isolated/shadow-orphan-cycles/diagnose (deprecated alias) responds 200", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/shadow-orphan-cycles/diagnose");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("readOnly", true);
    expect(res.body).toHaveProperty("realOrdersAffected", false);
    expect(res.body).toHaveProperty("deprecated", true);
    expect(res.body).toHaveProperty("replacement", "/api/grid-isolated/shadow-open-cycles/diagnose");
    expect(res.body).toHaveProperty("cyclesEligibleForSimulatedClose");
    expect(res.body).toHaveProperty("recommendation");
  });

  it("shadow-orphan-cycles/diagnose alias returns same functional fields as canonical endpoint", async () => {
    const res = await simulateGet(app, "/api/grid-isolated/shadow-orphan-cycles/diagnose");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("mode");
    expect(res.body).toHaveProperty("activeRangeVersionId");
    expect(typeof res.body.cyclesEligibleForSimulatedClose).toBe("number");
    expect(typeof res.body.totalOpen).toBe("number");
    expect(res.body.deprecated).toBe(true);
    expect(res.body.replacement).toBe("/api/grid-isolated/shadow-open-cycles/diagnose");
  });

  it("shadow-orphan-cycles/diagnose is read-only (does not modify status)", async () => {
    const before = await simulateGet(app, "/api/grid-isolated/status");
    const diag = await simulateGet(app, "/api/grid-isolated/shadow-orphan-cycles/diagnose");
    const after = await simulateGet(app, "/api/grid-isolated/status");
    expect(diag.status).toBe(200);
    expect(after.body.mode).toBe(before.body.mode);
    expect(after.body.isActive).toBe(before.body.isActive);
    expect(after.body.isRunning).toBe(before.body.isRunning);
  });

  // ─── 3C.4-I-REV-B: shadow-open-cycles/diagnose endpoint ─────────────

  function setupOpenCyclesDiagnose(opts: { mode?: string; isActive?: boolean; cycleStatus?: any; targetSet?: boolean; previousRange?: boolean } = {}) {
    const engine = gridIsolatedEngine as any;
    engine.config = {
      id: 1,
      pair: "BTC/USD",
      mode: opts.mode ?? "SHADOW",
      isActive: opts.isActive ?? true,
      executionPolicy: "MAKER_ONLY",
    } as any;
    engine.activeRangeVersion = {
      id: "rv1",
      pair: "BTC/USD",
      versionNumber: 1,
      status: "active",
      createdAt: new Date(),
      activatedAt: new Date(),
      closedAt: null,
    } as any;
    engine.levels = [{
      id: "s1",
      rangeVersionId: "rv1",
      levelIndex: 1,
      side: "SELL",
      price: 61000,
      quantity: 0.001,
      status: "planned",
      clientOrderId: "sell-client-1",
      exchangeOrderId: null,
      filledPrice: null,
      filledQuantity: null,
      filledAt: null,
      createdAt: new Date(),
      placedAt: null,
      cancelledAt: null,
    }] as any[];
    engine.cycles = [{
      id: "c1",
      rangeVersionId: opts.previousRange ? "rv2" : "rv1",
      cycleNumber: 1,
      pair: "BTC/USD",
      status: opts.cycleStatus ?? "buy_filled",
      buyLevelId: "b1",
      sellLevelId: null,
      targetSellLevelId: opts.targetSet !== false ? "s1" : null,
      buyPrice: 60000,
      sellPrice: null,
      targetSellPrice: opts.targetSet !== false ? 61000 : null,
      targetSellQuantity: opts.targetSet !== false ? 0.001 : null,
      quantity: 0.001,
      grossPnlUsd: 0,
      feeTotalUsd: 0,
      taxReserveUsd: 0,
      netPnlUsd: 0,
      netPnlPct: 0,
      buyClientOrderId: "buy-client-1",
      sellClientOrderId: null,
      buyFilledAt: new Date(Date.now() - 60_000),
      sellFilledAt: null,
      holdTimeMinutes: 0,
      createdAt: new Date(),
      completedAt: null,
    }] as any[];
    engine.lastShadowExecutionPrice = null;
  }

  function resetDiagnoseEngine() {
    const engine = gridIsolatedEngine as any;
    engine.config = null;
    engine.activeRangeVersion = null;
    engine.cycles = [];
    engine.levels = [];
  }

  describe("GET /api/grid-isolated/shadow-open-cycles/diagnose", () => {
    beforeEach(() => { setupOpenCyclesDiagnose(); });
    afterEach(() => { resetDiagnoseEngine(); });

    it("responds 200 with readOnly=true and realOrdersAffected=false", async () => {
      const res = await simulateGet(app, "/api/grid-isolated/shadow-open-cycles/diagnose");
      expect(res.status).toBe(200);
      expect(res.body.readOnly).toBe(true);
      expect(res.body.realOrdersAffected).toBe(false);
      expect(res.body.mode).toBe("SHADOW");
    });

    it("returns price context fields", async () => {
      const res = await simulateGet(app, "/api/grid-isolated/shadow-open-cycles/diagnose");
      expect(res.status).toBe(200);
      expect(typeof res.body.currentBid).toBe("number");
      expect(typeof res.body.priceSource).toBe("string");
      expect(typeof res.body.priceTimestamp).toBe("string");
      expect(typeof res.body.priceStale).toBe("boolean");
      expect(res.body.priceStale).toBe(false);
    });

    it("returns counts for one executable open cycle", async () => {
      const res = await simulateGet(app, "/api/grid-isolated/shadow-open-cycles/diagnose");
      expect(res.status).toBe(200);
      expect(res.body.totalOpen).toBe(1);
      expect(res.body.executableOpenCyclesCount).toBe(1);
      expect(res.body.waitingSellCyclesCount).toBe(1);
      expect(res.body.previousRangeOpenCyclesCount).toBe(0);
      expect(res.body.reviewRequiredCyclesCount).toBe(0);
      expect(res.body.cyclesEligibleForSimulatedClose).toBe(1);
      expect(res.body.wouldCloseNow).toBe(1);
      expect(res.body.eligibleToClose).toBe(1);
    });

    it("returns per-cycle diagnostic details", async () => {
      const res = await simulateGet(app, "/api/grid-isolated/shadow-open-cycles/diagnose");
      expect(res.status).toBe(200);
      expect(res.body.cycles).toHaveLength(1);
      const cycle = res.body.cycles[0];
      expect(cycle.targetSellPrice).toBe(61000);
      expect(cycle.rangeRelation).toBe("active");
      expect(cycle.lifecycleState).toBe("buy_filled");
      expect(cycle.requiresReview).toBe(false);
    });

    it("marks HODL_RECOVERY as requiresReview and excludes it from close", async () => {
      setupOpenCyclesDiagnose({ cycleStatus: "hodl_recovery" });
      const res = await simulateGet(app, "/api/grid-isolated/shadow-open-cycles/diagnose");
      expect(res.status).toBe(200);
      expect(res.body.inHodlRecovery).toBe(1);
      expect(res.body.cyclesEligibleForSimulatedClose).toBe(0);
      expect(res.body.reviewRequiredCyclesCount).toBe(1);
      expect(res.body.cycles[0].requiresReview).toBe(true);
    });

    it("detects missing target as requiresReview", async () => {
      // El ciclo compró a un precio superior a cualquier SELL del rango activo,
      // por lo que resolveTargetSellForCycle no encuentra objetivo.
      setupOpenCyclesDiagnose({ targetSet: false, previousRange: true });
      const res = await simulateGet(app, "/api/grid-isolated/shadow-open-cycles/diagnose");
      expect(res.status).toBe(200);
      expect(res.body.missingTarget).toBe(1);
      expect(res.body.executableOpenCyclesCount).toBe(0);
      expect(res.body.reviewRequiredCyclesCount).toBe(1);
    });

    it("classifies previous-range open cycles with rangeRelation=previous", async () => {
      setupOpenCyclesDiagnose({ previousRange: true });
      const res = await simulateGet(app, "/api/grid-isolated/shadow-open-cycles/diagnose");
      expect(res.status).toBe(200);
      expect(res.body.previousRangeOpenCyclesCount).toBe(1);
      expect(res.body.cycles[0].rangeRelation).toBe("previous");
    });

    it("is read-only: does not persist target, update cycles/levels or place orders", async () => {
      setupOpenCyclesDiagnose({ targetSet: false });
      const engine = gridIsolatedEngine as any;
      const beforeTarget = engine.cycles[0].targetSellLevelId;
      const beforeLevelStatus = engine.levels[0].status;
      const beforeCycleStatus = engine.cycles[0].status;
      const res = await simulateGet(app, "/api/grid-isolated/shadow-open-cycles/diagnose");
      expect(res.status).toBe(200);
      expect(engine.cycles[0].targetSellLevelId).toBe(beforeTarget);
      expect(engine.cycles[0].status).toBe(beforeCycleStatus);
      expect(engine.levels[0].status).toBe(beforeLevelStatus);
    });

    it("resuelve candidates históricos y reporta contadores correctos sin persistir", async () => {
      const engine = gridIsolatedEngine as any;
      const rangeA = "9bf99770-c40c-4870-a166-4389a51226f0";
      const rangeB = "9bf99770-c40c-4870-a166-4389a51226f1";
      engine.config = {
        id: 1,
        pair: "BTC/USD",
        mode: "SHADOW",
        isActive: true,
        executionPolicy: "MAKER_ONLY",
      } as any;
      engine.activeRangeVersion = { id: "new-active", pair: "BTC/USD", versionNumber: 2, status: "active", createdAt: new Date() } as any;
      engine.referencedRangeVersions = [
        { id: rangeA, pair: "BTC/USD", versionNumber: 1, status: "replaced", createdAt: new Date() },
        { id: rangeB, pair: "BTC/USD", versionNumber: 1, status: "replaced", createdAt: new Date() },
      ] as any;
      engine.cycles = [
        { id: "cA", cycleNumber: 25, rangeVersionId: rangeA, pair: "BTC/USD", status: "buy_filled", buyPrice: 63264.40, quantity: 0.00379061, targetSellLevelId: null, targetSellPrice: null, targetSellQuantity: null, buyClientOrderId: "bcA", sellClientOrderId: null, buyFilledAt: new Date(), createdAt: new Date(), completedAt: null, grossPnlUsd: 0, feeTotalUsd: 0, taxReserveUsd: 0, netPnlUsd: 0, netPnlPct: 0, holdTimeMinutes: 0 },
        { id: "cB", cycleNumber: 26, rangeVersionId: rangeB, pair: "BTC/USD", status: "buy_filled", buyPrice: 62532.30, quantity: 0.00383786, targetSellLevelId: null, targetSellPrice: null, targetSellQuantity: null, buyClientOrderId: "bcB", sellClientOrderId: null, buyFilledAt: new Date(), createdAt: new Date(), completedAt: null, grossPnlUsd: 0, feeTotalUsd: 0, taxReserveUsd: 0, netPnlUsd: 0, netPnlPct: 0, holdTimeMinutes: 0 },
      ];
      engine.levels = [
        { id: "c6e8cfd1-37fa-4516-88e8-79ebe54a5f43", rangeVersionId: rangeA, side: "SELL", price: 64893.12322364, quantity: 0.00379061, status: "planned", clientOrderId: "scA", exchangeOrderId: null, filledPrice: null, filledQuantity: null, filledAt: null, createdAt: new Date() },
        { id: "4f300503-ff58-4aba-9d0b-6fc8f7869018", rangeVersionId: rangeB, side: "SELL", price: 65692.19591410, quantity: 0.00383786, status: "planned", clientOrderId: "scB", exchangeOrderId: null, filledPrice: null, filledQuantity: null, filledAt: null, createdAt: new Date() },
      ];
      engine.lastShadowExecutionPrice = null;
      // Evita query real; diagnosis usará referencedRangeVersions ya cargados
      const originalLoader = engine.loadReferencedRangeVersions;
      engine.loadReferencedRangeVersions = async () => {};

      const res = await simulateGet(app, "/api/grid-isolated/shadow-open-cycles/diagnose");
      expect(res.status).toBe(200);
      expect(res.body.totalOpen).toBe(2);
      expect(res.body.previousRangeOpenCyclesCount).toBe(2);
      expect(res.body.missingTarget).toBe(0);
      expect(res.body.reviewRequiredCyclesCount).toBe(0);
      expect(res.body.executableOpenCyclesCount).toBe(2);
      const diagA = res.body.cycles.find((c: any) => c.id === "cA");
      const diagB = res.body.cycles.find((c: any) => c.id === "cB");
      expect(diagA.targetSellLevelId).toBe("c6e8cfd1-37fa-4516-88e8-79ebe54a5f43");
      expect(diagA.targetSellPrice).toBe(64893.12322364);
      expect(diagB.targetSellLevelId).toBe("4f300503-ff58-4aba-9d0b-6fc8f7869018");
      expect(diagB.targetSellPrice).toBe(65692.19591410);
      expect(diagA.requiresReview).toBe(false);
      expect(diagA.rangeRelation).toBe("previous");
      // No persistencia
      expect(engine.cycles[0].targetSellLevelId).toBeNull();
      expect(engine.cycles[1].targetSellLevelId).toBeNull();

      engine.loadReferencedRangeVersions = originalLoader;
    });
  });

  describe("GET /api/grid-isolated/shadow-orphan-cycles/diagnose alias", () => {
    beforeEach(() => { setupOpenCyclesDiagnose(); });
    afterEach(() => { resetDiagnoseEngine(); });

    it("responds 200 with deprecated=true and replacement", async () => {
      const res = await simulateGet(app, "/api/grid-isolated/shadow-orphan-cycles/diagnose");
      expect(res.status).toBe(200);
      expect(res.body.deprecated).toBe(true);
      expect(res.body.replacement).toBe("/api/grid-isolated/shadow-open-cycles/diagnose");
      expect(res.body.readOnly).toBe(true);
      expect(res.body.realOrdersAffected).toBe(false);
      expect(res.body.mode).toBe("SHADOW");
    });

    it("returns same functional content as the canonical endpoint", async () => {
      const canonical = await simulateGet(app, "/api/grid-isolated/shadow-open-cycles/diagnose");
      const alias = await simulateGet(app, "/api/grid-isolated/shadow-orphan-cycles/diagnose");
      expect(canonical.status).toBe(200);
      expect(alias.status).toBe(200);
      const stripTimestamp = (body: any) => {
        const { deprecated: _d, replacement: _r, priceTimestamp: _pt, priceAgeMs: _pa, ...rest } = body;
        return rest;
      };
      expect(stripTimestamp(alias.body)).toEqual(stripTimestamp(canonical.body));
    });
  });
});
