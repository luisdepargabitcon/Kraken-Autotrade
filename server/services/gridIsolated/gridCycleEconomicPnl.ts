export interface GridCycleEconomicPnlInput {
  buyPrice: number;
  sellPrice: number;
  quantity: number;
  buyFeePct: number;
  sellFeePct: number;
  spreadBufferPct: number;
  safetyBufferPct: number;
  taxReservePct: number;
}

export interface GridCycleEconomicPnl {
  buyNotional: number;
  sellNotional: number;
  grossPnlUsd: number;
  buyFeeUsd: number;
  sellFeeUsd: number;
  exchangeFeesUsd: number;
  operationalCostsUsd: number;
  netBeforeTaxUsd: number;
  netBeforeTaxPct: number;
  taxReserveUsd: number;
  netPnlUsd: number;
  netPnlPct: number;
}

export function computeGridCycleEconomicPnl(input: GridCycleEconomicPnlInput): GridCycleEconomicPnl {
  const buyNotional = input.buyPrice * input.quantity;
  const sellNotional = input.sellPrice * input.quantity;
  const grossPnlUsd = sellNotional - buyNotional;
  const buyFeeUsd = buyNotional * input.buyFeePct / 100;
  const sellFeeUsd = sellNotional * input.sellFeePct / 100;
  const exchangeFeesUsd = buyFeeUsd + sellFeeUsd;
  const operationalCostsUsd = buyNotional * (input.spreadBufferPct + input.safetyBufferPct) / 100;
  const netBeforeTaxUsd = grossPnlUsd - exchangeFeesUsd - operationalCostsUsd;
  const netBeforeTaxPct = buyNotional > 0 ? netBeforeTaxUsd / buyNotional * 100 : 0;
  const taxReserveUsd = Math.max(netBeforeTaxUsd, 0) * input.taxReservePct / 100;
  const netPnlUsd = netBeforeTaxUsd - taxReserveUsd;
  const netPnlPct = buyNotional > 0 ? netPnlUsd / buyNotional * 100 : 0;
  return { buyNotional, sellNotional, grossPnlUsd, buyFeeUsd, sellFeeUsd, exchangeFeesUsd, operationalCostsUsd, netBeforeTaxUsd, netBeforeTaxPct, taxReserveUsd, netPnlUsd, netPnlPct };
}

/**
 * V3.2: Compute V3 economic PnL with explicit liquidity roles.
 *
 * Preserves the full V3 economic model (spreadBufferPct, safetyBufferPct, taxReservePct)
 * while allowing different fee rates for maker vs taker SELL liquidity.
 *
 * BUY is always maker (post-only). SELL can be maker or taker.
 * The only difference between maker and taker is the sellFeePct used.
 * All V3 buffers (spread, safety, tax) are preserved identically.
 */
export function computeGridCycleEconomicPnlWithLiquidityRoles(
  input: GridCycleEconomicPnlInput & {
    buyLiquidityRole?: "maker" | "taker";
    sellLiquidityRole?: "maker" | "taker";
  }
): GridCycleEconomicPnl & {
  buyLiquidityRole: "maker" | "taker";
  sellLiquidityRole: "maker" | "taker";
} {
  const buyLiquidityRole = input.buyLiquidityRole ?? "maker";
  const sellLiquidityRole = input.sellLiquidityRole ?? "maker";
  const result = computeGridCycleEconomicPnl(input);
  return {
    ...result,
    buyLiquidityRole,
    sellLiquidityRole,
  };
}
