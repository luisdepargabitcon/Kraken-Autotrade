import { describe, expect, it, vi, beforeEach } from "vitest";

const repoMock = vi.hoisted(() => ({
  getActiveBotCycle: vi.fn(async () => null),
  getAllActiveBotCycles: vi.fn(async () => []),
  getSimulationWallet: vi.fn(async () => ({ availableBalanceUsd: "1000" })),
  getAssetConfig: vi.fn(),
  getAllActiveCyclesForPair: vi.fn(async () => []),
  getActiveImportedCycles: vi.fn(async () => []),
  hasActiveBotCycleForPair: vi.fn(async () => false),
  updateCycle: vi.fn(async () => undefined),
  createEvent: vi.fn(async () => ({})),
}));

vi.mock("../IdcaRepository", () => repoMock);
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

import { MarketDataService } from "../../MarketDataService";
import { ExchangeFactory } from "../../exchanges/ExchangeFactory";
import { performEntryCheckForTest, evaluatePairForTest, __setIdcaOhlcCacheForTest, __clearIdcaOhlcCacheForTest, __clearExitPriceAlertThrottleForTest } from "../IdcaEngine";

const HOUR = 3_600_000;
const NOW = 1_699_999_200_000;

function rawCandles(count: number) {
  const start = NOW - count * HOUR;
  return Array.from({ length: count }, (_, i) => ({
    time: start + i * HOUR,
    open: 100 + i * 0.01,
    high: 101 + i * 0.01,
    low: 99 + i * 0.01,
    close: 100.5 + i * 0.01,
    volume: 10,
  }));
}

function series(count: number, opts: { staleHours?: number; missingVolume?: boolean; validity?: string } = {}) {
  const lastClose = NOW - (opts.staleHours ?? 1) * HOUR;
  const candles = Array.from({ length: count }, (_, i) => {
    const openTime = lastClose - (count - i) * HOUR;
    return {
      openTime,
      closeTime: openTime + HOUR,
      isClosed: openTime + HOUR <= NOW,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: opts.missingVolume && i === count - 1 ? null : 10,
    };
  }).filter(c => c.isClosed);
  const ageMs = candles.length ? NOW - candles[candles.length - 1].closeTime : null;
  return {
    candles,
    gaps: 0,
    source: "kraken",
    origin: "live",
    quality: {
      validity: opts.validity ?? (ageMs !== null && ageMs > 2 * HOUR ? "stale" : "valid"),
      ageMs,
      missing: count < 100 ? ["warmup"] : [],
    },
  } as any;
}

function mockSeries(s: any) {
  vi.mocked(MarketDataService.getCandleSeries).mockResolvedValue(s as any);
}

function config(): any {
  return {
    allocatedCapitalUsd: "1000",
    maxModuleExposurePct: "90",
    localHighLookbackMinutes: 60,
    smartModeEnabled: false,
    adaptivePositionSizingEnabled: false,
    marketScoreWeightsJson: {},
    idcaDynamicAnchorEnabled: false,
    entryUiJson: {},
  };
}
function assetConfig(): any {
  return {
    enabled: true,
    dipReference: "hybrid",
    vwapEnabled: false,
    minDipPct: "1",
    entryMode: "assisted_entry",
    requireReboundConfirmation: false,
    dynamicDistanceConfigJson: null,
  };
}

describe("IDCA engine data-gate E2E", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearIdcaOhlcCacheForTest();
    __clearExitPriceAlertThrottleForTest();
    vi.useRealTimers();
    repoMock.getActiveBotCycle.mockResolvedValue(null);
    repoMock.getAllActiveBotCycles.mockResolvedValue([]);
    __setIdcaOhlcCacheForTest("BTC/USD", rawCandles(120));
  });

  it.each([
    ["stale", series(120, { staleHours: 5 })],
    ["warmup", series(30)],
    ["missing volume", series(120, { missingVolume: true })],
  ])("performEntryCheck real bloquea datos %s sin ejecutar orden", async (_name, s) => {
    mockSeries(s);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const result = await performEntryCheckForTest("BTC/USD", 90, config(), assetConfig(), "live");
    expect(result.allowed).toBe(false);
    expect(result.blockReasons.some(b => b.code.startsWith("data_gate_blocked:"))).toBe(true);
    const exchange = vi.mocked(ExchangeFactory.getTradingExchange)() as any;
    expect(exchange.placeOrder).not.toHaveBeenCalled();
    expect(exchange.createOrder).not.toHaveBeenCalled();
  });

  it("performEntryCheck real con datos sanos no contiene bloque data_gate", async () => {
    mockSeries(series(120));
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const result = await performEntryCheckForTest("BTC/USD", 90, config(), assetConfig(), "live");
    expect(result.blockReasons.some(b => b.code.startsWith("data_gate_blocked:"))).toBe(false);
  });

  it("evaluatePair sin precio realtime ni fallback no evalúa salidas y emite crítico", async () => {
    repoMock.getAssetConfig.mockResolvedValue(assetConfig());
    vi.mocked(MarketDataService.getPrice).mockResolvedValue(0);
    await evaluatePairForTest("BTC/USD", config(), "live");
    expect(repoMock.createEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "exit_price_unavailable", severity: "critical" }));
    expect(repoMock.getAllActiveCyclesForPair).not.toHaveBeenCalled();
    expect(repoMock.updateCycle).not.toHaveBeenCalled();
  });

  it("evaluatePair con fallback degradado válido sigue evaluando ciclos", async () => {
    repoMock.getAssetConfig.mockResolvedValue(assetConfig());
    vi.mocked(MarketDataService.getPrice)
      .mockResolvedValueOnce(100) // primera evaluación: establece fallback realtime
      .mockResolvedValueOnce(0);  // segunda evaluación: usa fallback degradado
    await evaluatePairForTest("BTC/USD", config(), "live");
    repoMock.createEvent.mockClear();
    await evaluatePairForTest("BTC/USD", config(), "live");
    expect(repoMock.createEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "exit_price_degraded" }));
    expect(repoMock.getAllActiveCyclesForPair).toHaveBeenCalled();
  });

  it("throttle exit_price_unavailable: persistente 1 evento, tras 15min otro", async () => {
    repoMock.getAssetConfig.mockResolvedValue(assetConfig());
    vi.mocked(MarketDataService.getPrice).mockResolvedValue(0);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    await evaluatePairForTest("BTC/USD", config(), "live");
    await evaluatePairForTest("BTC/USD", config(), "live");
    expect(repoMock.createEvent.mock.calls.filter(c => c[0]?.eventType === "exit_price_unavailable")).toHaveLength(1);
    vi.setSystemTime(NOW + 15 * 60_000 + 1);
    await evaluatePairForTest("BTC/USD", config(), "live");
    expect(repoMock.createEvent.mock.calls.filter(c => c[0]?.eventType === "exit_price_unavailable")).toHaveLength(2);
  });

  it("recuperaci�n y nueva degradaci�n emiten evento inmediato", async () => {
    repoMock.getAssetConfig.mockResolvedValue(assetConfig());
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.mocked(MarketDataService.getPrice).mockResolvedValueOnce(100).mockResolvedValueOnce(0);
    await evaluatePairForTest("BTC/USD", config(), "live");
    await evaluatePairForTest("BTC/USD", config(), "live");
    expect(repoMock.createEvent.mock.calls.filter(c => c[0]?.eventType === "exit_price_degraded")).toHaveLength(1);
    vi.mocked(MarketDataService.getPrice).mockResolvedValueOnce(101).mockResolvedValueOnce(0);
    await evaluatePairForTest("BTC/USD", config(), "live");
    await evaluatePairForTest("BTC/USD", config(), "live");
    expect(repoMock.createEvent.mock.calls.filter(c => c[0]?.eventType === "exit_price_degraded")).toHaveLength(2);
  });
});
