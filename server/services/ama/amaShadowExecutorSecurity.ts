/**
 * AMA SHADOW, Executor & Security — Fases 23-25
 *
 * SHADOW mode: simulated execution alongside real data without orders.
 * Executor: order intent validation, Revolut X blocked.
 * Security: recovery procedures, key rotation, access control.
 * No real orders. No exchange calls. No key exposure.
 */

import type { AmaMode, AmaTrancheCandidate } from "./amaTypes";
import { isModeReal } from "./amaTypes";

// ─── SHADOW Mode (Fase 23) ──────────────────────────────────────────

export type ShadowStatus = "PENDING" | "SIMULATED_EXECUTED" | "SIMULATED_FILLED" | "SIMULATED_REJECTED" | "EXPIRED";

export interface ShadowOrder {
  orderId: string;
  cycleId: string;
  trancheId: string;
  pair: string;
  side: "BUY" | "SELL";
  type: "LIMIT_MAKER" | "LIMIT_TAKER";
  price: number;
  quantity: number;
  amountUsd: number;
  status: ShadowStatus;
  createdAt: string;
  simulatedFillPrice: number | null;
  simulatedFillTimestamp: string | null;
  rejectionReason: string | null;
}

export function createShadowOrder(
  cycleId: string,
  tranche: AmaTrancheCandidate,
  pair: string,
  currentPrice: number,
): ShadowOrder {
  const quantity = tranche.amountUsd / currentPrice;
  return {
    orderId: `shadow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    cycleId,
    trancheId: tranche.trancheId,
    pair,
    side: "BUY",
    type: "LIMIT_MAKER",
    price: currentPrice,
    quantity,
    amountUsd: tranche.amountUsd,
    status: "PENDING",
    createdAt: new Date().toISOString(),
    simulatedFillPrice: null,
    simulatedFillTimestamp: null,
    rejectionReason: null,
  };
}

export function simulateFill(
  order: ShadowOrder,
  fillPrice: number,
  fillTimestamp: string,
): ShadowOrder {
  return {
    ...order,
    status: "SIMULATED_FILLED",
    simulatedFillPrice: fillPrice,
    simulatedFillTimestamp: fillTimestamp,
  };
}

export function simulateReject(
  order: ShadowOrder,
  reason: string,
): ShadowOrder {
  return {
    ...order,
    status: "SIMULATED_REJECTED",
    rejectionReason: reason,
  };
}

export function expireShadowOrder(order: ShadowOrder): ShadowOrder {
  return { ...order, status: "EXPIRED" };
}

export interface ShadowReport {
  totalOrders: number;
  filled: number;
  rejected: number;
  expired: number;
  pending: number;
  totalSimulatedUsd: number;
  totalSimulatedBtc: number;
  averageFillPrice: number | null;
  slippagePct: number | null;
}

export function generateShadowReport(orders: ShadowOrder[]): ShadowReport {
  const filled = orders.filter((o) => o.status === "SIMULATED_FILLED");
  const totalSimulatedUsd = filled.reduce((sum, o) => sum + o.amountUsd, 0);
  const totalSimulatedBtc = filled.reduce((sum, o) => sum + o.quantity, 0);
  const fillPrices = filled
    .map((o) => o.simulatedFillPrice)
    .filter((p): p is number => p !== null);
  const averageFillPrice = fillPrices.length > 0
    ? fillPrices.reduce((a, b) => a + b, 0) / fillPrices.length
    : null;

  const slippagePct = averageFillPrice !== null && filled.length > 0
    ? filled.reduce((sum, o) => {
        const slip = o.simulatedFillPrice !== null
          ? ((o.simulatedFillPrice - o.price) / o.price) * 100
          : 0;
        return sum + slip;
      }, 0) / filled.length
    : null;

  return {
    totalOrders: orders.length,
    filled: filled.length,
    rejected: orders.filter((o) => o.status === "SIMULATED_REJECTED").length,
    expired: orders.filter((o) => o.status === "EXPIRED").length,
    pending: orders.filter((o) => o.status === "PENDING").length,
    totalSimulatedUsd,
    totalSimulatedBtc,
    averageFillPrice,
    slippagePct,
  };
}

// ─── Executor (Fase 24) ─────────────────────────────────────────────

export type ExecutorStatus = "BLOCKED" | "READY" | "EXECUTING" | "COMPLETED" | "FAILED";

export interface OrderIntent {
  intentId: string;
  cycleId: string;
  trancheId: string;
  pair: string;
  side: "BUY" | "SELL";
  type: "LIMIT_MAKER" | "LIMIT_TAKER";
  price: number;
  quantity: number;
  amountUsd: number;
}

export interface ExecutorResult {
  intentId: string;
  status: ExecutorStatus;
  reason: string;
  executedAt: string | null;
  exchangeOrderId: string | null;
}

export function validateOrderIntent(
  intent: OrderIntent,
  mode: AmaMode,
  spreadTolerancePct: number,
  currentPrice: number,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Block REAL modes
  if (isModeReal(mode)) {
    errors.push("REAL_MODE_NOT_AUTHORIZED_FOR_EXECUTOR");
  }

  // Validate price within spread tolerance
  const priceDiffPct = Math.abs((intent.price - currentPrice) / currentPrice) * 100;
  if (priceDiffPct > spreadTolerancePct) {
    errors.push("PRICE_OUTSIDE_SPREAD_TOLERANCE");
  }

  // Validate positive values
  if (intent.price <= 0) errors.push("INVALID_PRICE");
  if (intent.quantity <= 0) errors.push("INVALID_QUANTITY");
  if (intent.amountUsd <= 0) errors.push("INVALID_AMOUNT");

  // Revolut X blocked
  if (intent.pair.includes("REVOLUT")) {
    errors.push("REVOLUT_X_BLOCKED");
  }

  return { valid: errors.length === 0, errors };
}

export function executeOrderIntent(
  intent: OrderIntent,
  mode: AmaMode,
  spreadTolerancePct: number,
  currentPrice: number,
): ExecutorResult {
  const validation = validateOrderIntent(intent, mode, spreadTolerancePct, currentPrice);

  if (!validation.valid) {
    return {
      intentId: intent.intentId,
      status: "FAILED",
      reason: validation.errors.join(", "),
      executedAt: null,
      exchangeOrderId: null,
    };
  }

  // Simulate execution (no real orders)
  return {
    intentId: intent.intentId,
    status: "COMPLETED",
    reason: "SIMULATED_EXECUTION",
    executedAt: new Date().toISOString(),
    exchangeOrderId: `sim-${Date.now()}`,
  };
}

// ─── Security & Recovery (Fase 25) ──────────────────────────────────

export type SecurityLevel = "SAFE" | "ELEVATED" | "CRITICAL";

export interface SecurityAssessment {
  level: SecurityLevel;
  issues: string[];
  recommendations: string[];
  requiresAction: boolean;
}

export function assessSecurity(
  mode: AmaMode,
  killSwitchActive: boolean,
  hasUnresolvedAnomalies: boolean,
  failedReconciliationCount: number,
): SecurityAssessment {
  const issues: string[] = [];
  const recommendations: string[] = [];

  if (isModeReal(mode)) {
    issues.push("REAL_MODE_ACTIVE");
    recommendations.push("Verify explicit authorization for REAL mode");
  }

  if (killSwitchActive) {
    issues.push("KILL_SWITCH_ACTIVE");
    recommendations.push("Do not execute any new orders");
  }

  if (hasUnresolvedAnomalies) {
    issues.push("UNRESOLVED_ANOMALIES");
    recommendations.push("Investigate anomalies before proceeding");
  }

  if (failedReconciliationCount > 0) {
    issues.push(`RECONCILIATION_FAILURES: ${failedReconciliationCount}`);
    recommendations.push("Run manual reconciliation");
  }

  const level: SecurityLevel = issues.some((i) => i.includes("REAL_MODE") || i.includes("KILL_SWITCH"))
    ? "CRITICAL"
    : issues.length > 1
    ? "ELEVATED"
    : "SAFE";

  return {
    level,
    issues,
    recommendations,
    requiresAction: issues.length > 0,
  };
}

export interface RecoveryProcedure {
  procedureId: string;
  type: "KILL_SWITCH" | "RECONCILIATION" | "KEY_ROTATION" | "MANUAL_INTERVENTION";
  steps: string[];
  requiresAuthorization: boolean;
}

export function createKillSwitchRecovery(): RecoveryProcedure {
  return {
    procedureId: `recovery-kill-switch-${Date.now()}`,
    type: "KILL_SWITCH",
    steps: [
      "1. Verify kill switch is active",
      "2. Cancel all pending orders",
      "3. Review active positions",
      "4. Document incident",
      "5. Request authorization to resume",
    ],
    requiresAuthorization: true,
  };
}

export function createReconciliationRecovery(): RecoveryProcedure {
  return {
    procedureId: `recovery-reconciliation-${Date.now()}`,
    type: "RECONCILIATION",
    steps: [
      "1. Export current portfolio state",
      "2. Compare with exchange records",
      "3. Identify discrepancies",
      "4. Document differences",
      "5. Request manual review",
    ],
    requiresAuthorization: true,
  };
}

export function createKeyRotationRecovery(): RecoveryProcedure {
  return {
    procedureId: `recovery-key-rotation-${Date.now()}`,
    type: "KEY_ROTATION",
    steps: [
      "1. Generate new API key pair",
      "2. Update configuration (NEVER in code)",
      "3. Test new key with read-only call",
      "4. Deactivate old key",
      "5. Verify all services using new key",
    ],
    requiresAuthorization: true,
  };
}
