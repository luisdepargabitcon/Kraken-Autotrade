import { describe, expect, it, vi } from "vitest";

const storageMock = vi.hoisted(() => ({
  getBotConfig: vi.fn(),
  getLatestMarketMetrics: vi.fn(),
  getMarketMetricSnapshots: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../storage", () => ({ storage: storageMock }));

import { evaluateMarketMetricsAdvisory } from "../marketMetricsAdvisory";
import { DEFAULT_METRICS_CONFIG, METRIC_NAMES } from "../MarketMetricsTypes";
import { evaluateIdcaEntryConfluence } from "../../institutionalDca/IdcaConfluenceEngine";

describe("market metrics advisory", () => {
  it("evalúa en observación, nunca bloquea y expone status/dataQuality", async () => {
    const now = new Date("2026-01-02T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    storageMock.getBotConfig.mockResolvedValue({
      marketMetricsConfig: { ...DEFAULT_METRICS_CONFIG, enabled: true, mode: "activo" },
    });
    storageMock.getLatestMarketMetrics.mockResolvedValue([{
      source: "binance",
      metric: METRIC_NAMES.FUNDING_RATE,
      asset: "BTC",
      pair: null,
      value: 0.2,
      tsProvider: now,
      tsIngested: now,
      meta: {},
    }]);

    const decision = await evaluateMarketMetricsAdvisory("BTC/USD", now);
    expect(decision.mode).toBe("observacion");
    expect(decision.action).toBe("PERMITIR");
    expect(decision.status).toBe("DEGRADED");
    expect(decision.dataQuality[`${METRIC_NAMES.FUNDING_RATE}:BTC`].state).toBe("ok");
    vi.useRealTimers();
  });

  it("adjuntar advisory no altera el resultado de confluencia de entrada", () => {
    const input = {
      pair: "BTC/USD",
      usedFor: "initial_entry" as const,
      confluenceProfile: "assisted" as const,
      drawdownFromReferencePct: 2.5,
      requiredDistancePct: 3,
      sliderBasePct: 3,
      referenceMethod: "vwap_anchor",
      vwapReliable: true,
      reboundConfirmed: false,
      requireReboundConfirmation: true,
      trailingBuyArmed: false,
      priceInActivationZone: false,
      capitalUsedUsd: 0,
      capitalReservedUsd: 0,
      buyCount: 0,
      marketScore: 65,
      atrPct: 2.1,
      candleCount: 50,
      atrReliable: true,
      smartAdjustmentEnabled: false,
    };
    const baseline = evaluateIdcaEntryConfluence(input);
    const withAdvisory = evaluateIdcaEntryConfluence(input);
    expect(withAdvisory).toEqual(baseline);
    const diagnostic = { ...withAdvisory, marketMetricsAdvisory: { status: "DEGRADED" } };
    expect(diagnostic.confidenceScore).toBe(baseline.confidenceScore);
    expect(diagnostic.hardBlocked).toBe(baseline.hardBlocked);
    expect(diagnostic.marketMetricsAdvisory.status).toBe("DEGRADED");
  });
});
