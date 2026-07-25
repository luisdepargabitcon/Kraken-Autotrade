import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { Express } from "express";
import http from "http";
import { gridRecommendationRegistry } from "../../services/gridIsolated/gridRecommendationRegistry";
import { gridIsolatedEngine } from "../../services/gridIsolated/gridIsolatedEngine";
import { MarketDataService } from "../../services/MarketDataService";
import { getGridBandSnapshot } from "../../services/gridIsolated/gridBandAdapter";
import {
  buildConfigFingerprint,
  buildActiveRangeFingerprint,
} from "../../services/gridIsolated/gridRecommendationService";
import type { ConfigurationRecommendation, RecommendationAlternative } from "@shared/gridRecommendationHelper";

const defaultRuntimeConfig = {
  mode: "SHADOW",
  pair: "BTC/USD",
  buyLevels: 1,
  sellLevels: 1,
  bandPeriod: 20,
  bandStdDevMultiplier: 2,
  atrPeriod: 14,
  atrTimeframe: "1h",
  adaptiveRangeNormalMaxPct: 5.0,
  adaptiveRangeMaxPct: 15.0,
};

const defaultActiveRangeVersionId = "rv1";

function computeConfigFingerprint(runtimeConfig?: any) {
  return buildConfigFingerprint({
    pair: defaultRuntimeConfig.pair,
    mode: defaultRuntimeConfig.mode,
    config: runtimeConfig ?? defaultRuntimeConfig,
    marketContext: null,
    resolvedRange: { activeRangeVersionId: null },
    adaptiveDecision: null,
    professionalGenerator: null,
    levels: [],
    status: null,
  } as any);
}

function makeAlt(id: "A" | "B" | "C", overrides: Partial<RecommendationAlternative> = {}): RecommendationAlternative {
  const base: Record<string, RecommendationAlternative> = {
    A: {
      id: "A",
      title: "Reducir niveles",
      explanation: "",
      proposedConfig: { buyLevels: 2 },
      changedFields: ["buyLevels"],
      expectedBefore: { levels: 1, spacingPct: 1, rangePct: 1, netProfitPct: 0.8 },
      expectedAfter: { levels: 2, spacingPct: 1, rangePct: 1, netProfitPct: 0.8 },
      warnings: [],
      safeToApply: true,
      blockingReason: null,
    },
    B: {
      id: "B",
      title: "Mejorar objetivo",
      explanation: "",
      proposedConfig: { netProfitTargetPct: 1.0 },
      changedFields: ["netProfitTargetPct"],
      expectedBefore: { levels: 1, spacingPct: 1, rangePct: 1, netProfitPct: 0.8 },
      expectedAfter: { levels: 1, spacingPct: 1, rangePct: 1, netProfitPct: 1.0 },
      warnings: [],
      safeToApply: true,
      blockingReason: null,
    },
    C: {
      id: "C",
      title: "Ampliar rango",
      explanation: "",
      proposedConfig: { gridRangeMaxPct: 4.0 },
      changedFields: ["gridRangeMaxPct"],
      expectedBefore: { levels: 1, spacingPct: 1, rangePct: 1, netProfitPct: 0.8 },
      expectedAfter: { levels: 2, spacingPct: 1, rangePct: 4, netProfitPct: 0.8 },
      warnings: [],
      safeToApply: true,
      blockingReason: null,
    },
  };
  return { ...base[id], ...overrides } as RecommendationAlternative;
}

function makeRecommendation(
  overrides: Partial<ConfigurationRecommendation> = {},
  altOverrides: Partial<RecommendationAlternative> = {},
  runtimeConfigForFingerprint?: any,
): ConfigurationRecommendation {
  const alt = makeAlt("A", altOverrides);
  const cfgFp = computeConfigFingerprint(runtimeConfigForFingerprint);
  const arFp = buildActiveRangeFingerprint(defaultActiveRangeVersionId);
  const now = Date.now();
  return {
    id: "rec-apply-test",
    generatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
    snapshotFingerprint: `${cfgFp}||${arFp}||mkt`,
    configFingerprint: cfgFp,
    marketFingerprint: "mkt",
    activeRangeFingerprint: arFp,
    context: {
      pair: "BTC/USD",
      mode: "SHADOW",
      activeRangeVersionId: "rv1",
      regime: "RANGE",
      regimeMaxPct: 5,
      bandPeriod: 20,
      bandStdDevMultiplier: 2,
      atrPeriod: 14,
      atrTimeframe: "1h",
      bandSource: "grid_band_adapter",
      bandLower: 90000,
      bandCenter: 95000,
      bandUpper: 100000,
      bandWidthPct: 10,
      atrPct: 2,
      referencePrice: 95000,
    },
    referencePrice: 95000,
    fresh: true,
    confidence: 0.85,
    title: "Recomendación",
    explanation: "",
    currentConfig: { buyLevels: 1 },
    alternatives: [alt],
    recommendedAlternativeId: "A",
    warnings: [],
    safeToApply: true,
    blockingReason: null,
    ...overrides,
  };
}

function makeRecommendationWithAlts(
  alts: RecommendationAlternative[],
  overrides: Partial<ConfigurationRecommendation> = {},
  runtimeConfigForFingerprint?: any,
): ConfigurationRecommendation {
  const rec = makeRecommendation(overrides, {}, runtimeConfigForFingerprint);
  rec.alternatives = alts;
  return rec;
}

const defaultTicker = { last: 95000, bid: 94990, ask: 95010 };
const defaultBandSnapshot = {
  lower: 90000,
  middle: 95000,
  upper: 100000,
  bandWidthPct: 10,
  atrPct: 2,
  internallyConsistent: true,
  regime: "RANGE",
};

vi.mock("../../services/MarketDataService", () => ({
  MarketDataService: {
    getTicker: vi.fn().mockResolvedValue({ last: 95000, bid: 94990, ask: 95010 }),
  },
}));

vi.mock("../../services/gridIsolated/gridBandAdapter", () => ({
  getGridBandSnapshot: vi.fn().mockResolvedValue({
    lower: 90000,
    middle: 95000,
    upper: 100000,
    bandWidthPct: 10,
    atrPct: 2,
    internallyConsistent: true,
    regime: "RANGE",
  }),
}));

vi.mock("../../services/gridIsolated/gridRecommendationRegistry", () => ({
  gridRecommendationRegistry: {
    get: vi.fn(),
    isApplied: vi.fn().mockReturnValue(false),
    markApplied: vi.fn().mockReturnValue(true),
    deleteExpired: vi.fn().mockReturnValue(0),
  },
}));

vi.mock("../../services/gridIsolated/gridIsolatedEngine", () => ({
  gridIsolatedEngine: {
    loadConfig: vi.fn().mockResolvedValue({
      mode: "SHADOW",
      pair: "BTC/USD",
      buyLevels: 1,
      sellLevels: 1,
      bandPeriod: 20,
      bandStdDevMultiplier: 2,
      atrPeriod: 14,
      atrTimeframe: "1h",
    }),
    getStatusSafe: vi.fn().mockResolvedValue({ activeRangeVersionId: "rv1" }),
    getConfig: vi.fn().mockReturnValue({ buyLevels: 1 }),
    saveConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../services/botLogger", () => ({
  botLogger: { info: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../../db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
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
  and: vi.fn(),
  inArray: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray, ...vals: any[]) => ({ sql: strings.join("?"), params: vals })),
}));

import { registerGridIsolatedRoutes } from "../gridIsolated.routes";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  registerGridIsolatedRoutes(app);
  return app;
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

describe("Recommendation apply endpoint", () => {
  let app: Express;

  beforeEach(() => {
    app = createApp();
    vi.mocked(gridRecommendationRegistry.get).mockReset();
    vi.mocked(gridRecommendationRegistry.isApplied).mockReset().mockReturnValue(false);
    vi.mocked(gridRecommendationRegistry.markApplied).mockReset().mockReturnValue(true);
    vi.mocked(gridIsolatedEngine.loadConfig).mockReset().mockResolvedValue(defaultRuntimeConfig as any);
    vi.mocked(gridIsolatedEngine.getStatusSafe).mockReset().mockResolvedValue({ activeRangeVersionId: defaultActiveRangeVersionId } as any);
    vi.mocked(gridIsolatedEngine.getConfig).mockReset().mockReturnValue({ buyLevels: 1 } as any);
    vi.mocked(gridIsolatedEngine.saveConfig).mockReset().mockResolvedValue(undefined);
    vi.mocked(MarketDataService.getTicker).mockReset().mockResolvedValue(defaultTicker);
    vi.mocked(getGridBandSnapshot).mockReset().mockResolvedValue(defaultBandSnapshot as any);
  });

  it("returns 404 when recommendation is not found", async () => {
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(null);
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "missing",
      alternativeId: "A",
      confirmed: true,
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("RECOMMENDATION_NOT_FOUND");
  });

  it("rejects proposedConfig from client", async () => {
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(makeRecommendation());
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "A",
      confirmed: true,
      proposedConfig: { buyLevels: 99 },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CLIENT_PROPOSED_CONFIG_REJECTED");
  });

  it("rejects when not in SHADOW mode", async () => {
    vi.mocked(gridIsolatedEngine.loadConfig).mockResolvedValue({ ...defaultRuntimeConfig, mode: "OFF" } as any);
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(makeRecommendation());
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "A",
      confirmed: true,
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_SHADOW");
  });

  it("returns 410 when recommendation is expired", async () => {
    const rec = makeRecommendation({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(rec);
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "A",
      confirmed: true,
    });
    expect(res.status).toBe(410);
    expect(res.body.code).toBe("RECOMMENDATION_EXPIRED");
  });

  it("returns 409 when config fingerprint changed", async () => {
    const rec = makeRecommendation({
      configFingerprint: "different-fingerprint",
      snapshotFingerprint: "different-fingerprint||rv1||mkt",
    });
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(rec);
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "A",
      confirmed: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFIG_CHANGED");
  });

  it("returns 409 when active range fingerprint changed", async () => {
    const rec = makeRecommendation({ activeRangeFingerprint: "different-range" });
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(rec);
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "A",
      confirmed: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ACTIVE_RANGE_CHANGED");
  });

  it("returns 503 when ticker throws", async () => {
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(makeRecommendation());
    vi.mocked(MarketDataService.getTicker).mockRejectedValue(new Error("Network"));
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "A",
      confirmed: true,
    });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("MARKET_DATA_UNAVAILABLE");
    expect(gridIsolatedEngine.saveConfig).not.toHaveBeenCalled();
    expect(gridRecommendationRegistry.markApplied).not.toHaveBeenCalled();
  });

  it("returns MARKET_SNAPSHOT_INCOMPLETE when ticker is null", async () => {
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(makeRecommendation());
    vi.mocked(MarketDataService.getTicker).mockResolvedValue(null as any);
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "A",
      confirmed: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MARKET_SNAPSHOT_INCOMPLETE");
    expect(gridIsolatedEngine.saveConfig).not.toHaveBeenCalled();
  });

  it("returns MARKET_SNAPSHOT_INCOMPLETE when last is null", async () => {
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(makeRecommendation());
    vi.mocked(MarketDataService.getTicker).mockResolvedValue({ last: null } as any);
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "A",
      confirmed: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MARKET_SNAPSHOT_INCOMPLETE");
  });

  it("returns MARKET_SNAPSHOT_INCOMPLETE when last <= 0", async () => {
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(makeRecommendation());
    vi.mocked(MarketDataService.getTicker).mockResolvedValue({ last: 0 } as any);
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "A",
      confirmed: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MARKET_SNAPSHOT_INCOMPLETE");
  });

  it("returns 503 when getGridBandSnapshot throws", async () => {
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(makeRecommendation());
    vi.mocked(getGridBandSnapshot).mockRejectedValue(new Error("Band error"));
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "A",
      confirmed: true,
    });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("MARKET_DATA_UNAVAILABLE");
    expect(gridIsolatedEngine.saveConfig).not.toHaveBeenCalled();
    expect(gridRecommendationRegistry.markApplied).not.toHaveBeenCalled();
  });

  it("returns MARKET_SNAPSHOT_INCOMPLETE when bandSnapshot is null", async () => {
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(makeRecommendation());
    vi.mocked(getGridBandSnapshot).mockResolvedValue(null as any);
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "A",
      confirmed: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MARKET_SNAPSHOT_INCOMPLETE");
  });

  it.each([
    ["lower", { lower: null }],
    ["middle", { middle: null }],
    ["upper", { upper: null }],
    ["bandWidthPct", { bandWidthPct: null }],
    ["atrPct", { atrPct: null }],
    ["regime", { regime: null }],
  ])("returns MARKET_SNAPSHOT_INCOMPLETE when %s is null", async (_label, bandOverride) => {
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(makeRecommendation());
    vi.mocked(getGridBandSnapshot).mockResolvedValue({ ...defaultBandSnapshot, ...bandOverride } as any);
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "A",
      confirmed: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MARKET_SNAPSHOT_INCOMPLETE");
  });

  it("returns MARKET_SNAPSHOT_INCONSISTENT when band is internally inconsistent", async () => {
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(makeRecommendation());
    vi.mocked(getGridBandSnapshot).mockResolvedValue({ ...defaultBandSnapshot, internallyConsistent: false } as any);
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "A",
      confirmed: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MARKET_SNAPSHOT_INCONSISTENT");
  });

  it("returns MARKET_SNAPSHOT_INCOMPLETE when stored required field is null", async () => {
    const rec = makeRecommendation({ context: { ...makeRecommendation().context, regime: null } as any });
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(rec);
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "A",
      confirmed: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MARKET_SNAPSHOT_INCOMPLETE");
  });

  it("alternative A applies without current regimeMaxPct", async () => {
    const runtimeConfig = { ...defaultRuntimeConfig, adaptiveRangeNormalMaxPct: undefined };
    const rec = makeRecommendationWithAlts([makeAlt("A")], {}, runtimeConfig);
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(rec);
    vi.mocked(gridIsolatedEngine.loadConfig).mockResolvedValue(runtimeConfig as any);
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "A",
      confirmed: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("alternative B without range change applies without current regimeMaxPct", async () => {
    const runtimeConfig = { ...defaultRuntimeConfig, adaptiveRangeNormalMaxPct: undefined };
    const rec = makeRecommendationWithAlts([makeAlt("A"), makeAlt("B")], {}, runtimeConfig);
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(rec);
    vi.mocked(gridIsolatedEngine.loadConfig).mockResolvedValue(runtimeConfig as any);
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "B",
      confirmed: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("alternative C requires stored and current regimeMaxPct", async () => {
    const rec = makeRecommendationWithAlts([makeAlt("A"), makeAlt("B"), makeAlt("C")], {
      context: { ...makeRecommendation().context, regimeMaxPct: null } as any,
    });
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(rec);
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "C",
      confirmed: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("REGIME_LIMIT_UNAVAILABLE");
    expect(gridIsolatedEngine.saveConfig).not.toHaveBeenCalled();
  });

  it("alternative C uses minimum of stored and current regimeMaxPct", async () => {
    const rec = makeRecommendationWithAlts([makeAlt("C")], {
      context: { ...makeRecommendation().context, regimeMaxPct: 4.5 } as any,
    });
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(rec);
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "C",
      confirmed: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("does not modify runtime config or mark applied on any previous failure", async () => {
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(makeRecommendation());
    vi.mocked(MarketDataService.getTicker).mockRejectedValue(new Error("fail"));
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "A",
      confirmed: true,
    });
    expect(res.status).toBe(503);
    expect(gridIsolatedEngine.getConfig).not.toHaveBeenCalled();
    expect(gridIsolatedEngine.saveConfig).not.toHaveBeenCalled();
    expect(gridRecommendationRegistry.markApplied).not.toHaveBeenCalled();
  });

  it("returns 200 and applies a valid recommendation", async () => {
    vi.mocked(gridRecommendationRegistry.get).mockReturnValue(makeRecommendation());
    const res = await simulatePost(app, "/api/grid-isolated/config/recommendation/apply", {
      recommendationId: "rec-apply-test",
      alternativeId: "A",
      confirmed: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.appliedFields).toContain("buyLevels");
    expect(res.body.beforeValues).toHaveProperty("buyLevels");
    expect(res.body.afterValues).toHaveProperty("buyLevels");
    expect(gridRecommendationRegistry.markApplied).toHaveBeenCalledWith("rec-apply-test");
  });
});
