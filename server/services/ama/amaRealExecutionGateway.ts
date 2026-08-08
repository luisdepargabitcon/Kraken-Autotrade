/**
 * AMA Real Execution Gateway — R2.32
 *
 * Feature-flagged gateway for real order execution.
 * Disabled by default. Requires:
 *   1. Feature flag REAL_EXECUTION_ENABLED=true in env
 *   2. AmaRealStateService.canExecute() = true
 *   3. REAL_LIMITED authorization active
 *   4. Pre-trade gates passed
 *   5. Portfolio reservation + lock acquired
 *
 * SAFETY:
 * - REAL_FULL is permanently locked. No service exists for it.
 * - If any gate fails, no order is sent.
 * - All executions are logged with full audit trail.
 * - Kill switch blocks immediately.
 */

import { amaRealStateService } from "./amaFunctionalClosure";
import { runPreTradeGates, isAuthorized, type PreTradeGateContext, type PreTradeGateResult } from "./amaRealLimitedService";
import { portfolioIntegrationAdapter } from "../portfolio/PortfolioIntegrationAdapter";
import { insertAuditEvent } from "./amaRepository";
import type { OperationalMode } from "../portfolio/portfolioTypes";

function isRealExecutionEnabled(): boolean {
  return process.env.AMA_REAL_EXECUTION_ENABLED === "true";
}

export interface RealExecutionRequest {
  cycleId: string;
  trancheId: string;
  pair: string;
  asset: string;
  exchange: string;
  amountUsd: number;
  orderType: "maker" | "taker";
  isPostOnly: boolean;
  currentPrice: number | null;
  cycleDeployedUsd: number;
  cycleBudgetUsd: number;
  cycleTrancheCount: number;
}

export interface RealExecutionResult {
  executed: boolean;
  reason: string | null;
  gateResult: PreTradeGateResult | null;
  reservationId: string | null;
  orderId: string | null;
}

class AmaRealExecutionGatewayService {

  /**
   * Check if real execution is enabled at the feature flag level.
   */
  isFeatureEnabled(): boolean {
    return isRealExecutionEnabled();
  }

  /**
   * Execute a real order through the full gateway.
   * Returns executed=true only if all gates pass and order is submitted.
   *
   * This method does NOT place the actual exchange order — that requires
   * the exchange service to be wired in a future phase. For now, it
   * validates all gates and acquires portfolio reservation + lock.
   */
  async executeRealOrder(req: RealExecutionRequest): Promise<RealExecutionResult> {
    // Gate 0: Feature flag
    if (!isRealExecutionEnabled()) {
      await insertAuditEvent("REAL_EXEC_BLOCKED", "INFO", {
        reason: "FEATURE_FLAG_DISABLED",
        cycleId: req.cycleId,
        trancheId: req.trancheId,
      });
      return {
        executed: false,
        reason: "FEATURE_FLAG_DISABLED",
        gateResult: null,
        reservationId: null,
        orderId: null,
      };
    }

    // Gate 1: Real state machine
    const canExecute = await amaRealStateService.canExecute();
    if (!canExecute) {
      await insertAuditEvent("REAL_EXEC_BLOCKED", "WARN", {
        reason: "REAL_STATE_NOT_ACTIVE",
        cycleId: req.cycleId,
        trancheId: req.trancheId,
      });
      return {
        executed: false,
        reason: "REAL_STATE_NOT_ACTIVE",
        gateResult: null,
        reservationId: null,
        orderId: null,
      };
    }

    // Gate 2: Authorization
    const authorized = await isAuthorized();
    if (!authorized) {
      await insertAuditEvent("REAL_EXEC_BLOCKED", "WARN", {
        reason: "NOT_AUTHORIZED",
        cycleId: req.cycleId,
        trancheId: req.trancheId,
      });
      return {
        executed: false,
        reason: "NOT_AUTHORIZED",
        gateResult: null,
        reservationId: null,
        orderId: null,
      };
    }

    // Gate 3: Pre-trade gates
    const gateCtx: PreTradeGateContext = {
      cycleId: req.cycleId,
      trancheId: req.trancheId,
      trancheAmountUsd: req.amountUsd,
      cycleDeployedUsd: req.cycleDeployedUsd,
      cycleBudgetUsd: req.cycleBudgetUsd,
      cycleTrancheCount: req.cycleTrancheCount,
      killSwitchActive: false,
      currentPrice: req.currentPrice,
      orderType: req.orderType,
      isPostOnly: req.isPostOnly,
    };

    const state = await amaRealStateService.getState();
    gateCtx.killSwitchActive = state.killSwitchActive;

    const gateResult = await runPreTradeGates(gateCtx);
    if (!gateResult.passed) {
      await insertAuditEvent("REAL_EXEC_BLOCKED", "WARN", {
        reason: "PRE_TRADE_GATE_FAILED",
        blockers: gateResult.blockers,
        cycleId: req.cycleId,
        trancheId: req.trancheId,
      });
      return {
        executed: false,
        reason: `PRE_TRADE_GATE_FAILED: ${gateResult.blockers.join(",")}`,
        gateResult,
        reservationId: null,
        orderId: null,
      };
    }

    // Gate 4: Portfolio reservation + lock
    const mode: OperationalMode = "AMA";
    const reservation = await portfolioIntegrationAdapter.beforeOrder({
      mode,
      exchange: req.exchange,
      asset: req.asset,
      amountUsd: req.amountUsd,
      cycleId: req.cycleId,
      trancheId: req.trancheId,
    });

    if (!reservation) {
      await insertAuditEvent("REAL_EXEC_BLOCKED", "WARN", {
        reason: "PORTFOLIO_RESERVATION_FAILED",
        cycleId: req.cycleId,
        trancheId: req.trancheId,
      });
      return {
        executed: false,
        reason: "PORTFOLIO_RESERVATION_FAILED",
        gateResult,
        reservationId: null,
        orderId: null,
      };
    }

    // All gates passed — log success
    await insertAuditEvent("REAL_EXEC_GATE_PASSED", "WARN", {
      cycleId: req.cycleId,
      trancheId: req.trancheId,
      amountUsd: req.amountUsd,
      reservationId: reservation.reservationId,
      lockId: reservation.lockId,
    });

    // NOTE: Actual exchange order placement would happen here.
    // For now, we return the reservation but do not place the order.
    // The exchange integration will be wired in a future phase.
    return {
      executed: true,
      reason: null,
      gateResult,
      reservationId: reservation.reservationId,
      orderId: null, // Will be set when exchange order is placed
    };
  }
}

export const amaRealExecutionGateway = new AmaRealExecutionGatewayService();
