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
  TrailingAtrSource,
  TrailingMode,
  TrailingPolicySnapshot,
} from "./gridIsolatedTypes";

export type JsonbValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; reason: string; code: string };

const VALID_GRID_CLOSE_PATHS: (GridClosePath | null)[] = [
  "NORMAL_TARGET",
  "SYNTHETIC_RUNG",
  "CYCLE_OWNED_TARGET",
  "LEGACY_PERSISTED_TARGET",
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
  "CYCLE_OWNED_SYNTHETIC",
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

const VALID_TRAILING_MODES: TrailingMode[] = ["adaptive_atr", "manual"];

const VALID_ATR_SOURCES: (TrailingAtrSource | null)[] = [
  "current_atr",
  "persisted_atr",
  "manual_fallback",
  "none",
  null,
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

function validateTrailingPolicy(raw: unknown): TrailingPolicySnapshot | null {
  if (!isPlainObject(raw)) return null;
  const mode = VALID_TRAILING_MODES.includes(raw.mode as TrailingMode)
    ? (raw.mode as TrailingMode)
    : "adaptive_atr";
  return {
    enabled: raw.enabled === true,
    mode,
    calculationVersion: finiteNumber(raw.calculationVersion) ?? 1,
    activationPctEffective: finiteNumber(raw.activationPctEffective) ?? 0,
    activationPrice: finiteNumber(raw.activationPrice),
    profitFloorPrice: finiteNumber(raw.profitFloorPrice),
    atrMultiplier: finiteNumber(raw.atrMultiplier) ?? 0.75,
    minPct: finiteNumber(raw.minPct) ?? 0.25,
    maxPct: finiteNumber(raw.maxPct) ?? 1.20,
    smoothingAlpha: finiteNumber(raw.smoothingAlpha) ?? 0.25,
  };
}

function validateTrailing(raw: unknown): TrailingProtectionState {
  const obj = isPlainObject(raw) ? raw : {};
  const highestPrice = finiteNumber(obj.highestPriceSinceBuy);
  const currentStop = finiteNumber(obj.currentStopPrice);
  const atrSource = VALID_ATR_SOURCES.includes(obj.atrSource as TrailingAtrSource | null)
    ? (obj.atrSource as TrailingAtrSource | null)
    : null;
  return {
    activated: obj.activated === true,
    activatedAt: toDate(obj.activatedAt),
    highestPriceSinceBuy: highestPrice,
    trailingStopPct: finiteNumber(obj.trailingStopPct) ?? 0,
    currentStopPrice: currentStop,
    reason: typeof obj.reason === "string" ? obj.reason : "",
    // V3.1 additive fields (backward compatible — old JSONB without these is fine)
    policy: validateTrailingPolicy(obj.policy),
    atrPct: finiteNumber(obj.atrPct),
    smoothedAtrPct: finiteNumber(obj.smoothedAtrPct),
    atrSource,
    effectiveStopPct: finiteNumber(obj.effectiveStopPct),
    baseStopPct: finiteNumber(obj.baseStopPct),
    profitFloorPrice: finiteNumber(obj.profitFloorPrice),
    activationPrice: finiteNumber(obj.activationPrice),
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
    lifecycleTickId: finiteNumber(obj.lifecycleTickId),
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

  // Strict structural validation: any malformed sub-object or invalid enum
  // makes the whole risk state require manual review instead of silently normalizing.
  if (!isPlainObject(raw.trailing)) {
    return { valid: false, reason: "trailing no es un objeto", code: "RISK_TRAILING_INVALID" };
  }
  if (!Array.isArray(raw.stopLoss)) {
    return { valid: false, reason: "stopLoss no es un array", code: "RISK_STOPLOSS_INVALID" };
  }
  for (let i = 0; i < raw.stopLoss.length; i++) {
    const layer = raw.stopLoss[i];
    if (!isPlainObject(layer) || !["soft", "hard", "emergency"].includes(layer.layer as string)) {
      return { valid: false, reason: `stopLoss[${i}] tiene layer inválido`, code: "RISK_STOPLOSS_LAYER_INVALID" };
    }
  }
  if (!isPlainObject(raw.hodl)) {
    return { valid: false, reason: "hodl no es un objeto", code: "RISK_HODL_INVALID" };
  }
  if (!isPlainObject(raw.protectiveExit)) {
    return { valid: false, reason: "protectiveExit no es un objeto", code: "RISK_PROTECTIVE_EXIT_INVALID" };
  }
  if (!VALID_MAKER_EXIT_STATES.includes(raw.protectiveExit.state as GridMakerExitState)) {
    return { valid: false, reason: `protectiveExit.state inválido: ${raw.protectiveExit.state}`, code: "RISK_PROTECTIVE_EXIT_STATE_INVALID" };
  }
  if (
    raw.protectiveExit.route != null &&
    !VALID_GRID_CLOSE_PATHS.includes(raw.protectiveExit.route as GridClosePath | null)
  ) {
    return { valid: false, reason: `protectiveExit.route inválido: ${raw.protectiveExit.route}`, code: "RISK_PROTECTIVE_EXIT_ROUTE_INVALID" };
  }
  if (
    raw.lastAction != null &&
    !VALID_RISK_ACTIONS.includes(raw.lastAction as RiskAction | null)
  ) {
    return { valid: false, reason: `lastAction inválido: ${raw.lastAction}`, code: "RISK_LAST_ACTION_INVALID" };
  }
  if (
    raw.activeExitRoute != null &&
    !VALID_GRID_CLOSE_PATHS.includes(raw.activeExitRoute as GridClosePath | null)
  ) {
    return { valid: false, reason: `activeExitRoute inválido: ${raw.activeExitRoute}`, code: "RISK_ACTIVE_EXIT_ROUTE_INVALID" };
  }

  const lastAction = raw.lastAction as RiskAction | null;
  const activeExitRoute = raw.activeExitRoute as GridClosePath | null;
  const pendingExitPrice = finiteNumber(raw.pendingExitPrice);

  const risk: GridCycleRiskState = {
    trailing: validateTrailing(raw.trailing),
    stopLoss: raw.stopLoss.map(validateStopLayer),
    hodl: validateHodl(raw.hodl),
    lastAction,
    activeExitRoute,
    pendingExitPrice,
    protectiveExit: validatePendingMakerExit(raw.protectiveExit),
    stateVersion: 1,
    lastEvaluatedAt: toDate(raw.lastEvaluatedAt),
    // V3.1: trailing policy snapshot (additive — null for legacy cycles)
    trailingPolicy: isPlainObject(raw.trailingPolicy) ? validateTrailingPolicy(raw.trailingPolicy) : null,
  };

  return { valid: true, value: risk };
}

export function validateTargetCalculationJson(raw: unknown): JsonbValidationResult<GridTargetCalculation> {
  if (!isPlainObject(raw)) {
    return { valid: false, reason: "targetCalculationJson no es un objeto", code: "TARGET_NOT_OBJECT" };
  }

  const version = finiteNumber(raw.stateVersion);
  if (version !== 1 && version !== 2) {
    return { valid: false, reason: `stateVersion desconocida: ${version}`, code: "TARGET_UNKNOWN_VERSION" };
  }

  if (!VALID_TARGET_KINDS.includes(raw.targetKind as GridTargetKind | null)) {
    return { valid: false, reason: `targetKind inválido: ${raw.targetKind}`, code: "TARGET_KIND_INVALID" };
  }

  if (raw.rejectedCandidates != null && !Array.isArray(raw.rejectedCandidates)) {
    return { valid: false, reason: "rejectedCandidates no es un array", code: "TARGET_REJECTED_CANDIDATES_INVALID" };
  }

  const isV3 = version === 2 || raw.policyVersion === "CYCLE_OWNED_NET_TARGET_V3" || raw.targetKind === "CYCLE_OWNED_SYNTHETIC";
  if (isV3) {
    if (raw.stateVersion !== 2 || raw.policyVersion !== "CYCLE_OWNED_NET_TARGET_V3" || raw.targetKind !== "CYCLE_OWNED_SYNTHETIC" || raw.targetSellLevelId != null || raw.targetRungLevelId != null) {
      return { valid: false, reason: "Target V3 inválido: stateVersion, policyVersion, targetKind o IDs de nivel no coinciden", code: "TARGET_V3_INVALID" };
    }
    const requiredNumbers = [
      "targetSellPrice", "targetSellQuantity", "grossExitGapPct", "actualGrossGapPct", "grossPnlUsd",
      "buyFeePct", "sellFeePct", "spreadBufferPct", "safetyBufferPct", "taxReservePct",
      "buyFeeUsd", "sellFeeUsd", "exchangeFeesUsd", "operationalCostsUsd", "netBeforeTaxUsd", "netBeforeTaxPct",
      "taxReserveUsd", "availablePnlAfterTaxUsd", "availablePnlAfterTaxPct", "netProfitTargetPct",
      "priceTickSize", "quantityStep", "minOrderBase", "minOrderQuote", "maxOrderBase"
    ];
    const missing = requiredNumbers.filter(key => finiteNumber(raw[key]) == null);
    if (missing.length > 0) {
      return { valid: false, reason: `Target V3 inválido: faltan ${missing.join(", ")}`, code: "TARGET_V3_MISSING_FIELDS" };
    }
    const requiredStrings = ["baseCurrency", "quoteCurrency", "constraintsSource", "constraintsFetchedAt", "explanation"];
    const missingStrings = requiredStrings.filter(key => typeof raw[key] !== "string" || raw[key].length === 0);
    if (missingStrings.length > 0) {
      return { valid: false, reason: `Target V3 inválido: faltan strings ${missingStrings.join(", ")}`, code: "TARGET_V3_MISSING_STRINGS" };
    }
    if (raw.quoteCurrency === "USD" && finiteNumber(raw.minOrderUsd) == null) {
      return { valid: false, reason: "Target V3 inválido: minOrderUsd obligatorio para quoteCurrency=USD", code: "TARGET_V3_MISSING_MIN_ORDER_USD" };
    }

    const targetSellPrice = finiteNumber(raw.targetSellPrice)!;
    const targetSellQuantity = finiteNumber(raw.targetSellQuantity)!;
    const priceTickSize = finiteNumber(raw.priceTickSize)!;
    const quantityStep = finiteNumber(raw.quantityStep)!;
    const minOrderBase = finiteNumber(raw.minOrderBase)!;
    const minOrderQuote = finiteNumber(raw.minOrderQuote)!;
    const maxOrderBase = finiteNumber(raw.maxOrderBase)!;
    const netProfitTargetPct = finiteNumber(raw.netProfitTargetPct)!;
    const availablePnlAfterTaxPct = finiteNumber(raw.availablePnlAfterTaxPct)!;
    const buyFeeUsd = finiteNumber(raw.buyFeeUsd)!;
    const sellFeeUsd = finiteNumber(raw.sellFeeUsd)!;
    const exchangeFeesUsd = finiteNumber(raw.exchangeFeesUsd)!;
    const grossPnlUsd = finiteNumber(raw.grossPnlUsd)!;
    const operationalCostsUsd = finiteNumber(raw.operationalCostsUsd)!;
    const netBeforeTaxUsd = finiteNumber(raw.netBeforeTaxUsd)!;
    const taxReserveUsd = finiteNumber(raw.taxReserveUsd)!;
    const availablePnlAfterTaxUsd = finiteNumber(raw.availablePnlAfterTaxUsd)!;

    if (targetSellPrice <= 0 || targetSellQuantity <= 0) return { valid: false, reason: "Target V3 inválido: precio o cantidad no positivos", code: "TARGET_V3_NON_POSITIVE" };
    if (Math.abs((targetSellPrice / priceTickSize) - Math.round(targetSellPrice / priceTickSize)) > 1e-10) return { valid: false, reason: "Target V3 inválido: precio no alineado con priceTickSize", code: "TARGET_V3_PRICE_NOT_ALIGNED" };
    if (Math.abs((targetSellQuantity / quantityStep) - Math.round(targetSellQuantity / quantityStep)) > 1e-10) return { valid: false, reason: "Target V3 inválido: cantidad no alineada con quantityStep", code: "TARGET_V3_QTY_NOT_ALIGNED" };
    if (targetSellQuantity < minOrderBase - 1e-12) return { valid: false, reason: "Target V3 inválido: cantidad inferior a minOrderBase", code: "TARGET_V3_QTY_BELOW_MIN" };
    if (targetSellQuantity > maxOrderBase + 1e-12) return { valid: false, reason: "Target V3 inválido: cantidad superior a maxOrderBase", code: "TARGET_V3_QTY_ABOVE_MAX" };
    if (targetSellPrice * targetSellQuantity < minOrderQuote - 1e-8) return { valid: false, reason: "Target V3 inválido: notional target inferior a minOrderQuote", code: "TARGET_V3_NOTIONAL_BELOW_MIN" };
    if (raw.quoteCurrency === "USD" && Math.abs(finiteNumber(raw.minOrderUsd)! - minOrderQuote) > 1e-8) return { valid: false, reason: "Target V3 inválido: minOrderUsd debe coincidir con minOrderQuote para USD", code: "TARGET_V3_MIN_USD_MISMATCH" };
    if (availablePnlAfterTaxPct + 1e-10 < netProfitTargetPct) return { valid: false, reason: "Target V3 inválido: beneficio neto inferior al objetivo", code: "TARGET_V3_NET_BELOW_TARGET" };
    if (Math.abs(exchangeFeesUsd - (buyFeeUsd + sellFeeUsd)) > 1e-6) return { valid: false, reason: "Target V3 inválido: exchangeFeesUsd no coincide con buyFeeUsd+sellFeeUsd", code: "TARGET_V3_FEES_INCOHERENT" };
    if (Math.abs(netBeforeTaxUsd - (grossPnlUsd - exchangeFeesUsd - operationalCostsUsd)) > 1e-6) return { valid: false, reason: "Target V3 inválido: netBeforeTaxUsd incoherente", code: "TARGET_V3_NET_BEFORE_TAX_INCOHERENT" };
    if (Math.abs(availablePnlAfterTaxUsd - (netBeforeTaxUsd - taxReserveUsd)) > 1e-6) return { valid: false, reason: "Target V3 inválido: availablePnlAfterTaxUsd incoherente", code: "TARGET_V3_NET_AFTER_TAX_INCOHERENT" };
  }

  const calculation: GridTargetCalculation = {
    selected: raw.selected === true,
    policyVersion: raw.policyVersion === "FIRST_PROFITABLE_HIGHER_RUNG_V2" || raw.policyVersion === "CYCLE_OWNED_NET_TARGET_V3" ? raw.policyVersion : undefined,
    stateVersion: version,
    targetKind: raw.targetKind as GridTargetKind | null,
    targetSellLevelId: typeof raw.targetSellLevelId === "string" ? raw.targetSellLevelId : null,
    targetRungLevelId: typeof raw.targetRungLevelId === "string" ? raw.targetRungLevelId : null,
    targetSellPrice: finiteNumber(raw.targetSellPrice),
    targetSellQuantity: finiteNumber(raw.targetSellQuantity),
    grossExitGapPct: finiteNumber(raw.grossExitGapPct),
    actualGrossGapPct: finiteNumber(raw.actualGrossGapPct),
    grossPnlUsd: finiteNumber(raw.grossPnlUsd),
    exchangeFeesUsd: finiteNumber(raw.exchangeFeesUsd),
    operationalCostsUsd: finiteNumber(raw.operationalCostsUsd),
    operationalNetPnlUsd: finiteNumber(raw.operationalNetPnlUsd),
    operationalNetPnlPct: finiteNumber(raw.operationalNetPnlPct),
    taxReserveUsd: finiteNumber(raw.taxReserveUsd),
    availablePnlAfterTaxUsd: finiteNumber(raw.availablePnlAfterTaxUsd),
    availablePnlAfterTaxPct: finiteNumber(raw.availablePnlAfterTaxPct),
    netProfitTargetPct: finiteNumber(raw.netProfitTargetPct),
    buyFeePct: finiteNumber(raw.buyFeePct),
    sellFeePct: finiteNumber(raw.sellFeePct),
    taxReservePct: finiteNumber(raw.taxReservePct),
    spreadBufferPct: finiteNumber(raw.spreadBufferPct),
    safetyBufferPct: finiteNumber(raw.safetyBufferPct),
    priceTickSize: finiteNumber(raw.priceTickSize),
    quantityStep: finiteNumber(raw.quantityStep),
    minOrderBase: finiteNumber(raw.minOrderBase),
    minOrderQuote: finiteNumber(raw.minOrderQuote),
    minOrderUsd: finiteNumber(raw.minOrderUsd),
    maxOrderBase: finiteNumber(raw.maxOrderBase),
    baseCurrency: typeof raw.baseCurrency === "string" ? raw.baseCurrency : null,
    quoteCurrency: typeof raw.quoteCurrency === "string" ? raw.quoteCurrency : null,
    constraintsSource: typeof raw.constraintsSource === "string" ? raw.constraintsSource : null,
    constraintsFetchedAt: typeof raw.constraintsFetchedAt === "string" ? raw.constraintsFetchedAt : null,
    buyFeeUsd: finiteNumber(raw.buyFeeUsd),
    sellFeeUsd: finiteNumber(raw.sellFeeUsd),
    netBeforeTaxUsd: finiteNumber(raw.netBeforeTaxUsd),
    netBeforeTaxPct: finiteNumber(raw.netBeforeTaxPct),
    rejectedCandidates: Array.isArray(raw.rejectedCandidates)
      ? raw.rejectedCandidates.map((c: any) => {
          if (c == null || (c.side !== "BUY" && c.side !== "SELL")) {
            return {
              levelId: String(c?.levelId ?? ""),
              side: "BUY" as "BUY" | "SELL",
              price: 0,
              reasonCode: "INVALID_CANDIDATE",
              reason: "Candidato inválido o sin lado definido",
            };
          }
          return {
            levelId: String(c.levelId ?? ""),
            side: c.side as "BUY" | "SELL",
            price: finiteNumber(c.price) ?? 0,
            reasonCode: String(c.reasonCode ?? ""),
            reason: String(c.reason ?? ""),
          };
        })
      : [],
    explanation: typeof raw.explanation === "string" ? raw.explanation : "",
    reasonCode: typeof raw.reasonCode === "string" ? raw.reasonCode : undefined,
  };

  return { valid: true, value: calculation };
}

/**
 * Safe parser used when loading cycles from DB. On corrupt JSONB returns a
 * review-required risk state instead of silently discarding data.
 */
export interface JsonbForensicParseResult<T> {
  valid: boolean;
  value: T | null;
  raw: unknown;
  reason?: string;
  code?: string;
}

export function safeParseRiskStateJsonForensic(raw: unknown): JsonbForensicParseResult<GridCycleRiskState> {
  if (raw == null) return { valid: true, value: null, raw };
  const result = validateRiskStateJson(raw);
  if (result.valid) return { valid: true, value: result.value, raw };
  botLogger.warn("GRID_RISK_STATE_REVIEW_REQUIRED" as any, result.reason, { code: result.code });
  return { valid: false, value: null, raw, reason: result.reason, code: result.code };
}

export function safeParseRiskStateJson(raw: unknown): GridCycleRiskState | null {
  const forensic = safeParseRiskStateJsonForensic(raw);
  if (forensic.valid) return forensic.value;
  const empty: GridCycleRiskState = {
    trailing: {
      activated: false,
      activatedAt: null,
      highestPriceSinceBuy: null,
      trailingStopPct: 0,
      currentStopPrice: null,
      reason: "",
      policy: null,
      atrPct: null,
      smoothedAtrPct: null,
      atrSource: null,
      effectiveStopPct: null,
      baseStopPct: null,
      profitFloorPrice: null,
      activationPrice: null,
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
      lifecycleTickId: null,
      lastRepricedAt: null,
      repriceAttempts: 0,
      pendingQuantity: 0,
      simulatedOrderId: null,
      fillPrice: null,
      filledAt: null,
      bestBidAtFill: null,
      bestAskAtFill: null,
      cancellationReason: forensic.reason ?? "unknown",
    },
    stateVersion: 1,
    lastEvaluatedAt: null,
    trailingPolicy: null,
  };
  return empty;
}

export function safeParseTargetCalculationJsonForensic(raw: unknown): JsonbForensicParseResult<GridTargetCalculation> {
  if (raw == null) return { valid: true, value: null, raw };
  const result = validateTargetCalculationJson(raw);
  if (result.valid) return { valid: true, value: result.value, raw };
  botLogger.warn("GRID_TARGET_CALCULATION_REVIEW_REQUIRED" as any, result.reason, { code: result.code });
  return { valid: false, value: null, raw, reason: result.reason, code: result.code };
}

export function safeParseTargetCalculationJson(raw: unknown): GridTargetCalculation | null {
  return safeParseTargetCalculationJsonForensic(raw).value;
}

function defaultReviewRequiredMakerExit(reason: string): GridPendingMakerExit {
  return {
    state: "REQUIRES_REVIEW",
    route: null,
    triggerPrice: null,
    triggerDetectedAt: null,
    bestBidAtTrigger: null,
    bestAskAtTrigger: null,
    requestedMakerPrice: null,
    makerOrderCreatedAt: null,
    makerEligibleAfter: null,
    lifecycleTickId: null,
    lastRepricedAt: null,
    repriceAttempts: 0,
    pendingQuantity: 0,
    simulatedOrderId: null,
    fillPrice: null,
    filledAt: null,
    bestBidAtFill: null,
    bestAskAtFill: null,
    cancellationReason: reason,
  };
}

export function validateMakerExitStateJson(raw: unknown): JsonbValidationResult<GridPendingMakerExit> {
  if (!isPlainObject(raw)) {
    return { valid: false, reason: "makerExitStateJson no es un objeto", code: "MAKER_EXIT_NOT_OBJECT" };
  }
  if (!VALID_MAKER_EXIT_STATES.includes(raw.state as GridMakerExitState)) {
    return { valid: false, reason: `makerExitStateJson.state inválido: ${raw.state}`, code: "MAKER_EXIT_STATE_INVALID" };
  }
  if (raw.route != null && !VALID_GRID_CLOSE_PATHS.includes(raw.route as GridClosePath | null)) {
    return { valid: false, reason: `makerExitStateJson.route inválido: ${raw.route}`, code: "MAKER_EXIT_ROUTE_INVALID" };
  }
  return { valid: true, value: validatePendingMakerExit(raw) };
}

export function safeParseMakerExitStateJsonForensic(raw: unknown): JsonbForensicParseResult<GridPendingMakerExit> {
  if (raw == null) return { valid: true, value: null, raw };
  const result = validateMakerExitStateJson(raw);
  if (result.valid) return { valid: true, value: result.value, raw };
  botLogger.warn("GRID_MAKER_EXIT_STATE_REVIEW_REQUIRED" as any, result.reason, { code: result.code });
  return { valid: false, value: null, raw, reason: result.reason, code: result.code };
}

export function safeParseMakerExitStateJson(raw: unknown): GridPendingMakerExit | null {
  const forensic = safeParseMakerExitStateJsonForensic(raw);
  if (forensic.valid) return forensic.value;
  return defaultReviewRequiredMakerExit(forensic.reason ?? "unknown");
}

// ─── Canonical audit JSON object parser ──────────────────────────────

export type ForensicJsonObjectParseResult =
  | {
      status: "absent";
      valid: true;
      value: null;
      raw: null;
      requiresReview: false;
      reviewCode: null;
      reviewReason: null;
    }
  | {
      status: "valid";
      valid: true;
      value: Record<string, unknown>;
      raw: unknown;
      requiresReview: false;
      reviewCode: null;
      reviewReason: null;
    }
  | {
      status: "invalid";
      valid: false;
      value: null;
      raw: unknown;
      requiresReview: true;
      reviewCode: string;
      reviewReason: string;
    };

export function safeParseJsonObjectForAudit(raw: unknown): ForensicJsonObjectParseResult {
  if (raw == null) {
    return { status: "absent", valid: true, value: null, raw: null, requiresReview: false, reviewCode: null, reviewReason: null };
  }
  if (typeof raw === "object") {
    if (isPlainObject(raw)) {
      return { status: "valid", valid: true, value: raw, raw, requiresReview: false, reviewCode: null, reviewReason: null };
    }
    return { status: "invalid", valid: false, value: null, raw, requiresReview: true, reviewCode: "INVALID_JSON_SHAPE", reviewReason: "El JSON no contiene un objeto válido" };
  }
  try {
    const parsed = JSON.parse(raw as string);
    if (isPlainObject(parsed)) {
      return { status: "valid", valid: true, value: parsed, raw, requiresReview: false, reviewCode: null, reviewReason: null };
    }
    return { status: "invalid", valid: false, value: null, raw, requiresReview: true, reviewCode: "INVALID_JSON_SHAPE", reviewReason: "El JSON no contiene un objeto válido" };
  } catch {
    return { status: "invalid", valid: false, value: null, raw, requiresReview: true, reviewCode: "PARSE_ERROR", reviewReason: "JSON inválido" };
  }
}
