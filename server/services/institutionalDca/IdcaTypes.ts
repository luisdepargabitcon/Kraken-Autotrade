/**
 * IdcaTypes — Type definitions for the Institutional DCA module.
 */

export type IdcaMode = "disabled" | "simulation" | "live";
export type IdcaCycleStatus = "idle" | "waiting_entry" | "active" | "tp_armed" | "trailing_active" | "paused" | "blocked" | "closed";
export type IdcaOrderType = "base_buy" | "safety_buy" | "partial_sell" | "final_sell" | "breakeven_sell" | "emergency_sell" | "manual_sell";
export type IdcaSizeProfile = "aggressive_quality" | "balanced" | "defensive";
export type IdcaReinvestMode = "none" | "profits_only" | "full";
export type DipReferenceMethod = "hybrid" | "swing_high" | "window_high";
export type BasePriceType = "swing_high_1h" | "window_high_p95" | "hybrid_v2" | "cycle_start_price";

// ─── Single source of truth for valid dip reference methods ───────────
export const VALID_DIP_REFERENCE_METHODS: readonly DipReferenceMethod[] = ["hybrid", "swing_high", "window_high"] as const;

export function isValidDipReferenceMethod(value: unknown): value is DipReferenceMethod {
  return typeof value === "string" && (VALID_DIP_REFERENCE_METHODS as readonly string[]).includes(value);
}

export function normalizeDipReferenceMethod(
  value: unknown,
  context?: { pair?: string; origin?: string }
): DipReferenceMethod {
  if (isValidDipReferenceMethod(value)) return value;
  const ctx = context ? ` [pair=${context.pair ?? "?"}, origin=${context.origin ?? "?"}]` : "";
  console.warn(`[IDCA][DIP_REF] Invalid dipReference='${value}' — falling back to 'hybrid'${ctx}`);
  return "hybrid";
}

export interface BasePriceResult {
  price: number;
  type: BasePriceType;
  windowMinutes: number;
  timestamp: Date;
  isReliable: boolean;
  reason: string;
  meta?: {
    // Core counts
    candleCount: number;       // candles in primary (24h) window
    candleCount7d?: number;
    candleCount30d?: number;
    swingHighsFound: number;
    swingWindowUsed?: number;  // 1440 | 2880 | 4320 — which window found the swing
    // Candidates computed
    candidates?: {
      swingHigh24h?: number;
      swingHighExpanded?: number;  // swing found in 48h/72h fallback
      p95_24h?: number;
      windowHigh24h?: number;
      p95_7d?: number;
      p95_30d?: number;
    };
    // Decision
    selectedMethod?: string;   // 'swing_high_24h' | 'swing_high_48h' | 'swing_high_72h' | 'p95_24h' | 'p95_7d' | ...
    selectedReason?: string;
    selectedAnchorPrice?: number;
    selectedAnchorTime?: Date;
    drawdownPctFromAnchor?: number;
    // Outlier guard
    outlierRejected?: boolean;
    outlierRejectedValue?: number;
    // Caps applied
    capsApplied?: {
      cappedBy7d?: boolean;
      cappedBy30d?: boolean;
      originalBase?: number;
    };
    // Volatility context
    atrPct?: number;
    // Dynamic tolerances (Hybrid V2.1 audit trail)
    dynamicTols?: {
      pair: string;
      swingAlignmentTol: number;      // % dynamic value used
      swingAlignmentTolFixedLegacy: number; // % legacy fixed reference
      cap7dTol: number;
      cap7dTolFixedLegacy: number;
      cap30dTol: number;
      cap30dTolFixedLegacy: number;
      atrPctUsed: number;
    };
    // Legacy fields (kept for backward compat)
    p95Value?: number;
    maxAbsolute?: number;
    filteredWindow?: number;
  };
}

// ─── IDCA Price Context (macro / multi-timeframe) ─────────────────────
export interface IdcaBucketContext {
  bucket: "7d" | "30d" | "90d" | "180d";
  highMax: number;
  lowMin: number;
  p95High: number;
  avgClose: number;
  drawdownFromHighPct: number;
  rangePosition: number;   // 0=at low, 1=at high
  candleCount: number;
}

export interface IdcaMacroContext {
  pair: string;
  computedAt: Date;
  buckets: Partial<Record<"7d" | "30d" | "90d" | "180d", IdcaBucketContext>>;
  // Structural (from daily cache, ~2 years)
  high2y?: number;
  high2yTime?: Date;
  low2y?: number;
  low2yTime?: Date;
  yearHigh?: number;
  yearLow?: number;
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
  // ── Compras ──────────────────────────────────────────────────────
  cycle_started: boolean;
  base_buy_executed: boolean;
  safety_buy_executed: boolean;
  buy_blocked: boolean;
  // ── Sistema de salida ────────────────────────────────────────────
  protection_armed: boolean;          // Break-even armado (stop a coste)
  trailing_activated: boolean;        // Trailing stop activado (start seguimiento)
  tp_armed: boolean;                  // TP alcanzado: venta parcial + trailing residual
  trailing_exit: boolean;             // Trailing stop ejecutado → venta final
  breakeven_exit: boolean;            // Salida por break-even (stop tocado)
  module_max_drawdown_reached: boolean; // Módulo superó drawdown máximo
  // ── Eventos de ciclo ─────────────────────────────────────────────
  cycle_closed: boolean;
  partial_sell_executed: boolean;
  trailing_updated: boolean;
  daily_summary: boolean;
  critical_error: boolean;
  smart_adjustment_applied: boolean;
  simulation_alerts_enabled: boolean;
  // ── VWAP / Trailing Buy ──────────────────────────────────────────
  vwap_anchor_changed: boolean;       // Ancla VWAP actualizada a precio más alto
  vwap_approaching_buy: boolean;      // Precio a ≤3% del trigger de compra (cooldown 2h)
  vwap_drawdown_milestone: boolean;   // Caída -5%, -10%, -15%, -20% desde ancla (1x por hito)
  trailing_buy_armed: boolean;        // Trailing buy armado (precio entró en zona de interés)
  trailing_buy_triggered: boolean;    // Trailing buy disparado (rebote confirmado)
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

export interface VwapEntryContext {
  vwap: number;
  upperBand1: number;
  lowerBand1: number;
  upperBand2: number;
  lowerBand2: number;
  lowerBand3: number;
  stdDev: number;
  anchorTime: number;
  candlesUsed: number;      // candles from anchor (used for VWAP)
  candlesForSigma: number;  // candles used for stdDev (>= candlesUsed, min 24)
  isReliable: boolean;
  zone: "below_lower3" | "below_lower2" | "below_lower1" | "between_bands" | "above_upper1" | "above_upper2";
  distanceFromVwapPct: number;
  distanceFromLower1Pct: number;
  vwapWeekly: number | null;
  vwapMonthly: number | null;
}

export interface IdcaEntryCheckResult {
  allowed: boolean;
  blockReasons: IdcaBlockReason[];
  marketScore?: number;
  volatilityScore?: number;
  sizeProfile?: IdcaSizeProfile;
  entryDipPct?: number;
  basePrice?: BasePriceResult;
  reboundConfirmed?: boolean;
  vwapContext?: VwapEntryContext;
  effectiveBasePrice?: number;
  effectiveMinDip?: number;
  basePriceMethod?: string;
  weeklyTrend?: "below" | "above" | "unknown";
  monthlyBias?: "aggressive" | "balanced" | "defensive" | "unknown";
  entrySource?: "normal" | "trailing_buy";
  dipValidatedBy?: "currentPrice" | "localLow";
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

export type IdcaCycleType = "main" | "plus" | "recovery";

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

// ─── Recovery Config ─────────────────────────────────────────────

export interface RecoveryConfig {
  enabled: boolean;
  activationDrawdownPct: number;           // min drawdown on main to trigger (default 25)
  maxRecoveryCyclesPerMain: number;        // default 1
  maxTotalCyclesPerPair: number;           // main + plus + recovery (default 3)
  maxPairExposurePct: number;              // % of module capital (default 40)
  capitalAllocationPct: number;            // % of module capital for recovery (default 10)
  maxRecoveryCapitalUsd: number;           // absolute cap (default 500)
  cooldownMinutesAfterMainBuy: number;     // wait after last main buy (default 120)
  cooldownMinutesBetweenRecovery: number;  // between recovery cycles (default 360)
  minMarketScoreForRecovery: number;       // minimum score 0-100 (default 40)
  requireReboundConfirmation: boolean;     // default true
  recoveryTpPctBtc: number;               // conservative TP (default 2.5)
  recoveryTpPctEth: number;               // conservative TP (default 3.0)
  maxRecoveryEntries: number;              // base + safety (default 2)
  recoveryEntryDipSteps: number[];         // default [2.0, 4.0]
  recoveryTrailingPctBtc: number;          // tight trailing (default 0.8)
  recoveryTrailingPctEth: number;          // tight trailing (default 1.0)
  autoCloseIfMainClosed: boolean;          // default true
  autoCloseIfMainRecovers: boolean;        // close if main goes positive (default false)
  maxRecoveryDurationHours: number;        // max lifespan (default 168 = 7d)
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

// ─── Edit Imported Cycle ──────────────────────────────────────────

export interface EditImportedCycleRequest {
  avgEntryPrice?: number;      // Precio medio corregido
  quantity?: number;           // Cantidad corregida
  capitalUsedUsd?: number;     // Capital/coste total (opcional, calculable)
  exchangeSource?: string;     // revolut_x | kraken | other
  startedAt?: string;          // ISO date - fecha de apertura real
  soloSalida?: boolean;        // Cambio modo gestión
  notes?: string;              // Notas actualizadas
  feesPaidUsd?: number;        // Fees reales pagados
  estimatedFeePct?: number;    // % fee estimado

  // Metadatos de auditoría obligatorios
  editReason: string;          // "Error al introducir precio", etc.
  editAcknowledged: boolean;   // Confirmación de consecuencias
}

export interface EditHistoryEntry {
  editedAt: string;              // ISO timestamp
  editedBy: string;              // user_manual o api_key
  reason: string;                // Motivo de la edición
  case: "A_no_activity" | "B_with_activity"; // Caso A o B
  changes: Record<string, { old: string | number | null; new: string | number | null }>;
  derivedImpact: Record<string, { old: string | number | null; new: string | number | null }>;
  activityAtEdit: {
    buyCount: number;
    hasPostImportSells: boolean;
    status: string;
  };
}

export interface PostImportActivityCheck {
  hasActivity: boolean;
  buyCount: number;
  postImportSells: number;
  safetyBuys: number;
  currentStatus: string;
  case: "A_no_activity" | "B_with_activity";
  warnings: string[];
}

// ─── Ladder ATRP Config ───────────────────────────────────────────────

export type LadderProfile = "aggressive" | "balanced" | "conservative" | "custom";

export interface LadderAtrpConfig {
  // Master switches
  enabled: boolean;
  profile: LadderProfile;
  
  // Intensity slider (0-100)
  sliderIntensity: number;  // 0 = ultra conservative, 100 = ultra aggressive
  
  // Multipliers based on ATRP
  baseMultiplier: number;      // Base ATRP multiplier for first safety order
  stepMultiplier: number;      // Increment per level
  maxMultiplier: number;       // Maximum ATRP multiplier
  
  // Effective multipliers (calculated)
  effectiveMultipliers: number[];  // Final ATRP multipliers per level
  
  // Size distribution
  sizeDistribution: number[];     // % per level (sums to 100)
  
  // Clamps
  minDipPct: number;          // Minimum dip % (absolute floor)
  maxDipPct: number;          // Maximum dip % (absolute ceiling)
  maxLevels: number;          // Maximum number of safety orders
  
  // Deep ladder settings
  depthMode: "normal" | "deep" | "manual";  // How deep the ladder can go
  targetCoveragePct: number;  // Target coverage % (e.g., 8 for BTC, 10 for ETH)
  minStepPct: number;         // Minimum step between levels (%)
  allowDeepExtension: boolean;  // Allow extending beyond calculated coverage
  
  // Manual per-level configuration
  manualLevelEnabled?: boolean;  // Whether manual per-level configuration is enabled
  manualMultipliers?: number[];  // Manual ATRP multipliers per level
  manualSizeDistribution?: number[];  // Manual size distribution per level
  
  // Advanced settings
  adaptiveScaling: boolean;   // Scale with volatility
  volatilityScaling: number;  // How much to scale with ATRP
  rebalanceOnVwap: boolean;   // Rebalance based on VWAP zones
}

export interface LadderLevel {
  level: number;              // 0 = base buy, 1+ = safety orders
  dipPct: number;             // Dip % from anchor
  triggerPrice: number;       // Price where this level triggers
  sizePct: number;            // % of asset budget for this level
  atrpMultiplier: number;     // ATRP multiplier used
  isActive: boolean;          // Whether this level is active
}

export interface LadderResult {
  levels: LadderLevel[];
  totalLevels: number;
  maxDrawdownCovered: number;  // Maximum dip % covered by ladder
  totalSizePct: number;        // Total % of asset budget
  isLimitedByMaxLevels?: boolean;  // Whether target coverage was limited by maxLevels
  calculatedAt: Date;
  config: LadderAtrpConfig;
  marketContext: {
    anchorPrice: number;
    currentPrice: number;
    atrPct?: number;
    vwapZone?: string;
  };
}

// ─── Trailing Buy Level 1 Config ───────────────────────────────────────

export interface TrailingBuyLevel1Config {
  enabled: boolean;
  
  // Trigger conditions
  triggerLevel: number;        // Which ladder level triggers trailing (0 = base, 1 = first safety)
  triggerMode: "dip_pct" | "atrp_multiplier";  // How to trigger
  
  // Trailing parameters
  trailingMode: "rebound_pct" | "atrp_fraction";
  trailingValue: number;       // Either % rebound or ATRP fraction
  
  // Time limits
  maxWaitMinutes: number;      // Maximum time to wait for trigger
  cancelOnRecovery: boolean;   // Cancel if price recovers too much
  
  // Advanced
  minVolumeCheck: boolean;     // Check volume before triggering
  confirmWithVwap: boolean;    // Require VWAP confirmation

  // Execution safety
  maxTrailingBuyOvershootPct?: number; // Max % above buyThreshold allowed at execution (default 0.30)
}

export interface TrailingBuyState {
  isArmed: boolean;
  triggeredAt?: Date;
  localLow?: number;
  targetPrice?: number;
  triggerLevel: number;
  expiresAt?: Date;
}
