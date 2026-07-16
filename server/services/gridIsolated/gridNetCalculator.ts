/**
 * GridNetCalculator — Financial calculations for the Isolated Grid Engine.
 *
 * Computes:
 *   - grossTargetPct: the raw price gap needed between buy and sell
 *   - feeAdjustedTargetPct: gross target + buy fee + sell fee
 *   - netProfitTargetPct: final target after tax reserve
 *   - per-cycle PnL: gross, fees, tax reserve, net
 *
 * Uses Revolut X fees: maker 0.00%, taker 0.09%.
 * Fee buffers: 0.09% buy + 0.09% sell (conservative — assumes taker on both sides).
 * Tax reserve: 20% of net profit.
 *
 * This module is PURE — no side effects, no DB, no exchange calls.
 * It does NOT duplicate fiscal logic (FIFO, disposal, etc.).
 */

import {
  FEE_BUFFER_BUY_PCT,
  FEE_BUFFER_SELL_PCT,
  TAX_RESERVE_PCT,
} from "./gridIsolatedTypes";

export interface NetTargetBreakdown {
  netProfitTargetPct: number;
  grossTargetPct: number;
  feeAdjustedTargetPct: number;
  buyFeePct: number;
  sellFeePct: number;
  taxReservePct: number;
}

export interface CyclePnL {
  buyPrice: number;
  sellPrice: number;
  quantity: number;
  buyLiquidityRole?: "maker" | "taker";
  sellLiquidityRole?: "maker" | "taker";
  grossPnlUsd: number;
  buyFeeUsd: number;
  sellFeeUsd: number;
  totalFeesUsd: number;
  netBeforeTaxUsd: number;
  taxReserveUsd: number;
  netPnlUsd: number;
  netPnlPct: number;
  actualPriceGapPct: number;
}

export interface CyclePnLOptions {
  buyPrice: number;
  sellPrice: number;
  quantity: number;
  buyLiquidityRole?: "maker" | "taker";
  sellLiquidityRole?: "maker" | "taker";
  makerFeePct?: number;
  takerFeePct?: number;
  taxReservePct?: number;
}

/**
 * Compute the gross target percentage from a net profit target slider value.
 *
 * Formula:
 *   netProfitTargetPct = user slider (e.g. 0.5%)
 *   taxReservePct = 20% of (netProfitTargetPct)
 *   feeAdjustedTargetPct = netProfitTargetPct + taxReservePct + buyFeePct + sellFeePct
 *   grossTargetPct = feeAdjustedTargetPct  (this is the price gap needed)
 *
 * Inverse: given a desired net %, what price gap do we need?
 *   grossTargetPct = netProfitTargetPct / (1 - taxReserveFraction) + buyFeePct + sellFeePct
 *
 * where taxReserveFraction = TAX_RESERVE_PCT / 100
 */
export function computeGrossTargetFromNet(netProfitTargetPct: number): NetTargetBreakdown {
  const buyFeePct = FEE_BUFFER_BUY_PCT;
  const sellFeePct = FEE_BUFFER_SELL_PCT;
  const taxReserveFraction = TAX_RESERVE_PCT / 100;

  // grossTargetPct is the price gap that, after fees and tax, yields netProfitTargetPct
  // netBeforeTax = grossGap - buyFee - sellFee
  // netAfterTax = netBeforeTax * (1 - taxReserveFraction)
  // netAfterTax = netProfitTargetPct
  // => netBeforeTax = netProfitTargetPct / (1 - taxReserveFraction)
  // => grossGap = netBeforeTax + buyFee + sellFee
  const netBeforeTax = netProfitTargetPct / (1 - taxReserveFraction);
  const grossTargetPct = netBeforeTax + buyFeePct + sellFeePct;
  const feeAdjustedTargetPct = grossTargetPct;
  const taxReservePct = netBeforeTax * taxReserveFraction;

  return {
    netProfitTargetPct,
    grossTargetPct,
    feeAdjustedTargetPct,
    buyFeePct,
    sellFeePct,
    taxReservePct,
  };
}

/**
 * Compute the sell price that achieves the net profit target given a buy price.
 */
export function computeSellPrice(buyPrice: number, netProfitTargetPct: number): number {
  const breakdown = computeGrossTargetFromNet(netProfitTargetPct);
  return buyPrice * (1 + breakdown.grossTargetPct / 100);
}

/**
 * Compute the actual PnL for a completed cycle.
 */
export function computeCyclePnL(
  buyPrice: number,
  sellPrice: number,
  quantity: number,
  makerFeePct: number = 0.00,
  takerFeePct: number = 0.09,
  usedTakerForBuy: boolean = true,
  usedTakerForSell: boolean = true
): CyclePnL {
  const buyNotional = buyPrice * quantity;
  const sellNotional = sellPrice * quantity;

  const buyFeeRate = (usedTakerForBuy ? takerFeePct : makerFeePct) / 100;
  const sellFeeRate = (usedTakerForSell ? takerFeePct : makerFeePct) / 100;

  const buyFeeUsd = buyNotional * buyFeeRate;
  const sellFeeUsd = sellNotional * sellFeeRate;
  const totalFeesUsd = buyFeeUsd + sellFeeUsd;

  const grossPnlUsd = sellNotional - buyNotional;
  const netBeforeTaxUsd = grossPnlUsd - totalFeesUsd;

  // Tax reserve only on positive net profit
  const taxReserveUsd = netBeforeTaxUsd > 0
    ? netBeforeTaxUsd * (TAX_RESERVE_PCT / 100)
    : 0;

  const netPnlUsd = netBeforeTaxUsd - taxReserveUsd;
  const actualPriceGapPct = buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice) * 100 : 0;
  const netPnlPct = buyNotional > 0 ? (netPnlUsd / buyNotional) * 100 : 0;

  return {
    buyPrice,
    sellPrice,
    quantity,
    grossPnlUsd,
    buyFeeUsd,
    sellFeeUsd,
    totalFeesUsd,
    netBeforeTaxUsd,
    taxReserveUsd,
    netPnlUsd,
    netPnlPct,
    actualPriceGapPct,
  };
}

/**
 * Compute cycle PnL with explicit liquidity roles. Avoids ambiguous boolean flags.
 * Default SHADOW policy: maker/maker (post-only), 0% fee, 20% tax reserve.
 */
export function computeCyclePnLWithRoles(options: CyclePnLOptions): CyclePnL {
  const {
    buyPrice,
    sellPrice,
    quantity,
    buyLiquidityRole = "maker",
    sellLiquidityRole = "maker",
    makerFeePct = 0.00,
    takerFeePct = 0.09,
    taxReservePct = TAX_RESERVE_PCT,
  } = options;

  const buyNotional = buyPrice * quantity;
  const sellNotional = sellPrice * quantity;

  const buyFeeRate = (buyLiquidityRole === "taker" ? takerFeePct : makerFeePct) / 100;
  const sellFeeRate = (sellLiquidityRole === "taker" ? takerFeePct : makerFeePct) / 100;

  const buyFeeUsd = buyNotional * buyFeeRate;
  const sellFeeUsd = sellNotional * sellFeeRate;
  const totalFeesUsd = buyFeeUsd + sellFeeUsd;

  const grossPnlUsd = sellNotional - buyNotional;
  const netBeforeTaxUsd = grossPnlUsd - totalFeesUsd;

  const taxReserveUsd = netBeforeTaxUsd > 0
    ? netBeforeTaxUsd * (taxReservePct / 100)
    : 0;

  const netPnlUsd = netBeforeTaxUsd - taxReserveUsd;
  const actualPriceGapPct = buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice) * 100 : 0;
  const netPnlPct = buyNotional > 0 ? (netPnlUsd / buyNotional) * 100 : 0;

  return {
    buyPrice,
    sellPrice,
    quantity,
    buyLiquidityRole,
    sellLiquidityRole,
    grossPnlUsd,
    buyFeeUsd,
    sellFeeUsd,
    totalFeesUsd,
    netBeforeTaxUsd,
    taxReserveUsd,
    netPnlUsd,
    netPnlPct,
    actualPriceGapPct,
  };
}

/**
 * Validate that a cycle's net PnL meets the target.
 */
export function cycleMeetsNetTarget(
  cyclePnl: CyclePnL,
  netProfitTargetPct: number
): boolean {
  return cyclePnl.netPnlPct >= netProfitTargetPct;
}

/**
 * Compute the effective sell price needed to break even (net PnL = 0).
 * Useful for HODL recovery target.
 */
export function computeBreakEvenSellPrice(
  buyPrice: number,
  quantity: number,
  takerFeePct: number = 0.09
): number {
  const buyNotional = buyPrice * quantity;
  const buyFeeUsd = buyNotional * (takerFeePct / 100);
  // At break-even: sellNotional - sellFee - buyNotional - buyFee = 0
  // sellNotional * (1 - takerFee/100) = buyNotional + buyFee
  const sellNotional = (buyNotional + buyFeeUsd) / (1 - takerFeePct / 100);
  return sellNotional / quantity;
}
