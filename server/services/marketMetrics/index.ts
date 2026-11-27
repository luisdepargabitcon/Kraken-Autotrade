// ============================================================
// index.ts — Re-exportaciones del módulo marketMetrics
// ============================================================

export { marketMetricsService } from "./MarketMetricsService";
export { marketMetricsEngine } from "./MarketMetricsEngine";
export { evaluateMarketMetricsAdvisory } from "./marketMetricsAdvisory";
export { analyzeMarketMetricsAchievability } from "./marketMetricsAlcanzabilidad";
export type {
  MarketMetricsDecision,
  MetricsEvalContext,
  MarketMetricsConfig,
  MetricsAction,
  MetricsMode,
  RiskLevel,
  Bias,
  MarketMetricsDecisionStatus,
  MarketMetricDataQuality,
} from "./MarketMetricsTypes";
export { DEFAULT_METRICS_CONFIG, makePassthroughDecision } from "./MarketMetricsTypes";
