import * as repo from "./IdcaRepository";

export interface IdcaAccountingPort {
  getCycleById(cycleId: number): Promise<any>;
  updateCycle(cycleId: number, patch: Record<string, unknown>): Promise<unknown>;
  createOrder(order: Record<string, unknown>): Promise<unknown>;
  getOrdersByCycle?(cycleId: number): Promise<any[]>;
}

export const defaultIdcaAccountingPort: IdcaAccountingPort = {
  getCycleById: (cycleId) => repo.getCycleById(cycleId),
  updateCycle: (cycleId, patch) => repo.updateCycle(cycleId, patch as any),
  createOrder: (order) => repo.createOrder(order as any),
  getOrdersByCycle: (cycleId) => repo.getOrdersByCycle(cycleId),
};

export interface ReconciledSellEffect {
  cycleId: number;
  pair: string;
  deltaQty: number;
  deltaGrossValueUsd: number;
  deltaFeesUsd: number;
  averagePrice: number;
  closePosition: boolean;
  orderType: string;
  triggerReason: string;
  closeReason?: string;
  exchangeOrderId: string | null;
  clientOrderId: string;
  feeSource: string;
}

export interface AppliedSellAccounting {
  quantitySold: number;
  costBasisSold: number;
  netValueUsd: number;
  realizedPnlIncrement: number;
  closed: boolean;
  remainingQty: number;
}

export async function applyReconciledSellEffect(
  effect: ReconciledSellEffect,
  port: IdcaAccountingPort = defaultIdcaAccountingPort,
): Promise<AppliedSellAccounting | null> {
  if (!(effect.deltaQty > 0)) return null;
  const cycle = await port.getCycleById(effect.cycleId);
  if (!cycle || cycle.status === "closed") return null;

  const oldQty = parseFloat(String(cycle.totalQuantity || "0"));
  const oldCapitalUsed = parseFloat(String(cycle.capitalUsedUsd || "0"));
  if (!(oldQty > 0)) return null;

  const quantitySold = Math.min(effect.deltaQty, oldQty);
  const sellRatio = effect.closePosition ? 1 : Math.min(1, quantitySold / oldQty);
  const costBasisSold = oldCapitalUsed * sellRatio;
  const remainingCost = Math.max(0, oldCapitalUsed - costBasisSold);
  const grossValue = effect.deltaGrossValueUsd > 0
    ? effect.deltaGrossValueUsd
    : quantitySold * effect.averagePrice;
  const netValue = grossValue - effect.deltaFeesUsd;
  const realizedPnlIncrement = netValue - costBasisSold;
  const remainingQty = effect.closePosition ? 0 : Math.max(0, oldQty - quantitySold);
  const closed = effect.closePosition || remainingQty <= 0;

  const prevRealizedPnl = parseFloat(String(cycle.realizedPnlUsd || "0"));
  const prevRealizedCostBasis = parseFloat(String(cycle.realizedCostBasisUsd || "0"));
  const partialSellCount = Number(cycle.partialSellCount ?? 0);

  await port.updateCycle(effect.cycleId, closed ? {
    status: "closed",
    closeReason: effect.closeReason ?? effect.triggerReason,
    totalQuantity: "0",
    capitalUsedUsd: "0",
    realizedCostBasisUsd: (prevRealizedCostBasis + costBasisSold).toFixed(2),
    realizedPnlUsd: (prevRealizedPnl + realizedPnlIncrement).toFixed(2),
    unrealizedPnlUsd: "0",
    unrealizedPnlPct: "0",
    currentPrice: effect.averagePrice.toFixed(8),
    closedAt: new Date(),
  } : {
    totalQuantity: remainingQty.toFixed(8),
    capitalUsedUsd: remainingCost.toFixed(2),
    realizedCostBasisUsd: (prevRealizedCostBasis + costBasisSold).toFixed(2),
    realizedPnlUsd: (prevRealizedPnl + realizedPnlIncrement).toFixed(2),
    partialSellCount: partialSellCount + 1,
    lastPartialSellAt: new Date(),
    currentPrice: effect.averagePrice.toFixed(8),
  });

  await port.createOrder({
    cycleId: effect.cycleId,
    pair: effect.pair,
    mode: "live",
    orderType: effect.orderType,
    side: "sell",
    price: effect.averagePrice.toFixed(8),
    quantity: quantitySold.toFixed(8),
    grossValueUsd: grossValue.toFixed(2),
    feesUsd: effect.deltaFeesUsd.toFixed(4),
    slippageUsd: "0",
    netValueUsd: netValue.toFixed(2),
    exchangeOrderId: effect.exchangeOrderId ?? undefined,
    triggerReason: effect.triggerReason,
    humanReason: `Venta live reconciliada (${effect.feeSource})`,
  });

  return { quantitySold, costBasisSold, netValueUsd: netValue, realizedPnlIncrement, closed, remainingQty };
}


export interface ReconciledBuyEffect {
  cycleId: number;
  pair: string;
  cumulativeFilledQty: number;
  cumulativeNetFilledQty: number;
  previouslyAppliedQty: number;
  deltaQty: number;
  deltaGrossValueUsd: number;
  deltaFeesUsd: number;
  averagePrice: number;
  orderType: string;
  triggerReason: string;
  exchangeOrderId: string | null;
  clientOrderId: string;
  feeSource: string;
  terminal: boolean;
}

export interface AppliedBuyAccounting {
  quantityBought: number;
  grossValueUsd: number;
  feesUsd: number;
  alreadyAccounted: boolean;
}

/**
 * Recovery accounting for live buys. Immediate callers remain responsible for
 * their strategy-specific updates; this function detects their order rows by
 * exchange order id and applies only the unaccounted cumulative delta after a
 * restart. It intentionally updates only position/cost facts, not TP or next
 * safety-level strategy state.
 */
export async function applyReconciledBuyEffect(
  effect: ReconciledBuyEffect,
  port: IdcaAccountingPort = defaultIdcaAccountingPort,
): Promise<AppliedBuyAccounting | null> {
  if (!(effect.cumulativeFilledQty > 0) || !(effect.averagePrice > 0)) return null;
  const cycle = await port.getCycleById(effect.cycleId);
  if (!cycle || cycle.status === "closed") {
    throw new Error(`IDCA_BUY_CYCLE_UNAVAILABLE: cycle=${effect.cycleId}`);
  }

  const orderKey = effect.exchangeOrderId ?? effect.clientOrderId;
  const orders = port.getOrdersByCycle ? await port.getOrdersByCycle(effect.cycleId) : [];
  const matching = (orders ?? []).filter(o => String(o?.exchangeOrderId ?? "") === String(orderKey));
  const externallyAccountedQty = matching.reduce((max, o) => {
    const executed = parseFloat(String(o?.executedQuantity ?? o?.quantity ?? "0"));
    return Number.isFinite(executed) ? Math.max(max, executed) : max;
  }, 0);

  const isInitialLike = ["initial_buy", "plus_buy", "recovery_buy"].includes(effect.triggerReason);
  const cycleQty = parseFloat(String(cycle.totalQuantity || "0"));
  const netRatio = effect.cumulativeFilledQty > 0
    ? Math.min(1, Math.max(0, effect.cumulativeNetFilledQty / effect.cumulativeFilledQty))
    : 1;
  // A base cycle is created with its first executed quantity before its order
  // row. If the crash happened in that gap, use the cycle quantity as the
  // already-accounted floor instead of double-adding it.
  const initialFloor = isInitialLike && externallyAccountedQty <= 0 ? Math.min(effect.cumulativeFilledQty, Math.max(0, cycleQty) / Math.max(netRatio, 1e-12)) : 0;
  const accountedQty = Math.max(effect.previouslyAppliedQty, externallyAccountedQty, initialFloor);
  const qtyToApply = Math.max(0, effect.cumulativeFilledQty - accountedQty);
  if (qtyToApply <= 1e-12) {
    return { quantityBought: 0, grossValueUsd: 0, feesUsd: 0, alreadyAccounted: true };
  }

  const grossValue = effect.deltaQty > 0
    ? effect.deltaGrossValueUsd * (qtyToApply / effect.deltaQty)
    : qtyToApply * effect.averagePrice;
  const feesUsd = effect.deltaQty > 0
    ? effect.deltaFeesUsd * (qtyToApply / effect.deltaQty)
    : 0;

  const positionQtyToApply = qtyToApply * netRatio;
  const oldQty = Math.max(0, parseFloat(String(cycle.totalQuantity || "0")));
  const oldCapital = Math.max(0, parseFloat(String(cycle.capitalUsedUsd || "0")));
  const oldCostBasis = Math.max(0, parseFloat(String(cycle.totalCostBasisUsd || cycle.capitalUsedUsd || "0")));
  const newQty = oldQty + positionQtyToApply;
  const newCapital = oldCapital + grossValue;
  const newAvg = newQty > 0 ? newCapital / newQty : 0;
  const isBaseBuy = isInitialLike;
  const shouldIncrementBuyCount = effect.terminal && !isBaseBuy;
  const newBuyCount = shouldIncrementBuyCount ? Number(cycle.buyCount ?? 0) + 1 : Number(cycle.buyCount ?? 0);

  await port.updateCycle(effect.cycleId, {
    totalQuantity: newQty.toFixed(8),
    capitalUsedUsd: newCapital.toFixed(2),
    totalCostBasisUsd: (oldCostBasis + grossValue).toFixed(2),
    avgEntryPrice: newAvg.toFixed(8),
    buyCount: newBuyCount,
    lastBuyAt: new Date(),
    currentPrice: effect.averagePrice.toFixed(8),
  });

  await port.createOrder({
    cycleId: effect.cycleId,
    pair: effect.pair,
    mode: "live",
    orderType: isBaseBuy ? "base_buy" : "safety_buy",
    buyIndex: isBaseBuy ? 1 : Math.max(1, newBuyCount),
    side: "buy",
    price: effect.averagePrice.toFixed(8),
    quantity: qtyToApply.toFixed(8),
    grossValueUsd: Math.max(0, grossValue - feesUsd).toFixed(2),
    feesUsd: feesUsd.toFixed(4),
    slippageUsd: "0",
    netValueUsd: grossValue.toFixed(2),
    exchangeOrderId: effect.exchangeOrderId ?? undefined,
    triggerReason: effect.triggerReason,
    humanReason: `Compra live reconciliada (${effect.feeSource})`,
    executionStatus: effect.terminal ? "filled" : "partial",
    intendedQuantity: undefined,
    executedQuantity: effect.cumulativeFilledQty.toFixed(8),
    grossBaseQty: qtyToApply.toFixed(8),
    netBaseQty: positionQtyToApply.toFixed(8),
    avgFillPrice: effect.averagePrice.toFixed(8),
    feeSource: effect.feeSource === "venue" ? "exchange_api" : effect.feeSource === "estimated_preset" ? "inferred_from_default_pct" : null,
  });

  return { quantityBought: qtyToApply, grossValueUsd: grossValue, feesUsd, alreadyAccounted: false };
}
