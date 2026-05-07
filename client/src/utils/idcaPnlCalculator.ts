/**
 * IDCA PnL Calculator — Canonical PnL computation for IDCA cycles in frontend.
 *
 * Handles legacy/imported cycles where realizedPnlUsd may store SELL PROCEEDS
 * instead of NET PROFIT (pre-bee8391).
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
  pnlSource: "orders" | "cycle_capital" | "cycle_avg_entry" | "cycle_realized" | "insufficient";
  warnings: string[];
}

/**
 * Calculate PnL for an IDCA cycle using canonical rules.
 *
 * Hierarchy for cost basis:
 * 1. BUY orders (preferred)
 * 2. cycle.capitalUsedUsd / cycle.totalQuantity (for imported/manual cycles)
 * 3. cycle.avgEntryPrice (fallback)
 * 4. insufficient (cannot calculate)
 */
export function calculateIdcaCycleRealizedPnl(
  cycle: any,
  orders: any[] = []
): IdcaCyclePnlResult {
  const warnings: string[] = [];
  let pnlSource: IdcaCyclePnlResult["pnlSource"] = "insufficient";

  // Extract cycle data
  const capitalUsedUsd = parseFloat(String(cycle.capitalUsedUsd || "0"));
  const totalQuantity = parseFloat(String(cycle.totalQuantity || "0"));
  const avgEntryPrice = parseFloat(String(cycle.avgEntryPrice || "0"));
  const realizedPnlUsd = parseFloat(String(cycle.realizedPnlUsd || "0"));

  // Separate BUY and SELL orders
  const buyOrders = orders.filter((o: any) => o.side === "buy" && o.status === "filled");
  const sellOrders = orders.filter((o: any) => o.side === "sell" && o.status === "filled");

  // Calculate BUY stats
  let totalBuyQty = 0;
  let totalBuyCostUsd = 0;
  let avgCostUsd = 0;

  if (buyOrders.length > 0) {
    totalBuyQty = buyOrders.reduce((sum, o) => sum + parseFloat(String(o.quantity || "0")), 0);
    totalBuyCostUsd = buyOrders.reduce((sum, o) => sum + parseFloat(String(o.valueUsd || "0")), 0);
    const buyFeesUsd = buyOrders.reduce((sum, o) => sum + parseFloat(String(o.feesUsd || "0")), 0);
    totalBuyCostUsd += buyFeesUsd; // Include fees in cost basis
    avgCostUsd = totalBuyQty > 0 ? totalBuyCostUsd / totalBuyQty : 0;
    pnlSource = "orders";
  } else if (capitalUsedUsd > 0 && totalQuantity > 0) {
    // Fallback: use cycle.capitalUsedUsd / cycle.totalQuantity
    totalBuyQty = totalQuantity;
    totalBuyCostUsd = capitalUsedUsd;
    avgCostUsd = capitalUsedUsd / totalQuantity;
    pnlSource = "cycle_capital";
    warnings.push("Using cycle.capitalUsedUsd as cost basis (no BUY orders)");
  } else if (avgEntryPrice > 0) {
    // Fallback: use cycle.avgEntryPrice
    avgCostUsd = avgEntryPrice;
    pnlSource = "cycle_avg_entry";
    warnings.push("Using cycle.avgEntryPrice as cost basis (no BUY orders or capitalUsedUsd)");
  } else {
    // Cannot calculate cost basis
    warnings.push("Insufficient data to calculate cost basis");
    return {
      capitalInvestedUsd: 0,
      totalBuyQty: 0,
      totalBuyCostUsd: 0,
      avgCostUsd: 0,
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

  // Calculate SELL stats
  const totalSellQty = sellOrders.reduce((sum, o) => sum + parseFloat(String(o.quantity || "0")), 0);
  const totalSellValueUsd = sellOrders.reduce((sum, o) => sum + parseFloat(String(o.valueUsd || "0")), 0);
  const totalSellFeesUsd = sellOrders.reduce((sum, o) => sum + parseFloat(String(o.feesUsd || "0")), 0);

  // Calculate sold cost basis
  let soldCostBasisUsd = avgCostUsd * totalSellQty;

  // Dust tolerance: if sellQty is close to totalQty, use total cost basis
  if (totalSellQty > 0 && totalBuyQty > 0) {
    const diffQty = totalBuyQty - totalSellQty;
    const diffPct = (diffQty / totalBuyQty) * 100;
    const isBtc = cycle.pair?.includes("BTC");
    const isEth = cycle.pair?.includes("ETH");

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

  // Calculate PnL
  const realizedGrossUsd = totalSellValueUsd - soldCostBasisUsd;
  const realizedNetUsd = realizedGrossUsd - totalSellFeesUsd;
  const realizedPnlPct = soldCostBasisUsd > 0 ? (realizedNetUsd / soldCostBasisUsd) * 100 : 0;

  return {
    capitalInvestedUsd: totalBuyCostUsd,
    totalBuyQty,
    totalBuyCostUsd,
    avgCostUsd,
    totalSellQty,
    totalSellValueUsd,
    soldCostBasisUsd,
    realizedGrossUsd,
    totalFeesUsd: totalSellFeesUsd,
    realizedNetUsd,
    realizedPnlPct,
    pnlSource,
    warnings,
  };
}
