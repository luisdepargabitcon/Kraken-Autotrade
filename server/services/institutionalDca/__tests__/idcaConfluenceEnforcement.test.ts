import { beforeEach, describe, expect, it, vi } from "vitest";

const repoMock = vi.hoisted(() => ({
  createEvent: vi.fn(async () => ({})),
  createOrder: vi.fn(async () => ({})),
  updateCycle: vi.fn(async () => undefined),
  getActiveBotCycle: vi.fn(async () => null),
  getAllActiveBotCycles: vi.fn(async () => []),
  getSimulationWallet: vi.fn(async () => ({ availableBalanceUsd: "1000", usedBalanceUsd: "0" })),
  updateSimulationWallet: vi.fn(async () => undefined),
  getCycleById: vi.fn(async () => null),
}));

const exitRepoMock = vi.hoisted(() => ({
  hasPendingExitInstruction: vi.fn(async () => false),
}));

const confluenceMock = vi.hoisted(() => ({
  evaluateIdcaEntryConfluence: vi.fn(),
  logIdcaConfluence: vi.fn(),
}));

vi.mock("../IdcaRepository", () => repoMock);
vi.mock("../IdcaExitInstructionRepository", () => exitRepoMock);
vi.mock("../IdcaConfluenceEngine", () => confluenceMock);
vi.mock("../IdcaTelegramNotifier", () => ({
  alertBuyBlocked: vi.fn(async () => undefined),
  alertApproachingBuy: vi.fn(async () => undefined),
  alertOrderFailed: vi.fn(async () => undefined),
  alertSafetyBuy: vi.fn(async () => undefined),
  getNearZoneThresholdPct: vi.fn(() => 1),
}));
vi.mock("../../MarketDataService", () => ({
  MarketDataService: {
    getCandleSeries: vi.fn(),
    getPrice: vi.fn(async () => 0),
    getCandles: vi.fn(async () => []),
  },
}));
vi.mock("../../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {
    getTradingExchange: vi.fn(() => ({ placeOrder: vi.fn(), createOrder: vi.fn() })),
    getDataExchange: vi.fn(() => ({ isInitialized: () => false })),
    getDataExchangeType: vi.fn(() => "kraken"),
  },
}));

import {
  __clearIdcaOhlcCacheForTest,
  __setIdcaOhlcCacheForTest,
  checkSafetyBuyForTest,
  performEntryCheckForTest,
} from "../IdcaEngine";
import { MarketDataService } from "../../MarketDataService";
import { TrailingBuyManager } from "../TrailingBuyManager";

const HOUR_MS = 3_600_000;
const NOW = 1_699_999_200_000;

function makeCandles() {
  const start = NOW - 120 * HOUR_MS;
  const candles = Array.from({ length: 120 }, (_, i) => ({
    time: start + i * HOUR_MS,
    open: 110,
    high: 111,
    low: 109,
    close: 110,
    volume: 10,
  }));
  Object.assign(candles[117], { open: 100, high: 100.2, low: 99.8, close: 100 });
  Object.assign(candles[118], { open: 100.5, high: 101.2, low: 99.8, close: 101 });
  Object.assign(candles[119], { open: 100, high: 103, low: 98.5, close: 102 });
  return candles;
}

function mockHealthySeries(candles: ReturnType<typeof makeCandles>) {
  const healthCandles = candles.map(candle => ({
    openTime: candle.time,
    closeTime: candle.time + HOUR_MS,
    isClosed: candle.time + HOUR_MS <= NOW,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  })).filter(candle => candle.isClosed);
  vi.mocked(MarketDataService.getCandleSeries).mockResolvedValue({
    candles: healthCandles,
    gaps: 0,
    source: "kraken",
    origin: "live",
    quality: { validity: "valid", ageMs: 0, missing: [] },
  } as any);
}

function baseConfig(entryPolicy?: unknown): any {
  return {
    allocatedCapitalUsd: "1000",
    maxModuleExposurePct: "90",
    maxAssetExposurePct: "90",
    localHighLookbackMinutes: 720,
    smartModeEnabled: true,
    adaptivePositionSizingEnabled: false,
    marketScoreWeightsJson: {
      ema20_distance: 15, ema50_distance: 10, ema20_slope: 10, ema50_slope: 10,
      rsi: 15, relative_volume: 10, drawdown_from_high: 20, btc_condition: 10,
    },
    idcaDynamicAnchorEnabled: false,
    btcMarketGateForEthEnabled: false,
    adaptiveTpEnabled: false,
    volatilityTrailingEnabled: false,
    simulationFeePct: "0.1",
    simulationSlippagePct: "0",
    entryUiJson: entryPolicy === undefined ? {} : { entryPolicy },
  };
}

function enforcedConfig(): any {
  return baseConfig({ version: "v2_candidate", confluenceEnforcement: "enforced" });
}

function assetConfig(): any {
  return {
    enabled: true,
    dipReference: "hybrid",
    vwapEnabled: false,
    minDipPct: "1",
    entryMode: "assisted_entry",
    requireReboundConfirmation: false,
    reboundMinPct: "0.30",
    dynamicDistanceConfigJson: null,
    takeProfitPct: "2",
    trailingMarginPct: "1",
  };
}

function confluenceResult(decisionClass: string, overrides: Record<string, unknown> = {}): any {
  return {
    decisionClass,
    confidenceScore: 65,
    confidenceGrade: "C",
    marketRegime: "neutral_range",
    hardBlocked: false,
    hardBlockers: [],
    degradingBlockers: [],
    canArmTrailingBuy: true,
    finalRequiredDistancePct: 4.2,
    smartAdjustmentPct: 0,
    ...overrides,
  };
}

async function runEntry(config: any, price = 102) {
  return performEntryCheckForTest("BTC/USD", price, config, assetConfig(), "simulation");
}

describe("confluence enforcement IDCA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    TrailingBuyManager.clearAll();
    __clearIdcaOhlcCacheForTest();
    const candles = makeCandles();
    __setIdcaOhlcCacheForTest("BTC/USD", candles);
    mockHealthySeries(candles);
    repoMock.getActiveBotCycle.mockResolvedValue(null);
    repoMock.getAllActiveBotCycles.mockResolvedValue([]);
    repoMock.getSimulationWallet.mockResolvedValue({ availableBalanceUsd: "1000" });
    exitRepoMock.hasPendingExitInstruction.mockResolvedValue(false);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it.each([
    "WATCH",
    "ARM_TRAILING",
    "NORMAL_ENTRY",
    "HIGH_CONFIDENCE_ENTRY",
    "DEFENSIVE_SAFETY_BUY",
  ] as const)("diagnostic no añade bloqueo para %s", async decisionClass => {
    confluenceMock.evaluateIdcaEntryConfluence.mockReturnValue(confluenceResult(decisionClass));
    const result = await runEntry(baseConfig());
    expect(result.confluenceEnforcement).toBe("diagnostic");
    expect(result.confluenceDecisionClass).toBe(decisionClass);
    expect(result.blockReasons.some(block => block.code.startsWith("confluence_"))).toBe(false);
    expect(result.allowed).toBe(true);
    expect(TrailingBuyManager.isArmed("BTC/USD")).toBe(false);
  });

  it.each([
    ["WATCH", "confluence_watch"],
    ["DEFENSIVE_SAFETY_BUY", "confluence_watch"],
    ["ARM_TRAILING", "confluence_arm_trailing"],
  ] as const)("enforced simulation bloquea %s con %s", async (decisionClass, code) => {
    confluenceMock.evaluateIdcaEntryConfluence.mockReturnValue(confluenceResult(decisionClass));
    const result = await runEntry(enforcedConfig());
    expect(result.confluenceEnforcement).toBe("enforced");
    expect(result.allowed).toBe(false);
    expect(result.blockReasons.some(block => block.code === code)).toBe(true);
  });

  it("enforced ARM_TRAILING no bloquea la ejecución cuando el trailing ya gatilló", async () => {
    confluenceMock.evaluateIdcaEntryConfluence.mockReturnValue(confluenceResult("ARM_TRAILING"));
    const result = await performEntryCheckForTest(
      "BTC/USD",
      102,
      enforcedConfig(),
      assetConfig(),
      "simulation",
      { localLow: 100, buyThreshold: 106, maxExecutionPrice: 108 },
    );
    expect(result.blockReasons.some(block => block.code === "confluence_arm_trailing")).toBe(false);
    expect(result.allowed).toBe(true);
  });

  it.each(["NORMAL_ENTRY", "HIGH_CONFIDENCE_ENTRY"] as const)("enforced simulation no bloquea %s", async decisionClass => {
    confluenceMock.evaluateIdcaEntryConfluence.mockReturnValue(confluenceResult(decisionClass));
    const result = await runEntry(enforcedConfig());
    expect(result.allowed).toBe(true);
    expect(result.blockReasons.some(block => block.code.startsWith("confluence_"))).toBe(false);
  });

  it("enforced ARM_TRAILING arma el trailing existente y no ejecuta compra directa", async () => {
    confluenceMock.evaluateIdcaEntryConfluence.mockReturnValue(confluenceResult("ARM_TRAILING"));
    const result = await runEntry(enforcedConfig());
    expect(result.allowed).toBe(false);
    expect(result.blockReasons.some(block => block.code === "confluence_arm_trailing")).toBe(true);
    expect(TrailingBuyManager.isArmed("BTC/USD")).toBe(true);
    expect(TrailingBuyManager.getState("BTC/USD")?.canonicalParams?.mode).toBe("static");
  });

  it.each([
    "WATCH",
    "ARM_TRAILING",
    "NORMAL_ENTRY",
    "HIGH_CONFIDENCE_ENTRY",
    "DEFENSIVE_SAFETY_BUY",
  ] as const)("live fuerza diagnostic aunque la política pida enforced (%s)", async decisionClass => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    confluenceMock.evaluateIdcaEntryConfluence.mockReturnValue(confluenceResult(decisionClass));
    const result = await performEntryCheckForTest("BTC/USD", 102, enforcedConfig(), assetConfig(), "live");
    warnSpy.mockRestore();
    expect(result.confluenceEnforcement).toBe("diagnostic");
    expect(result.allowed).toBe(true);
    expect(result.blockReasons.some(block => block.code === "confluence_watch" || block.code === "confluence_arm_trailing")).toBe(false);
    expect(TrailingBuyManager.isArmed("BTC/USD")).toBe(false);
  });

  it("hard gate de confluencia convive con exposición y no la elimina", async () => {
    repoMock.getAllActiveBotCycles.mockResolvedValue([{ capitalUsedUsd: "950" }]);
    confluenceMock.evaluateIdcaEntryConfluence.mockReturnValue(confluenceResult("NO_ENTRY", {
      hardBlocked: true,
      hardBlockers: ["data_unusable"],
    }));
    const result = await runEntry(enforcedConfig());
    expect(result.allowed).toBe(false);
    expect(result.blockReasons.some(block => block.code === "module_exposure_max_reached")).toBe(true);
    expect(result.blockReasons.some(block => block.code === "confluence_hard_blocked")).toBe(true);
  });

  it("enforced no elimina un bloqueo de precio insuficiente", async () => {
    confluenceMock.evaluateIdcaEntryConfluence.mockReturnValue(confluenceResult("HIGH_CONFIDENCE_ENTRY", {
      finalRequiredDistancePct: 0.1,
    }));
    const result = await runEntry(enforcedConfig(), 110.5);
    expect(result.allowed).toBe(false);
    expect(result.blockReasons.some(block => block.code === "insufficient_dip")).toBe(true);
  });

  it("DEFENSIVE_SAFETY_BUY en safety no bloquea ni bypassa límites", async () => {
    confluenceMock.evaluateIdcaEntryConfluence.mockReturnValue(confluenceResult("DEFENSIVE_SAFETY_BUY"));
    const cycle: any = {
      id: 31,
      pair: "BTC/USD",
      buyCount: 1,
      lastBuyAt: null,
      nextBuyPrice: "110",
      capitalUsedUsd: "100",
      capitalReservedUsd: "1000",
      avgEntryPrice: "110",
      marketScore: "60",
    };
    const asset: any = {
      maxSafetyOrders: 1,
      safetyOrdersJson: [{ dipPct: 2, sizePctOfAssetBudget: 25 }],
      cooldownMinutesBetweenBuys: 0,
      requireReboundConfirmation: false,
    };
    await checkSafetyBuyForTest(cycle, 102, enforcedConfig(), asset, "simulation");
    expect(confluenceMock.evaluateIdcaEntryConfluence).toHaveBeenCalled();
    expect(repoMock.updateCycle).toHaveBeenCalled();
  });

  it("WATCH en safety enforced sí bloquea antes de ejecutar", async () => {
    confluenceMock.evaluateIdcaEntryConfluence.mockReturnValue(confluenceResult("WATCH"));
    const cycle: any = {
      id: 32,
      pair: "BTC/USD",
      buyCount: 1,
      lastBuyAt: null,
      nextBuyPrice: "110",
      capitalUsedUsd: "100",
      capitalReservedUsd: "1000",
      avgEntryPrice: "110",
      marketScore: "60",
    };
    const asset: any = {
      maxSafetyOrders: 1,
      safetyOrdersJson: [{ dipPct: 2, sizePctOfAssetBudget: 25 }],
      cooldownMinutesBetweenBuys: 0,
      requireReboundConfirmation: false,
    };
    await checkSafetyBuyForTest(cycle, 102, enforcedConfig(), asset, "simulation");
    expect(repoMock.updateCycle).not.toHaveBeenCalled();
    expect(repoMock.createEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "buy_blocked",
      payloadJson: { blockCode: "confluence_watch" },
    }));
  });
});
