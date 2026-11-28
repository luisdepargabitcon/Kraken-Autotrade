import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const storageMock = vi.hoisted(() => ({
  getLatestMarketMetrics: vi.fn(),
  getBotConfig: vi.fn(),
  saveMarketMetricSnapshot: vi.fn(),
}));
vi.mock("../../../storage", () => ({ storage: storageMock }));

import { marketMetricsService } from "../MarketMetricsService";
import { DEFAULT_METRICS_CONFIG } from "../MarketMetricsTypes";

describe("arranque idempotente de Market Metrics", () => {
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

  it("tres arranques consecutivos solo refrescan una vez cuando el primero persiste snapshot fresco", async () => {
    const saved: any[] = [];
    storageMock.getBotConfig.mockResolvedValue({ marketMetricsConfig: { ...DEFAULT_METRICS_CONFIG, enabled: true } });
    storageMock.getLatestMarketMetrics.mockImplementation(async () => saved);
    storageMock.saveMarketMetricSnapshot.mockImplementation(async (snap: any) => {
      saved.push(snap);
    });
    const provider = {
      name: "startup-fixture",
      enabled: true,
      optional: false,
      fetch: vi.fn().mockResolvedValue({
        records: [{
          source: "startup-fixture",
          metric: "funding_rate",
          asset: "BTC",
          pair: null,
          value: 0.01,
          tsProvider: new Date("2026-01-02T11:59:00Z"),
          meta: { synthetic: true },
        }],
      }),
    };
    (marketMetricsService as any).providers = [provider];
    (marketMetricsService as any).sleepMs = async () => undefined;
    (marketMetricsService as any).random = () => 0.5;

    await marketMetricsService.refreshIfDue();
    await marketMetricsService.refreshIfDue();
    await marketMetricsService.refreshIfDue();

    expect(provider.fetch).toHaveBeenCalledTimes(1);
    expect(storageMock.saveMarketMetricSnapshot).toHaveBeenCalledTimes(1);
  });
});
