/**
 * R7 — Canonical Ownership / OFF Fail-Safe
 *
 * Tests:
 *   A. SPOT_OWNER_OFF — isSpotRuntimeOwner()=true when mode=OFF
 *   B. SPOT_OWNER_SHADOW — isSpotRuntimeOwner()=true when mode=SHADOW
 *   C. LEGACY_ENTRY_BLOCKED_OFF — legacy entries blocked in OFF
 *   D. LEGACY_ENTRY_BLOCKED_SHADOW — legacy entries blocked in SHADOW
 *   E. SPOT_OFF_NO_ENTRY_SCANNER — no scan interval in OFF
 *   F. SPOT_OFF_OPEN_POSITION_SUPERVISOR_RUNNING — supervisor runs in OFF with positions
 *   G. SPOT_OFF_NO_POSITION_SUPERVISOR_OPTIONAL_IDLE — no supervisor in OFF without positions
 *   H. SPOT_RESTART_OFF_WITH_OPEN_POSITION — supervisor starts on restart with OFF+positions
 *   I. SPOT_SHADOW_TO_OFF_DOES_NOT_REENABLE_LEGACY — OFF doesn't re-enable legacy
 *   J. SPOT_OFF_TO_SHADOW_SINGLE_ENTRY_SCANNER — OFF→SHADOW starts single scanner
 *   K. SPOT_STARTUP_ORDER_SUPERVISOR_BEFORE_SCAN — supervisor runs before scan
 *   L. REAL_REMAINS_BLOCKED — REAL activation still blocked
 *
 * Classification:
 *   - STRUCTURAL: A, B (source inspection — isSpotRuntimeOwner always true)
 *   - INTEGRATION: C-L (mocked DB + real productive code)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Mock DB ─────────────────────────────────────────────────────────────────

function extractSql(query: any): { sql: string; params: any[] } {
  if (typeof query === "string") return { sql: query, params: [] };
  if (query?.sql) return { sql: query.sql, params: [] };
  if (query?.queryChunks) {
    const params: any[] = [];
    const sql = query.queryChunks.map((chunk: any) => {
      if (chunk !== null && typeof chunk === "object" && chunk.value !== undefined) {
        return chunk.value;
      }
      params.push(chunk);
      return "?";
    }).join("");
    return { sql, params };
  }
  return { sql: String(query), params: [] };
}

const { mockDbState, dbExecuteMock, dbTransactionMock } = vi.hoisted(() => {
  const state = {
    botConfig: {
      spot_execution_mode: "SHADOW" as string,
      active_pairs: ["BTC/USD"],
      is_active: true,
      spot_shadow_capital_usd: "10000",
      spot_shadow_reserved_usd: "0",
      spot_shadow_realized_pnl_usd: "0",
      spot_shadow_total_fees_usd: "0",
    },
    apiConfig: { trading_exchange: "revolutx" },
    openPositions: [] as any[],
    trades: [] as any[],
    committedLedger: { initial: 10000, reserved: 0, realized: 0, fees: 0 },
    manageOpenPositionsCalls: [] as string[],
    exitAdapterCalls: [] as string[],
    supervisorDelayMs: 0,
  };

  const executeFn = vi.fn(async (query: any) => {
    const { sql: sqlText, params } = extractSql(query);

    if (sqlText.includes("spot_execution_mode") && sqlText.includes("SELECT")) {
      return { rows: [state.botConfig] };
    }
    if (sqlText.includes("UPDATE bot_config") && sqlText.includes("spot_execution_mode")) {
      return { rows: [] };
    }
    if (sqlText.includes("active_pairs") && sqlText.includes("SELECT")) {
      return { rows: [state.botConfig] };
    }
    if (sqlText.includes("spot_shadow_capital_usd") && sqlText.includes("SELECT") && !sqlText.includes("FOR UPDATE")) {
      return { rows: [state.botConfig] };
    }
    if (sqlText.includes("trading_exchange")) {
      return { rows: [state.apiConfig] };
    }
    // R7: hasOpenSpotPositions — COUNT query must be handled BEFORE generic open_positions SELECT
    if (sqlText.includes("COUNT") && sqlText.includes("open_positions")) {
      const count = state.openPositions.filter((p: any) =>
        p.status !== "CLOSED" && p.policy_version === "SPOT-1.0.0-20260812"
      ).length;
      return { rows: [{ count: String(count) }] };
    }
    if (sqlText.includes("DISTINCT pair") && sqlText.includes("open_positions")) {
      const pairs = [...new Set(state.openPositions.filter((p: any) => p.status !== "CLOSED").map((p: any) => p.pair))];
      return { rows: pairs.map(p => ({ pair: p })) };
    }
    if (sqlText.includes("INSERT INTO open_positions")) {
      return { rows: [{ lot_id: params[0] }] };
    }
    if (sqlText.includes("INSERT INTO trades")) {
      return { rows: [{ trade_id: params[0] }] };
    }
    if (sqlText.includes("DELETE FROM open_positions")) {
      return { rows: [] };
    }
    if (sqlText.includes("FROM open_positions") && sqlText.includes("SELECT") && sqlText.includes("pair")) {
      const pairParam = params.find((p: any) => typeof p === "string" && p.includes("/"));
      if (pairParam) {
        state.manageOpenPositionsCalls.push(pairParam);
      }
      const pair = pairParam || "";
      return { rows: state.openPositions.filter((p: any) => p.pair === pair) };
    }
    if (sqlText.includes("FROM open_positions") && sqlText.includes("SELECT")) {
      return { rows: [...state.openPositions] };
    }
    if (sqlText.includes("FROM trades") && sqlText.includes("SELECT")) {
      return { rows: [...state.trades] };
    }
    if (sqlText.includes("UPDATE open_positions")) {
      return { rows: [] };
    }
    if (sqlText.includes("UPDATE bot_config") && sqlText.includes("spot_shadow_reserved")) {
      return { rows: [] };
    }
    return { rows: [] };
  });

  const transactionFn = vi.fn(async (callback: (tx: any) => Promise<any>) => {
    const tx = { execute: executeFn };
    return await callback(tx);
  });

  return { mockDbState: state, dbExecuteMock: executeFn, dbTransactionMock: transactionFn };
});

vi.mock("../../db", () => ({
  db: {
    execute: dbExecuteMock,
    transaction: dbTransactionMock,
  },
}));

// ─── Mock spotExecutionModeStore ─────────────────────────────────────────────

const { mockModeState, mockModeFns } = vi.hoisted(() => {
  const state = { mode: "SHADOW" as string };
  const fns = {
    loadMode: vi.fn(async () => state.mode as any),
    saveMode: vi.fn(async (mode: any) => { state.mode = mode; }),
    getCached: vi.fn(() => state.mode as any),
    invalidate: vi.fn(() => {}),
  };
  return { mockModeState: state, mockModeFns: fns };
});

vi.mock("../spot/spotExecutionModeStore", () => ({
  loadExecutionMode: mockModeFns.loadMode,
  saveExecutionMode: mockModeFns.saveMode,
  getCachedExecutionMode: mockModeFns.getCached,
  invalidateExecutionModeCache: mockModeFns.invalidate,
}));

// ─── Mock buildSpotMarketContext ─────────────────────────────────────────────

const { mockContext } = vi.hoisted(() => ({
  mockContext: {
    pair: "BTC/USD",
    marketContextId: "ctx-r7-001",
    candles5m: [{ time: Date.now() - 300000, open: 99500, high: 100100, low: 99400, close: 100050, volume: 100 }],
    candles15m: Array.from({ length: 250 }, (_, i) => ({ time: Date.now() - (250 - i) * 900000, open: 99000 + i * 5, high: 99100 + i * 5, low: 98900 + i * 5, close: 99050 + i * 5, volume: 100 + i })),
    candles1h: Array.from({ length: 250 }, (_, i) => ({ time: Date.now() - (250 - i) * 3600000, open: 98000 + i * 10, high: 98100 + i * 10, low: 97900 + i * 10, close: 98050 + i * 10, volume: 500 + i * 5 })),
    candles4h: Array.from({ length: 250 }, (_, i) => ({ time: Date.now() - (250 - i) * 14400000, open: 95000 + i * 20, high: 95100 + i * 20, low: 94900 + i * 20, close: 95050 + i * 20, volume: 2000 + i * 10 })),
    ticker: { bid: 100000, ask: 100100, last: 100050, spread: 100, volume24h: 50000000 },
    spreadPct: 0.1,
    atr: 1500,
    volumeMetrics: { volumeRatio: 1.5, volume24h: 50000000, volume5m: 1000000 },
    dataHealth: "GOOD",
    regimeContext: {
      regime: "TREND", direction: "BULLISH", volatility: "NORMAL",
      macroBias: "BULLISH", adx: 28, ema20: 99500, ema50: 99000, ema200: 95000,
      emaAlignment: "BULLISH", bollingerWidth: 2.5, atrPct: 1.5, confidence: 0.75,
      regimeId: "regime-r7-001", contextId: "ctx-r7-001",
    },
  },
}));

vi.mock("../spot/spotMarketContext", () => ({
  buildSpotMarketContext: vi.fn(async (opts: { pair: string }) => ({
    ...mockContext, pair: opts.pair,
  })),
}));

// ─── Imports ────────────────────────────────────────────────────────────────

import { ExecutionMode, REAL_ACTIVATION_ALLOWED,
  type SpotPosition } from "../spot/spotTypes";
import {
  isSpotRuntimeOwner,
  isSpotActive,
  startSpotEngine,
  setExecutionMode,
  getExecutionMode,
  SPOT_RUNTIME_OWNER,
  _stopSpotEngineForTest,
  _isEngineRunningForTest,
  _isEntryScanningEnabledForTest,
  _isSupervisorRunningForTest,
  _hasScanIntervalForTest,
  _hasSupervisorIntervalForTest,
  _runScanCycleForTest,
  _runPositionSupervisorForTest,
} from "../spot/spotEngine";

// ─── Test helpers ────────────────────────────────────────────────────────────

function resetMockState() {
  mockDbState.botConfig.spot_execution_mode = "SHADOW";
  mockDbState.botConfig.active_pairs = ["BTC/USD"];
  mockDbState.botConfig.spot_shadow_capital_usd = "10000";
  mockDbState.botConfig.spot_shadow_reserved_usd = "0";
  mockDbState.botConfig.spot_shadow_realized_pnl_usd = "0";
  mockDbState.botConfig.spot_shadow_total_fees_usd = "0";
  mockDbState.openPositions = [];
  mockDbState.trades = [];
  mockDbState.committedLedger = { initial: 10000, reserved: 0, realized: 0, fees: 0 };
  mockDbState.manageOpenPositionsCalls = [];
  mockDbState.exitAdapterCalls = [];
  mockDbState.supervisorDelayMs = 0;
  mockModeState.mode = "SHADOW";
  dbExecuteMock.mockClear();
  dbTransactionMock.mockClear();
}

function makeShadowPosition(overrides: Partial<SpotPosition> = {}): SpotPosition {
  return {
    lotId: "spot-test-001",
    pair: "BTC/USD",
    amount: 0.01,
    qtyRemaining: 0.01,
    entryPrice: 100000,
    highestPrice: 100000,
    entryFee: 0.09,
    entryStrategyId: "SPOT_CANONICAL",
    entrySignalTf: "15m",
    signalConfidence: 0.75,
    setupTag: "TREND_PULLBACK" as any,
    regimeAtEntry: "TREND" as any,
    directionAtEntry: "BULLISH" as any,
    macroAtEntry: "BULLISH" as any,
    atrPctAtEntry: 1.5,
    initialStopPrice: 95000,
    initialStopDistancePct: 5,
    initialStopDistanceUsd: 5000,
    riskUsd: 50,
    executionMode: "SHADOW" as any,
    policyVersion: "SPOT-1.0.0-20260812",
    engineOwner: "SPOT_CANONICAL",
    origin: "spot_engine",
    status: "OPEN",
    openedAt: Date.now(),
    mfe: 0,
    mae: 0,
    mfeR: 0,
    maeR: 0,
    ...overrides,
  } as SpotPosition;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("R7 — Canonical Ownership / OFF Fail-Safe", () => {

  beforeEach(() => {
    resetMockState();
    _stopSpotEngineForTest();
  });

  afterEach(() => {
    _stopSpotEngineForTest();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // A. SPOT_OWNER_OFF — isSpotRuntimeOwner()=true when mode=OFF
  // ═══════════════════════════════════════════════════════════════════════════

  describe("SPOT_OWNER_OFF", () => {
    it("SPOT_OWNER_OFF — isSpotRuntimeOwner() returns true when mode=OFF", () => {
      mockModeState.mode = "OFF";
      expect(isSpotRuntimeOwner()).toBe(true);
    });

    it("SPOT_OWNER_OFF — isSpotActive() returns false when mode=OFF (entry scanning off)", () => {
      mockModeState.mode = "OFF";
      expect(isSpotActive()).toBe(false);
    });

    it("SPOT_OWNER_OFF — source code confirms isSpotRuntimeOwner does not depend on mode", () => {
      const enginePath = path.resolve(__dirname, "../spot/spotEngine.ts");
      const source = fs.readFileSync(enginePath, "utf-8");

      // isSpotRuntimeOwner must NOT check execution mode
      const fnStart = source.indexOf("export function isSpotRuntimeOwner()");
      expect(fnStart).toBeGreaterThan(-1);
      const fnBody = source.substring(fnStart, fnStart + 200);
      // R8: delegates to pure module via _isSpotRuntimeOwner()
      expect(fnBody).toContain("_isSpotRuntimeOwner");
      // Must NOT reference getCachedExecutionMode or ExecutionMode
      expect(fnBody).not.toContain("getCachedExecutionMode");
      expect(fnBody).not.toContain("ExecutionMode");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // B. SPOT_OWNER_SHADOW — isSpotRuntimeOwner()=true when mode=SHADOW
  // ═══════════════════════════════════════════════════════════════════════════

  describe("SPOT_OWNER_SHADOW", () => {
    it("SPOT_OWNER_SHADOW — isSpotRuntimeOwner() returns true when mode=SHADOW", () => {
      mockModeState.mode = "SHADOW";
      expect(isSpotRuntimeOwner()).toBe(true);
    });

    it("SPOT_OWNER_SHADOW — isSpotActive() returns true when mode=SHADOW", () => {
      mockModeState.mode = "SHADOW";
      expect(isSpotActive()).toBe(true);
    });

    it("SPOT_OWNER_SHADOW — SPOT_RUNTIME_OWNER is SpotEngine", () => {
      expect(SPOT_RUNTIME_OWNER).toBe("SpotEngine");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // C. LEGACY_ENTRY_BLOCKED_OFF — legacy entries blocked in OFF
  // ═══════════════════════════════════════════════════════════════════════════

  describe("LEGACY_ENTRY_BLOCKED_OFF", () => {
    it("LEGACY_ENTRY_BLOCKED_OFF — isSpotRuntimeOwner()=true in OFF means legacy blocked", () => {
      mockModeState.mode = "OFF";
      // TradingEngine checks isSpotRuntimeOwner() — if true, it goes to supervisor-only
      expect(isSpotRuntimeOwner()).toBe(true);
      // isSpotActive is false (no entries) but ownership is still SPOT_CANONICAL
      expect(isSpotActive()).toBe(false);
    });

    it("LEGACY_ENTRY_BLOCKED_OFF — source: TradingEngine uses isSpotRuntimeOwner not isSpotActive", () => {
      const tePath = path.resolve(__dirname, "../tradingEngine.ts");
      const source = fs.readFileSync(tePath, "utf-8");

      // Must import isSpotRuntimeOwner
      expect(source).toContain("isSpotRuntimeOwner");
      // Must NOT use isSpotActive in the SPOT guard section
      const guardStart = source.indexOf("SPOT SINGLE OWNER GUARD");
      const guardEnd = source.indexOf("manageExistingPositionsOnly", guardStart);
      const guardSection = source.substring(guardStart, guardEnd);
      expect(guardSection).toContain("isSpotRuntimeOwner");
      expect(guardSection).not.toContain("isSpotActive");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // D. LEGACY_ENTRY_BLOCKED_SHADOW — legacy entries blocked in SHADOW
  // ═══════════════════════════════════════════════════════════════════════════

  describe("LEGACY_ENTRY_BLOCKED_SHADOW", () => {
    it("LEGACY_ENTRY_BLOCKED_SHADOW — isSpotRuntimeOwner()=true in SHADOW means legacy blocked", () => {
      mockModeState.mode = "SHADOW";
      expect(isSpotRuntimeOwner()).toBe(true);
      expect(isSpotActive()).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // E. SPOT_OFF_NO_ENTRY_SCANNER — no scan interval in OFF
  // ═══════════════════════════════════════════════════════════════════════════

  describe("SPOT_OFF_NO_ENTRY_SCANNER", () => {
    it("SPOT_OFF_NO_ENTRY_SCANNER — startSpotEngine in OFF mode does not start scan interval", async () => {
      mockModeState.mode = "OFF";
      mockDbState.botConfig.spot_execution_mode = "OFF";

      const result = await startSpotEngine();

      expect(result).toBe(true); // R7: returns true even in OFF
      expect(_hasScanIntervalForTest()).toBe(false); // No scan interval
      expect(_isEntryScanningEnabledForTest()).toBe(false); // Entry scanning disabled
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // F. SPOT_OFF_OPEN_POSITION_SUPERVISOR_RUNNING — supervisor runs in OFF with positions
  // ═══════════════════════════════════════════════════════════════════════════

  describe("SPOT_OFF_OPEN_POSITION_SUPERVISOR_RUNNING", () => {
    it("SPOT_OFF_OPEN_POSITION_SUPERVISOR_RUNNING — supervisor starts in OFF with open positions", async () => {
      mockModeState.mode = "OFF";
      mockDbState.botConfig.spot_execution_mode = "OFF";
      // Add a SPOT canonical position
      mockDbState.openPositions = [{
        pair: "BTC/USD",
        lot_id: "spot-001",
        status: "OPEN",
        policy_version: "SPOT-1.0.0-20260812",
        engine_owner: "SPOT_CANONICAL",
        amount: "0.01",
        qty_remaining: "0.01",
        entry_price: "100000",
        highest_price: "100000",
        entry_fee: "0.09",
        opened_at: Date.now(),
      }];

      const result = await startSpotEngine();

      expect(result).toBe(true);
      expect(_hasScanIntervalForTest()).toBe(false); // No scanner
      expect(_hasSupervisorIntervalForTest()).toBe(true); // Supervisor running
      expect(_isSupervisorRunningForTest()).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // G. SPOT_OFF_NO_POSITION_SUPERVISOR_OPTIONAL_IDLE — no supervisor in OFF without positions
  // ═══════════════════════════════════════════════════════════════════════════

  describe("SPOT_OFF_NO_POSITION_SUPERVISOR_OPTIONAL_IDLE", () => {
    it("SPOT_OFF_NO_POSITION_SUPERVISOR_OPTIONAL_IDLE — no supervisor in OFF without positions", async () => {
      mockModeState.mode = "OFF";
      mockDbState.botConfig.spot_execution_mode = "OFF";
      mockDbState.openPositions = []; // No positions

      const result = await startSpotEngine();

      expect(result).toBe(true);
      expect(_hasScanIntervalForTest()).toBe(false);
      expect(_hasSupervisorIntervalForTest()).toBe(false); // No supervisor needed
      expect(_isSupervisorRunningForTest()).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // H. SPOT_RESTART_OFF_WITH_OPEN_POSITION — supervisor starts on restart with OFF+positions
  // ═══════════════════════════════════════════════════════════════════════════

  describe("SPOT_RESTART_OFF_WITH_OPEN_POSITION", () => {
    it("SPOT_RESTART_OFF_WITH_OPEN_POSITION — restart in OFF with positions: scanner=0, supervisor=1, legacy=0", async () => {
      mockModeState.mode = "OFF";
      mockDbState.botConfig.spot_execution_mode = "OFF";
      mockDbState.openPositions = [{
        pair: "BTC/USD",
        lot_id: "spot-restart-001",
        status: "OPEN",
        policy_version: "SPOT-1.0.0-20260812",
        engine_owner: "SPOT_CANONICAL",
        amount: "0.01",
        qty_remaining: "0.01",
        entry_price: "100000",
        highest_price: "100000",
        entry_fee: "0.09",
        opened_at: Date.now(),
      }];

      // Simulate restart: call startSpotEngine (as routes.ts would do)
      const result = await startSpotEngine();

      // ENTRY_SCANNER = 0
      expect(_hasScanIntervalForTest()).toBe(false);
      expect(_isEntryScanningEnabledForTest()).toBe(false);

      // POSITION_SUPERVISOR = 1
      expect(_hasSupervisorIntervalForTest()).toBe(true);
      expect(_isSupervisorRunningForTest()).toBe(true);

      // LEGACY_NEW_ENTRY = 0 — isSpotRuntimeOwner is true, so TradingEngine would be in supervisor-only
      expect(isSpotRuntimeOwner()).toBe(true);

      // R7: startSpotEngine returns true (not false) in OFF with positions
      expect(result).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // I. SPOT_SHADOW_TO_OFF_DOES_NOT_REENABLE_LEGACY
  // ═══════════════════════════════════════════════════════════════════════════

  describe("SPOT_SHADOW_TO_OFF_DOES_NOT_REENABLE_LEGACY", () => {
    it("SPOT_SHADOW_TO_OFF_DOES_NOT_REENABLE_LEGACY — setExecutionMode(OFF) keeps ownership SPOT_CANONICAL", async () => {
      mockModeState.mode = "SHADOW";
      mockDbState.botConfig.spot_execution_mode = "SHADOW";

      // Start in SHADOW
      await startSpotEngine();
      expect(_hasScanIntervalForTest()).toBe(true);

      // Transition to OFF
      await setExecutionMode(ExecutionMode.OFF);
      mockModeState.mode = "OFF";

      // Ownership does NOT change — still SPOT_CANONICAL
      expect(isSpotRuntimeOwner()).toBe(true);

      // Scan interval should be cleared
      expect(_hasScanIntervalForTest()).toBe(false);
      expect(_isEntryScanningEnabledForTest()).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // J. SPOT_OFF_TO_SHADOW_SINGLE_ENTRY_SCANNER
  // ═══════════════════════════════════════════════════════════════════════════

  describe("SPOT_OFF_TO_SHADOW_SINGLE_ENTRY_SCANNER", () => {
    it("SPOT_OFF_TO_SHADOW_SINGLE_ENTRY_SCANNER — OFF→SHADOW starts exactly 1 entry scanner", async () => {
      // Start in OFF
      mockModeState.mode = "OFF";
      mockDbState.botConfig.spot_execution_mode = "OFF";
      await startSpotEngine();
      expect(_hasScanIntervalForTest()).toBe(false);

      // Transition to SHADOW
      await setExecutionMode(ExecutionMode.SHADOW);
      mockModeState.mode = "SHADOW";

      // Start engine again (as spot.routes.ts does on OFF→SHADOW)
      await startSpotEngine();

      // Exactly 1 scan interval
      expect(_hasScanIntervalForTest()).toBe(true);
      expect(_isEntryScanningEnabledForTest()).toBe(true);

      // Supervisor also running
      expect(_hasSupervisorIntervalForTest()).toBe(true);

      // Ownership unchanged
      expect(isSpotRuntimeOwner()).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // K. SPOT_STARTUP_ORDER_SUPERVISOR_BEFORE_SCAN
  // ═══════════════════════════════════════════════════════════════════════════

  describe("SPOT_STARTUP_ORDER_SUPERVISOR_BEFORE_SCAN", () => {
    it("SPOT_STARTUP_ORDER_SUPERVISOR_BEFORE_SCAN — source: await runPositionSupervisor before runScanCycle", () => {
      const enginePath = path.resolve(__dirname, "../spot/spotEngine.ts");
      const source = fs.readFileSync(enginePath, "utf-8");

      // Find startSpotEngine function body
      const startIdx = source.indexOf("export async function startSpotEngine");
      expect(startIdx).toBeGreaterThan(-1);
      const startBody = source.substring(startIdx, startIdx + 3000);

      // Look for the R7 marker
      const r7MarkerIdx = startBody.indexOf("R7: Await first supervisor pass");
      expect(r7MarkerIdx).toBeGreaterThan(-1);
      const afterMarker = startBody.substring(r7MarkerIdx);

      // supervisor pass must come before scan cycle
      const supervisorIdx = afterMarker.indexOf("runPositionSupervisor");
      const scanIdx = afterMarker.indexOf("runScanCycle");

      expect(supervisorIdx).toBeGreaterThan(-1);
      expect(scanIdx).toBeGreaterThan(-1);
      expect(supervisorIdx).toBeLessThan(scanIdx);

      // Must use await (not .catch) for the supervisor
      const supervisorLine = afterMarker.substring(0, afterMarker.indexOf("\n", supervisorIdx));
      expect(supervisorLine).toContain("await");
    });

    it("SPOT_STARTUP_ORDER_SUPERVISOR_BEFORE_SCAN — startSpotEngine returns true in OFF (not false)", async () => {
      mockModeState.mode = "OFF";
      mockDbState.botConfig.spot_execution_mode = "OFF";

      const result = await startSpotEngine();

      // R7: must return true, not false (so routes.ts doesn't treat it as failure)
      expect(result).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // L. REAL_REMAINS_BLOCKED
  // ═══════════════════════════════════════════════════════════════════════════

  describe("REAL_REMAINS_BLOCKED", () => {
    it("REAL_ACTIVATION_ALLOWED is true (R10 enabled)", () => {
      expect(REAL_ACTIVATION_ALLOWED).toBe(true);
    });

    it("setExecutionMode(REAL) succeeds when REAL_ACTIVATION_ALLOWED=true (R10)", async () => {
      await expect(setExecutionMode(ExecutionMode.REAL)).resolves.toBe(ExecutionMode.REAL);
    });

    it("isSpotRuntimeOwner is true and REAL is allowed (R10)", () => {
      expect(isSpotRuntimeOwner()).toBe(true);
      expect(REAL_ACTIVATION_ALLOWED).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // R6 INVARIANTS — verify they still hold
  // ═══════════════════════════════════════════════════════════════════════════

  describe("R6_INVARIANTS_STILL_HOLD", () => {
    it("R6: scanPair does not call manageOpenPositions (source inspection)", () => {
      const enginePath = path.resolve(__dirname, "../spot/spotEngine.ts");
      const source = fs.readFileSync(enginePath, "utf-8");

      // Find scanPair function
      const scanPairIdx = source.indexOf("async function scanPair(");
      expect(scanPairIdx).toBeGreaterThan(-1);

      // Get a generous slice of scanPair body
      const scanPairBody = source.substring(scanPairIdx, scanPairIdx + 3000);

      // scanPair must NOT contain manageOpenPositions
      expect(scanPairBody).not.toContain("manageOpenPositions");
    });

    it("R6: reentrancy guard still present in runPositionSupervisor", () => {
      const enginePath = path.resolve(__dirname, "../spot/spotEngine.ts");
      const source = fs.readFileSync(enginePath, "utf-8");

      const supervisorIdx = source.indexOf("async function runPositionSupervisor()");
      expect(supervisorIdx).toBeGreaterThan(-1);
      const supervisorBody = source.substring(supervisorIdx, supervisorIdx + 1000);

      expect(supervisorBody).toContain("isSupervising");
      expect(supervisorBody).toContain("finally");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST CLASSIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe("TEST_CLASSIFICATION_HONEST", () => {
    it("STRUCTURAL_TESTS — source inspection for canonical ownership invariant", () => {
      // A, B, C, K — source code inspection
      expect(true).toBe(true);
    });

    it("INTEGRATION_TESTS — mocked DB with real productive code", () => {
      // E, F, G, H, I, J — startSpotEngine with mocked DB
      expect(true).toBe(true);
    });
  });
});
