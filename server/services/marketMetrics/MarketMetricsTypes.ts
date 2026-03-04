// ============================================================
// MarketMetricsTypes.ts
// Tipos centrales del módulo de Métricas de Mercado
// ============================================================

export type RiskLevel = "BAJO" | "MEDIO" | "ALTO" | "DESCONOCIDO";
export type Bias = "ALCISTA" | "BAJISTA" | "NEUTRAL" | "DESCONOCIDO";
export type MetricsAction = "PERMITIR" | "AJUSTAR" | "BLOQUEAR";
export type MetricsMode = "observacion" | "activo";
export type MetricsSensitivity = "conservador" | "normal" | "agresivo";

// ---- Snapshot de una métrica individual ----
export interface MetricSnapshot {
  source: string;
  metric: string;
  asset: string | null;
  pair: string | null;
  value: number;
  tsProvider: Date | null;
  tsIngested: Date;
  meta: Record<string, unknown>;
  staleSec: number;
  isStale: boolean;
}

// ---- Resultado de la evaluación del Engine ----
export interface MarketMetricsDecision {
  enabled: boolean;
  available: boolean;
  mode: MetricsMode;
  riskLevel: RiskLevel;
  score: number;
  bias: Bias;
  action: MetricsAction;
  adjustments?: {
    minSignalsDelta?: number;
    sizeMultiplier?: number;
  };
  reasons: string[];
  details: {
    metrics: Record<string, number | null>;
    thresholds: Record<string, number>;
    stalenessMs: Record<string, number>;
    scoreBreakdown: ScoreBreakdown[];
  };
}

export interface ScoreBreakdown {
  metric: string;
  value: number | null;
  points: number;
  reason: string;
}

// ---- Contexto de entrada al Engine ----
export interface MetricsEvalContext {
  pair: string;
  side: "buy" | "sell";
  regime?: string | null;
  strategyId?: string;
  signalsCount?: number;
  tradeAmountUSD?: number;
}

// ---- Configuración del módulo (cargada desde DB / bot_config) ----
export interface MarketMetricsConfig {
  enabled: boolean;
  mode: MetricsMode;
  applyToBuy: boolean;
  applyToSell: boolean;
  sensitivity: MetricsSensitivity;
  stalenessMaxMs: {
    stablecoins: number;
    netflow: number;
    whaleActivity: number;
    derivatives: number;
  };
}

export const DEFAULT_METRICS_CONFIG: MarketMetricsConfig = {
  enabled: false,
  mode: "observacion",
  applyToBuy: true,
  applyToSell: false,
  sensitivity: "normal",
  stalenessMaxMs: {
    stablecoins: 6 * 60 * 60 * 1000,   // 6h
    netflow:     6 * 60 * 60 * 1000,   // 6h
    whaleActivity: 2 * 60 * 60 * 1000, // 2h
    derivatives: 1 * 60 * 60 * 1000,   // 1h
  },
};

// ---- Sensitivity multipliers ----
export const SENSITIVITY_MULTIPLIERS: Record<MetricsSensitivity, number> = {
  conservador: 0.7,
  normal: 1.0,
  agresivo: 1.4,
};

// ---- Score thresholds ----
export const SCORE_THRESHOLDS = {
  LOW:    { min: 0, max: 2 },  // BAJO => PERMITIR
  MEDIUM: { min: 3, max: 4 },  // MEDIO => AJUSTAR
  HIGH:   { min: 5, max: 99 }, // ALTO => BLOQUEAR
} as const;

// ---- Known metric names ----
export const METRIC_NAMES = {
  STABLECOIN_SUPPLY_DELTA_24H: "stablecoin_supply_delta_24h",
  STABLECOIN_SUPPLY_DELTA_7D:  "stablecoin_supply_delta_7d",
  EXCHANGE_NETFLOW:            "exchange_netflow",
  EXCHANGE_RESERVES:           "exchange_reserves",
  WHALE_INFLOW_USD:            "whale_inflow_usd",
  OPEN_INTEREST:               "open_interest",
  FUNDING_RATE:                "funding_rate",
  LIQUIDATIONS_1H_USD:         "liquidations_1h_usd",
} as const;

// ---- Passthrough decision (cuando disabled o no disponible) ----
export function makePassthroughDecision(
  enabled: boolean,
  mode: MetricsMode,
  reason?: string
): MarketMetricsDecision {
  return {
    enabled,
    available: false,
    mode,
    riskLevel: "DESCONOCIDO",
    score: 0,
    bias: "DESCONOCIDO",
    action: "PERMITIR",
    reasons: reason ? [reason] : [],
    details: {
      metrics: {},
      thresholds: {},
      stalenessMs: {},
      scoreBreakdown: [],
    },
  };
}
