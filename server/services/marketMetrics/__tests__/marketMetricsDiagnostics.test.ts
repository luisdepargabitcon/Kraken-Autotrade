import { describe, expect, it, vi } from "vitest";

const storageMock = vi.hoisted(() => ({
  getLatestMarketMetrics: vi.fn().mockResolvedValue([]),
  getMarketMetricSnapshots: vi.fn(),
  getBotConfig: vi.fn(),
}));
vi.mock("../../../storage", () => ({ storage: storageMock }));

import { marketMetricsService } from "../MarketMetricsService";

describe("diagnóstico de proveedores market metrics", () => {
  it("expone estados honestos, edad y contadores de consumo", async () => {
    delete process.env.COINGLASS_API_KEY;
    delete process.env.WHALEALERT_API_KEY;
    marketMetricsService.recordEvaluationInvocation();
    marketMetricsService.recordEvaluationInvocation();
    marketMetricsService.recordEvaluationPersisted();

    const diagnostics = await marketMetricsService.getDiagnostics() as any;
    expect(diagnostics.providers.coinglass.state).toBe("no_credentials");
    expect(diagnostics.providers.whalealert.state).toBe("no_credentials");
    expect(diagnostics.providers.coinmetrics.state).toBe("no_coverage");
    expect(diagnostics.providers.binance).toHaveProperty("lastObservationAgeMs");
    expect(diagnostics.consumption.invocations).toBeGreaterThanOrEqual(2);
    expect(diagnostics.consumption.evaluationsPersisted).toBeGreaterThanOrEqual(1);
    expect(diagnostics.consumption.consumers).toContain("SPOT legacy applyMarketMetricsGate");
    expect(diagnostics.consumption.consumers).toContain("IDCA entry-diagnostics advisory");
  });
});
