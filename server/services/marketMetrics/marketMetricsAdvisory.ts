import { marketMetricsEngine } from "./MarketMetricsEngine";
import { marketMetricsService } from "./MarketMetricsService";
import type { MarketMetricsDecision } from "./MarketMetricsTypes";

export async function evaluateMarketMetricsAdvisory(
  pair: string,
  now: Date = new Date()
): Promise<MarketMetricsDecision> {
  const storedConfig = await marketMetricsService.getConfig();
  const advisoryConfig = {
    ...storedConfig,
    enabled: true,
    mode: "observacion" as const,
  };
  const { metrics, stalenessMs, metricMeta } = await marketMetricsService.getLatestMetrics(
    advisoryConfig,
    now.getTime()
  );
  marketMetricsService.recordEvaluationInvocation();
  return marketMetricsEngine.evaluate(
    { pair, side: "buy" },
    metrics,
    advisoryConfig,
    stalenessMs,
    metricMeta
  );
}
