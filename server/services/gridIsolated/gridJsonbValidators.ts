/**
 * Grid JSONB Validators — strict domain validation for persisted JSONB fields.
 *
 * Validates shape, enums, finiteness and coherency without trusting the DB.
 * Corrupt or unknown-version JSONB is rejected with a reason code.
 */

import { botLogger } from "../botLogger";
import type {
  GridClosePath,
  GridCycleRiskState,
  GridEventType,
  GridMakerExitState,
  GridPendingMakerExit,
  GridTargetCalculation,
  GridTargetKind,
  HodlRecoveryState,
  RiskAction,
  StopLossLayer,
  StopLossLayerType,
  TrailingProtectionState,
} from "./gridIsolatedTypes";

export type JsonbValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; reason: string; code: string };

const VALID_GRID_CLOSE_PATHS: (GridClosePath | null)[] = [
  "NORMAL_TARGET",
  "TRAILING_MAKER",
  "PROTECTIVE_MAKER",
  "HODL_RECOVERY",
  null,
];

const VALID_RISK_ACTIONS: (RiskAction | null)[] = [
  "HOLD",
  "TRAILING_UPDATE",
  "TRAILING_CLOSE",
  "STOP_LOSS_SOFT",
  "STOP_LOSS_HARD",
  "STOP_LOSS_EMERGENCY",
  "HODL_RECOVERY_ACTIVATE",
  "HODL_RECOVERY_SELL",
  null,
];

const VALID_TARGET_KINDS: (GridTargetKind | null)[] = [
  "PERSISTED_SELL",
  "SYNTHETIC_RUNG",
  "UNKNOWN",
  null,
];

const VALID_MAKER_EXIT_STATES: GridMakerExitState[] = [
  "NONE",
  "ARMED",
  "TRIGGERED",
  "MAKER_PENDING",
  "MAKER_FILLED",
  "CANCELLED",
  "REQUIRES_REVIEW",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return isFinite(value.getTime()) ? value : null;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return isFinite(d.getTime()) ? d : null;
  }
  return null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function validateTrailing(raw: unknown): TrailingProtectionState {
  const obj = isPlainObject(raw) ? raw : {};
  const highestPrice = finiteNumber(obj.highestPriceSinceBuy);
  const currentStop = finiteNumber(obj.currentStopPrice);
  return {
    activated: obj.activated === true,
    activatedAt: toDate(obj.activatedAt),
    highestPriceSinceBuy: highestPrice,
    trailingStopPct: finiteNumber(obj.trailingStopPct) ?? 0,
    currentStopPrice: currentStop,
    reason: typeof obj.reason === "string" ? obj.reason : "",
  };
}

function validateStopLayer(raw: unknown): StopLossLayer {
  const obj = isPlainObject(raw) ? raw : {};
  const layer = ["soft", "hard", "emergency"].includes(obj.layer as string)
    ? (obj.layer as StopLossLayerType)
    : "soft";
  return {
    layer,
    triggerPricePct: finiteNumber(obj.triggerPricePct) ?? 0,
    triggered: obj.triggered === true,
    triggeredAt: toDate(obj.triggeredAt),
    reason: typeof obj.reason === "string" ? obj.reason : "",
  };
}

function validateHodl(raw: unknown): HodlRecoveryState {
  const obj = isPlainObject(raw) ? raw : {};
  return {
    active: obj.active === true,
    activatedAt: toDate(obj.activatedAt),
    originalBuyPrice: finiteNumber(obj.originalBuyPrice),
    recoveryTargetPrice: finiteNumber(obj.recoveryTargetPrice),
    reason: typeof obj.reason === "string" ? obj.reason : "",
  };
}

function validatePendingMakerExit(raw: unknown): GridPendingMakerExit {
  const obj = isPlainObject(raw) ? raw : {};
  const state = VALID_MAKER_EXIT_STATES.includes(obj.state as GridMakerExitState)
    ? (obj.state as GridMakerExitState)
    : "NONE";
  const route = VALID_GRID_CLOSE_PATHS.includes(obj.route as GridClosePath | null)
    ? (obj.route as GridClosePath | null)
    : null;
  return {
    state,
    route,
    triggerPrice: finiteNumber(obj.triggerPrice),
    triggerDetectedAt: toDate(obj.triggerDetectedAt),
    bestBidAtTrigger: finiteNumber(obj.bestBidAtTrigger),
    bestAskAtTrigger: finiteNumber(obj.bestAskAtTrigger),
    requestedMakerPrice: finiteNumber(obj.requestedMakerPrice),
    makerOrderCreatedAt: toDate(obj.makerOrderCreatedAt),
    makerEligibleAfter: toDate(obj.makerEligibleAfter),
    lastRepricedAt: toDate(obj.lastRepricedAt),
    repriceAttempts: Number.isFinite(obj.repriceAttempts) ? (obj.repriceAttempts as number) : 0,
    pendingQuantity: finiteNumber(obj.pendingQuantity) ?? 0,
    simulatedOrderId: typeof obj.simulatedOrderId === "string" ? obj.simulatedOrderId : null,
    fillPrice: finiteNumber(obj.fillPrice),
    filledAt: toDate(obj.filledAt),
    bestBidAtFill: finiteNumber(obj.bestBidAtFill),
    bestAskAtFill: finiteNumber(obj.bestAskAtFill),
    cancellationReason: typeof obj.cancellationReason === "string" ? obj.cancellationReason : null,
  };
}

export function validateRiskStateJson(raw: unknown): JsonbValidationResult<GridCycleRiskState> {
  if (!isPlainObject(raw)) {
    return { valid: false, reason: "riskStateJson no es un objeto", code: "RISK_NOT_OBJECT" };
  }

  const version = finiteNumber(raw.stateVersion);
  if (version !== 1) {
    return { valid: false, reason: `stateVersion desconocida: ${version}`, code: "RISK_UNKNOWN_VERSION" };
  }

  const lastAction = VALID_RISK_ACTIONS.includes(raw.lastAction as RiskAction | null)
    ? (raw.lastAction as RiskAction | null)
    : null;

  const activeExitRoute = VALID_GRID_CLOSE_PATHS.includes(raw.activeExitRoute as GridClosePath | null)
    ? (raw.activeExitRoute as GridClosePath | null)
    : null;

  const pendingExitPrice = finiteNumber(raw.pendingExitPrice);

  const risk: GridCycleRiskState = {
    trailing: validateTrailing(raw.trailing),
    stopLoss: Array.isArray(raw.stopLoss) ? raw.stopLoss.map(validateStopLayer) : [],
    hodl: validateHodl(raw.hodl),
    lastAction,
    activeExitRoute,
    pendingExitPrice,
    protectiveExit: validatePendingMakerExit(raw.protectiveExit),
    stateVersion: 1,
    lastEvaluatedAt: toDate(raw.lastEvaluatedAt),
  };

  return { valid: true, value: risk };
}

export function validateTargetCalculationJson(raw: unknown): JsonbValidationResult<GridTargetCalculation> {
  if (!isPlainObject(raw)) {
    return { valid: false, reason: "targetCalculationJson no es un objeto", code: "TARGET_NOT_OBJECT" };
  }

  const version = finiteNumber(raw.stateVersion);
  if (version !== 1) {
    return { valid: false, reason: `stateVersion desconocida: ${version}`, code: "TARGET_UNKNOWN_VERSION" };
  }

  const targetKind = VALID_TARGET_KINDS.includes(raw.targetKind as GridTargetKind | null)
    ? (raw.targetKind as GridTargetKind | null)
    : null;

  const calculation: GridTargetCalculation = {
    selected: raw.selected === true,
    policyVersion: raw.policyVersion === "FIRST_PROFITABLE_HIGHER_RUNG_V2" ? "FIRST_PROFITABLE_HIGHER_RUNG_V2" : undefined,
    stateVersion: 1,
    targetKind,
    targetSellLevelId: typeof raw.targetSellLevelId === "string" ? raw.targetSellLevelId : null,
    targetRungLevelId: typeof raw.targetRungLevelId === "string" ? raw.targetRungLevelId : null,
    targetSellPrice: finiteNumber(raw.targetSellPrice),
    targetSellQuantity: finiteNumber(raw.targetSellQuantity),
    grossPnlUsd: finiteNumber(raw.grossPnlUsd),
    exchangeFeesUsd: finiteNumber(raw.exchangeFeesUsd),
    operationalCostsUsd: finiteNumber(raw.operationalCostsUsd),
    operationalNetPnlUsd: finiteNumber(raw.operationalNetPnlUsd),
    operationalNetPnlPct: finiteNumber(raw.operationalNetPnlPct),
    taxReserveUsd: finiteNumber(raw.taxReserveUsd),
    availablePnlAfterTaxUsd: finiteNumber(raw.availablePnlAfterTaxUsd),
    availablePnlAfterTaxPct: finiteNumber(raw.availablePnlAfterTaxPct),
    netProfitTargetPct: finiteNumber(raw.netProfitTargetPct),
    rejectedCandidates: Array.isArray(raw.rejectedCandidates) ? raw.rejectedCandidates.map((c: any) => ({
      levelId: String(c.levelId ?? ""),
      side: c.side === "BUY" || c.side === "SELL" ? c.side : "BUY",
      price: finiteNumber(c.price) ?? 0,
      reasonCode: String(c.reasonCode ?? ""),
      reason: String(c.reason ?? ""),
    })) : [],
    explanation: typeof raw.explanation === "string" ? raw.explanation : "",
    reasonCode: typeof raw.reasonCode === "string" ? raw.reasonCode : undefined,
  };

  return { valid: true, value: calculation };
}

/**
 * Safe parser used when loading cycles from DB. On corrupt JSONB returns a
 * review-required risk state instead of silently discarding data.
 */
export function safeParseRiskStateJson(raw: unknown): GridCycleRiskState | null {
  if (raw == null) return null;
  const result = validateRiskStateJson(raw);
  if (result.valid) return result.value;
  botLogger.warn("GRID_RISK_STATE_REVIEW_REQUIRED" as any, result.reason, { code: result.code });
  const empty: GridCycleRiskState = {
    trailing: {
      activated: false,
      activatedAt: null,
      highestPriceSinceBuy: null,
      trailingStopPct: 0,
      currentStopPrice: null,
      reason: "",
    },
    stopLoss: [],
    hodl: {
      active: false,
      activatedAt: null,
      originalBuyPrice: null,
      recoveryTargetPrice: null,
      reason: "",
    },
    lastAction: null,
    activeExitRoute: null,
    pendingExitPrice: null,
    protectiveExit: {
      state: "REQUIRES_REVIEW",
      route: null,
      triggerPrice: null,
      triggerDetectedAt: null,
      bestBidAtTrigger: null,
      bestAskAtTrigger: null,
      requestedMakerPrice: null,
      makerOrderCreatedAt: null,
      makerEligibleAfter: null,
      lastRepricedAt: null,
      repriceAttempts: 0,
      pendingQuantity: 0,
      simulatedOrderId: null,
      fillPrice: null,
      filledAt: null,
      bestBidAtFill: null,
      bestAskAtFill: null,
      cancellationReason: result.reason,
    },
    stateVersion: 1,
    lastEvaluatedAt: null,
  };
  return empty;
}

export function safeParseTargetCalculationJson(raw: unknown): GridTargetCalculation | null {
  const result = validateTargetCalculationJson(raw);
  if (result.valid) return result.value;
  botLogger.warn("GRID_TARGET_CALCULATION_REVIEW_REQUIRED" as any, result.reason, { code: result.code });
  return null;
}
