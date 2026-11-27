import { describe, expect, it, vi, beforeEach } from "vitest";

const storageMock = vi.hoisted(() => ({
  getLatestMarketMetrics: vi.fn(),
  getMarketMetricSnapshots: vi.fn(),
  getBotConfig: vi.fn(),
}));

vi.mock("../../../storage", () => ({ storage: storageMock }));

import { marketMetricsService } from "../MarketMetricsService";
import { DEFAULT_METRICS_CONFIG, METRIC_NAMES } from "../MarketMetricsTypes";

describe("MarketMetricsService métricas derivadas y frescura", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calcula open_interest_delta_24h_pct desde histórico del mismo proveedor", async () => {
    const now = Date.now();
    const currentTs = new Date(now - 10_000);
    const referenceTs = new Date(now - 24 * 60 * 60 * 1000);
    storageMock.getLatestMarketMetrics.mockResolvedValue([{
      source: "binance",
      metric: METRIC_NAMES.OPEN_INTEREST,
      asset: "BTC",
      pair: null,
      value: 120,
      tsProvider: currentTs,
      tsIngested: new Date(now),
      meta: { unit: "USD" },
    }]);
    storageMock.getMarketMetricSnapshots.mockResolvedValue([{
      source: "binance",
      metric: METRIC_NAMES.OPEN_INTEREST,
      asset: "BTC",
      pair: null,
      value: 100,
      tsProvider: referenceTs,
      tsIngested: referenceTs,
      meta: { unit: "USD" },
    }]);

    const result = await marketMetricsService.getLatestMetrics(DEFAULT_METRICS_CONFIG);
    const key = `${METRIC_NAMES.OPEN_INTEREST_DELTA_24H_PCT}:BTC`;
    expect(result.metrics[key]).toBeCloseTo(20, 8);
    expect(result.metricMeta[key].source).toBe("binance");
    expect(result.stalenessMs[key]).toBeGreaterThanOrEqual(10_000);
  });

  it("usa variación proporcionada por el proveedor cuando existe", async () => {
    const now = Date.now();
    storageMock.getLatestMarketMetrics.mockResolvedValue([{
      source: "coinglass",
      metric: METRIC_NAMES.OPEN_INTEREST,
      asset: "ETH",
      pair: null,
      value: 1000,
      tsProvider: new Date(now),
      tsIngested: new Date(now),
      meta: { changePercent24h: -5.5 },
    }]);
    const result = await marketMetricsService.getLatestMetrics(DEFAULT_METRICS_CONFIG);
    expect(result.metrics[`${METRIC_NAMES.OPEN_INTEREST_DELTA_24H_PCT}:ETH`]).toBe(-5.5);
    expect(storageMock.getMarketMetricSnapshots).not.toHaveBeenCalled();
  });

  it("frescura usa tsProvider y no tsIngested; sin tsProvider queda unknown_age", async () => {
    const now = Date.now();
    storageMock.getLatestMarketMetrics.mockResolvedValue([
      {
        source: "binance",
        metric: METRIC_NAMES.FUNDING_RATE,
        asset: "BTC",
        pair: null,
        value: 0.01,
        tsProvider: new Date(now - 30 * 60_000),
        tsIngested: new Date(now),
        meta: {},
      },
      {
        source: "defillama",
        metric: METRIC_NAMES.STABLECOIN_SUPPLY_DELTA_24H,
        asset: "ALL",
        pair: null,
        value: 0.1,
        tsProvider: null,
        tsIngested: new Date(now),
        meta: {},
      },
    ]);
    const result = await marketMetricsService.getLatestMetrics(DEFAULT_METRICS_CONFIG);
    expect(result.stalenessMs[`${METRIC_NAMES.FUNDING_RATE}:BTC`]).toBeGreaterThanOrEqual(30 * 60_000);
    expect(result.stalenessMs[`${METRIC_NAMES.STABLECOIN_SUPPLY_DELTA_24H}:ALL`]).toBeUndefined();
  });
});
