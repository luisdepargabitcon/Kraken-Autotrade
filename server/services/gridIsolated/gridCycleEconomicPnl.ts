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
