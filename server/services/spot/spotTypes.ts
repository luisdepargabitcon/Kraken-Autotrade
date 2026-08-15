/**
 * SpotTypes — Core domain types for SPOT canonical engine.
 *
 * Defines the single ExecutionMode enum, position model, execution intent,
 * and all shared types consumed by the SPOT pipeline.
 *
 * INVARIANTS:
 *   - ExecutionMode is the SINGLE enum: OFF | SHADOW | REAL.
 *   - dryRunMode boolean is NOT used in SPOT domain (compat only).
 *   - SPOT = LONG ONLY. No SHORT.
 *   - SHADOW cannot call placeOrder (enforced in SpotExecutionAdapter).
 *   - Fail-safe ambiguo → OFF. Nunca → REAL.
 */

import type { DataHealth } from "./candleTimestamp";
import type { FeeQuality } from "./feeModel";

// ─── ExecutionMode (single canonical enum) ──────────────────────────────────

export enum ExecutionMode {
  OFF = "OFF",
  SHADOW = "SHADOW",
  REAL = "REAL",
}

/**
 * Legacy mode values for migration compatibility.
 * Maps old dryRunMode boolean → ExecutionMode.
 */
export function dryRunModeToExecutionMode(dryRunMode: boolean, isActive: boolean): ExecutionMode {
  if (!isActive) return ExecutionMode.OFF;
  return dryRunMode ? ExecutionMode.SHADOW : ExecutionMode.REAL;
}

/**
 * Fail-safe resolution: ambiguous or invalid → OFF.
 * NEVER returns REAL from ambiguous input.
 */
export function resolveExecutionMode(raw: unknown): ExecutionMode {
  if (raw === ExecutionMode.OFF || raw === "OFF") return ExecutionMode.OFF;
  if (raw === ExecutionMode.SHADOW || raw === "SHADOW") return ExecutionMode.SHADOW;
  if (raw === ExecutionMode.REAL || raw === "REAL") return ExecutionMode.REAL;
  // Ambiguous/invalid → OFF (fail-safe)
  return ExecutionMode.OFF;
}

/**
 * Whether REAL trading is allowed.
 * R10: REAL is now fully implemented — adapter, pending fill lifecycle,
 * restart recovery, and preflight checks are all in place.
 */
export const REAL_ACTIVATION_ALLOWED = true;

// ─── Setup tags (15m) ───────────────────────────────────────────────────────

export enum SetupTag {
  PULLBACK_CONTINUATION = "PULLBACK_CONTINUATION",
  BREAKOUT_RETEST = "BREAKOUT_RETEST",
}

// ─── Regime (unified vocabulary) ────────────────────────────────────────────

export enum Regime {
  TREND = "TREND",
  RANGE = "RANGE",
  TRANSITION = "TRANSITION",
}

export enum RegimeDirection {
  BULLISH = "BULLISH",
  BEARISH = "BEARISH",
  NEUTRAL = "NEUTRAL",
}

export enum VolatilityLevel {
  LOW = "LOW",
  NORMAL = "NORMAL",
  HIGH = "HIGH",
}

// ─── Macro bias (4h) ────────────────────────────────────────────────────────

export enum MacroBias {
  BULLISH = "BULLISH",
  BEARISH = "BEARISH",
  NEUTRAL = "NEUTRAL",
}

// ─── SpotRegimeContext ──────────────────────────────────────────────────────

export interface SpotRegimeContext {
  regimeId: string;
  contextId: string;
  pair: string;
  regime: Regime;
  direction: RegimeDirection;
  volatility: VolatilityLevel;
  macroBias: MacroBias;
  adx: number;
  ema20: number;
  ema50: number;
  ema200: number;
  emaAlignment: "bullish" | "bearish" | "neutral";
  bollingerWidth: number;
  atrPct: number;
  confidence: number;
  dataHealth: DataHealth;
  generatedAt: number; // epoch ms
}

// ─── SpotMarketContext ──────────────────────────────────────────────────────

export interface SpotMarketContext {
  marketContextId: string;
  generatedAt: number; // epoch ms
  pair: string;
  dataHealth: DataHealth;
  macroBias: MacroBias;
  regimeContext: SpotRegimeContext;
  candles5m: SpotCandle[];
  candles15m: SpotCandle[];
  candles1h: SpotCandle[];
  candles4h: SpotCandle[];
  ticker: SpotTicker;
  spreadPct: number;
  atr: number;
  volumeMetrics: SpotVolumeMetrics;
}

export interface SpotCandle {
  time: number; // epoch ms (normalized via candleTimestamp)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SpotTicker {
  bid: number;
  ask: number;
  last: number;
  spread: number;
  fetchedAt: number; // epoch ms
}

export interface SpotVolumeMetrics {
  volumeRatio: number; // current vs average
  volume24h: number;
  participation: "LOW" | "NORMAL" | "HIGH";
}

// ─── SpotPosition ───────────────────────────────────────────────────────────

export interface SpotPosition {
  lotId: string;
  pair: string;
  amount: number; // base currency
  qtyRemaining: number;
  entryPrice: number;
  entryFee: number; // USD
  entryFeeQuality: FeeQuality;
  highestPrice: number;
  openedAt: number; // epoch ms
  entryStrategyId: string;
  entrySignalTf: string;
  signalConfidence: number;
  signalReason: string;
  setupTag: SetupTag;
  signalId: string;
  marketContextId: string;
  regimeAtEntry: Regime;
  directionAtEntry: RegimeDirection;
  macroAtEntry: MacroBias;
  atrPctAtEntry: number;
  initialStopPrice: number;
  initialStopDistancePct: number;
  initialStopDistanceUsd: number;
  riskUsd: number;
  notionalUsd: number;
  executionMode: ExecutionMode;
  policyVersion: string;
  // SmartGuard state
  sgBreakEvenActivated: boolean;
  sgTrailingActivated: boolean;
  sgScaleOutDone: boolean;
  sgCurrentStopPrice: number;
  // Audit metrics (updated by SpotAudit)
  mfe: number; // max favorable excursion (USD)
  mae: number; // max adverse excursion (USD)
  mfeR: number; // MFE in R-multiples
  maeR: number; // MAE in R-multiples
}

// ─── SpotEntryIntent (anti-late-entry) ──────────────────────────────────────

export enum EntryIntentState {
  CREATED = "CREATED",
  WAITING = "WAITING",
  APPROVED = "APPROVED",
  EXECUTED = "EXECUTED",
  EXPIRED = "EXPIRED",
  INVALIDATED = "INVALIDATED",
  CHASED = "CHASED",
  CANCELLED = "CANCELLED",
}

export interface SpotEntryIntent {
  signalId: string;
  pair: string;
  setupTag: SetupTag;
  createdAt: number; // epoch ms
  expiresAt: number; // epoch ms
  state: EntryIntentState;
  // Origin snapshot (frozen at signal time)
  origin15mOpenAt: number;
  origin15mCloseAt: number;
  originPrice: number;
  originClose: number;
  originAtrPct: number;
  originRegime: Regime;
  originDirection: RegimeDirection;
  originMacro: MacroBias;
  originVolume: number;
  originContextId: string;
  // Retry tracking
  retryCount: number;
  initialBlockReason: string | null;
  // Last evaluation
  lastBlockReason: string | null;
  lastEvaluatedAt: number | null;
}

// ─── SpotExecutionIntent ────────────────────────────────────────────────────

export type ExecutionSide = "BUY" | "SELL";

export type ExecutionOrderType = "MARKET" | "LIMIT";

export interface SpotExecutionIntent {
  intentId: string;
  pair: string;
  side: ExecutionSide;
  orderType: ExecutionOrderType;
  volume: number;
  price: number | null; // null for MARKET
  notionalUsd: number;
  reason: string;
  reasonType: ExitReasonType | "ENTRY";
  positionLotId: string | null; // null for entry, set for exit
  executionMode: ExecutionMode;
  ttlMs: number; // for LIMIT orders
  createdAt: number;
}

// ─── Exit ───────────────────────────────────────────────────────────────────

export enum ExitReasonType {
  EMERGENCY = "EMERGENCY",
  STRUCTURE_INVALIDATION = "STRUCTURE_INVALIDATION",
  DEFENSIVE = "DEFENSIVE",
  BREAK_EVEN = "BREAK_EVEN",
  TRAILING = "TRAILING",
  PROFIT = "PROFIT",
  TIME_EFFICIENCY = "TIME_EFFICIENCY",
}

export enum ExitPriority {
  EMERGENCY = 1,
  STRUCTURE_INVALIDATION = 2,
  DEFENSIVE = 3,
  BREAK_EVEN = 4,
  TRAILING = 5,
  PROFIT = 6,
  TIME_EFFICIENCY = 7,
}

export interface SpotExitDecision {
  shouldExit: boolean;
  reasonType: ExitReasonType | null;
  reason: string;
  price: number;
  volume: number | null; // null = full position
  priority: ExitPriority | null;
  evaluatedAt: number;
}

export interface SpotExitState {
  positionLotId: string;
  emergencyStopPrice: number;
  structureInvalidationPrice: number | null;
  breakEvenStopPrice: number | null;
  trailingStopPrice: number | null;
  trailingHighestPrice: number;
  profitExitTarget: number | null;
  timeEfficiencyArmed: boolean;
  lastExitEvaluation: number | null;
  currentExitReason: string | null;
}

// ─── SpotExecutionResult ────────────────────────────────────────────────────

export interface SpotExecutionResult {
  success: boolean;
  orderId: string | null;
  clientOrderId: string | null;
  venueOrderId: string | null;
  fillPrice: number | null;
  fillVolume: number | null;
  fillQuality: FeeQuality;
  feeUsd: number | null;
  slippageUsd: number | null;
  error: string | null;
  pendingFill: boolean;
  executedAt: number;
  submissionState?: "REJECTED" | "AMBIGUOUS";
}

// ─── SpotPolicyVersion ──────────────────────────────────────────────────────

/**
 * Strategy policy version. Frozen post-deploy.
 * Recorded with every trade to prevent silent parameter changes.
 */
export const SPOT_POLICY_VERSION = "SPOT-1.0.0-20260812";

// ─── SpotActivityEvent (R10: Smart Activity Logs) ───────────────────────────

export type SpotActivityCategory =
  | "MARKET" | "DECISION" | "SIGNAL" | "INTENT" | "RISK"
  | "ENTRY" | "POSITION" | "PROTECTION" | "EXIT" | "EXECUTION"
  | "MODE" | "SYSTEM" | "ERROR";

export type SpotActivitySeverity =
  | "INFO" | "SUCCESS" | "ATTENTION" | "WARNING" | "CRITICAL";

export interface SpotActivityEvent {
  id: string;
  timestamp: number;
  pair: string | null;
  category: SpotActivityCategory;
  severity: SpotActivitySeverity;
  title: string;
  explanation: string;
  decision: string | null;
  executionMode: ExecutionMode | null;
  setupTag: SetupTag | null;
  regime: Regime | null;
  direction: RegimeDirection | null;
  macroBias: MacroBias | null;
  price: number | null;
  reasonCode: string | null;
  technicalDetails: string | null;
  contextId: string | null;
  signalId: string | null;
  lotId: string | null;
  intentId: string | null;
  orderId: string | null;
  repeatCount: number;
}

// ─── Real Order Lifecycle (R10) ──────────────────────────────────────────────

export type RealOrderState =
  | "CREATED"
  | "SUBMITTED"
  | "PENDING_FILL"
  | "FILLED"
  | "FAILED"
  | "CANCELLED"
  | "EXIT_PENDING"
  | "UNCERTAIN";

export interface RealOrderRecord {
  internalIntentId: string;
  clientOrderId: string;
  venueOrderId: string | null;
  pair: string;
  side: ExecutionSide;
  requestedQty: number;
  requestedPrice: number | null;
  orderType: ExecutionOrderType;
  submittedAt: number;
  status: RealOrderState;
  policyVersion: string;
  engineOwner: string;
  executionMode: ExecutionMode;
  lotId: string | null;
  fillPrice: number | null;
  fillVolume: number | null;
  feeUsd: number | null;
  reason: string | null;
  error: string | null;
}
