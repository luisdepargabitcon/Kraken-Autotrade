/**
 * R9.1 — Functional tests for legacy exit provenance
 *
 * These tests instantiate a real TradingEngine and call executeTrade
 * with mocked exchange adapter to verify:
 *   - DRY position stays DRY even when global dryRunMode=false
 *   - REAL position stays REAL even when global dryRunMode=true
 *   - Unknown provenance always fails closed (both dryRunMode=true and false)
 *
 * Evidence: placeOrderMock call count + db.insert call count
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { placeOrderMock, dbInsertMock, dbUpdateMock, dbSelectMock, botLoggerErrorMock } = vi.hoisted(() => {
  const placeOrder = vi.fn(async () => ({ success: true, txid: "MOCK-REAL-TXID" }));
  const insert = vi.fn(async () => ({ rows: [{ id: 9999 }] }));
  const update = vi.fn(async () => ({ rows: [] }));
  const select = vi.fn(async () => ({ rows: [] }));
  const errorMock = vi.fn(async () => {});
  return { placeOrderMock: placeOrder, dbInsertMock: insert, dbUpdateMock: update, dbSelectMock: select, botLoggerErrorMock: errorMock };
});

// Mock IExchangeService
const mockExchange = {
  isInitialized: () => true,
  placeOrder: placeOrderMock,
  getBalance: vi.fn(async () => ({ USD: 100000, ZUSD: 100000 })),
  getStepSize: vi.fn(() => 0.0001),
  getOrderMin: vi.fn(() => 0.01),
  hasMetadata: vi.fn(() => true),
  loadPairMetadata: vi.fn(async () => {}),
  getTicker: vi.fn(async () => ({ last: 100, bid: 99, ask: 101 })),
  getOHLC: vi.fn(async () => []),
  takerFeePct: 0.4,
  makerFeePct: 0.25,
};

// Mock ExchangeFactory
vi.mock("../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {
    getTradingExchange: () => mockExchange,
    getDataExchange: () => mockExchange,
    getTradingExchangeType: () => "kraken",
    getDataExchangeType: () => "kraken",
    getTradingExchangeFees: () => ({ takerFeePct: 0.4, makerFeePct: 0.25 }),
  },
  ExchangeType: "kraken",
}));

// Mock db
const makeChain = (finalResult: any) => {
  const limitFn = vi.fn(async () => finalResult);
  const orderByFn = vi.fn(() => ({ limit: limitFn }));
  const whereFn = vi.fn(() => ({ limit: limitFn, orderBy: orderByFn }));
  const fromFn = vi.fn(() => ({ where: whereFn }));
  return { fromFn, whereFn, orderByFn, limitFn };
};

vi.mock("../../db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(async () => {
        dbInsertMock();
        return { rows: [{ id: 9999 }] };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => {
          dbUpdateMock();
          return { rows: [] };
        }),
      })),
    })),
    select: vi.fn(() => {
      const chain = makeChain([]);
      return { from: chain.fromFn };
    }),
  },
  eq: (a: any, b: any) => ({ type: "eq", a, b }),
  and: (...args: any[]) => ({ type: "and", args }),
  lt: (a: any, b: any) => ({ type: "lt", a, b }),
  desc: (a: any) => ({ type: "desc", a }),
}));

// Mock storage
vi.mock("../storage", () => ({
  storage: {
    getBotConfig: vi.fn(async () => ({
      is_active: true,
      dry_run_mode: false,
      stop_loss_percent: "5",
      take_profit_percent: "7",
      trailing_stop_enabled: false,
      trailing_stop_percent: "2",
      position_mode: "SMART_GUARD",
      active_pairs: ["BTC/USD"],
      strategy: "momentum_cycle",
      sgMinEntryUsd: "100",
      sgAllowUnderMin: true,
    })),
    getOpenPositions: vi.fn(async () => []),
    saveOpenPositionByLotId: vi.fn(async () => {}),
    deleteOpenPositionByLotId: vi.fn(async () => {}),
    updatePositionHighestPriceByLotId: vi.fn(async () => {}),
    createOrderIntent: vi.fn(async () => {}),
    updateOrderIntentStatus: vi.fn(async () => {}),
    getPendingFillPositions: vi.fn(async () => []),
  },
}));

// Mock schema
vi.mock("@shared/schema", () => ({
  dryRunTrades: {
    id: "id", simTxid: "simTxid", pair: "pair", type: "type", price: "price",
    amount: "amount", totalUsd: "totalUsd", reason: "reason", status: "status",
    entrySimTxid: "entrySimTxid", entryPrice: "entryPrice", realizedPnlUsd: "realizedPnlUsd",
    realizedPnlPct: "realizedPnlPct", closedAt: "closedAt", strategyId: "strategyId",
    regime: "regime", confidence: "confidence", createdAt: "createdAt",
    normalizedReason: "normalizedReason",
  },
  InsertTrade: {},
  Trade: {},
}));

// Mock botLogger
vi.mock("../botLogger", () => ({
  botLogger: {
    info: vi.fn(async () => {}),
    warn: vi.fn(async () => {}),
    error: vi.fn(async (...args: any[]) => { botLoggerErrorMock(...args); }),
    debug: vi.fn(async () => {}),
  },
}));

// Mock other heavy deps
vi.mock("../utils/logger", () => ({ log: vi.fn() }));
vi.mock("./environment", () => ({
  environment: {
    envTag: "TEST",
    isReplit: false,
    isStaging: false,
    isProduction: false,
  },
}));
vi.mock("./kraken", () => ({
  KrakenService: vi.fn().mockImplementation(() => ({
    isInitialized: () => true,
    getBalance: vi.fn(async () => ({ USD: 100000 })),
  })),
  krakenService: { isInitialized: () => true, getBalance: vi.fn(async () => ({})) },
}));
vi.mock("./telegram", () => ({
  TelegramService: vi.fn().mockImplementation(() => ({
    isInitialized: () => false,
    sendAlertWithSubtype: vi.fn(async () => {}),
    sendBuyExecutedSnapshot: vi.fn(async () => {}),
  })),
}));
vi.mock("./aiService", () => ({
  aiService: { analyze: vi.fn(async () => null) },
  AiFeatures: {},
}));
vi.mock("./fifoMatcher", () => ({ fifoMatcher: { match: vi.fn(() => null) } }));
vi.mock("./MarketDataService", () => ({
  MarketDataService: vi.fn().mockImplementation(() => ({
    getOHLC: vi.fn(async () => []),
    getCurrentPrice: vi.fn(async () => 100),
  })),
}));
vi.mock("./ConfigService", () => ({
  configService: {
    getConfig: vi.fn(async () => ({ global: { dryRunMode: false } })),
    updateConfig: vi.fn(async () => {}),
    on: vi.fn(),
  },
}));
vi.mock("./signalAccumulator", () => ({
  signalAccumulator: { add: vi.fn(), clear: vi.fn(), get: vi.fn(() => []) },
  ACCUMULATOR_THRESHOLD: 2,
}));
vi.mock("./ErrorAlertService", () => ({
  errorAlertService: { sendCriticalError: vi.fn(async () => {}) },
  ErrorAlertService: vi.fn(),
}));
vi.mock("./MarkupTracker", () => ({ markupTracker: { track: vi.fn(), get: vi.fn(() => null) } }));
vi.mock("./SmartExitEngine", () => ({
  smartExitEngine: { evaluate: vi.fn(async () => null) },
}));
vi.mock("./SmartExitStateManager", () => ({
  smartExitStateManager: { transition: vi.fn() },
}));
vi.mock("./capitalEfficiencyGate", () => ({
  checkCapitalEfficiencyGate: vi.fn(() => ({ allowed: true, message: "", reason: "", meta: {} })),
}));
vi.mock("./indicators", () => ({
  calculateEMA: vi.fn(), calculateRSI: vi.fn(), calculateVolatility: vi.fn(),
  calculateMACD: vi.fn(), calculateBollingerBands: vi.fn(), calculateATR: vi.fn(),
  calculateATRPercent: vi.fn(), detectAbnormalVolume: vi.fn(), wilderSmooth: vi.fn(),
  calculateADX: vi.fn(),
}));
vi.mock("./regimeDetection", () => ({
  detectMarketRegime: vi.fn(() => "TRENDING"),
  getRegimeAdjustedParams: vi.fn(() => ({})),
  calculateAtrBasedExits: vi.fn(() => ({})),
  shouldPauseEntriesDueToRegime: vi.fn(() => false),
  REGIME_PRESETS: {},
  REGIME_CONFIG: { ADX_TREND_ENTRY: 20, ADX_TREND_EXIT: 15, ADX_HARD_EXIT: 10, CONFIRM_SCANS_REQUIRED: 1, MIN_HOLD_MINUTES: 0, NOTIFY_COOLDOWN_MS: 60000 },
}));
vi.mock("./regimeManager", () => ({
  RegimeManager: vi.fn().mockImplementation(() => ({ getRegime: vi.fn(() => "TRENDING") })),
}));
vi.mock("./spreadFilter", () => ({
  SpreadFilter: vi.fn().mockImplementation(() => ({ check: vi.fn(() => true) })),
}));
vi.mock("./MtfAnalyzer", () => ({
  MtfAnalyzer: vi.fn().mockImplementation(() => ({ analyze: vi.fn(() => null) })),
  analyzeTimeframeTrend: vi.fn(), analyzeMultiTimeframe: vi.fn(),
}));
vi.mock("./exitManager", () => ({
  ExitManager: vi.fn().mockImplementation(() => ({
    recordSellAttempt: vi.fn(), checkExits: vi.fn(async () => {}),
  })),
}));
vi.mock("../utils/exitReasonClassifier", () => ({ classifyExitReason: vi.fn(() => "TEST") }));
vi.mock("../utils/confidence", () => ({
  toConfidencePct: vi.fn((x: number) => x),
  toConfidenceUnit: vi.fn((x: any) => x),
}));
vi.mock("../utils/tradeId", () => ({ buildTradeId: vi.fn(() => "MOCK-ID") }));
vi.mock("../utils/krakenRateLimiter", () => ({
  krakenRateLimiter: { acquire: vi.fn(async () => () => {}), getStats: vi.fn(() => ({})) },
}));
vi.mock("./spot/spotOwnership", () => ({
  isSpotRuntimeOwner: vi.fn(() => true),
  SPOT_CANONICAL_OWNS_ENTRIES: true,
}));
vi.mock("./spot/spotTypes", () => ({
  REAL_ACTIVATION_ALLOWED: false,
  SPOT_MODE: { OFF: "OFF", SHADOW: "SHADOW", REAL: "REAL" },
}));
vi.mock("@shared/config-schema", () => ({
  defaultFeatureFlags: {},
  TradingConfig: {},
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import { TradingEngine } from "../tradingEngine";

// ─── Helper ──────────────────────────────────────────────────────────────────

function createEngine(): any {
  const krakenMock = { isInitialized: () => true, getBalance: vi.fn(async () => ({})) } as any;
  const telegramMock = { isInitialized: () => false, sendAlertWithSubtype: vi.fn(async () => {}) } as any;
  return new TradingEngine(krakenMock, telegramMock) as any;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("R9.1 — Functional: Legacy exit provenance is sole source for SELL", () => {
  let engine: any;

  beforeEach(() => {
    placeOrderMock.mockClear();
    dbInsertMock.mockClear();
    dbUpdateMock.mockClear();
    dbSelectMock.mockClear();
    botLoggerErrorMock.mockClear();
    engine = createEngine();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DRY_POSITION_STAYS_DRY_AFTER_GLOBAL_MODE_CHANGE
  // ═══════════════════════════════════════════════════════════════════════════

  describe("DRY_POSITION_STAYS_DRY_AFTER_GLOBAL_MODE_CHANGE", () => {
    it("D1: DRY_RUN position + global dryRunMode=false → simulation, placeOrder=0", async () => {
      // Set global mode to LIVE (not dry run)
      engine.dryRunMode = false;

      const sellContext = {
        entryPrice: 100,
        lotId: "DRY-TEST-001",
        executionProvenance: "DRY_RUN" as const,
      };

      const result = await engine.executeTrade(
        "BTC/USD", "sell", "0.001", 110, "take_profit", undefined, undefined, undefined, sellContext
      );

      expect(result).toBe(true); // simulation succeeds
      expect(placeOrderMock).toHaveBeenCalledTimes(0); // NO real order
      // db.insert should have been called for the simulated sell record
      expect(dbInsertMock).toHaveBeenCalledTimes(1);
    });

    it("D2: DRY_RUN position + global dryRunMode=true → simulation, placeOrder=0", async () => {
      engine.dryRunMode = true;

      const sellContext = {
        entryPrice: 100,
        lotId: "DRY-TEST-002",
        executionProvenance: "DRY_RUN" as const,
      };

      const result = await engine.executeTrade(
        "BTC/USD", "sell", "0.001", 110, "take_profit", undefined, undefined, undefined, sellContext
      );

      expect(result).toBe(true);
      expect(placeOrderMock).toHaveBeenCalledTimes(0);
      expect(dbInsertMock).toHaveBeenCalledTimes(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // REAL_POSITION_STAYS_REAL_AFTER_GLOBAL_MODE_CHANGE
  // ═══════════════════════════════════════════════════════════════════════════

  describe("REAL_POSITION_STAYS_REAL_AFTER_GLOBAL_MODE_CHANGE", () => {
    it("R1: REAL position + global dryRunMode=true → real order path, placeOrder=1", async () => {
      // Set global mode to DRY (simulating user toggled to dry after having real positions)
      engine.dryRunMode = true;

      const sellContext = {
        entryPrice: 100,
        lotId: "REAL-TEST-001",
        executionProvenance: "REAL" as const,
      };

      const result = await engine.executeTrade(
        "BTC/USD", "sell", "0.001", 110, "take_profit", undefined, undefined, undefined, sellContext
      );

      // Should reach placeOrder (real path) despite dryRunMode=true
      expect(placeOrderMock).toHaveBeenCalledTimes(1);
      // Should NOT have simulated a dry run sell
      expect(dbInsertMock).toHaveBeenCalledTimes(0);
    });

    it("R2: REAL position + global dryRunMode=false → real order path, placeOrder=1", async () => {
      engine.dryRunMode = false;

      const sellContext = {
        entryPrice: 100,
        lotId: "REAL-TEST-002",
        executionProvenance: "REAL" as const,
      };

      const result = await engine.executeTrade(
        "BTC/USD", "sell", "0.001", 110, "take_profit", undefined, undefined, undefined, sellContext
      );

      expect(placeOrderMock).toHaveBeenCalledTimes(1);
      expect(dbInsertMock).toHaveBeenCalledTimes(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // UNKNOWN_PROVENANCE_ALWAYS_FAILS_CLOSED
  // ═══════════════════════════════════════════════════════════════════════════

  describe("UNKNOWN_PROVENANCE_ALWAYS_FAILS_CLOSED", () => {
    it("U1: Unknown provenance + global dryRunMode=false → BLOCK, placeOrder=0", async () => {
      engine.dryRunMode = false;

      const sellContext = {
        entryPrice: 100,
        lotId: "UNKNOWN-TEST-001",
        // executionProvenance deliberately omitted
      };

      const result = await engine.executeTrade(
        "BTC/USD", "sell", "0.001", 110, "take_profit", undefined, undefined, undefined, sellContext
      );

      expect(result).toBe(false); // blocked
      expect(placeOrderMock).toHaveBeenCalledTimes(0); // no real order
      expect(dbInsertMock).toHaveBeenCalledTimes(0); // no simulated sell
      expect(botLoggerErrorMock).toHaveBeenCalledTimes(1); // CRITICAL logged
    });

    it("U2: Unknown provenance + global dryRunMode=true → BLOCK, placeOrder=0", async () => {
      engine.dryRunMode = true;

      const sellContext = {
        entryPrice: 100,
        lotId: "UNKNOWN-TEST-002",
        // executionProvenance deliberately omitted
      };

      const result = await engine.executeTrade(
        "BTC/USD", "sell", "0.001", 110, "take_profit", undefined, undefined, undefined, sellContext
      );

      expect(result).toBe(false); // blocked
      expect(placeOrderMock).toHaveBeenCalledTimes(0);
      expect(dbInsertMock).toHaveBeenCalledTimes(0);
      expect(botLoggerErrorMock).toHaveBeenCalledTimes(1);
    });

    it("U3: Undefined sellContext + SELL → BLOCK, placeOrder=0", async () => {
      engine.dryRunMode = false;

      const result = await engine.executeTrade(
        "BTC/USD", "sell", "0.001", 110, "stop-loss-emergency", undefined, undefined, undefined, undefined
      );

      // With no sellContext at all, provenance is undefined → fail-closed
      // However, emergency exits without sellContext are allowed to proceed
      // to the real path (line 6694-6710). So this might reach placeOrder.
      // The R9.1 check happens BEFORE the emergency exit check.
      // Let's verify: provenance is undefined → should fail-closed
      expect(result).toBe(false);
      expect(placeOrderMock).toHaveBeenCalledTimes(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT: SELL_EXECUTION_PATH_SOURCE = POSITION_PROVENANCE_ONLY
  // ═══════════════════════════════════════════════════════════════════════════

  describe("SELL_EXECUTION_PATH_SOURCE_INVARIANTS", () => {
    it("I1: DRY_RUN provenance is sole determinant — global mode does not override", async () => {
      // Test both global modes with DRY_RUN provenance
      for (const globalMode of [true, false]) {
        engine.dryRunMode = globalMode;
        placeOrderMock.mockClear();
        dbInsertMock.mockClear();

        const result = await engine.executeTrade(
          "BTC/USD", "sell", "0.001", 110, "take_profit", undefined, undefined, undefined,
          { entryPrice: 100, lotId: "DRY-INV", executionProvenance: "DRY_RUN" as const }
        );

        expect(result).toBe(true);
        expect(placeOrderMock).toHaveBeenCalledTimes(0);
        expect(dbInsertMock).toHaveBeenCalledTimes(1);
      }
    });

    it("I2: REAL provenance is sole determinant — global mode does not override", async () => {
      for (const globalMode of [true, false]) {
        engine.dryRunMode = globalMode;
        placeOrderMock.mockClear();
        dbInsertMock.mockClear();

        const result = await engine.executeTrade(
          "BTC/USD", "sell", "0.001", 110, "take_profit", undefined, undefined, undefined,
          { entryPrice: 100, lotId: "REAL-INV", executionProvenance: "REAL" as const }
        );

        expect(placeOrderMock).toHaveBeenCalledTimes(1);
        expect(dbInsertMock).toHaveBeenCalledTimes(0);
      }
    });
  });
});
