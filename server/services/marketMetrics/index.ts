// ============================================================
// index.ts — Re-exportaciones del módulo marketMetrics
// ============================================================

export { marketMetricsService } from "./MarketMetricsService";
export { marketMetricsEngine } from "./MarketMetricsEngine";
export type {
  MarketMetricsDecision,
  MetricsEvalContext,
  MarketMetricsConfig,
  MetricsAction,
  MetricsMode,
  RiskLevel,
  Bias,
} from "./MarketMetricsTypes";
export { DEFAULT_METRICS_CONFIG, makePassthroughDecision } from "./MarketMetricsTypes";
