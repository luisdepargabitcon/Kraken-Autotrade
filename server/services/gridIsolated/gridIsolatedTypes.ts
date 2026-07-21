/**
 * Grid Isolated Types — Type definitions for the Isolated Professional Grid Engine.
 *
 * This module is INDEPENDENT from Spot Normal, IDCA, and the IDCA Grid Overlay.
 * It does NOT share inventories, capital, or state with any other strategy.
 *
 * Market data is consumed via MarketDataService (central, Kraken-sourced).
 * WBands (Bollinger Bands) are consumed via the indicators module (no duplication).
 *
 * Safety: REAL_LIMITED and REAL_FULL modes are fully implemented but LOCKED
 * until explicit safety conditions are met (see GridModeLock).
 */

// ─── Operational Modes ──────────────────────────────────────────────

export type GridMode = "OFF" | "SHADOW" | "REAL_LIMITED" | "REAL_FULL";

export const GRID_MODE_VALUES: GridMode[] = ["OFF", "SHADOW", "REAL_LIMITED", "REAL_FULL"];

export function isModeReal(mode: GridMode): boolean {
  return mode === "REAL_LIMITED" || mode === "REAL_FULL";
}

export function isModeActive(mode: GridMode): boolean {
  return mode !== "OFF";
}

// ─── Capital Allocation Profiles ────────────────────────────────────

export type CapitalProfile = "conservative" | "balanced" | "aggressive";

export type AllocationMode = "uniform" | "progressive_conservative" | "progressive_aggressive" | "adaptive_market";

export type CapitalDeploymentMode = "capped" | "target_budget" | "adaptive_budget";

export interface PerLevelAllocation {
  levelIndex: number;
  side: "BUY" | "SELL";
  weight: number;
  allocationUsd: number;
  allocationReason: string;
}

export interface CapitalAllocationSummary {
  totalWalletUsd: number;
  configuredMaxCapitalBudgetUsd: number;
  configuredReservePct: number;
  buyLevelsCount: number;
  sellLevelsCount: number;
  plannedBuyUsd: number;
  plannedSellNotionalUsd: number;
  grossVisualNotionalUsd: number;
  usdActuallyNeededForBuyLevels: number;
  usdNotNeededBecauseSellLevelsDoNotConsumeUsd: number;
  maxBudgetReferenceUsd: number;
  budgetUsedPct: number;
  budgetUnusedUsd: number;
  budgetUnusedReason: string;
  allocationMode: AllocationMode;
  capitalDeploymentMode: CapitalDeploymentMode;
  allocationExplanation: string;
  perLevelAllocations: PerLevelAllocation[];
}

export interface CapitalProfileConfig {
  reservePct: number;
  maxCapitalPctOfBalance: number;
  maxLevelsPerRange: number;
  minNotionalPerLevelUsd: number;
  maxNotionalPerLevelUsd: number;
}

export const CAPITAL_PROFILES: Record<CapitalProfile, CapitalProfileConfig> = {
  conservative: {
    reservePct: 30,
    maxCapitalPctOfBalance: 15,
    maxLevelsPerRange: 8,
    minNotionalPerLevelUsd: 50,
    maxNotionalPerLevelUsd: 500,
  },
  balanced: {
    reservePct: 20,
    maxCapitalPctOfBalance: 25,
    maxLevelsPerRange: 12,
    minNotionalPerLevelUsd: 30,
    maxNotionalPerLevelUsd: 800,
  },
  aggressive: {
    reservePct: 10,
    maxCapitalPctOfBalance: 40,
    maxLevelsPerRange: 16,
    minNotionalPerLevelUsd: 20,
    maxNotionalPerLevelUsd: 1200,
  },
};

// ─── Execution Policy ───────────────────────────────────────────────

export type ExecutionPolicy =
  | "MAKER_ONLY"
  /** @deprecated Legacy fallback policies kept only for parsing old configs. New cycles default to MAKER_ONLY. */
  | "MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK"
  /** @deprecated Legacy fallback policies kept only for parsing old configs. New cycles default to MAKER_ONLY. */
  | "MAKER_3_ATTEMPTS_THEN_TAKER_FALLBACK";

/** Default policy for the Grid: maker-only, no taker fallback. */
export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = "MAKER_ONLY";

/** SHADOW mode always uses maker-only, no taker fallback, zero real order fees. Fees are simulated using the configured buy/sell fee percentages. */
export const SHADOW_EXECUTION_POLICY: ExecutionPolicy = "MAKER_ONLY";

export const POST_ONLY_MAX_ATTEMPTS = 3;

export const MAKER_ATTEMPTS_BEFORE_TAKER = 3;
export const TAKER_FALLBACK_ATTEMPT_NUMBER = 4;
export const MAX_TAKER_FALLBACK_PER_CYCLE = 1;

export function executionPolicyLabel(policy: ExecutionPolicy): string {
  switch (policy) {
    case "MAKER_ONLY":
      return "Solo maker (sin taker fallback)";
    case "MAKER_3_ATTEMPTS_THEN_TAKER_FALLBACK":
      return "3 intentos maker + 4º taker controlado (legacy)";
    case "MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK":
      return "Maker primero, luego taker como fallback (legacy)";
    default:
      return policy;
  }
}

export const LEGACY_EXECUTION_POLICIES: readonly ExecutionPolicy[] = [
  "MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK",
  "MAKER_3_ATTEMPTS_THEN_TAKER_FALLBACK",
];

export function isLegacyExecutionPolicy(policy: ExecutionPolicy | string | null | undefined): boolean {
  if (!policy) return false;
  return (LEGACY_EXECUTION_POLICIES as readonly string[]).includes(policy as string);
}

/**
 * Returns the effective execution policy for a loaded config.
 * SHADOW always normalizes to MAKER_ONLY. REAL modes use the stored value,
 * but legacy fallback policies are allowed in memory only for old rows and
 * should not be applied for new cycles.
 */
export function getEffectiveExecutionPolicy(config: { mode: GridMode; executionPolicy: ExecutionPolicy }): ExecutionPolicy {
  if (config.mode === "SHADOW") return "MAKER_ONLY";
  return config.executionPolicy;
}
export const CIRCUIT_BREAKER_RETRY_DELAY_MS = 5 * 60 * 1000;
export const DAILY_ORDER_REQUEST_LIMIT = 300;
export const DAILY_ORDER_WARNING_THRESHOLD = 200;

// ─── Fee & Tax Constants ────────────────────────────────────────────

export const FEE_BUFFER_BUY_PCT = 0.09;
export const FEE_BUFFER_SELL_PCT = 0.09;
export const TAX_RESERVE_PCT = 20;

// ─── Grid Range Version ─────────────────────────────────────────────

export type RangeVersionStatus =
  | "proposed"
  | "active"
  | "paused"
  | "exhausted"
  | "closed"
  | "archived"
  | "replaced";

export interface GridRangeVersion {
  id: string;
  versionNumber: number;
  pair: string;
  status: RangeVersionStatus;
  midPrice: number;
  upperPrice: number;
  lowerPrice: number;
  bandUpper: number;
  bandMiddle: number;
  bandLower: number;
  bandWidthPct: number;
  atrPct: number;
  regime: string;
  levelsCount: number;
  geometricRatio: number;
  capitalBudgetUsd: number;
  capitalPerLevelUsd: number;
  netProfitTargetPct: number;
  createdAt: Date;
  activatedAt: Date | null;
  closedAt: Date | null;
}

// ─── Grid Level ─────────────────────────────────────────────────────

export type GridLevelSide = "BUY" | "SELL";
export type GridLevelStatus =
  | "planned"
  | "placed"
  | "open"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "expired"
  | "replaced";

export interface GridLevel {
  id: string;
  rangeVersionId: string;
  levelIndex: number;
  side: GridLevelSide;
  price: number;
  notionalUsd: number;
  quantity: number;
  status: GridLevelStatus;
  filledQuantity: number;
  filledPrice: number | null;
  clientOrderId: string;
  exchangeOrderId: string | null;
  postOnlyAttempts: number;
  usedTakerFallback: boolean;
  netProfitTargetUsd: number;
  feeEstimateUsd: number;
  taxReserveUsd: number;
  createdAt: Date;
  placedAt: Date | null;
  filledAt: Date | null;
  cancelledAt: Date | null;
}

// ─── Grid Cycle (Buy → Sell round trip) ─────────────────────────────

export type GridCycleStatus =
  | "pending"
  | "buy_placed"
  | "buy_filled"
  | "sell_placed"
  | "sell_filled"
  | "completed"
  | "stop_loss_hit"
  | "trailing_closed"
  | "hodl_recovery"
  | "cancelled"
  | "cycle_open";

export type GridExitPolicyVersion =
  | "SYMMETRIC_INDEX_V1"
  | "FIRST_PROFITABLE_HIGHER_RUNG_V2";

export type GridTargetKind =
  | "PERSISTED_SELL"
  | "SYNTHETIC_RUNG"
  | "UNKNOWN";

export type GridMakerExitState =
  | "NONE"
  | "ARMED"
  | "TRIGGERED"
  | "MAKER_PENDING"
  | "MAKER_FILLED"
  | "CANCELLED"
  | "REQUIRES_REVIEW";

export interface GridPendingMakerExit {
  state: GridMakerExitState;
  route: GridClosePath | null;
  triggerPrice: number | null;
  triggerDetectedAt: Date | null;
  bestBidAtTrigger: number | null;
  bestAskAtTrigger: number | null;
  requestedMakerPrice: number | null;
  makerOrderCreatedAt: Date | null;
  makerEligibleAfter: Date | null;
  /** Tick sequence in which the maker order was created; fills are only allowed on a later tick. */
  lifecycleTickId: number | null;
  lastRepricedAt: Date | null;
  repriceAttempts: number;
  pendingQuantity: number;
  simulatedOrderId: string | null;
  fillPrice: number | null;
  filledAt: Date | null;
  bestBidAtFill: number | null;
  bestAskAtFill: number | null;
  cancellationReason: string | null;
}

export interface GridCycleRiskState {
  trailing: TrailingProtectionState;
  stopLoss: StopLossLayer[];
  hodl: HodlRecoveryState;
  lastAction: RiskAction | null;
  activeExitRoute: GridClosePath | null;
  pendingExitPrice: number | null;
  protectiveExit: GridPendingMakerExit;
  stateVersion: number;
  lastEvaluatedAt: Date | null;
}

export type RiskAction =
  | "HOLD"
  | "TRAILING_UPDATE"
  | "TRAILING_CLOSE"
  | "STOP_LOSS_SOFT"
  | "STOP_LOSS_HARD"
  | "STOP_LOSS_EMERGENCY"
  | "HODL_RECOVERY_ACTIVATE"
  | "HODL_RECOVERY_SELL";

export type GridClosePath =
  | "NORMAL_TARGET"
  | "SYNTHETIC_RUNG"
  | "LEGACY_PERSISTED_TARGET"
  | "TRAILING_MAKER"
  | "PROTECTIVE_MAKER"
  | "HODL_RECOVERY";

export interface GridRejectedCandidate {
  levelId: string;
  side: GridLevelSide;
  price: number;
  reasonCode: string;
  reason: string;
}

export interface GridTargetCalculation {
  selected: boolean;
  /** Policy version used to compute this target (legacy field kept for audits). */
  policyVersion?: "FIRST_PROFITABLE_HIGHER_RUNG_V2";
  stateVersion: number;
  targetKind: GridTargetKind | null;
  targetSellLevelId: string | null;
  targetRungLevelId: string | null;
  targetSellPrice: number | null;
  targetSellQuantity: number | null;
  grossPnlUsd: number | null;
  exchangeFeesUsd: number | null;
  operationalCostsUsd: number | null;
  operationalNetPnlUsd: number | null;
  operationalNetPnlPct: number | null;
  taxReserveUsd: number | null;
  availablePnlAfterTaxUsd: number | null;
  availablePnlAfterTaxPct: number | null;
  netProfitTargetPct: number | null;
  rejectedCandidates: GridRejectedCandidate[];
  explanation: string;
  reasonCode?: string;
}

export interface GridCycle {
  id: string;
  rangeVersionId: string;
  cycleNumber: number;
  pair: string;
  status: GridCycleStatus;
  buyLevelId: string | null;
  sellLevelId: string | null;
  targetSellLevelId: string | null;
  /** Identificador del escalón RUNG original (BUY o SELL) usado para calcular el target. */
  targetRungLevelId: string | null;
  buyPrice: number | null;
  sellPrice: number | null;
  targetSellPrice: number | null;
  targetSellQuantity: number | null;
  quantity: number;
  grossPnlUsd: number;
  feeTotalUsd: number;
  taxReserveUsd: number;
  netPnlUsd: number;
  netPnlPct: number;
  /** Política de salida asignada a este ciclo. */
  exitPolicyVersion: GridExitPolicyVersion | null;
  /** Tipo de target: SELL persistida o RUNG sintético. */
  targetKind: GridTargetKind | null;
  /** Desglose del cálculo del target (costes, comisiones, reserva). */
  targetCalculationJson: GridTargetCalculation | null;
  /** Estado de trailing, stops y HODL recovery. */
  riskStateJson: GridCycleRiskState | null;
  /** Estado del ciclo de vida de la orden maker de salida (pending/filled). */
  makerExitStateJson: GridPendingMakerExit | null;
  buyClientOrderId: string | null;
  sellClientOrderId: string | null;
  buyFilledAt: Date | null;
  sellFilledAt: Date | null;
  holdTimeMinutes: number | null;
  createdAt: Date;
  completedAt: Date | null;
}

// Estados de ciclo con BUY aún no ejecutada. No se pueden cerrar con una SELL.
export const ENTRY_PENDING_GRID_CYCLE_STATUSES: readonly GridCycleStatus[] = [
  "pending",
  "buy_placed",
] as const;

// Estados de ciclo con posición comprada y pendiente de venta.
// processOpenCyclesShadow solo actúa sobre estos estados.
export const POSITION_OPEN_GRID_CYCLE_STATUSES: readonly GridCycleStatus[] = [
  "buy_filled",
  "sell_placed",
  "hodl_recovery",
] as const;

// Estados en los que ya se ejecutó una SELL pero falta finalización contable.
export const SELL_FILLED_PENDING_FINALIZATION_STATUSES: readonly GridCycleStatus[] = [
  "sell_filled",
] as const;

// Estados terminales que nunca se reprocesan.
export const TERMINAL_GRID_CYCLE_STATUSES: readonly GridCycleStatus[] = [
  "completed",
  "stop_loss_hit",
  "trailing_closed",
  "cancelled",
] as const;

// Estados de posición abierta para contadores, incluyendo HODL recovery.
// HODL recovery conserva BTC comprado a la espera de una salida posterior;
// por tanto se considera una posición abierta especial.
export const OPEN_POSITION_GRID_CYCLE_STATUSES: readonly GridCycleStatus[] = [
  ...POSITION_OPEN_GRID_CYCLE_STATUSES,
  ...SELL_FILLED_PENDING_FINALIZATION_STATUSES,
] as const;

// Estados que no pueden cerrarse automáticamente por SELL objetivo en esta fase.
export const NON_TARGET_SELL_CLOSABLE_STATUSES: readonly GridCycleStatus[] = [
  ...ENTRY_PENDING_GRID_CYCLE_STATUSES,
  ...TERMINAL_GRID_CYCLE_STATUSES,
  "hodl_recovery",
] as const;

export type GridCycleLifecycleState =
  | "ENTRY_PENDING"
  | "OPEN_WAITING_SELL"
  | "SELL_FILLED_PENDING_FINALIZATION"
  | "HODL_RECOVERY"
  | "COMPLETED"
  | "STOP_LOSS_HIT"
  | "TRAILING_CLOSED"
  | "CANCELLED"
  | "UNKNOWN";

export type GridCycleRangeRelation = "current_range" | "previous_range" | "unknown_range";

// ─── Pump/Dump Guard ────────────────────────────────────────────────

export type PumpDumpState = "normal" | "pump_detected" | "dump_detected" | "cooldown";

export interface PumpDumpGuardState {
  state: PumpDumpState;
  triggeredAt: Date | null;
  priceDeviationPct: number;
  volumeSpikeRatio: number;
  cooldownUntil: Date | null;
  reason: string;
}

// ─── Trailing Protection ────────────────────────────────────────────

export interface TrailingProtectionState {
  activated: boolean;
  activatedAt: Date | null;
  highestPriceSinceBuy: number | null;
  trailingStopPct: number;
  currentStopPrice: number | null;
  reason: string;
}

// ─── HODL Recovery ──────────────────────────────────────────────────

export interface HodlRecoveryState {
  active: boolean;
  activatedAt: Date | null;
  originalBuyPrice: number | null;
  recoveryTargetPrice: number | null;
  reason: string;
}

// ─── Stop Loss Layers ───────────────────────────────────────────────

export type StopLossLayerType = "soft" | "hard" | "emergency";

export interface StopLossLayer {
  layer: StopLossLayerType;
  triggerPricePct: number;
  triggered: boolean;
  triggeredAt: Date | null;
  reason: string;
}

// ─── Grid Isolated Config (persisted) ───────────────────────────────

export interface GridIsolatedConfig {
  id: string;
  pair: string;
  mode: GridMode;
  capitalProfile: CapitalProfile;
  executionPolicy: ExecutionPolicy;
  /** Política de salida por defecto para nuevos ciclos. */
  defaultExitPolicyVersion?: GridExitPolicyVersion;
  /** Activa/desactiva el trailing stop a nivel de ciclo. */
  trailingEnabled?: boolean;
  /** Activa/desactiva las capas de stop-loss. */
  stopLossEnabled?: boolean;
  /** Porcentaje de comisión simulada para la compra (maker en SHADOW). */
  buyFeePct: number;
  /** Porcentaje de comisión simulada para la venta (maker en SHADOW). */
  sellFeePct: number;
  netProfitTargetPct: number;
  bandPeriod: number;
  bandStdDevMultiplier: number;
  atrPeriod: number;
  atrTimeframe: string;
  gridStepAtrMultiplier: number;
  gridStepMinPct: number;
  gridStepMaxPct: number;
  geometricRatioMin: number;
  geometricRatioMax: number;
  trailingActivationPct: number;
  trailingStopPct: number;
  stopLossSoftPct: number;
  stopLossHardPct: number;
  stopLossEmergencyPct: number;
  hodlRecoveryEnabled: boolean;
  pumpGuardDeviationPct: number;
  pumpGuardVolumeSpikeRatio: number;
  pumpGuardCooldownMinutes: number;
  dumpGuardDeviationPct: number;
  dumpGuardVolumeSpikeRatio: number;
  dumpGuardCooldownMinutes: number;
  maxOpenCycles: number;
  maxDailyOrders: number;
  fiscalStatus: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  // ─── Execution: Maker/Taker ───
  makerAttemptsBeforeTaker: number;
  takerFallbackEnabled: boolean;
  takerFallbackAttemptNumber: number;
  maxTakerFallbackPerCycle: number;
  takerFallbackRequiresNetProfit: boolean;
  takerFallbackAuditRequired: boolean;
  // ─── Wallet / Cartera ───
  gridWalletMode: "automatic" | "manual";
  gridWalletInitialUsd: number;
  gridWalletMaxUsd: number;
  gridWalletUseProfits: boolean;
  gridWalletCompoundProfits: boolean;
  gridMaxCapitalPerCycleUsd: number;
  gridMaxCapitalPerCyclePct: number;
  gridReservePct: number;
  gridMinFreeCapitalUsd: number;
  gridPauseCycleWhenCapitalDepleted: boolean;
  gridAllowNewCycleWhenCapitalFree: boolean;
  // ─── Capital Allocation Modes ───
  gridAllocationMode: AllocationMode;
  gridCapitalDeploymentMode: CapitalDeploymentMode;
  gridProgressiveIntensity: number;
  gridMaxLevelPct: number;
  gridMinLevelUsd: number;
  // ─── Compact Range Control (3C.3-A) ───
  enforceCompactRange: boolean;
  gridRangeMaxPct: number;
  maxDistanceFromCenterPct: number;
  maxSellDistanceFromNearestBuyPct: number;
  // ─── Adaptive Smart Range (3C.3-C) ───
  gridRangeControlMode: 'adaptive_smart' | 'fixed_compact' | 'legacy_hybrid';
  adaptiveRangeEnabled: boolean;
  adaptiveRangeProfile: 'conservative' | 'balanced' | 'aggressive';
  adaptiveRangeMinPct: number;
  adaptiveRangeMaxPct: number;
  adaptiveRangeLowVolMaxPct: number;
  adaptiveRangeNormalMaxPct: number;
  adaptiveRangeHighVolMaxPct: number;
  adaptiveRangeTargetFullLevels: boolean;
  adaptiveRangeMinViableLevels: number;
}

export const DEFAULT_GRID_CONFIG: Omit<GridIsolatedConfig, "id" | "createdAt" | "updatedAt"> = {
  pair: "BTC/USD",
  mode: "OFF",
  capitalProfile: "balanced",
  executionPolicy: "MAKER_ONLY",
  defaultExitPolicyVersion: "FIRST_PROFITABLE_HIGHER_RUNG_V2",
  trailingEnabled: false,
  stopLossEnabled: false,
  buyFeePct: 0.09,
  sellFeePct: 0.09,
  netProfitTargetPct: 0.8,
  bandPeriod: 20,
  bandStdDevMultiplier: 2,
  atrPeriod: 14,
  atrTimeframe: "1h",
  gridStepAtrMultiplier: 1.5,
  gridStepMinPct: 0.15,
  gridStepMaxPct: 3.0,
  geometricRatioMin: 0.8,
  geometricRatioMax: 1.2,
  trailingActivationPct: 1.0,
  trailingStopPct: 0.4,
  stopLossSoftPct: 2.0,
  stopLossHardPct: 5.0,
  stopLossEmergencyPct: 10.0,
  hodlRecoveryEnabled: true,
  pumpGuardDeviationPct: 3.0,
  pumpGuardVolumeSpikeRatio: 3.0,
  pumpGuardCooldownMinutes: 30,
  dumpGuardDeviationPct: 3.0,
  dumpGuardVolumeSpikeRatio: 3.0,
  dumpGuardCooldownMinutes: 30,
  maxOpenCycles: 10,
  maxDailyOrders: DAILY_ORDER_REQUEST_LIMIT,
  fiscalStatus: "pending",
  isActive: false,
  // Execution: Maker/Taker
  makerAttemptsBeforeTaker: MAKER_ATTEMPTS_BEFORE_TAKER,
  takerFallbackEnabled: false,
  takerFallbackAttemptNumber: TAKER_FALLBACK_ATTEMPT_NUMBER,
  maxTakerFallbackPerCycle: MAX_TAKER_FALLBACK_PER_CYCLE,
  takerFallbackRequiresNetProfit: true,
  takerFallbackAuditRequired: true,
  // Wallet / Cartera
  gridWalletMode: "automatic",
  gridWalletInitialUsd: 1000,
  gridWalletMaxUsd: 5000,
  gridWalletUseProfits: true,
  gridWalletCompoundProfits: true,
  gridMaxCapitalPerCycleUsd: 600,
  gridMaxCapitalPerCyclePct: 60,
  gridReservePct: 20,
  gridMinFreeCapitalUsd: 50,
  gridPauseCycleWhenCapitalDepleted: true,
  gridAllowNewCycleWhenCapitalFree: true,
  // Capital Allocation Modes
  gridAllocationMode: "uniform" as AllocationMode,
  gridCapitalDeploymentMode: "capped" as CapitalDeploymentMode,
  gridProgressiveIntensity: 0.30,
  gridMaxLevelPct: 40,
  gridMinLevelUsd: 30,
  // Compact Range Control (3C.3-A)
  enforceCompactRange: true,
  gridRangeMaxPct: 2.50,
  maxDistanceFromCenterPct: 1.25,
  maxSellDistanceFromNearestBuyPct: 1.50,
  // Adaptive Smart Range (3C.3-C)
  gridRangeControlMode: 'adaptive_smart' as const,
  adaptiveRangeEnabled: true,
  adaptiveRangeProfile: 'balanced' as const,
  adaptiveRangeMinPct: 1.50,
  adaptiveRangeMaxPct: 7.00,
  adaptiveRangeLowVolMaxPct: 3.00,
  adaptiveRangeNormalMaxPct: 5.00,
  adaptiveRangeHighVolMaxPct: 7.00,
  adaptiveRangeTargetFullLevels: false,
  adaptiveRangeMinViableLevels: 4,
};

// ─── Mode Lock Safety Conditions ────────────────────────────────────

export interface GridModeLock {
  currentMode: GridMode;
  requestedMode: GridMode;
  unlocked: boolean;
  blockingReasons: string[];
  /** Structured reason codes and human-readable Spanish reasons. */
  blockingReasonDetails: { code: string; humanReason: string }[];
  checkedAt: Date;
}

export interface ModeUnlockCheck {
  revolutxInitialized: boolean;
  revolutxHasBalance: boolean;
  reconciliationPassed: boolean;
  capitalReserved: boolean;
  modeLockAcknowledged: boolean;
  dailyOrderLimitRespected: boolean;
  postOnlySupported: boolean;
}

export const REAL_MODE_UNLOCK_DEFAULTS: ModeUnlockCheck = {
  revolutxInitialized: false,
  revolutxHasBalance: false,
  reconciliationPassed: false,
  capitalReserved: false,
  modeLockAcknowledged: false,
  dailyOrderLimitRespected: true,
  postOnlySupported: false,
};

// ─── Grid Event Types (for botLogger) ───────────────────────────────

export const GRID_EVENT_TYPES = [
  "GRID_MODE_CHANGED",
  "GRID_RANGE_PROPOSED",
  "GRID_RANGE_ACTIVATED",
  "GRID_RANGE_PAUSED",
  "GRID_RANGE_CLOSED",
  "GRID_LEVEL_PLACED",
  "GRID_LEVEL_PARTIAL_FILL",
  "GRID_LEVEL_FILLED",
  "GRID_LEVEL_CANCELLED",
  "GRID_LEVEL_POST_ONLY_REJECTED",
  "GRID_LEVEL_TAKER_FALLBACK",
  "GRID_CYCLE_BUY_PLACED",
  "GRID_CYCLE_BUY_FILLED",
  "GRID_CYCLE_SELL_PLACED",
  "GRID_CYCLE_SELL_FILLED",
  "GRID_CYCLE_COMPLETED",
  "GRID_CYCLE_STOP_LOSS_HIT",
  "GRID_CYCLE_TRAILING_CLOSED",
  "GRID_CYCLE_HODL_RECOVERY",
  "GRID_CYCLE_CANCELLED",
  "GRID_PUMP_GUARD_TRIGGERED",
  "GRID_DUMP_GUARD_TRIGGERED",
  "GRID_PUMP_DUMP_COOLDOWN_END",
  "GRID_TRAILING_ACTIVATED",
  "GRID_TRAILING_STOP_UPDATED",
  "GRID_RECONCILIATION_OK",
  "GRID_RECONCILIATION_MISMATCH",
  "GRID_RECONCILIATION_BLOCKED",
  "GRID_CAPITAL_RESERVED",
  "GRID_CAPITAL_RELEASED",
  "GRID_DAILY_ORDER_WARNING",
  "GRID_DAILY_ORDER_LIMIT_HIT",
  "GRID_CIRCUIT_BREAKER_OPENED",
  "GRID_CIRCUIT_BREAKER_CLOSED",
  "GRID_BACKTEST_STARTED",
  "GRID_BACKTEST_COMPLETED",
  "GRID_MODE_UNLOCK_REQUESTED",
  "GRID_MODE_UNLOCK_GRANTED",
  "GRID_MODE_UNLOCK_DENIED",
  "GRID_SHADOW_SIMULATION",
  "GRID_SHADOW_TICK_SKIPPED",
  "GRID_SHADOW_NO_LEVELS",
  "GRID_SHADOW_RANGE_REUSED",
  "GRID_SHADOW_NO_VIABLE_RANGE",
  "GRID_SHADOW_WAITING",
  "GRID_RANGE_CHANGED",
  "GRID_LEVELS_REBUILT",
  "GRID_LEVELS_REPLACED",
  "GRID_LEVELS_PRESERVED_DUE_TO_CYCLE",
  "GRID_REGIME_CHANGED",
  "GRID_RANGE_REBUILT_MANUAL",
  "GRID_PROFESSIONAL_GENERATOR_USED",
  "GRID_PROFESSIONAL_GENERATOR_COMPACT",
  "GRID_PROFESSIONAL_GENERATOR_NOT_VIABLE",
  "GRID_SHADOW_LEVEL_IGNORED_OUT_OF_ACTIVE_RANGE",
  "GRID_SHADOW_MAX_OPEN_CYCLES_REACHED",
  "GRID_SHADOW_DUPLICATE_BUY_LEVEL_IGNORED",
  "GRID_SHADOW_SELL_IGNORED_NO_OPEN_CYCLE",
  "GRID_SHADOW_FILL_BEFORE_REBUILD",
  "GRID_SHADOW_OPEN_CYCLES_CLOSED",
  "GRID_SHADOW_OPEN_CYCLES_NO_BID",
  "GRID_SHADOW_EXECUTION_PRICE",
  "GRID_SHADOW_CLOSE_SKIPPED_STALE_PRICE",
  "GRID_CYCLE_TARGET_REVIEW_REQUIRED",
  "GRID_CYCLES_RECOVERED",
  "GRID_PUMP_GUARD_BLOCKED_REBUILD",
  "GRID_PUMP_GUARD_ALLOWED_EXIT_ONLY",
  "GRID_CIRCUIT_BREAKER_OPEN",
  "GRID_CIRCUIT_BREAKER_BLOCKED_BUY",
  "GRID_RISK_STATE_REVIEW_REQUIRED",
  "GRID_TARGET_CALCULATION_REVIEW_REQUIRED",
  "GRID_BUY_BLOCKED_NO_PROFITABLE_EXIT",
  "GRID_MAKER_PENDING_PLACED",
  "GRID_MAKER_PENDING_REPRICED",
  "GRID_MAKER_PENDING_CANCELLED",
  "GRID_MAKER_PENDING_FILLED",
  "GRID_SHADOW_CLEANUP_PREVIEWED",
  "GRID_SHADOW_CLEANUP_APPLIED",
  "GRID_SHADOW_CLEANUP_ABORTED",
] as const;

export type GridEventType = (typeof GRID_EVENT_TYPES)[number];

// ─── Backtest Types ─────────────────────────────────────────────────

export interface GridBacktestConfig {
  pair: string;
  startDate: Date;
  endDate: Date;
  timeframe: string;
  initialCapitalUsd: number;
  variants: GridBacktestVariant[];
  fillModel: "optimistic" | "realistic" | "pessimistic";
}

export interface GridBacktestVariant {
  label: string;
  netProfitTargetPct: number;
  capitalProfile: CapitalProfile;
  gridStepAtrMultiplier: number;
  bandPeriod: number;
  bandStdDevMultiplier: number;
}

export interface GridBacktestResult {
  variantLabel: string;
  totalCycles: number;
  completedCycles: number;
  stopLossCycles: number;
  trailingCycles: number;
  hodlCycles: number;
  totalNetPnlUsd: number;
  totalFeesUsd: number;
  totalTaxReserveUsd: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  averageCycleTimeMinutes: number;
  bestCyclePnlUsd: number;
  worstCyclePnlUsd: number;
  cyclesPerDay: number;
  finalCapitalUsd: number;
}

// ─── Execution Status ───────────────────────────────────────────────

export interface GridExecutionStatus {
  mode: GridMode;
  activeRangeVersionId: string | null;
  activeRangeVersionNumber: number | null;
  activeRangeCreatedAt: Date | null;
  activeRangeStatus: RangeVersionStatus | null;
  openLevels: number;
  plannedLevelsCount: number;
  activeOrdersCount: number;
  realOpenOrdersCount: number;
  historicalLevelsCount: number;
  openCycles: number;
  activeOpenCyclesCount: number;
  globalOpenCyclesCount: number;
  orphanOpenCyclesCount: number;
  historicalOpenCyclesCount: number;
  executableOpenCyclesCount: number;
  waitingSellCyclesCount: number;
  trailingActiveCyclesCount: number;
  reviewRequiredCyclesCount: number;
  previousRangeOpenCyclesCount: number;
  dailyOrderCount: number;
  circuitBreakerOpen: boolean;
  pumpDumpState: PumpDumpState;
  lastReconciliationAt: Date | null;
  lastReconciliationOk: boolean | null;
  capitalReservedUsd: number;
  capitalAvailableUsd: number;
  totalNetPnlUsd: number;
  totalCyclesCompleted: number;
  globalLevelsCount: number;
  globalPlannedLevelsCount: number;
  orphanPlannedLevelsCount: number;
  configLoaded: boolean;
  configSource: "memory" | "db_snapshot" | "default_runtime_empty";
  runtimeLoaded: boolean;
  statusSource: "runtime" | "db_snapshot" | "default_runtime_empty";
  shadowExecutionPrice?: number | null;
  shadowExecutionPriceSource?: string | null;
  shadowExecutionPriceBid?: number | null;
  shadowExecutionPriceAsk?: number | null;
  bandSnapshotClose?: number | null;
  bandSnapshotTimeframe?: string | null;
}

// ─── Reconciliation ─────────────────────────────────────────────────

export interface GridReconciliationResult {
  ok: boolean;
  mismatches: GridReconciliationMismatch[];
  checkedAt: Date;
  blockedNewOrders: boolean;
}

export interface GridReconciliationMismatch {
  levelId: string;
  clientOrderId: string;
  localStatus: GridLevelStatus;
  exchangeStatus: string;
  localFilledQty: number;
  exchangeFilledQty: number;
  discrepancy: string;
}

// ─── Capital Reservation ────────────────────────────────────────────

export interface CapitalReservation {
  id: string;
  strategyType: "GRID_ISOLATED";
  pair: string;
  reservedUsd: number;
  availableUsd: number;
  reservedAt: Date;
  releasedAt: Date | null;
  reason: string;
}

// ─── Market Context (read-only snapshot for UI) ───────────────────────

export interface GridMarketContext {
  pair: string;
  currentPrice: number;
  bid: number | null;
  ask: number | null;
  spreadPct: number | null;
  source: string;
  updatedAt: string;
  currentBid?: number | null;
  currentAsk?: number | null;
  priceSource?: string | null;
  priceFresh?: boolean;
  priceAgeMs?: number | null;
  priceMaxAgeMs?: number | null;
  band: {
    lower: number | null;
    center: number | null;
    upper: number | null;
    widthPct: number | null;
    status: string;
  };
  bandPosition: string;
  bandPositionPct: number | null;
  atrPct?: number | null;
  nearestLevel: {
    id: string | number;
    side: string;
    price: number;
    distanceUsd: number | null;
    distancePct: number | null;
  } | null;
}
