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
  postNormalizationWarnings: string[];
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

    const alignedPrice = alignPriceToTick(price, constraints.priceTickSize, constraints.pricePrecision);

    if (!Number.isFinite(alignedPrice) || alignedPrice <= 0) {
      rejectedLevels.push({ levelId: level.id, reasonCode: "PRICE_NOT_FINITE_OR_ZERO", originalQuantity, alignedQuantity, notionalUsd: level.notionalUsd });
      continue;
    }

    const finalNotionalUsd = alignedQuantity * alignedPrice;

    if (!Number.isFinite(finalNotionalUsd)) {
      rejectedLevels.push({ levelId: level.id, reasonCode: "NOTIONAL_NOT_FINITE", originalQuantity, alignedQuantity, notionalUsd: finalNotionalUsd });
      continue;
    }

    const minOrderBase = constraints.minOrderBase;
    if (minOrderBase !== null && Number.isFinite(minOrderBase) && alignedQuantity < minOrderBase) {
      rejectedLevels.push({ levelId: level.id, reasonCode: "MIN_ORDER_BASE_NOT_MET", originalQuantity, alignedQuantity, notionalUsd: finalNotionalUsd });
      continue;
    }

    const minOrderQuote = constraints.minOrderQuote;
    if (minOrderQuote !== null && Number.isFinite(minOrderQuote) && finalNotionalUsd < minOrderQuote) {
      rejectedLevels.push({ levelId: level.id, reasonCode: "MIN_ORDER_QUOTE_NOT_MET", originalQuantity, alignedQuantity, notionalUsd: finalNotionalUsd });
      continue;
    }

    const minOrderUsd = constraints.minOrderUsd;
    if (minOrderUsd !== null && Number.isFinite(minOrderUsd) && finalNotionalUsd < minOrderUsd) {
      rejectedLevels.push({ levelId: level.id, reasonCode: "MIN_ORDER_USD_NOT_MET", originalQuantity, alignedQuantity, notionalUsd: finalNotionalUsd });
      continue;
    }

    const maxOrderBase = constraints.maxOrderBase;
    if (maxOrderBase !== null && Number.isFinite(maxOrderBase) && alignedQuantity > maxOrderBase) {
      rejectedLevels.push({ levelId: level.id, reasonCode: "MAX_ORDER_BASE_EXCEEDED", originalQuantity, alignedQuantity, notionalUsd: finalNotionalUsd });
      continue;
    }

    acceptedLevels.push({ ...level, price: alignedPrice, quantity: alignedQuantity, notionalUsd: finalNotionalUsd });
  }

  const postNormalizationWarnings: string[] = [];

  if (acceptedLevels.length >= 2) {
    const priceSet = new Set<number>();
    for (const l of acceptedLevels) {
      if (priceSet.has(l.price)) {
        postNormalizationWarnings.push(`GRID_LEVEL_PRICE_COLLISION_AFTER_NORMALIZATION: duplicate price ${l.price} for level ${l.id}`);
      }
      priceSet.add(l.price);
    }

    const buys = acceptedLevels.filter(l => l.side === "BUY").sort((a, b) => a.price - b.price);
    const sells = acceptedLevels.filter(l => l.side === "SELL").sort((a, b) => a.price - b.price);

    for (let i = 1; i < buys.length; i++) {
      if (buys[i].price <= buys[i - 1].price) {
        postNormalizationWarnings.push(`GRID_LEVEL_PRICE_COLLISION_AFTER_NORMALIZATION: BUY ordering inverted at index ${i}`);
      }
    }
    for (let i = 1; i < sells.length; i++) {
      if (sells[i].price <= sells[i - 1].price) {
        postNormalizationWarnings.push(`GRID_LEVEL_PRICE_COLLISION_AFTER_NORMALIZATION: SELL ordering inverted at index ${i}`);
      }
    }

    if (buys.length > 0 && sells.length > 0) {
      const highestBuy = buys[buys.length - 1].price;
      const lowestSell = sells[0].price;
      if (highestBuy >= lowestSell) {
        postNormalizationWarnings.push(`GRID_LEVEL_PRICE_COLLISION_AFTER_NORMALIZATION: highestBuy ${highestBuy} >= lowestSell ${lowestSell}`);
      }
    }
  }

  return { acceptedLevels, rejectedLevels, postNormalizationWarnings };
}
