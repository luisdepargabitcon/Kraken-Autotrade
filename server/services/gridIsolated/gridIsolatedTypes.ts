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

export type ExecutionPolicy = "MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK";

export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = "MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK";

export const POST_ONLY_MAX_ATTEMPTS = 3;
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
  | "archived";

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
  | "open"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "expired";

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
  | "cancelled";

export interface GridCycle {
  id: string;
  rangeVersionId: string;
  cycleNumber: number;
  pair: string;
  status: GridCycleStatus;
  buyLevelId: string | null;
  sellLevelId: string | null;
  buyPrice: number | null;
  sellPrice: number | null;
  quantity: number;
  grossPnlUsd: number;
  feeTotalUsd: number;
  taxReserveUsd: number;
  netPnlUsd: number;
  netPnlPct: number;
  buyClientOrderId: string | null;
  sellClientOrderId: string | null;
  buyFilledAt: Date | null;
  sellFilledAt: Date | null;
  holdTimeMinutes: number;
  createdAt: Date;
  completedAt: Date | null;
}

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
}

export const DEFAULT_GRID_CONFIG: Omit<GridIsolatedConfig, "id" | "createdAt" | "updatedAt"> = {
  pair: "BTC/USD",
  mode: "OFF",
  capitalProfile: "balanced",
  executionPolicy: "MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK",
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
};

// ─── Mode Lock Safety Conditions ────────────────────────────────────

export interface GridModeLock {
  currentMode: GridMode;
  requestedMode: GridMode;
  unlocked: boolean;
  blockingReasons: string[];
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
  openLevels: number;
  openCycles: number;
  dailyOrderCount: number;
  circuitBreakerOpen: boolean;
  pumpDumpState: PumpDumpState;
  lastReconciliationAt: Date | null;
  lastReconciliationOk: boolean | null;
  capitalReservedUsd: number;
  capitalAvailableUsd: number;
  totalNetPnlUsd: number;
  totalCyclesCompleted: number;
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
