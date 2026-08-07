/**
 * AMA Shadow Executor Service — Simulated order execution for SHADOW modes.
 *
 * Executes simulated orders against the AMA engine without touching real
 * exchanges or capital. Orders are persisted to ama_shadow_orders.
 *
 * SAFETY:
 * - No real orders.
 * - No exchange calls.
 * - No capital at risk.
 * - All simulated orders are persisted for auditability.
 * - SHADOW_SCENARIO: uses historical/scenario data.
 * - SHADOW_LIVE: uses live market data but simulated execution.
 */

import {
  insertShadowOrder,
  updateShadowOrderStatus,
  getShadowOrdersByCycle,
  type ShadowOrderRow,
} from "./amaShadowReplayRepository";
import {
  insertShadowScenario,
  getShadowScenarios,
  getShadowScenarioById,
  updateShadowScenarioStatus,
  type ShadowScenarioRow,
} from "./amaShadowReplayRepository";
import { checkShadowReadiness } from "./amaShadowExecutorSecurity";
import type { AmaMode, AmaTranche } from "./amaTypes";

export interface ShadowOrderInput {
  orderId: string;
  cycleId: string;
  trancheId: string;
  pair: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT_MAKER" | "LIMIT_TAKER";
  price: number;
  quantity: number;
  amountUsd: number;
  shadowMode: "SHADOW_SCENARIO" | "SHADOW_LIVE";
  scenarioId?: string | null;
}

export async function createShadowOrder(
  input: ShadowOrderInput,
): Promise<ShadowOrderRow> {
  const now = new Date().toISOString();
  const row: ShadowOrderRow = {
    orderId: input.orderId,
    cycleId: input.cycleId,
    trancheId: input.trancheId,
    pair: input.pair,
    side: input.side,
    orderType: input.orderType,
    price: input.price,
    quantity: input.quantity,
    amountUsd: input.amountUsd,
    status: "PENDING",
    simulatedFillPrice: null,
    simulatedFillTimestamp: null,
    rejectionReason: null,
    shadowMode: input.shadowMode,
    scenarioId: input.scenarioId ?? null,
    createdAt: now,
  };

  await insertShadowOrder(row);
  return row;
}

export async function simulateFill(
  orderId: string,
  fillPrice: number,
): Promise<void> {
  await updateShadowOrderStatus(
    orderId,
    "SIMULATED_FILLED",
    fillPrice,
    new Date().toISOString(),
  );
}

export async function simulateReject(
  orderId: string,
  reason: string,
): Promise<void> {
  await updateShadowOrderStatus(
    orderId,
    "SIMULATED_REJECTED",
    undefined,
    undefined,
    reason,
  );
}

export async function expireShadowOrder(orderId: string): Promise<void> {
  await updateShadowOrderStatus(orderId, "EXPIRED");
}

export async function getShadowOrders(cycleId: string): Promise<ShadowOrderRow[]> {
  return await getShadowOrdersByCycle(cycleId);
}

// ─── Shadow Scenario Management ──────────────────────────────────────

export interface ShadowScenarioInput {
  scenarioId: string;
  name: string;
  description?: string;
  asset: string;
  pair: string;
  config: Record<string, unknown>;
}

export async function createShadowScenario(
  input: ShadowScenarioInput,
): Promise<void> {
  const now = new Date().toISOString();
  await insertShadowScenario({
    scenarioId: input.scenarioId,
    name: input.name,
    description: input.description ?? null,
    asset: input.asset,
    pair: input.pair,
    configJson: input.config,
    status: "ACTIVE",
    totalOrders: 0,
    totalFilled: 0,
    totalSimulatedUsd: 0,
    createdAt: now,
    updatedAt: now,
  });
}

export async function listShadowScenarios(): Promise<ShadowScenarioRow[]> {
  return await getShadowScenarios();
}

export async function getShadowScenario(
  scenarioId: string,
): Promise<ShadowScenarioRow | null> {
  return await getShadowScenarioById(scenarioId);
}

export async function closeShadowScenario(scenarioId: string): Promise<void> {
  await updateShadowScenarioStatus(scenarioId, "CLOSED");
}

// ─── Shadow Execution Engine ─────────────────────────────────────────

export interface ShadowExecutionContext {
  mode: AmaMode;
  hasHwm: boolean;
  hasBudget: boolean;
  hasCurrentPrice: boolean;
  dataCoveragePct: number;
  minDataCoveragePct: number;
}

export interface ShadowExecutionResult {
  ready: boolean;
  blockers: string[];
  ordersCreated: number;
  ordersFilled: number;
  ordersRejected: number;
  totalSimulatedUsd: number;
}

export async function executeShadowTick(
  cycleId: string,
  tranches: AmaTranche[],
  currentPrice: number,
  ctx: ShadowExecutionContext,
): Promise<ShadowExecutionResult> {
  // Check readiness
  const readiness = checkShadowReadiness(
    ctx.mode,
    ctx.hasHwm,
    ctx.hasBudget,
    ctx.hasCurrentPrice,
    ctx.dataCoveragePct,
    ctx.minDataCoveragePct,
  );

  if (!readiness.ready) {
    return {
      ready: false,
      blockers: readiness.blockers,
      ordersCreated: 0,
      ordersFilled: 0,
      ordersRejected: 0,
      totalSimulatedUsd: 0,
    };
  }

  let ordersCreated = 0;
  let ordersFilled = 0;
  let ordersRejected = 0;
  let totalSimulatedUsd = 0;

  for (const tranche of tranches) {
    if (tranche.status !== "CREATED") continue;

    const orderId = `shadow-${cycleId}-${tranche.trancheId}-${Date.now()}`;
    const shadowMode = ctx.mode === "SHADOW_LIVE" ? "SHADOW_LIVE" : "SHADOW_SCENARIO";

    const order = await createShadowOrder({
      orderId,
      cycleId,
      trancheId: tranche.trancheId,
      pair: "BTC/USD",
      side: "BUY",
      orderType: "LIMIT_MAKER",
      price: currentPrice,
      quantity: tranche.plannedAmountUsd / currentPrice,
      amountUsd: tranche.plannedAmountUsd,
      shadowMode,
    });

    ordersCreated++;

    // Simulate fill at current price (LIMIT_MAKER would fill at maker price)
    if (currentPrice > 0) {
      await simulateFill(order.orderId, currentPrice);
      ordersFilled++;
      totalSimulatedUsd += tranche.plannedAmountUsd;
    } else {
      await simulateReject(order.orderId, "INVALID_PRICE");
      ordersRejected++;
    }
  }

  return {
    ready: true,
    blockers: [],
    ordersCreated,
    ordersFilled,
    ordersRejected,
    totalSimulatedUsd,
  };
}

// ─── Shadow Report ───────────────────────────────────────────────────

export interface ShadowReport {
  cycleId: string;
  totalOrders: number;
  totalFilled: number;
  totalRejected: number;
  totalExpired: number;
  totalPending: number;
  totalSimulatedUsd: number;
  averageFillPrice: number | null;
  ordersByType: Record<string, number>;
}

export async function generateShadowReport(cycleId: string): Promise<ShadowReport> {
  const orders = await getShadowOrdersByCycle(cycleId);

  let totalFilled = 0;
  let totalRejected = 0;
  let totalExpired = 0;
  let totalPending = 0;
  let totalSimulatedUsd = 0;
  let fillPriceSum = 0;
  let fillCount = 0;
  const ordersByType: Record<string, number> = {};

  for (const order of orders) {
    ordersByType[order.orderType] = (ordersByType[order.orderType] ?? 0) + 1;

    switch (order.status) {
      case "SIMULATED_FILLED":
        totalFilled++;
        totalSimulatedUsd += order.amountUsd;
        if (order.simulatedFillPrice !== null) {
          fillPriceSum += order.simulatedFillPrice;
          fillCount++;
        }
        break;
      case "SIMULATED_REJECTED":
        totalRejected++;
        break;
      case "EXPIRED":
        totalExpired++;
        break;
      case "PENDING":
        totalPending++;
        break;
    }
  }

  return {
    cycleId,
    totalOrders: orders.length,
    totalFilled,
    totalRejected,
    totalExpired,
    totalPending,
    totalSimulatedUsd,
    averageFillPrice: fillCount > 0 ? fillPriceSum / fillCount : null,
    ordersByType,
  };
}
