import type { GridTargetCalculation } from "./gridIsolatedTypes";
import { computeGridCycleEconomicPnl } from "./gridCycleEconomicPnl";

export interface CycleOwnedExitTargetInput {
  buyFillPrice: number;
  buyFillQuantity: number;
  netProfitTargetPct: number;
  buyFeePct: number;
  sellFeePct: number;
  taxReservePct: number;
  spreadBufferPct: number;
  safetyBufferPct: number;
  priceTickSize: number;
  quantityStep: number;
  minOrderBase: number;
  minOrderQuote: number;
  minOrderUsd: number | null;
  maxOrderBase: number;
  constraintsSource: string;
  constraintsFetchedAt: Date;
  baseCurrency: string;
  quoteCurrency: string;
}

function validPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function ceilToStep(value: number, step: number): number {
  if (!validPositive(step)) return value;
  return Math.ceil((value / step) - 1e-12) * step;
}

function isStepAligned(value: number, step: number): boolean {
  if (!validPositive(step)) return true;
  return Math.abs((value / step) - Math.round(value / step)) <= 1e-10;
}

function rejected(input: CycleOwnedExitTargetInput, reasonCode: string, explanation: string): GridTargetCalculation {
  return {
    selected: false,
    policyVersion: "CYCLE_OWNED_NET_TARGET_V3",
    stateVersion: 2,
    targetKind: "CYCLE_OWNED_SYNTHETIC",
    targetSellLevelId: null,
    targetRungLevelId: null,
    targetSellPrice: null,
    targetSellQuantity: null,
    grossPnlUsd: null,
    exchangeFeesUsd: null,
    operationalCostsUsd: null,
    operationalNetPnlUsd: null,
    operationalNetPnlPct: null,
    taxReserveUsd: null,
    availablePnlAfterTaxUsd: null,
    availablePnlAfterTaxPct: null,
    netProfitTargetPct: input.netProfitTargetPct,
    buyFeePct: input.buyFeePct,
    sellFeePct: input.sellFeePct,
    taxReservePct: input.taxReservePct,
    spreadBufferPct: input.spreadBufferPct,
    safetyBufferPct: input.safetyBufferPct,
    priceTickSize: input.priceTickSize,
    quantityStep: input.quantityStep,
    rejectedCandidates: [],
    reasonCode,
    explanation,
  };
}

function calculatePnl(input: CycleOwnedExitTargetInput, targetSellPrice: number) {
  const pnl = computeGridCycleEconomicPnl({
    buyPrice: input.buyFillPrice,
    sellPrice: targetSellPrice,
    quantity: input.buyFillQuantity,
    buyFeePct: input.buyFeePct,
    sellFeePct: input.sellFeePct,
    spreadBufferPct: input.spreadBufferPct,
    safetyBufferPct: input.safetyBufferPct,
    taxReservePct: input.taxReservePct,
  });
  return {
    ...pnl,
    operationalNetPnlUsd: pnl.netBeforeTaxUsd,
    operationalNetPnlPct: pnl.netBeforeTaxPct,
    availablePnlAfterTaxUsd: pnl.netPnlUsd,
    availablePnlAfterTaxPct: pnl.netPnlPct,
  };
}

export function resolveNewGridCycleExitPolicy(): "CYCLE_OWNED_NET_TARGET_V3" {
  return "CYCLE_OWNED_NET_TARGET_V3";
}

export function computeCycleOwnedExitTarget(input: CycleOwnedExitTargetInput): GridTargetCalculation {
  const numericValues = [input.buyFillPrice, input.buyFillQuantity, input.netProfitTargetPct, input.buyFeePct, input.sellFeePct, input.taxReservePct, input.spreadBufferPct, input.safetyBufferPct, input.priceTickSize, input.quantityStep, input.minOrderBase, input.minOrderQuote, input.maxOrderBase];
  if (numericValues.some(value => !Number.isFinite(value)) || !validPositive(input.buyFillPrice) || !validPositive(input.buyFillQuantity) || !validPositive(input.priceTickSize) || !validPositive(input.quantityStep) || !validPositive(input.minOrderBase) || !validPositive(input.minOrderQuote) || !validPositive(input.maxOrderBase) || input.maxOrderBase < input.minOrderBase || !input.constraintsSource || !(input.constraintsFetchedAt instanceof Date) || !input.baseCurrency || !input.quoteCurrency) {
    return rejected(input, "INVALID_INPUT", "El fill de compra o los parámetros de salida individual no son válidos.");
  }
  if (input.netProfitTargetPct <= 0 || input.taxReservePct < 0 || input.taxReservePct >= 100 || input.buyFeePct < 0 || input.sellFeePct < 0 || input.spreadBufferPct < 0 || input.safetyBufferPct < 0) {
    return rejected(input, "INVALID_COST_CONFIGURATION", "La configuración de beneficio, comisiones, reserva o buffers no es válida.");
  }
  if (!isStepAligned(input.buyFillQuantity, input.quantityStep)) {
    return rejected(input, "BUY_QTY_NOT_STEP_ALIGNED", "La cantidad real de compra no está alineada con quantityStep; no se puede cerrar íntegramente el ciclo.");
  }

  const buyNotional = input.buyFillPrice * input.buyFillQuantity;
  if (input.buyFillQuantity < input.minOrderBase) return rejected(input, "QUANTITY_BELOW_BASE_MINIMUM", "La cantidad del ciclo es inferior al mínimo base oficial.");
  if (input.buyFillQuantity > input.maxOrderBase) return rejected(input, "QUANTITY_ABOVE_BASE_MAXIMUM", "La cantidad del ciclo supera el máximo base oficial.");
  if (buyNotional < input.minOrderQuote) return rejected(input, "QUOTE_NOTIONAL_BELOW_MINIMUM", "El nocional quote del ciclo es inferior al mínimo oficial.");
  if (input.quoteCurrency === "USD" && input.minOrderUsd != null && buyNotional < input.minOrderUsd) return rejected(input, "MIN_ORDER_USD", "El nocional USD del ciclo es inferior al mínimo oficial.");

  const netBeforeTaxPct = input.netProfitTargetPct / (1 - input.taxReservePct / 100);
  const grossExitGapPct = netBeforeTaxPct + input.buyFeePct + input.sellFeePct + input.spreadBufferPct + input.safetyBufferPct;
  const rawTargetPrice = input.buyFillPrice * (1 + grossExitGapPct / 100);
  let targetSellPrice = ceilToStep(rawTargetPrice, input.priceTickSize);
  let pnl = calculatePnl(input, targetSellPrice);
  let attempts = 0;
  while (pnl.availablePnlAfterTaxPct + 1e-10 < input.netProfitTargetPct && attempts < 1000) {
    targetSellPrice = ceilToStep(targetSellPrice + input.priceTickSize, input.priceTickSize);
    pnl = calculatePnl(input, targetSellPrice);
    attempts++;
  }

  if (targetSellPrice <= input.buyFillPrice || pnl.availablePnlAfterTaxPct + 1e-10 < input.netProfitTargetPct) {
    return rejected(input, "NET_TARGET_UNREACHABLE", "No se puede garantizar el objetivo neto tras el redondeo al tick.");
  }
  const sellNotionalQuote = targetSellPrice * input.buyFillQuantity;
  if (sellNotionalQuote < input.minOrderQuote) return rejected(input, "QUOTE_NOTIONAL_BELOW_MINIMUM", "El nocional quote de salida queda por debajo del mínimo oficial.");
  if (input.quoteCurrency === "USD" && input.minOrderUsd != null && sellNotionalQuote < input.minOrderUsd) return rejected(input, "MIN_ORDER_USD", "El nocional USD de salida queda por debajo del mínimo oficial.");

  const actualGrossGapPct = (targetSellPrice - input.buyFillPrice) / input.buyFillPrice * 100;
  return {
    selected: true,
    policyVersion: resolveNewGridCycleExitPolicy(),
    stateVersion: 2,
    targetKind: "CYCLE_OWNED_SYNTHETIC",
    targetSellLevelId: null,
    targetRungLevelId: null,
    targetSellPrice,
    targetSellQuantity: input.buyFillQuantity,
    grossExitGapPct,
    actualGrossGapPct,
    grossPnlUsd: pnl.grossPnlUsd,
    exchangeFeesUsd: pnl.exchangeFeesUsd,
    operationalCostsUsd: pnl.operationalCostsUsd,
    operationalNetPnlUsd: pnl.operationalNetPnlUsd,
    operationalNetPnlPct: pnl.operationalNetPnlPct,
    taxReserveUsd: pnl.taxReserveUsd,
    availablePnlAfterTaxUsd: pnl.availablePnlAfterTaxUsd,
    availablePnlAfterTaxPct: pnl.availablePnlAfterTaxPct,
    netProfitTargetPct: input.netProfitTargetPct,
    buyFeePct: input.buyFeePct,
    sellFeePct: input.sellFeePct,
    taxReservePct: input.taxReservePct,
    spreadBufferPct: input.spreadBufferPct,
    safetyBufferPct: input.safetyBufferPct,
    priceTickSize: input.priceTickSize,
    quantityStep: input.quantityStep,
    minOrderBase: input.minOrderBase,
    minOrderQuote: input.minOrderQuote,
    minOrderUsd: input.minOrderUsd,
    maxOrderBase: input.maxOrderBase,
    baseCurrency: input.baseCurrency,
    quoteCurrency: input.quoteCurrency,
    constraintsSource: input.constraintsSource,
    constraintsFetchedAt: input.constraintsFetchedAt.toISOString(),
    buyFeeUsd: pnl.buyFeeUsd,
    sellFeeUsd: pnl.sellFeeUsd,
    netBeforeTaxUsd: pnl.netBeforeTaxUsd,
    netBeforeTaxPct: pnl.netBeforeTaxPct,
    rejectedCandidates: [],
    reasonCode: "TARGET_FOUND",
    explanation: `Salida individual calculada desde la compra real: ${actualGrossGapPct.toFixed(4)}% bruto y ${pnl.availablePnlAfterTaxPct.toFixed(4)}% neto disponible.`,
  };
}
