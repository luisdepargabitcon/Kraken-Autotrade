import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const storageMock = vi.hoisted(() => ({
  getLatestMarketMetrics: vi.fn(),
  getMarketMetricSnapshots: vi.fn(),
  getBotConfig: vi.fn(),
  saveMarketMetricSnapshot: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../storage", () => ({ storage: storageMock }));

import { marketMetricsService } from "../MarketMetricsService";
import { DEFAULT_METRICS_CONFIG } from "../MarketMetricsTypes";

describe("refresh market metrics", () => {
  const originalProviders = (marketMetricsService as any).providers;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T12:00:00Z"));
  });
  afterEach(() => {
    (marketMetricsService as any).providers = originalProviders;
    vi.useRealTimers();
  });

  it("omite refresh de arranque si el snapshot más reciente es más joven que la ventana", async () => {
    storageMock.getBotConfig.mockResolvedValue({ marketMetricsConfig: { ...DEFAULT_METRICS_CONFIG, enabled: true } });
    storageMock.getLatestMarketMetrics.mockResolvedValue([{ tsIngested: new Date(Date.now() - 60 * 60_000) }]);
    const provider = { name: "dummy", enabled: true, optional: false, fetch: vi.fn() };
    (marketMetricsService as any).providers = [provider];
    await marketMetricsService.refreshIfDue();
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it("escalona providers con jitter acotado y conserva providerTs al persistir", async () => {
    const sleeps: number[] = [];
    (marketMetricsService as any).sleepMs = async (ms: number) => { sleeps.push(ms); };
    (marketMetricsService as any).random = () => 0.5;
    const providerTs = new Date("2026-01-02T11:59:00Z");
    const makeProvider = (name: string) => ({
      name,
      enabled: true,
      optional: false,
      fetch: vi.fn().mockResolvedValue({
        records: [{
          source: name,
          metric: "funding_rate",
          asset: "BTC",
          pair: null,
          value: 0.01,
          tsProvider: providerTs,
          meta: {},
        }],
      }),
    });
    const p1 = makeProvider("p1");
    const p2 = makeProvider("p2");
    (marketMetricsService as any).providers = [p1, p2];
    await marketMetricsService.refreshForced();
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(250);
    expect(sleeps[0]).toBeLessThanOrEqual(750);
    expect(storageMock.saveMarketMetricSnapshot).toHaveBeenCalledTimes(2);
    expect(storageMock.saveMarketMetricSnapshot.mock.calls[0][0].tsProvider).toBe(providerTs);
  });
});
