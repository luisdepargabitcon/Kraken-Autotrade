/**
 * GridCycleExitSelector — FIRST_PROFITABLE_HIGHER_RUNG_V2
 *
 * Rules:
 *   - For a BUY-filled cycle, scan every RUNG (BUY or SELL level) whose price is
 *     strictly greater than the real BUY fill price.
 *   - Ignores side label: a BUY rung can become a synthetic SELL target when the
 *     market has moved up enough.
 *   - Computes economic viability with separated components:
 *       grossPnlUsd, exchangeFeesUsd, operationalCostsUsd, taxReserveUsd,
 *       availablePnlAfterTaxUsd, availablePnlAfterTaxPct.
 *   - Picks the first rung whose available net PnL % meets the configured target.
 *   - Enforces tick size, quantity step and min order USD on the synthetic SELL.
 *   - Returns targetSellLevelId = null when the chosen rung is a BUY-level that is
 *     being reused as a synthetic SELL target; otherwise the persisted SELL id.
 *   - Persists-friendly: returns all values needed to populate the cycle row.
 *
 * This module is PURE: no DB access, no side effects, no exchange calls, no clock.
 */

import type { GridCycle, GridLevel, GridRangeVersion, GridTargetCalculation, GridRejectedCandidate } from "./gridIsolatedTypes";

export interface ExitSelectorParams {
  /** Real BUY fill price of the cycle. */
  buyFillPrice: number;
  /** Real BUY fill quantity of the cycle. */
  buyFillQuantity: number;
  /** Net profit target configured for the grid (%). */
  netProfitTargetPct: number;
  /** Fee % applied to the BUY side. */
  buyFeePct: number;
  /** Fee % applied to the SELL side. */
  sellFeePct: number;
  /** Exchange maker fee % (e.g. 0.00). */
  makerFeePct: number;
  /** Exchange taker fee % (e.g. 0.09). */
  takerFeePct: number;
  /** Tax reserve % applied on positive net before tax (default 20). */
  taxReservePct: number;
  /** Optional spread + safety buffer cost % (default 0). */
  spreadBufferPct?: number;
  safetyBufferPct?: number;
  /** Optional operational cost % override (sum of spread + safety if provided). */
  operationalCostPct?: number;
  /** Minimum viable order notional in USD. */
  minOrderUsd?: number;
  /** Price tick size for rounding synthetic targets. */
  tickSize?: number;
  /** Quantity step for validating target quantity. */
  quantityStep?: number;
  /** Maximum allowed price gap % from buy price to target (Grid constraint). */
  maxDistancePct?: number;
}

type RejectedCandidate = GridRejectedCandidate & {
  operationalNetPnlUsd?: number;
  availablePnlAfterTaxPct?: number;
};

type ReasonCode =
  | "TARGET_FOUND"
  | "NO_RUNGS_ABOVE_BUY"
  | "NO_PROFITABLE_RUNG"
  | "INVALID_INPUT"
  | "PRICE_NOT_ABOVE_BUY"
  | "DISTANCE_TOO_FAR"
  | "QUANTITY_INVALID"
  | "BUY_QTY_NOT_STEP_ALIGNED"
  | "RUNG_QUANTITY_INSUFFICIENT"
  | "MIN_ORDER_USD"
  | "OPERATIONAL_NET_NOT_POSITIVE"
  | "AVAILABLE_NET_BELOW_TARGET";

function reasonText(code: ReasonCode | string): string {
  switch (code) {
    case "PRICE_NOT_ABOVE_BUY": return "El precio del rung no es superior al precio de compra.";
    case "DISTANCE_TOO_FAR": return "El rung supera la distancia máxima permitida desde la compra.";
    case "QUANTITY_INVALID": return "La cantidad del rung no es válida o no es múltiplo del step.";
    case "BUY_QTY_NOT_STEP_ALIGNED": return "La cantidad comprada no es múltiplo del quantity step; no se puede cerrar íntegramente.";
    case "RUNG_QUANTITY_INSUFFICIENT": return "El rung no tiene cantidad suficiente para cerrar el ciclo completo.";
    case "MIN_ORDER_USD": return "El valor nocional del rung es inferior al mínimo permitido.";
    case "OPERATIONAL_NET_NOT_POSITIVE": return "El PnL neto operacional no es positivo.";
    case "AVAILABLE_NET_BELOW_TARGET": return "El PnL neto disponible tras impuestos no alcanza el objetivo.";
    default: return code;
  }
}

function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

function floorToStep(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.floor(value / step) * step;
}

function validPositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function computeOperationalPnL(
  buyPrice: number,
  sellPrice: number,
  quantity: number,
  params: ExitSelectorParams
): {
  grossPnlUsd: number;
  exchangeFeesUsd: number;
  operationalCostsUsd: number;
  operationalNetPnlUsd: number;
  operationalNetPnlPct: number;
  taxReserveUsd: number;
  availablePnlAfterTaxUsd: number;
  availablePnlAfterTaxPct: number;
} {
  const buyNotional = buyPrice * quantity;
  const sellNotional = sellPrice * quantity;
  const grossPnlUsd = sellNotional - buyNotional;

  const buyFeeRate = (params.buyFeePct ?? params.makerFeePct) / 100;
  const sellFeeRate = (params.sellFeePct ?? params.makerFeePct) / 100;
  const buyFeeUsd = buyNotional * buyFeeRate;
  const sellFeeUsd = sellNotional * sellFeeRate;
  const exchangeFeesUsd = buyFeeUsd + sellFeeUsd;

  const spreadBuffer = (params.spreadBufferPct ?? 0) / 100;
  const safetyBuffer = (params.safetyBufferPct ?? 0) / 100;
  const operationalCostRate = (params.operationalCostPct ?? (params.spreadBufferPct ?? 0) + (params.safetyBufferPct ?? 0)) / 100;
  // Operational costs are applied on the combined notional to model spread + safety slippage conservatively.
  const operationalCostsUsd = (buyNotional + sellNotional) * Math.max(spreadBuffer + safetyBuffer, operationalCostRate * 100) / 100;

  const operationalNetPnlUsd = grossPnlUsd - exchangeFeesUsd - operationalCostsUsd;
  const operationalNetPnlPct = buyNotional > 0 ? (operationalNetPnlUsd / buyNotional) * 100 : 0;

  const taxReserveUsd = operationalNetPnlUsd > 0
    ? operationalNetPnlUsd * (params.taxReservePct / 100)
    : 0;

  const availablePnlAfterTaxUsd = operationalNetPnlUsd - taxReserveUsd;
  const availablePnlAfterTaxPct = buyNotional > 0 ? (availablePnlAfterTaxUsd / buyNotional) * 100 : 0;

  return {
    grossPnlUsd,
    exchangeFeesUsd,
    operationalCostsUsd,
    operationalNetPnlUsd,
    operationalNetPnlPct,
    taxReserveUsd,
    availablePnlAfterTaxUsd,
    availablePnlAfterTaxPct,
  };
}

export function selectFirstProfitableHigherRung(
  cycle: Pick<GridCycle, "id" | "rangeVersionId" | "pair" | "buyPrice" | "quantity">,
  levels: GridLevel[],
  rangeVersion: GridRangeVersion | undefined,
  params: ExitSelectorParams
): GridTargetCalculation {
  if (!validPositive(cycle.buyPrice) || !validPositive(cycle.quantity)) {
    return {
      selected: false,
      stateVersion: 1,
      targetKind: "SYNTHETIC_RUNG",
      targetRungLevelId: null,
      targetSellLevelId: null,
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
      netProfitTargetPct: params.netProfitTargetPct,
      rejectedCandidates: [],
      reasonCode: "INVALID_INPUT",
      explanation: "El ciclo no tiene precio de compra o cantidad válidos.",
    };
  }

  if (rangeVersion && rangeVersion.pair !== cycle.pair) {
    return {
      selected: false,
      stateVersion: 1,
      targetKind: "SYNTHETIC_RUNG",
      targetRungLevelId: null,
      targetSellLevelId: null,
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
      netProfitTargetPct: params.netProfitTargetPct,
      rejectedCandidates: [],
      reasonCode: "INVALID_INPUT",
      explanation: `Par del rango (${rangeVersion.pair}) no coincide con el par del ciclo (${cycle.pair}).`,
    };
  }

  const buyPrice = cycle.buyPrice;
  const buyQty = cycle.quantity;
  const tickSize = params.tickSize;
  const quantityStep = params.quantityStep;
  const minOrderUsd = params.minOrderUsd ?? 0;
  const maxDistancePct = params.maxDistancePct;

  const rungs = levels
    .filter((l) => l.rangeVersionId === cycle.rangeVersionId && validPositive(l.price))
    .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));

  const candidates = rungs.filter((l) => l.price > buyPrice);

  if (candidates.length === 0) {
    return {
      selected: false,
      stateVersion: 1,
      targetKind: "SYNTHETIC_RUNG",
      targetRungLevelId: null,
      targetSellLevelId: null,
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
      netProfitTargetPct: params.netProfitTargetPct,
      rejectedCandidates: [],
      reasonCode: "NO_RUNGS_ABOVE_BUY",
      explanation: "No hay ningún escalón (BUY ni SELL) por encima del precio de compra.",
    };
  }

  const rejectedCandidates: RejectedCandidate[] = [];

  for (const rung of candidates) {
    const reasonCode = ((): RejectedCandidate["reasonCode"] | null => {
      if (rung.price <= buyPrice) return "PRICE_NOT_ABOVE_BUY";
      if (maxDistancePct != null && buyPrice > 0) {
        const distancePct = ((rung.price - buyPrice) / buyPrice) * 100;
        if (distancePct > maxDistancePct) return "DISTANCE_TOO_FAR";
      }
      if (!validPositive(rung.quantity)) return "QUANTITY_INVALID";
      return null;
    })();

    if (reasonCode) {
      rejectedCandidates.push({
        levelId: rung.id,
        side: rung.side,
        price: rung.price,
        reasonCode,
        reason: reasonText(reasonCode),
        operationalNetPnlUsd: 0,
        availablePnlAfterTaxPct: 0,
      });
      continue;
    }

    // Gate G: target quantity must close the WHOLE cycle (cantidad íntegra).
    // A persisted SELL rung must have enough available quantity.
    if (rung.side === "SELL" && rung.quantity < buyQty) {
      rejectedCandidates.push({
        levelId: rung.id,
        side: rung.side,
        price: rung.price,
        reasonCode: "RUNG_QUANTITY_INSUFFICIENT",
        reason: reasonText("RUNG_QUANTITY_INSUFFICIENT"),
        operationalNetPnlUsd: 0,
        availablePnlAfterTaxPct: 0,
      });
      continue;
    }

    let targetQty = buyQty;
    if (validPositive(quantityStep)) {
      const steppedQty = floorToStep(buyQty, quantityStep);
      if (Math.abs(steppedQty - buyQty) > 1e-12) {
        rejectedCandidates.push({
          levelId: rung.id,
          side: rung.side,
          price: rung.price,
          reasonCode: "BUY_QTY_NOT_STEP_ALIGNED",
          reason: reasonText("BUY_QTY_NOT_STEP_ALIGNED"),
          operationalNetPnlUsd: 0,
          availablePnlAfterTaxPct: 0,
        });
        continue;
      }
      targetQty = steppedQty;
    }
    if (!validPositive(targetQty)) {
      rejectedCandidates.push({
        levelId: rung.id,
        side: rung.side,
        price: rung.price,
        reasonCode: "QUANTITY_INVALID",
        reason: reasonText("QUANTITY_INVALID"),
        operationalNetPnlUsd: 0,
        availablePnlAfterTaxPct: 0,
      });
      continue;
    }

    let targetPrice = rung.price;
    if (validPositive(tickSize)) {
      targetPrice = roundToStep(targetPrice, tickSize);
      if (targetPrice <= buyPrice) {
        rejectedCandidates.push({
          levelId: rung.id,
          side: rung.side,
          price: rung.price,
          reasonCode: "PRICE_NOT_ABOVE_BUY",
          reason: reasonText("PRICE_NOT_ABOVE_BUY"),
          operationalNetPnlUsd: 0,
          availablePnlAfterTaxPct: 0,
        });
        continue;
      }
    }

    const notional = targetPrice * targetQty;
    if (minOrderUsd > 0 && notional < minOrderUsd) {
      rejectedCandidates.push({
        levelId: rung.id,
        side: rung.side,
        price: targetPrice,
        reasonCode: "MIN_ORDER_USD",
        reason: reasonText("MIN_ORDER_USD"),
        operationalNetPnlUsd: 0,
        availablePnlAfterTaxPct: 0,
      });
      continue;
    }

    const pnl = computeOperationalPnL(buyPrice, targetPrice, targetQty, params);

    if (pnl.operationalNetPnlUsd <= 0) {
      rejectedCandidates.push({
        levelId: rung.id,
        side: rung.side,
        price: targetPrice,
        reasonCode: "OPERATIONAL_NET_NOT_POSITIVE",
        reason: reasonText("OPERATIONAL_NET_NOT_POSITIVE"),
        operationalNetPnlUsd: pnl.operationalNetPnlUsd,
        availablePnlAfterTaxPct: pnl.availablePnlAfterTaxPct,
      });
      continue;
    }

    if (pnl.availablePnlAfterTaxPct < params.netProfitTargetPct) {
      rejectedCandidates.push({
        levelId: rung.id,
        side: rung.side,
        price: targetPrice,
        reasonCode: "AVAILABLE_NET_BELOW_TARGET",
        reason: reasonText("AVAILABLE_NET_BELOW_TARGET"),
        operationalNetPnlUsd: pnl.operationalNetPnlUsd,
        availablePnlAfterTaxPct: pnl.availablePnlAfterTaxPct,
      });
      continue;
    }

    const isPersistedSell = rung.side === "SELL";
    return {
      selected: true,
      stateVersion: 1,
      targetKind: isPersistedSell ? "PERSISTED_SELL" : "SYNTHETIC_RUNG",
      targetRungLevelId: rung.id,
      targetSellLevelId: isPersistedSell ? rung.id : null,
      targetSellPrice: targetPrice,
      targetSellQuantity: targetQty,
      grossPnlUsd: pnl.grossPnlUsd,
      exchangeFeesUsd: pnl.exchangeFeesUsd,
      operationalCostsUsd: pnl.operationalCostsUsd,
      operationalNetPnlUsd: pnl.operationalNetPnlUsd,
      operationalNetPnlPct: pnl.operationalNetPnlPct,
      taxReserveUsd: pnl.taxReserveUsd,
      availablePnlAfterTaxUsd: pnl.availablePnlAfterTaxUsd,
      availablePnlAfterTaxPct: pnl.availablePnlAfterTaxPct,
      netProfitTargetPct: params.netProfitTargetPct,
      rejectedCandidates,
      reasonCode: "TARGET_FOUND",
      explanation: `Primer escalón superior rentable: ${isPersistedSell ? "SELL persistida" : "RUNG sintético sobre BUY"} a ${targetPrice} (net disponible ${pnl.availablePnlAfterTaxPct.toFixed(4)}%).`,
    };
  }

  return {
    selected: false,
    stateVersion: 1,
    policyVersion: "FIRST_PROFITABLE_HIGHER_RUNG_V2",
    targetKind: "SYNTHETIC_RUNG",
    targetRungLevelId: null,
    targetSellLevelId: null,
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
    netProfitTargetPct: params.netProfitTargetPct,
    rejectedCandidates,
    reasonCode: "NO_PROFITABLE_RUNG",
    explanation: "Ningún escalón superior cumple el objetivo neto disponible configurado.",
  };
}
