/**
 * gridUniformGeometric.ts — Canonical uniform geometric grid helper.
 *
 * UNIFORM_GEOMETRIC_GRID is the single canonical geometry for Grid Isolated.
 * All level generation, counting, and range calculation must delegate to these
 * pure functions. No alternative geometry modes exist.
 *
 * Formula:
 *   step      = spacingPct / 100
 *   ratio     = 1 + step
 *   halfRatio = sqrt(ratio)
 *
 *   BUY[i]  = centerPrice / ratio^(i + 0.5)
 *   SELL[i] = centerPrice * ratio^(i + 0.5)
 *
 * Invariant: SELL[0] / BUY[0] = ratio  (central gap == spacingPct)
 *
 * PURE FUNCTIONS ONLY: No DB, no API, no side effects.
 */

export interface UniformGeometricLevelPriceInput {
  centerPrice: number;
  spacingPct: number;
  side: "BUY" | "SELL";
  index: number;
}

export interface UniformGeometricRangeRequirementInput {
  spacingPct: number;
  levelsPerSide: number;
}

/**
 * Calculate the uniform geometric ratio from spacingPct.
 * ratio = 1 + spacingPct / 100
 */
export function calculateUniformGeometricRatio(spacingPct: number): number {
  if (!Number.isFinite(spacingPct) || spacingPct <= 0) {
    throw new Error(`Invalid spacingPct: ${spacingPct}`);
  }
  return 1 + spacingPct / 100;
}

/**
 * Calculate the half-ratio (sqrt(ratio)) from spacingPct.
 * halfRatio = sqrt(1 + spacingPct / 100)
 */
export function calculateUniformGeometricHalfRatio(spacingPct: number): number {
  return Math.sqrt(calculateUniformGeometricRatio(spacingPct));
}

/**
 * Calculate the price of a single level in the uniform geometric grid.
 *
 * BUY[i]  = centerPrice / ratio^(i + 0.5)
 * SELL[i] = centerPrice * ratio^(i + 0.5)
 */
export function calculateUniformGeometricLevelPrice(
  input: UniformGeometricLevelPriceInput,
): number {
  const { centerPrice, spacingPct, side, index } = input;

  if (!Number.isFinite(centerPrice) || centerPrice <= 0) {
    throw new Error(`Invalid centerPrice: ${centerPrice}`);
  }
  if (!Number.isFinite(spacingPct) || spacingPct <= 0) {
    throw new Error(`Invalid spacingPct: ${spacingPct}`);
  }
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid index: ${index}`);
  }

  const ratio = calculateUniformGeometricRatio(spacingPct);
  const exponent = index + 0.5;

  if (side === "BUY") {
    return centerPrice / Math.pow(ratio, exponent);
  } else {
    return centerPrice * Math.pow(ratio, exponent);
  }
}

/**
 * Calculate the total range percentage required to fit `levelsPerSide` levels
 * on each side of the center, using the uniform geometric formula.
 *
 * For n levels per side:
 *   buyFarthestFactor  = ratio^(-(n - 0.5))
 *   sellFarthestFactor = ratio^(n - 0.5)
 *
 *   buySemiRangePct  = (1 - buyFarthestFactor) * 100
 *   sellSemiRangePct = (sellFarthestFactor - 1) * 100
 *
 *   requiredSemiRangePct  = max(buySemiRangePct, sellSemiRangePct)
 *   requiredTotalRangePct = 2 * requiredSemiRangePct
 *
 * Returns { requiredSemiRangePct, requiredTotalRangePct }.
 */
export function calculateUniformGeometricRangeRequirement(
  input: UniformGeometricRangeRequirementInput,
): { requiredSemiRangePct: number; requiredTotalRangePct: number } {
  const { spacingPct, levelsPerSide } = input;

  if (!Number.isFinite(spacingPct) || spacingPct <= 0) {
    throw new Error(`Invalid spacingPct: ${spacingPct}`);
  }
  if (!Number.isInteger(levelsPerSide) || levelsPerSide < 0) {
    throw new Error(`Invalid levelsPerSide: ${levelsPerSide}`);
  }

  if (levelsPerSide === 0) {
    return { requiredSemiRangePct: 0, requiredTotalRangePct: 0 };
  }

  const ratio = calculateUniformGeometricRatio(spacingPct);
  const n = levelsPerSide;

  const buyFarthestFactor = Math.pow(ratio, -(n - 0.5));
  const sellFarthestFactor = Math.pow(ratio, n - 0.5);

  const buySemiRangePct = (1 - buyFarthestFactor) * 100;
  const sellSemiRangePct = (sellFarthestFactor - 1) * 100;

  const requiredSemiRangePct = Math.max(buySemiRangePct, sellSemiRangePct);
  const requiredTotalRangePct = 2 * requiredSemiRangePct;

  return { requiredSemiRangePct, requiredTotalRangePct };
}
