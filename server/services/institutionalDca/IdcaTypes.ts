/**
 * IdcaTypes — Type definitions for the Institutional DCA module.
 */

export type IdcaMode = "disabled" | "simulation" | "live";
export type IdcaCycleStatus = "idle" | "waiting_entry" | "active" | "tp_armed" | "trailing_active" | "paused" | "blocked" | "closed";
export type IdcaOrderType = "base_buy" | "safety_buy" | "partial_sell" | "final_sell" | "breakeven_sell" | "emergency_sell";
export type IdcaSizeProfile = "aggressive_quality" | "balanced" | "defensive";
export type IdcaReinvestMode = "none" | "profits_only" | "full";
export type DipReferenceMethod = "hybrid" | "swing_high" | "window_high" | "ema";
export type BasePriceType = "swing_high_1h" | "window_high_p95" | "cycle_start_price";

export interface BasePriceResult {
  price: number;
  type: BasePriceType;
  windowMinutes: number;
  timestamp: Date;
  isReliable: boolean;
  reason: string;
  meta?: {
    candleCount: number;
    swingHighsFound: number;
    p95Value?: number;
    maxAbsolute?: number;
    filteredWindow?: number;
  };
}

export interface SafetyOrderLevel {
  dipPct: number;
  sizePctOfAssetBudget: number;
}

export interface MarketScoreWeights {
  ema20_distance: number;
  ema50_distance: number;
  ema20_slope: number;
  ema50_slope: number;
  rsi: number;
  relative_volume: number;
  drawdown_from_high: number;
  btc_condition: number;
}

export interface TelegramAlertToggles {
  cycle_started: boolean;
  base_buy_executed: boolean;
  safety_buy_executed: boolean;
  buy_blocked: boolean;
  tp_armed: boolean;
  partial_sell_executed: boolean;
  trailing_updated: boolean;
  trailing_exit: boolean;
  breakeven_exit: boolean;
  cycle_closed: boolean;
  daily_summary: boolean;
  critical_error: boolean;
  smart_adjustment_applied: boolean;
  simulation_alerts_enabled: boolean;
}

export interface IdcaBlockReason {
  code: string;
  message: string;
  pair?: string;
  timestamp: Date;
}

export const IDCA_BLOCK_CODES = [
  "spread_too_high",
  "sell_pressure_too_high",
  "breakdown_detected",
  "asset_exposure_max_reached",
  "module_exposure_max_reached",
  "combined_exposure_exceeded",
  "module_max_drawdown_reached",
  "buy_cooldown_active",
  "max_cycle_duration_reached",
  "mode_disabled",
  "pair_not_allowed",
  "btc_breakdown_blocks_eth",
  "market_score_too_low",
  "institutional_dca_toggle_off",
  "global_trading_pause",
  "insufficient_base_price_data",
] as const;

export type IdcaBlockCode = typeof IDCA_BLOCK_CODES[number];

export interface IdcaEntryCheckResult {
  allowed: boolean;
  blockReasons: IdcaBlockReason[];
  marketScore?: number;
  volatilityScore?: number;
  sizeProfile?: IdcaSizeProfile;
  entryDipPct?: number;
  basePrice?: BasePriceResult;
  reboundConfirmed?: boolean;
}

export interface IdcaPairEvaluation {
  pair: string;
  currentPrice: number;
  basePrice: number;
  basePriceType: BasePriceType;
  entryDipPct: number;
  marketScore: number;
  volatilityScore: number;
  regime: string;
  isBreakdown: boolean;
  reboundDetected: boolean;
}

export const SIZE_PROFILES: Record<IdcaSizeProfile, number[]> = {
  aggressive_quality: [30, 25, 25, 20],
  balanced: [25, 25, 25, 25],
  defensive: [15, 20, 30, 35],
};

export type IdcaCycleType = "main" | "plus";

export interface DynamicTpConfig {
  baseTpPctBtc: number;
  baseTpPctEth: number;
  reductionPerExtraBuyMain: number;
  reductionPerExtraBuyPlus: number;
  weakReboundReductionMain: number;
  weakReboundReductionPlus: number;
  strongReboundBonusMain: number;
  strongReboundBonusPlus: number;
  highVolatilityAdjustMain: number;
  highVolatilityAdjustPlus: number;
  lowVolatilityAdjustMain: number;
  lowVolatilityAdjustPlus: number;
  mainMinTpPctBtc: number;
  mainMaxTpPctBtc: number;
  mainMinTpPctEth: number;
  mainMaxTpPctEth: number;
  plusMinTpPctBtc: number;
  plusMaxTpPctBtc: number;
  plusMinTpPctEth: number;
  plusMaxTpPctEth: number;
}

export interface TpBreakdown {
  finalTpPct: number;
  baseTpPct: number;
  buyCountAdjustment: number;
  volatilityAdjustment: number;
  reboundAdjustment: number;
  clampedToMin: boolean;
  clampedToMax: boolean;
  cycleType: IdcaCycleType;
  minTpPct: number;
  maxTpPct: number;
}

export interface DynamicTpInput {
  pair: string;
  cycleType: IdcaCycleType;
  buyCount: number;
  marketScore: number;
  volatilityPct: number;
  reboundStrength: "none" | "weak" | "strong";
  config: DynamicTpConfig;
}

export interface PlusConfig {
  enabled: boolean;
  maxPlusCyclesPerMain: number;
  maxPlusEntries: number;
  capitalAllocationPct: number;
  activationExtraDipPct: number;
  requireMainExhausted: boolean;
  requireReboundConfirmation: boolean;
  cooldownMinutesBetweenBuys: number;
  autoCloseIfMainClosed: boolean;
  maxExposurePctPerAsset: number;
  entryDipSteps: number[];
  entrySizingMode: "fixed" | "adaptive";
  baseTpPctBtc: number;
  baseTpPctEth: number;
  trailingPctBtc: number;
  trailingPctEth: number;
}

// ─── Import Position ──────────────────────────────────────────────

export type ImportSourceType = "manual" | "normal_bot" | "exchange" | "external";
export type ImportManagedBy = "idca" | "normal_bot" | "external" | "manual";

export interface ImportPositionRequest {
  pair: string;
  quantity: number;
  avgEntryPrice: number;
  capitalUsedUsd?: number;   // auto-calculated if omitted
  sourceType: ImportSourceType;
  soloSalida: boolean;
  notes?: string;
  openedAt?: string;         // ISO date
  feesPaidUsd?: number;
  // Manual cycle & exchange fields
  isManualCycle?: boolean;
  exchangeSource?: string;   // revolut_x | kraken | other
  estimatedFeePct?: number;
  estimatedFeeUsd?: number;
  feesOverrideManual?: boolean;
  warningAcknowledged?: boolean; // user confirmed coexistence warning
}
