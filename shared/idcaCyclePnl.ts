/**
 * IDCA PnL Calculator — Canonical PnL computation for IDCA cycles.
 *
 * Pure function compatible with both frontend and backend.
 * Handles legacy/imported cycles where realizedPnlUsd may store SELL PROCEEDS
 * instead of NET PROFIT (pre-bee8391).
 *
 * PRIORITY: Always calculate from real orders when available.
 */

export interface IdcaCyclePnlResult {
  capitalInvestedUsd: number;
  totalBuyQty: number;
  totalBuyCostUsd: number;
  avgCostUsd: number;
  totalSellQty: number;
  totalSellValueUsd: number;
  soldCostBasisUsd: number;
  realizedGrossUsd: number;
  totalFeesUsd: number;
  realizedNetUsd: number;
  realizedPnlPct: number;
  pnlSource: "orders" | "orders_cycle_capital" | "orders_avg_entry" | "cycle_realized" | "insufficient";
  warnings: string[];
}

export interface IdcaCyclePnlOrder {
  side: string;
  status?: string;
  type?: string;
  reason?: string;
  price?: number | string | null;
  quantity?: number | string | null;
  valueUsd?: number | string | null;
  value_usd?: number | string | null;
  feesUsd?: number | string | null;
  feeUsd?: number | string | null;
  fee_usd?: number | string | null;
}

export interface IdcaCyclePnlInput {
  capitalUsedUsd?: number | string | null;
  totalQuantity?: number | string | null;
  avgEntryPrice?: number | string | null;
  realizedPnlUsd?: number | string | null;
  pair?: string | null;
  status?: string;
  isImported?: boolean;
  sourceType?: string;
  isManualCycle?: boolean;
}

/**
 * Normalize order side/type to "buy" | "sell" | "unknown"
 * Handles English and Spanish variants.
 */
function normalizeOrderSide(order: IdcaCyclePnlOrder): "buy" | "sell" | "unknown" {
  const side = order.side?.toLowerCase() || "";
  const type = order.type?.toLowerCase() || "";
  const reason = order.reason?.toLowerCase() || "";

  // Check side field
  if (side === "buy" || side === "buy") return "buy";
  if (side === "sell" || side === "sell") return "sell";

  // Check type field (Spanish)
  if (type.includes("compra") || type.includes("buy")) return "buy";
  if (type.includes("venta") || type.includes("sell")) return "sell";

  // Check reason field
  if (reason.includes("compra") || reason.includes("buy")) return "buy";
  if (reason.includes("venta") || reason.includes("sell")) return "sell";

  return "unknown";
}

/**
 * Check if realizedPnlUsd is plausible as NET PROFIT (not sell proceeds).
 * Legacy/imported cycles may store sell proceeds in realizedPnlUsd.
 */
function isPlausibleNetPnl(realizedPnlUsd: number, capitalUsedUsd: number): { plausible: boolean; reason: string } {
  if (capitalUsedUsd <= 0) {
    return { plausible: false, reason: "No capital to compare" };
  }

  const pnlRatio = Math.abs(realizedPnlUsd) / capitalUsedUsd;

  // If realizedPnlUsd is > 80% of capital, it's likely sell proceeds, not net profit
  if (realizedPnlUsd > capitalUsedUsd * 0.80) {
    return { plausible: false, reason: "realizedPnlUsd > 80% of capital, likely sell proceeds" };
  }

  // If realizedPnlUsd is ≈ capital + typical profit, it's likely sell proceeds
  if (realizedPnlUsd > capitalUsedUsd * 0.50 && realizedPnlUsd < capitalUsedUsd * 1.20) {
    return { plausible: false, reason: "realizedPnlUsd ≈ capital, likely sell proceeds" };
  }

  // If abs(realizedPnlUsd) <= 50% of capital, it's plausible as net profit
  if (pnlRatio <= 0.50) {
    return { plausible: true, reason: "Plausible as net profit" };
  }

  return { plausible: false, reason: "Unsure, treat as sell proceeds" };
}

/**
 * Calculate PnL for an IDCA cycle using canonical rules.
 *
 * PRIORITY:
 * 1. Calculate from BUY/SELL orders when available (always preferred)
 * 2. If SELL but no BUY: use capitalUsedUsd/avgEntry as cost basis
 * 3. Only if no orders sufficient: use realizedPnlUsd as fallback (with validation)
 * 4. Validate realizedPnlUsd before using (detect sell proceeds)
 */
export function calculateIdcaCycleRealizedPnl(
  cycle: IdcaCyclePnlInput,
  orders: IdcaCyclePnlOrder[] = []
): IdcaCyclePnlResult {
  const warnings: string[] = [];
  let pnlSource: IdcaCyclePnlResult["pnlSource"] = "insufficient";

  // Extract cycle data
  const capitalUsedUsd = parseFloat(String(cycle.capitalUsedUsd || "0"));
  const totalQuantity = parseFloat(String(cycle.totalQuantity || "0"));
  const avgEntryPrice = parseFloat(String(cycle.avgEntryPrice || "0"));
  const realizedPnlUsd = parseFloat(String(cycle.realizedPnlUsd || "0"));
  const status = cycle.status || "active";
  const pair = cycle.pair || "";

  // Separate BUY and SELL orders (normalized)
  const buyOrders = orders.filter((o: IdcaCyclePnlOrder) => {
    const normalizedSide = normalizeOrderSide(o);
    const isFilled = !o.status || o.status.toLowerCase() === "filled";
    return normalizedSide === "buy" && isFilled;
  });
  const sellOrders = orders.filter((o: IdcaCyclePnlOrder) => {
    const normalizedSide = normalizeOrderSide(o);
    const isFilled = !o.status || o.status.toLowerCase() === "filled";
    return normalizedSide === "sell" && isFilled;
  });

  // Calculate BUY stats
  let totalBuyQty = 0;
  let totalBuyCostUsd = 0;
  let avgCostUsd = 0;

  if (buyOrders.length > 0) {
    totalBuyQty = buyOrders.reduce((sum, o) => sum + parseFloat(String(o.quantity || "0")), 0);
    totalBuyCostUsd = buyOrders.reduce((sum, o) => {
      const value = parseFloat(String(o.valueUsd || o.value_usd || "0"));
      return sum + value;
    }, 0);
    const buyFeesUsd = buyOrders.reduce((sum, o) => {
      const fee = parseFloat(String(o.feesUsd || o.feeUsd || o.fee_usd || "0"));
      return sum + fee;
    }, 0);
    totalBuyCostUsd += buyFeesUsd; // Include fees in cost basis
    avgCostUsd = totalBuyQty > 0 ? totalBuyCostUsd / totalBuyQty : 0;
  }

  // Calculate SELL stats
  const totalSellQty = sellOrders.reduce((sum, o) => sum + parseFloat(String(o.quantity || "0")), 0);
  const totalSellValueUsd = sellOrders.reduce((sum, o) => {
    const value = parseFloat(String(o.valueUsd || o.value_usd || "0"));
    return sum + value;
  }, 0);
  const totalSellFeesUsd = sellOrders.reduce((sum, o) => {
    const fee = parseFloat(String(o.feesUsd || o.feeUsd || o.fee_usd || "0"));
    return sum + fee;
  }, 0);

  const hasSellOrders = sellOrders.length > 0 && totalSellValueUsd > 0;
  const hasBuyOrders = buyOrders.length > 0 && totalBuyCostUsd > 0 && totalBuyQty > 0;

  // PRIORITY 1: Calculate from orders when SELL orders exist
  if (hasSellOrders) {
    let soldCostBasisUsd = 0;
    let calculatedPnlSource: IdcaCyclePnlResult["pnlSource"] = "orders";

    if (hasBuyOrders) {
      // Use BUY orders for cost basis
      soldCostBasisUsd = avgCostUsd * totalSellQty;
      calculatedPnlSource = "orders";

      // Dust tolerance
      if (totalSellQty > 0 && totalBuyQty > 0) {
        const diffQty = totalBuyQty - totalSellQty;
        const diffPct = (diffQty / totalBuyQty) * 100;
        const isBtc = pair.includes("BTC");
        const isEth = pair.includes("ETH");

        if (isBtc && diffQty <= 0.00001) {
          soldCostBasisUsd = totalBuyCostUsd;
          warnings.push("Using total cost basis (BTC dust tolerance)");
        } else if (isEth && diffQty <= 0.0001) {
          soldCostBasisUsd = totalBuyCostUsd;
          warnings.push("Using total cost basis (ETH dust tolerance)");
        } else if (diffPct <= 0.20) {
          soldCostBasisUsd = totalBuyCostUsd;
          warnings.push("Using total cost basis (within 0.20% tolerance)");
        }
      }
    } else if (capitalUsedUsd > 0) {
      // Use capitalUsedUsd as cost basis (no BUY orders)
      soldCostBasisUsd = capitalUsedUsd;
      calculatedPnlSource = "orders_cycle_capital";
      warnings.push("Using capitalUsedUsd as cost basis (no BUY orders)");
    } else if (avgEntryPrice > 0 && totalSellQty > 0) {
      // Use avgEntryPrice as cost basis
      soldCostBasisUsd = avgEntryPrice * totalSellQty;
      calculatedPnlSource = "orders_avg_entry";
      warnings.push("Using avgEntryPrice as cost basis (no BUY orders or capitalUsedUsd)");
    } else {
      // Cannot calculate cost basis
      warnings.push("Cannot calculate cost basis from orders");
      return {
        capitalInvestedUsd: totalBuyCostUsd || capitalUsedUsd,
        totalBuyQty: totalBuyQty || totalQuantity,
        totalBuyCostUsd: totalBuyCostUsd || capitalUsedUsd,
        avgCostUsd: avgCostUsd || avgEntryPrice,
        totalSellQty,
        totalSellValueUsd,
        soldCostBasisUsd: 0,
        realizedGrossUsd: 0,
        totalFeesUsd: totalSellFeesUsd,
        realizedNetUsd: 0,
        realizedPnlPct: 0,
        pnlSource: "insufficient",
        warnings,
      };
    }

    const realizedGrossUsd = totalSellValueUsd - soldCostBasisUsd;
    const realizedNetUsd = realizedGrossUsd - totalSellFeesUsd;
    const realizedPnlPct = soldCostBasisUsd > 0 ? (realizedNetUsd / soldCostBasisUsd) * 100 : 0;

    // Debug log
    console.debug(`[IDCA][PNL_HISTORY_CALC] source=${calculatedPnlSource} buyQty=${totalBuyQty} buyCost=${totalBuyCostUsd} sellQty=${totalSellQty} sellValue=${totalSellValueUsd} soldCostBasis=${soldCostBasisUsd} realizedNet=${realizedNetUsd} pnlPct=${realizedPnlPct}`);

    return {
      capitalInvestedUsd: totalBuyCostUsd || capitalUsedUsd,
      totalBuyQty: totalBuyQty || totalQuantity,
      totalBuyCostUsd: totalBuyCostUsd || capitalUsedUsd,
      avgCostUsd: avgCostUsd || avgEntryPrice,
      totalSellQty,
      totalSellValueUsd,
      soldCostBasisUsd,
      realizedGrossUsd,
      totalFeesUsd: totalSellFeesUsd,
      realizedNetUsd,
      realizedPnlPct,
      pnlSource: calculatedPnlSource,
      warnings,
    };
  }

  // PRIORITY 2: Fallback to realizedPnlUsd (only if no orders sufficient)
  const plausible = isPlausibleNetPnl(realizedPnlUsd, capitalUsedUsd);
  if (status === "closed" && plausible.plausible && realizedPnlUsd !== 0) {
    const realizedPnlPct = capitalUsedUsd > 0 ? (realizedPnlUsd / capitalUsedUsd) * 100 : 0;
    warnings.push(`Using realizedPnlUsd as fallback: ${plausible.reason}`);
    return {
      capitalInvestedUsd: capitalUsedUsd,
      totalBuyQty: totalQuantity,
      totalBuyCostUsd: capitalUsedUsd,
      avgCostUsd: capitalUsedUsd > 0 && totalQuantity > 0 ? capitalUsedUsd / totalQuantity : 0,
      totalSellQty: totalQuantity,
      totalSellValueUsd: capitalUsedUsd + realizedPnlUsd,
      soldCostBasisUsd: capitalUsedUsd,
      realizedGrossUsd: realizedPnlUsd,
      totalFeesUsd: 0,
      realizedNetUsd: realizedPnlUsd,
      realizedPnlPct,
      pnlSource: "cycle_realized",
      warnings,
    };
  }

  // PRIORITY 3: Insufficient data
  if (!plausible.plausible) {
    warnings.push(`realizedPnlUsd not plausible as net profit: ${plausible.reason}`);
  }
  warnings.push("Insufficient data to calculate PnL");
  return {
    capitalInvestedUsd: capitalUsedUsd,
    totalBuyQty: totalQuantity,
    totalBuyCostUsd: capitalUsedUsd,
    avgCostUsd: capitalUsedUsd > 0 && totalQuantity > 0 ? capitalUsedUsd / totalQuantity : 0,
    totalSellQty: 0,
    totalSellValueUsd: 0,
    soldCostBasisUsd: 0,
    realizedGrossUsd: 0,
    totalFeesUsd: 0,
    realizedNetUsd: 0,
    realizedPnlPct: 0,
    pnlSource: "insufficient",
    warnings,
  };
}
