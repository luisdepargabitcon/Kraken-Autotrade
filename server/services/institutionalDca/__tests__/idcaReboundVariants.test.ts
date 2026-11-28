import { beforeEach, describe, expect, it, vi } from "vitest";

const repoMock = vi.hoisted(() => ({
  createEvent: vi.fn(async () => ({})),
  getActiveBotCycle: vi.fn(async () => null),
  getAllActiveBotCycles: vi.fn(async () => []),
  getClosedRecoveryCyclesCount: vi.fn(async () => 0),
  getActiveRecoveryCycles: vi.fn(async () => []),
  getTotalBotPairExposureUsd: vi.fn(async () => 0),
  getAllActiveBotCyclesForPair: vi.fn(async () => []),
  getLastClosedRecoveryCycle: vi.fn(async () => null),
  getSimulationWallet: vi.fn(async () => ({ availableBalanceUsd: "1000" })),
}));

const exitRepoMock = vi.hoisted(() => ({
  hasPendingExitInstruction: vi.fn(async () => false),
}));

vi.mock("../IdcaRepository", () => repoMock);
vi.mock("../IdcaExitInstructionRepository", () => exitRepoMock);
vi.mock("../IdcaTelegramNotifier", () => ({
  alertBuyBlocked: vi.fn(async () => undefined),
  alertApproachingBuy: vi.fn(async () => undefined),
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
  detectRebound,
  detectReboundDetailed,
  type OhlcCandle,
  type ReboundInput,
} from "../IdcaSmartLayer";
import {
  __clearIdcaOhlcCacheForTest,
  __setIdcaOhlcCacheForTest,
  checkRecoveryActivationForTest,
  checkSafetyBuyForTest,
  evaluateEngineReboundForTest,
  getReboundStrengthForTest,
  performEntryCheckForTest,
  selectReboundCandlesForTest,
} from "../IdcaEngine";
import { MarketDataService } from "../../MarketDataService";

function candle(open: number | undefined, high: number, low: number, close: number): OhlcCandle {
  return { open, high, low, close };
}

function input(
  recentCandles: OhlcCandle[],
  currentPrice: number,
  localLow: number,
  reboundMinPct = 0.3,
): ReboundInput {
  return { recentCandles, currentPrice, localLow, reboundMinPct };
}

const goldenLegacyVectors: Array<[string, ReboundInput, boolean]> = [
  [
    "wickLegacyGreen",
    input([
      candle(100, 101, 98, 100.5),
      candle(101, 102, 98, 101.8),
    ], 101.8, 98),
    true,
  ],
  [
    "wickLegacyRed",
    input([
      candle(100, 101, 98, 100.5),
      candle(102, 102, 98, 100.2),
    ], 100.2, 98),
    true,
  ],
  [
    "recovery",
    input([
      candle(100, 101, 99, 100),
      candle(100, 101, 99, 100.6),
    ], 100.7, 99),
    true,
  ],
  [
    "slowingLegacyAbsMove",
    input([
      candle(100, 101, 99, 100),
      candle(100, 102, 99, 101),
      candle(101, 102, 100.4, 101.2),
    ], 101.2, 99),
    true,
  ],
  [
    "none",
    input([
      candle(112, 112, 110, 110),
      candle(110, 110, 105, 105),
      candle(105, 105, 100, 100),
    ], 100, 90),
    false,
  ],
  [
    "insufficient",
    input([
      candle(100, 101, 99, 100.5),
    ], 100.5, 99),
    false,
  ],
  [
    "zeroRange",
    input([
      candle(100, 100, 100, 100),
      candle(100, 100, 100, 100),
    ], 100, 99),
    false,
  ],
];

function geometryInput(): ReboundInput {
  return input([
    candle(102, 102.2, 100.8, 101),
    candle(101, 101.2, 99.8, 100),
    candle(100, 103, 98, 102),
  ], 98.2, 98, 0.3);
}

function realFallInput(lastClose = 99.8): ReboundInput {
  return input([
    candle(106, 106.2, 104.8, 105),
    candle(105, 105.2, 99.8, 100),
    candle(100, 100.4, lastClose - 0.2, lastClose),
  ], lastClose, lastClose - 0.2, 5);
}

describe("detectRebound legacy golden outputs", () => {
  it.each(goldenLegacyVectors)("%s conserva la salida legacy esperada", (_name, vector, expected) => {
    expect(detectRebound(vector)).toBe(expected);
    expect(detectReboundDetailed(vector, "legacy").confirmed).toBe(expected);
  });
});

describe("detectReboundDetailed — geometría de mecha a1a", () => {
  it("vela verde: legacy cuenta cuerpo como mecha y a1a no", () => {
    const vector = geometryInput();
    expect(detectReboundDetailed(vector, "legacy").reasons.wick).toBe(true);
    const result = detectReboundDetailed(vector, "a1a_wick_geometry");
    expect(result.reasons.wick).toBe(false);
    expect(result.confirmed).toBe(false);
    expect(result.status).toBe("NOT_REQUIRED");
  });

  it("vela verde con mecha inferior geométrica real sí se reconoce", () => {
    const vector = input([
      candle(101, 101.2, 100.8, 101),
      candle(100, 103, 97.4, 102),
    ], 100.1, 97.4, 5);
    const result = detectReboundDetailed(vector, "a1a_wick_geometry");
    expect(result.reasons.wick).toBe(true);
    expect(result.confirmed).toBe(true);
  });

  it("vela roja y doji usan el cuerpo inferior sin inventar open", () => {
    const red = input([
      candle(102, 103, 98, 100),
      candle(101, 101.2, 100.8, 101),
    ], 100, 98, 5);
    const doji = input([
      candle(100, 103, 98, 100),
      candle(101, 101.2, 100.8, 101),
    ], 100, 98, 5);
    expect(detectReboundDetailed(red, "a1a_wick_geometry").reasons.wick).toBe(true);
    expect(detectReboundDetailed(doji, "a1a_wick_geometry").reasons.wick).toBe(true);
  });

  it("open ausente invalida a1a y no se sustituye por close", () => {
    const vector = input([
      candle(undefined, 103, 98, 102),
      candle(101, 101.2, 100.8, 101),
    ], 100, 98);
    const result = detectReboundDetailed(vector, "a1a_wick_geometry");
    expect(result.status).toBe("INVALID");
    expect(result.confirmed).toBe(false);
    expect(result.invalidReason).toContain("open");
  });

  it("rango cero no confirma pero no invalida una vela OHLC coherente", () => {
    const vector = input([
      candle(100, 100, 100, 100),
      candle(100, 100, 100, 100),
    ], 100, 99);
    const result = detectReboundDetailed(vector, "a1a_wick_geometry");
    expect(result.status).toBe("NOT_REQUIRED");
    expect(result.reasons.wick).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("valor no finito %s invalida variante corregida", bad => {
    const vector = input([
      candle(100, bad, 98, 102),
      candle(101, 101.2, 100.8, 101),
    ], 100, 98);
    expect(detectReboundDetailed(vector, "a1a_wick_geometry").status).toBe("INVALID");
  });

  it("OHLC incoherente invalida la variante con geometría", () => {
    const vector = input([
      candle(104, 103, 98, 102),
      candle(101, 101.2, 100.8, 101),
    ], 100, 98);
    expect(detectReboundDetailed(vector, "a1a_wick_geometry").status).toBe("INVALID");
  });
});

describe("detectReboundDetailed — desaceleración con caída real a1b", () => {
  it("movimiento al alza que legacy acepta no cuenta como desaceleración en a1b", () => {
    const vector = input([
      candle(100, 101, 99, 100),
      candle(100, 102, 99, 101),
      candle(101, 101.2, 100.6, 100.8),
    ], 100.8, 99);
    expect(detectReboundDetailed(vector, "legacy").reasons.slowing).toBe(true);
    const result = detectReboundDetailed(vector, "a1b_slowing_real_fall");
    expect(result.reasons.slowing).toBe(false);
    expect(result.confirmed).toBe(false);
  });

  it("caída real previa con caída posterior menor sí desacelera", () => {
    const result = detectReboundDetailed(realFallInput(99.8), "a1b_slowing_real_fall");
    expect(result.reasons.slowing).toBe(true);
    expect(result.confirmed).toBe(true);
  });

  it("caída real previa pero última caída no desacelerada no confirma por slowing", () => {
    const result = detectReboundDetailed(realFallInput(97), "a1b_slowing_real_fall");
    expect(result.reasons.slowing).toBe(false);
  });

  it("NaN/Infinity invalidan a1b aunque no exijan open", () => {
    const vector = realFallInput(99.8);
    vector.recentCandles[2].close = Number.NaN;
    expect(detectReboundDetailed(vector, "a1b_slowing_real_fall").status).toBe("INVALID");
  });
});

describe("detectReboundDetailed — combinación estricta a1c", () => {
  it("recovery + wick confirma", () => {
    const vector = input([
      candle(101, 101.2, 100.8, 101),
      candle(100, 103, 97.4, 102),
    ], 103.4, 97.4, 3);
    const result = detectReboundDetailed(vector, "a1c_combined");
    expect(result.reasons).toMatchObject({ wick: true, recovery: true });
    expect(result.status).toBe("CONFIRMED");
    expect(result.confirmed).toBe(true);
  });

  it("recovery + slowing confirma", () => {
    const vector = realFallInput(99.8);
    vector.currentPrice = 106;
    vector.localLow = 99.6;
    vector.recentCandles[2].close = 100.1;
    const result = detectReboundDetailed(vector, "a1c_combined");
    expect(result.reasons.recovery).toBe(true);
    expect(result.reasons.slowing).toBe(true);
    expect(result.status).toBe("CONFIRMED");
  });

  it("wick sola NO confirma en a1c: queda PENDING", () => {
    const vector = input([
      candle(101, 101.2, 100.8, 101),
      candle(100, 103, 97.4, 102),
    ], 100.1, 97.4, 5);
    const result = detectReboundDetailed(vector, "a1c_combined");
    expect(result.reasons.wick).toBe(true);
    expect(result.reasons.recovery).toBe(false);
    expect(result.status).toBe("PENDING");
    expect(result.confirmed).toBe(false);
  });

  it("slowing sola NO confirma en a1c: queda PENDING", () => {
    const result = detectReboundDetailed(realFallInput(99.8), "a1c_combined");
    expect(result.reasons.slowing).toBe(true);
    expect(result.reasons.recovery).toBe(false);
    expect(result.status).toBe("PENDING");
    expect(result.confirmed).toBe(false);
  });

  it("recovery sola NO confirma en a1c: queda PENDING", () => {
    const vector = input([
      candle(100, 100.5, 99.8, 100),
      candle(100, 101, 99.9, 100.6),
    ], 100.7, 99.8, 0.3);
    const result = detectReboundDetailed(vector, "a1c_combined");
    expect(result.reasons.recovery).toBe(true);
    expect(result.reasons.wick).toBe(false);
    expect(result.reasons.slowing).toBe(false);
    expect(result.status).toBe("PENDING");
    expect(result.confirmed).toBe(false);
  });

  it("todo falso es NOT_REQUIRED", () => {
    const vector = goldenLegacyVectors[4][1];
    const result = detectReboundDetailed(vector, "a1c_combined");
    expect(result.reasons).toEqual({ wick: false, recovery: false, slowing: false });
    expect(result.status).toBe("NOT_REQUIRED");
    expect(result.confirmed).toBe(false);
  });

  it("open ausente invalida a1c incluso si hay recovery", () => {
    const vector = input([
      candle(undefined, 101, 99, 100),
      candle(100, 101, 99, 100.6),
    ], 100.7, 99, 0.3);
    const result = detectReboundDetailed(vector, "a1c_combined");
    expect(result.status).toBe("INVALID");
    expect(result.confirmed).toBe(false);
  });
});

const HOUR_MS = 3_600_000;
const CALLSITE_NOW = 1_699_999_200_000;

function timestampedCandle(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
) {
  return { time, open, high, low, close, volume: 10 };
}

function wickGeometryCallsiteCandles(nowMs = CALLSITE_NOW) {
  return [
    timestampedCandle(nowMs - 5 * HOUR_MS, 100, 100.2, 99.8, 100),
    timestampedCandle(nowMs - 4 * HOUR_MS, 100.5, 101.2, 99.8, 101),
    timestampedCandle(nowMs - 3 * HOUR_MS, 100, 103, 98.5, 102),
  ];
}

function configWithPolicy(entryPolicy?: unknown): any {
  return {
    allocatedCapitalUsd: "1000",
    maxModuleExposurePct: "90",
    maxAssetExposurePct: "90",
    simulationFeePct: "0.1",
    simulationSlippagePct: "0",
    entryUiJson: entryPolicy === undefined ? {} : { entryPolicy },
  };
}

function candidateConfig(): any {
  return configWithPolicy({ version: "v2_candidate", reboundVariant: "a1c_combined" });
}

describe("call sites IDCA de rebote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearIdcaOhlcCacheForTest();
    repoMock.getActiveBotCycle.mockResolvedValue(null);
    repoMock.getAllActiveBotCycles.mockResolvedValue([]);
    repoMock.getClosedRecoveryCyclesCount.mockResolvedValue(0);
    repoMock.getActiveRecoveryCycles.mockResolvedValue([]);
    repoMock.getTotalBotPairExposureUsd.mockResolvedValue(0);
    repoMock.getAllActiveBotCyclesForPair.mockResolvedValue([]);
    repoMock.getSimulationWallet.mockResolvedValue({ availableBalanceUsd: "1000" });
    exitRepoMock.hasPendingExitInstruction.mockResolvedValue(false);
    __setIdcaOhlcCacheForTest("BTC/USD", wickGeometryCallsiteCandles());
  });

  it("evaluador común: sin política conserva legacy y con simulation+a1c aplica la variante", () => {
    const commonInput = {
      pair: "BTC/USD",
      currentPrice: 102,
      reboundMinPct: 0.3,
      nowMs: CALLSITE_NOW,
    };
    const legacyResult = evaluateEngineReboundForTest({
      ...commonInput,
      config: configWithPolicy(),
      mode: "simulation",
    });
    const candidateResult = evaluateEngineReboundForTest({
      ...commonInput,
      config: candidateConfig(),
      mode: "simulation",
    });

    expect(legacyResult.variant).toBe("legacy");
    expect(legacyResult.result.confirmed).toBe(true);
    expect(candidateResult.variant).toBe("a1c_combined");
    expect(candidateResult.result.status).toBe("PENDING");
    expect(candidateResult.result.confirmed).toBe(false);
  });

  it("evaluador común: live+a1c fuerza legacy", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = evaluateEngineReboundForTest({
      pair: "BTC/USD",
      currentPrice: 102,
      config: candidateConfig(),
      mode: "live",
      reboundMinPct: 0.3,
      nowMs: CALLSITE_NOW,
    });
    expect(result.variant).toBe("legacy");
    expect(result.result.confirmed).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("selector causal: legacy conserva la vela en formación y a1c solo usa cerradas", () => {
    const candles = [
      ...wickGeometryCallsiteCandles(),
      timestampedCandle(CALLSITE_NOW, 101, 104, 97, 103),
    ];
    expect(selectReboundCandlesForTest(candles, "legacy", CALLSITE_NOW)).toHaveLength(4);
    expect(selectReboundCandlesForTest(candles, "a1c_combined", CALLSITE_NOW)).toHaveLength(3);
  });

  it("call site getReboundStrength: default/live usan legacy y simulation+a1c aplica candidata", () => {
    const legacyDefault = getReboundStrengthForTest("BTC/USD", configWithPolicy(), "simulation");
    const candidate = getReboundStrengthForTest("BTC/USD", candidateConfig(), "simulation");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const liveForced = getReboundStrengthForTest("BTC/USD", candidateConfig(), "live");
    warnSpy.mockRestore();

    expect(legacyDefault).not.toBe("none");
    expect(candidate).toBe("none");
    expect(liveForced).not.toBe("none");
  });

  it("call site checkSafetyBuy propaga open/variante: legacy llega al guard siguiente y a1c bloquea en rebote", async () => {
    const cycle: any = {
      id: 11,
      pair: "BTC/USD",
      buyCount: 1,
      lastBuyAt: null,
      nextBuyPrice: "110",
      capitalUsedUsd: "950",
      capitalReservedUsd: "1000",
      unrealizedPnlPct: "-5",
    };
    const asset: any = {
      maxSafetyOrders: 1,
      safetyOrdersJson: [{ dipPct: 2, sizePctOfAssetBudget: 25 }],
      cooldownMinutesBetweenBuys: 0,
      requireReboundConfirmation: true,
      reboundMinPct: "0.30",
    };

    await checkSafetyBuyForTest(cycle, 102, configWithPolicy(), asset, "simulation");
    expect(repoMock.createEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "buy_blocked",
      payloadJson: { blockCode: "module_exposure_max_reached" },
    }));

    repoMock.createEvent.mockClear();
    await checkSafetyBuyForTest(cycle, 102, candidateConfig(), asset, "simulation");
    expect(repoMock.createEvent).not.toHaveBeenCalled();

    repoMock.createEvent.mockClear();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await checkSafetyBuyForTest(cycle, 102, candidateConfig(), asset, "live");
    warnSpy.mockRestore();
    expect(repoMock.createEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "buy_blocked",
      payloadJson: { blockCode: "module_exposure_max_reached" },
    }));
  });

  it("call site checkRecoveryActivation incluye no_rebound solo cuando la variante no confirma", async () => {
    const mainCycle: any = {
      id: 21,
      pair: "BTC/USD",
      status: "active",
      maxDrawdownPct: "30",
      unrealizedPnlPct: "-30",
      marketScore: "60",
      lastBuyAt: null,
    };
    const asset: any = {};
    const rcfg: any = {
      enabled: true,
      activationDrawdownPct: 25,
      maxRecoveryCyclesPerMain: 2,
      maxTotalCyclesPerPair: 1,
      maxPairExposurePct: 40,
      capitalAllocationPct: 10,
      maxRecoveryCapitalUsd: 500,
      cooldownMinutesAfterMainBuy: 0,
      cooldownMinutesBetweenRecovery: 0,
      minMarketScoreForRecovery: 40,
      requireReboundConfirmation: true,
    };
    repoMock.getAllActiveBotCyclesForPair.mockResolvedValue([mainCycle]);

    await checkRecoveryActivationForTest(mainCycle, 102, configWithPolicy(), asset, "simulation", rcfg);
    const legacyBlocked = repoMock.createEvent.mock.calls.find(call => call[0]?.eventType === "recovery_cycle_blocked");
    expect(legacyBlocked).toBeTruthy();
    expect(legacyBlocked[0].payloadJson.blockReasons).not.toContain("no_rebound_confirmed");

    repoMock.createEvent.mockClear();
    await checkRecoveryActivationForTest(mainCycle, 102, candidateConfig(), asset, "simulation", rcfg);
    const candidateBlocked = repoMock.createEvent.mock.calls.find(call => call[0]?.eventType === "recovery_cycle_blocked");
    expect(candidateBlocked).toBeTruthy();
    expect(candidateBlocked[0].payloadJson.blockReasons).toContain("no_rebound_confirmed");

    repoMock.createEvent.mockClear();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await checkRecoveryActivationForTest(mainCycle, 102, candidateConfig(), asset, "live", rcfg);
    warnSpy.mockRestore();
    const liveBlocked = repoMock.createEvent.mock.calls.find(call => call[0]?.eventType === "recovery_cycle_blocked");
    expect(liveBlocked).toBeTruthy();
    expect(liveBlocked[0].payloadJson.blockReasons).not.toContain("no_rebound_confirmed");
  });

  it("call site performEntryCheck refleja no_rebound solo con simulation+a1c y live fuerza legacy", async () => {
    const start = CALLSITE_NOW - 120 * HOUR_MS;
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
    __setIdcaOhlcCacheForTest("BTC/USD", candles);

    const healthCandles = candles.map(candle => ({
      openTime: candle.time,
      closeTime: candle.time + HOUR_MS,
      isClosed: candle.time + HOUR_MS <= CALLSITE_NOW,
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
      quality: {
        validity: "valid",
        ageMs: CALLSITE_NOW - healthCandles[healthCandles.length - 1].closeTime,
        missing: [],
      },
    } as any);

    const baseConfig = {
      ...configWithPolicy(),
      localHighLookbackMinutes: 720,
      smartModeEnabled: false,
      adaptivePositionSizingEnabled: false,
      marketScoreWeightsJson: {},
      idcaDynamicAnchorEnabled: false,
      btcMarketGateForEthEnabled: false,
      adaptiveTpEnabled: false,
      volatilityTrailingEnabled: false,
    };
    const asset: any = {
      enabled: true,
      dipReference: "hybrid",
      vwapEnabled: false,
      minDipPct: "1",
      entryMode: "assisted_entry",
      requireReboundConfirmation: true,
      reboundMinPct: "0.30",
      dynamicDistanceConfigJson: null,
      takeProfitPct: "2",
      trailingMarginPct: "1",
    };

    vi.useFakeTimers();
    vi.setSystemTime(CALLSITE_NOW);
    try {
      const legacyResult = await performEntryCheckForTest("BTC/USD", 102, baseConfig as any, asset, "simulation");
      expect(legacyResult.reboundConfirmed).toBe(true);
      expect(legacyResult.blockReasons.some(block => block.code === "no_rebound_confirmed")).toBe(false);

      const candidateResult = await performEntryCheckForTest(
        "BTC/USD",
        102,
        { ...baseConfig, ...candidateConfig() } as any,
        asset,
        "simulation",
      );
      expect(candidateResult.reboundConfirmed).toBe(false);
      expect(candidateResult.blockReasons.some(block => block.code === "no_rebound_confirmed")).toBe(true);

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const liveResult = await performEntryCheckForTest(
        "BTC/USD",
        102,
        { ...baseConfig, ...candidateConfig() } as any,
        asset,
        "live",
      );
      warnSpy.mockRestore();
      expect(liveResult.reboundConfirmed).toBe(true);
      expect(liveResult.blockReasons.some(block => block.code === "no_rebound_confirmed")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
