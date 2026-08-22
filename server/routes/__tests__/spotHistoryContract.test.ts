/**
 * SPOT_HISTORY_STAGING_CONTRACT
 *
 * Regression guard derived from the forensic audit of 2026-08-22.
 *
 * Root cause confirmed: the deployed `getClosedTrades()` returned raw DB rows
 * (snake_case keys) instead of the camelCase DTO that the frontend expects.
 * The crash was `TypeError: can't access property "toFixed", a.entryPrice is undefined`
 * because the frontend read `.entryPrice` while the API delivered `.entry_price`.
 *
 * These tests verify that:
 *  SPOT_HISTORY_REQUIRED_FIELDS  — every trade has the required camelCase numeric fields
 *  SPOT_HISTORY_STAGING_CONTRACT — /api/spot/history returns { trades, count, limit }
 *  SPOT_SUMMARY_LEDGER_CONTRACT  — /api/spot/summary returns consistent numeric aggregates
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { Express } from "express";
import http from "http";
import { ExecutionMode } from "../../services/spot/spotTypes";

// ─── Staging-representative fixture (from real 2026-08-22 capture) ──────────

const STAGING_TRADE_FIXTURE = {
  tradeId: "spot-trade-spot-ETH/USD-mt3ge42d-1lm1",
  lotId: "spot-ETH/USD-mt3ge42d-1lm1",
  pair: "ETH/USD",
  side: "sell",
  exitPrice: 2478.20028,
  entryPrice: 2450.52493700,
  amount: 0.7511858,
  grossPnl: 20.78932467,
  netPnl: 17.45717512,
  realizedPnl: 17.45717512,
  realizedPnlPct: 1.1294,
  entryFee: 1.65671958,
  exitFee: 1.67542997,
  executionCost: 0,
  feeQuality: "ESTIMATED",
  mfe: 70.71292261,
  mae: 0,
  mfeR: 1.4143,
  maeR: 0,
  profitCapturePct: 24.6874,
  rMultiple: 0,
  exitReason: "TIME_EFFICIENCY",
  holdTimeMinutes: 469,
  executionMode: "SHADOW",
  policyVersion: "SPOT-1.0.0-20260812",
  setupTag: "PULLBACK_CONTINUATION",
  signalId: "intent-ETH/USD-mt3g8yvr-ywmzv",
  marketContextId: "mc-ETH/USD-mt3ge3p1-i8d2f7",
  executedAt: expect.any(Number),
  openedAt: expect.any(Number),
  closedAt: expect.any(Number),
};

const STAGING_SUMMARY_FIXTURE = {
  totalTrades: 31,
  openPositions: 0,
  netPnlUsd: 961.04465811,
  winRate: 0.5483870967741935,
};

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockSpotEngine = vi.hoisted(() => ({
  getExecutionMode: vi.fn(async () => ExecutionMode.SHADOW),
  setExecutionMode: vi.fn(async (mode: ExecutionMode) => mode),
  getIntentStore: vi.fn(() => ({ getAll: () => [] })),
  getAuditTracker: vi.fn(() => ({
    getAll: () => [],
    getMetrics: vi.fn(() => null),
    getAggregate: vi.fn(() => ({ positionCount: 0, closedCount: 31, aggregate: {} })),
  })),
  getOpenPositions: vi.fn(async () => []),
  getClosedTrades: vi.fn(async () => [STAGING_TRADE_FIXTURE]),
  getSummaryStats: vi.fn(async () => ({
    totalTrades: STAGING_SUMMARY_FIXTURE.totalTrades,
    openPositions: STAGING_SUMMARY_FIXTURE.openPositions,
    netPnlUsd: STAGING_SUMMARY_FIXTURE.netPnlUsd,
    grossPnlUsd: 1065.76558778,
    winRate: STAGING_SUMMARY_FIXTURE.winRate,
    avgHoldTimeMinutes: 190.03,
    bestTrade: 147.41,
    worstTrade: -27.42,
    profitFactor: 6.23,
    avgMfe: 56.44,
    avgMae: 8.56,
  })),
  getLastScanResults: vi.fn(() => []),
  getLastScanTime: vi.fn(() => 0),
  SPOT_RUNTIME_OWNER: "SpotEngine",
  RealActivationBlockedError: class RealActivationBlockedError extends Error {
    blockers: string[];
    constructor(blockers: string[], message?: string) {
      super(message ?? "REAL activation blocked");
      this.name = "RealActivationBlockedError";
      this.blockers = blockers;
    }
  },
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
  RealActivationBlockedError: mockSpotEngine.RealActivationBlockedError,
}));

vi.mock("../../services/spot/feeModel", () => ({
  getTradingFeeModel: vi.fn(() => ({ exchange: "revolutx", takerFeePct: 0.09, makerFeePct: 0, quality: "REAL" })),
}));

vi.mock("../../services/spot/spotExecutionModeStore", () => ({
  getCachedExecutionMode: vi.fn(() => ExecutionMode.SHADOW),
}));

vi.mock("../../services/spot/spotMarketContext", () => ({
  buildSpotMarketContext: vi.fn(async () => ({})),
}));

vi.mock("../../services/spot/spotRealReadiness", () => ({
  checkRealReadiness: vi.fn(async () => ({ ready: false, blockers: [], warnings: [], checks: {} })),
}));

vi.mock("../../services/spot/spotActivityLogger", () => ({
  getActivityEvents: vi.fn(() => []),
  getActivityEventsFiltered: vi.fn(() => []),
  getActivityEventsFromDb: vi.fn(async () => []),
  humanizeSeverity: vi.fn((s: string) => s),
  humanizeCategory: vi.fn((c: string) => c),
  formatTimeAgo: vi.fn(() => "just now"),
}));

vi.mock("../../services/spot/spotPairToggle", () => ({
  getPairStatuses: vi.fn(async () => []),
  enablePair: vi.fn(async () => undefined),
  disablePair: vi.fn(async () => undefined),
  PairValidationError: class PairValidationError extends Error {},
  PairDisableDrainTimeoutError: class PairDisableDrainTimeoutError extends Error {},
}));

vi.mock("../../services/spot/spotTerminalStream", () => ({
  terminalWsServer: { upgrade: vi.fn() },
}));

vi.mock("../../services/spot/spotContextSnapshotStore", () => ({
  getSnapshot: vi.fn(async () => null),
  getAllSnapshots: vi.fn(async () => []),
}));

vi.mock("../../services/pairAllowlist", () => ({
  normalizePair: vi.fn((p: string) => p),
}));

// Import after mocks
import { registerSpotRoutes } from "../spot.routes";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  registerSpotRoutes(app, {} as any);
  return app;
}

async function get(app: Express, path: string): Promise<{ status: number; body: any }> {
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

// ─── SPOT_HISTORY_REQUIRED_FIELDS ────────────────────────────────────────────

describe("SPOT_HISTORY_REQUIRED_FIELDS", () => {
  let app: Express;
  beforeEach(() => { app = createApp(); });

  it("history route returns { trades, count, limit } wrapper", async () => {
    const { status, body } = await get(app, "/api/spot/history");
    expect(status).toBe(200);
    expect(body).toHaveProperty("trades");
    expect(Array.isArray(body.trades)).toBe(true);
    expect(body).toHaveProperty("count");
    expect(body).toHaveProperty("limit");
  });

  it("each trade has camelCase entryPrice as number — not undefined (regression guard)", async () => {
    const { body } = await get(app, "/api/spot/history");
    const trade = body.trades[0];
    expect(trade).toBeDefined();
    expect(typeof trade.entryPrice).toBe("number");
    expect(trade.entryPrice).toBeGreaterThan(0);
    expect(trade.entry_price).toBeUndefined();
  });

  it("each trade has camelCase exitPrice as number", async () => {
    const { body } = await get(app, "/api/spot/history");
    const trade = body.trades[0];
    expect(typeof trade.exitPrice).toBe("number");
    expect(trade.exitPrice).toBeGreaterThan(0);
    expect(trade.exit_price).toBeUndefined();
  });

  it("each trade has camelCase netPnl as number", async () => {
    const { body } = await get(app, "/api/spot/history");
    const trade = body.trades[0];
    expect(typeof trade.netPnl).toBe("number");
    expect(trade.net_pnl_usd).toBeUndefined();
  });

  it("each trade has camelCase grossPnl as number", async () => {
    const { body } = await get(app, "/api/spot/history");
    const trade = body.trades[0];
    expect(typeof trade.grossPnl).toBe("number");
    expect(trade.gross_pnl_usd).toBeUndefined();
  });

  it("each trade has required identity fields: tradeId, lotId, pair, side", async () => {
    const { body } = await get(app, "/api/spot/history");
    const trade = body.trades[0];
    expect(typeof trade.tradeId).toBe("string");
    expect(typeof trade.lotId).toBe("string");
    expect(typeof trade.pair).toBe("string");
    expect(typeof trade.side).toBe("string");
  });

  it("each trade has holdTimeMinutes as number", async () => {
    const { body } = await get(app, "/api/spot/history");
    const trade = body.trades[0];
    expect(typeof trade.holdTimeMinutes).toBe("number");
    expect(trade.hold_time_minutes).toBeUndefined();
  });

  it("each trade has executionMode as string", async () => {
    const { body } = await get(app, "/api/spot/history");
    const trade = body.trades[0];
    expect(typeof trade.executionMode).toBe("string");
    expect(trade.execution_mode).toBeUndefined();
  });
});

// ─── SPOT_HISTORY_STAGING_CONTRACT ───────────────────────────────────────────

describe("SPOT_HISTORY_STAGING_CONTRACT", () => {
  let app: Express;
  beforeEach(() => { app = createApp(); });

  it("ETH/USD staging fixture matches full DTO shape", async () => {
    const { status, body } = await get(app, "/api/spot/history?limit=1");
    expect(status).toBe(200);
    const trade = body.trades[0];
    expect(trade.pair).toBe("ETH/USD");
    expect(trade.entryPrice).toBeCloseTo(2450.52, 0);
    expect(trade.exitPrice).toBeCloseTo(2478.20, 0);
    expect(trade.netPnl).toBeCloseTo(17.46, 0);
    expect(trade.grossPnl).toBeCloseTo(20.79, 0);
    expect(trade.entryFee).toBeGreaterThan(0);
    expect(trade.exitFee).toBeGreaterThan(0);
    expect(trade.exitReason).toBe("TIME_EFFICIENCY");
    expect(trade.executionMode).toBe("SHADOW");
    expect(trade.holdTimeMinutes).toBe(469);
  });

  it("history count matches number of trade objects returned", async () => {
    const { body } = await get(app, "/api/spot/history");
    expect(body.count).toBe(body.trades.length);
  });
});

// ─── SPOT_SUMMARY_LEDGER_CONTRACT ────────────────────────────────────────────

describe("SPOT_SUMMARY_LEDGER_CONTRACT", () => {
  let app: Express;
  beforeEach(() => { app = createApp(); });

  it("summary returns executionMode, totalTrades, netPnlUsd, winRate", async () => {
    const { status, body } = await get(app, "/api/spot/summary");
    expect(status).toBe(200);
    expect(typeof body.executionMode).toBe("string");
    expect(typeof body.totalTrades).toBe("number");
    expect(typeof body.netPnlUsd).toBe("number");
    expect(typeof body.winRate).toBe("number");
  });

  it("staging ledger: netPnlUsd matches DB value 961.04", async () => {
    const { body } = await get(app, "/api/spot/summary");
    expect(body.netPnlUsd).toBeCloseTo(961.04, 1);
  });

  it("staging ledger: totalTrades is 31 and winRate is in [0,1]", async () => {
    const { body } = await get(app, "/api/spot/summary");
    expect(body.totalTrades).toBe(31);
    expect(body.winRate).toBeGreaterThanOrEqual(0);
    expect(body.winRate).toBeLessThanOrEqual(1);
  });
});
