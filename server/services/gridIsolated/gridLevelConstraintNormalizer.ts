import type { GridLevel } from "./gridIsolatedTypes";

export interface GridPairConstraintsForNormalization {
  quantityStep: number | null;
  minOrderBase: number | null;
  minOrderQuote: number | null;
  minOrderUsd: number | null;
  maxOrderBase: number | null;
  quantityPrecision: number | null;
  priceTickSize: number | null;
  pricePrecision: number | null;
}

export interface RejectedGridLevel {
  levelId: string;
  reasonCode: string;
  originalQuantity: number;
  alignedQuantity: number;
  notionalUsd: number;
}

export interface NormalizeGridLevelsResult {
  acceptedLevels: GridLevel[];
  rejectedLevels: RejectedGridLevel[];
}

function decimalPlacesFromStep(step: number): number {
  const s = step.toExponential();
  const match = s.match(/e([+-]?\d+)/);
  if (match) {
    const exp = parseInt(match[1], 10);
    if (exp < 0) return -exp;
  }
  const str = step.toString();
  if (str.includes(".")) return str.split(".")[1].length;
  return 0;
}

function alignQuantityDown(qty: number, step: number, precision: number | null): number {
  const dp = precision ?? decimalPlacesFromStep(step);
  const factor = Math.pow(10, dp);
  const qtyScaled = Math.floor(qty * factor);
  const stepScaled = Math.round(step * factor);
  if (stepScaled <= 0) return NaN;
  const alignedScaled = Math.floor(qtyScaled / stepScaled) * stepScaled;
  return alignedScaled / factor;
}

function alignPriceToTick(price: number, tickSize: number | null, precision: number | null): number {
  if (tickSize === null || !Number.isFinite(tickSize) || tickSize <= 0) return price;
  const dp = precision ?? decimalPlacesFromStep(tickSize);
  const factor = Math.pow(10, dp);
  const priceScaled = Math.round(price * factor);
  const tickScaled = Math.round(tickSize * factor);
  if (tickScaled <= 0) return price;
  const alignedScaled = Math.round(priceScaled / tickScaled) * tickScaled;
  return alignedScaled / factor;
}

export function normalizeGridLevelsForExecutionConstraints(
  levels: GridLevel[],
  constraints: GridPairConstraintsForNormalization
): NormalizeGridLevelsResult {
  const acceptedLevels: GridLevel[] = [];
  const rejectedLevels: RejectedGridLevel[] = [];

  for (const level of levels) {
    const originalQuantity = level.quantity;
    const price = level.price;

    if (!Number.isFinite(originalQuantity)) {
      rejectedLevels.push({ levelId: level.id, reasonCode: "QUANTITY_NOT_FINITE", originalQuantity, alignedQuantity: NaN, notionalUsd: level.notionalUsd });
      continue;
    }

    const qtyStep = constraints.quantityStep;
    if (qtyStep === null || !Number.isFinite(qtyStep) || qtyStep <= 0) {
      rejectedLevels.push({ levelId: level.id, reasonCode: "QUANTITY_STEP_INVALID", originalQuantity, alignedQuantity: NaN, notionalUsd: level.notionalUsd });
      continue;
    }

    const alignedQuantity = alignQuantityDown(originalQuantity, qtyStep, constraints.quantityPrecision);

    if (!Number.isFinite(alignedQuantity)) {
      rejectedLevels.push({ levelId: level.id, reasonCode: "QUANTITY_NOT_FINITE", originalQuantity, alignedQuantity, notionalUsd: level.notionalUsd });
      continue;
    }

    if (alignedQuantity <= 0) {
      rejectedLevels.push({ levelId: level.id, reasonCode: "QUANTITY_ALIGNED_TO_ZERO", originalQuantity, alignedQuantity, notionalUsd: level.notionalUsd });
      continue;
    }

    const notionalUsd = alignedQuantity * price;

    if (!Number.isFinite(notionalUsd)) {
      rejectedLevels.push({ levelId: level.id, reasonCode: "NOTIONAL_NOT_FINITE", originalQuantity, alignedQuantity, notionalUsd });
      continue;
    }

    const minOrderBase = constraints.minOrderBase;
    if (minOrderBase !== null && Number.isFinite(minOrderBase) && alignedQuantity < minOrderBase) {
      rejectedLevels.push({ levelId: level.id, reasonCode: "MIN_ORDER_BASE_NOT_MET", originalQuantity, alignedQuantity, notionalUsd });
      continue;
    }

    const minOrderQuote = constraints.minOrderQuote;
    if (minOrderQuote !== null && Number.isFinite(minOrderQuote) && notionalUsd < minOrderQuote) {
      rejectedLevels.push({ levelId: level.id, reasonCode: "MIN_ORDER_QUOTE_NOT_MET", originalQuantity, alignedQuantity, notionalUsd });
      continue;
    }

    const minOrderUsd = constraints.minOrderUsd;
    if (minOrderUsd !== null && Number.isFinite(minOrderUsd) && notionalUsd < minOrderUsd) {
      rejectedLevels.push({ levelId: level.id, reasonCode: "MIN_ORDER_USD_NOT_MET", originalQuantity, alignedQuantity, notionalUsd });
      continue;
    }

    const maxOrderBase = constraints.maxOrderBase;
    if (maxOrderBase !== null && Number.isFinite(maxOrderBase) && alignedQuantity > maxOrderBase) {
      rejectedLevels.push({ levelId: level.id, reasonCode: "MAX_ORDER_BASE_EXCEEDED", originalQuantity, alignedQuantity, notionalUsd });
      continue;
    }

    const alignedPrice = alignPriceToTick(price, constraints.priceTickSize, constraints.pricePrecision);
    const finalNotionalUsd = alignedQuantity * alignedPrice;
    acceptedLevels.push({ ...level, price: alignedPrice, quantity: alignedQuantity, notionalUsd: finalNotionalUsd });
  }

  return { acceptedLevels, rejectedLevels };
}
