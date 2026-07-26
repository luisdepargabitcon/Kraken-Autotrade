import type { GridTargetCalculation } from "./gridIsolatedTypes";

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
  minOrderUsd: number;
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
  const buyNotional = input.buyFillPrice * input.buyFillQuantity;
  const sellNotional = targetSellPrice * input.buyFillQuantity;
  const grossPnlUsd = sellNotional - buyNotional;
  const buyFeeUsd = buyNotional * input.buyFeePct / 100;
  const sellFeeUsd = sellNotional * input.sellFeePct / 100;
  const exchangeFeesUsd = buyFeeUsd + sellFeeUsd;
  const operationalCostsUsd = buyNotional * (input.spreadBufferPct + input.safetyBufferPct) / 100;
  const operationalNetPnlUsd = grossPnlUsd - exchangeFeesUsd - operationalCostsUsd;
  const taxReserveUsd = operationalNetPnlUsd > 0
    ? operationalNetPnlUsd * input.taxReservePct / 100
    : 0;
  const availablePnlAfterTaxUsd = operationalNetPnlUsd - taxReserveUsd;
  return {
    grossPnlUsd,
    exchangeFeesUsd,
    operationalCostsUsd,
    operationalNetPnlUsd,
    operationalNetPnlPct: buyNotional > 0 ? operationalNetPnlUsd / buyNotional * 100 : 0,
    taxReserveUsd,
    availablePnlAfterTaxUsd,
    availablePnlAfterTaxPct: buyNotional > 0 ? availablePnlAfterTaxUsd / buyNotional * 100 : 0,
  };
}

export function resolveNewGridCycleExitPolicy(): "CYCLE_OWNED_NET_TARGET_V3" {
  return "CYCLE_OWNED_NET_TARGET_V3";
}

export function computeCycleOwnedExitTarget(input: CycleOwnedExitTargetInput): GridTargetCalculation {
  const numericValues = Object.values(input);
  if (numericValues.some(value => !Number.isFinite(value)) || !validPositive(input.buyFillPrice) || !validPositive(input.buyFillQuantity)) {
    return rejected(input, "INVALID_INPUT", "El fill de compra o los parámetros de salida individual no son válidos.");
  }
  if (input.netProfitTargetPct <= 0 || input.taxReservePct < 0 || input.taxReservePct >= 100 || input.buyFeePct < 0 || input.sellFeePct < 0 || input.spreadBufferPct < 0 || input.safetyBufferPct < 0) {
    return rejected(input, "INVALID_COST_CONFIGURATION", "La configuración de beneficio, comisiones, reserva o buffers no es válida.");
  }
  if (!isStepAligned(input.buyFillQuantity, input.quantityStep)) {
    return rejected(input, "BUY_QTY_NOT_STEP_ALIGNED", "La cantidad real de compra no está alineada con quantityStep; no se puede cerrar íntegramente el ciclo.");
  }

  const buyNotional = input.buyFillPrice * input.buyFillQuantity;
  if (input.minOrderUsd > 0 && buyNotional < input.minOrderUsd) {
    return rejected(input, "MIN_ORDER_USD", "El nocional del ciclo es inferior al mínimo permitido para una salida individual.");
  }

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
  if (input.minOrderUsd > 0 && targetSellPrice * input.buyFillQuantity < input.minOrderUsd) {
    return rejected(input, "MIN_ORDER_USD", "El nocional de salida individual queda por debajo del mínimo permitido.");
  }

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
    rejectedCandidates: [],
    reasonCode: "TARGET_FOUND",
    explanation: `Salida individual calculada desde la compra real: ${actualGrossGapPct.toFixed(4)}% bruto y ${pnl.availablePnlAfterTaxPct.toFixed(4)}% neto disponible.`,
  };
}
