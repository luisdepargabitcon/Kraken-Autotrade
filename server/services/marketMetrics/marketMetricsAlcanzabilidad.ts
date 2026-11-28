import { SCORE_THRESHOLDS, SENSITIVITY_MULTIPLIERS, type MetricsSensitivity } from "./MarketMetricsTypes";

export interface MarketMetricsProviderSetDefinition {
  name: string;
  metrics: string[];
}

export interface MarketMetricsAchievabilityRow {
  providerSet: string;
  sensitivity: MetricsSensitivity;
  maxRawScore: number;
  maxScore: number;
  bloquearReachable: boolean;
}

const MAX_POINTS_BY_METRIC: Record<string, number> = {
  exchange_netflow: 2,
  whale_inflow_usd: 2,
  stablecoin_supply_delta_24h: 2,
  open_interest_delta_24h_pct: 1,
  funding_rate: 2,
  liquidations_1h_usd: 2,
};

export const PROVIDER_SETS: MarketMetricsProviderSetDefinition[] = [
  { name: "Binance Futures + DeFiLlama", metrics: ["open_interest_delta_24h_pct", "funding_rate", "stablecoin_supply_delta_24h"] },
  { name: "Binance Futures", metrics: ["open_interest_delta_24h_pct", "funding_rate"] },
  { name: "DeFiLlama", metrics: ["stablecoin_supply_delta_24h"] },
  {
    name: "Todos los proveedores",
    metrics: [
      "exchange_netflow",
      "whale_inflow_usd",
      "stablecoin_supply_delta_24h",
      "open_interest_delta_24h_pct",
      "funding_rate",
      "liquidations_1h_usd",
    ],
  },
];

export function analyzeMarketMetricsAchievability(
  providerSets: MarketMetricsProviderSetDefinition[] = PROVIDER_SETS
): MarketMetricsAchievabilityRow[] {
  const rows: MarketMetricsAchievabilityRow[] = [];
  for (const set of providerSets) {
    const maxRawScore = set.metrics.reduce((sum, metric) => sum + (MAX_POINTS_BY_METRIC[metric] ?? 0), 0);
    for (const sensitivity of Object.keys(SENSITIVITY_MULTIPLIERS) as MetricsSensitivity[]) {
      const maxScore = Math.round(maxRawScore * SENSITIVITY_MULTIPLIERS[sensitivity]);
      rows.push({
        providerSet: set.name,
        sensitivity,
        maxRawScore,
        maxScore,
        bloquearReachable: maxScore > SCORE_THRESHOLDS.MEDIUM.max,
      });
    }
  }
  return rows;
}
