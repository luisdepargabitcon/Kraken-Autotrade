/**
 * gridRecommendationHelper.ts
 *
 * Generates configuration recommendation alternatives based on current
 * market data, entry range diagnostic, and config values.
 *
 * Pure functions only — no side effects, no DB access, no trading logic.
 * The UI must call applyAlternative() to update a draft, then the user
 * must explicitly press "Guardar cambios".
 */

export interface RecommendationAlternative {
  id: "A" | "B" | "C";
  label: string;
  title: string;
  explanation: string;
  patch: Record<string, any>;
  expectedLevels: number;
  expectedRangePct: number;
  tradeoff: string;
}

export interface RecommendationContext {
  bandWidthPct: number | null;
  effectiveRangePct: number | null;
  minSpacingPct: number | null;
  maxLevelsPerSide: number | null;
  requestedLevels: number | null;
  actualLevels: number | null;
  netProfitTargetPct: number | null;
  buyFeePct: number | null;
  sellFeePct: number | null;
  taxReservePct: number | null;
  gridRangeMaxPct: number | null;
  enforceCompactRange: boolean | null;
  currentPrice: number | null;
}

function calcMinSpacing(netProfit: number, buyFee: number, sellFee: number, taxReserve: number): number {
  return netProfit + buyFee + sellFee + (netProfit * taxReserve / 100);
}

function calcMaxLevelsPerSide(effectiveRange: number, minSpacing: number): number {
  if (minSpacing <= 0) return 0;
  return Math.floor(effectiveRange / minSpacing);
}

/**
 * Build 3 recommendation alternatives (A, B, C) based on the current
 * market and config context.
 *
 * A: Lower net profit target → smaller min spacing → more levels fit
 * B: Wider operational range (raise gridRangeMaxPct or disable compact)
 * C: Combined approach — moderate profit reduction + wider range
 */
export function buildRecommendationAlternatives(ctx: RecommendationContext): RecommendationAlternative[] {
  const alternatives: RecommendationAlternative[] = [];

  const netProfit = ctx.netProfitTargetPct ?? 0.8;
  const buyFee = ctx.buyFeePct ?? 0.09;
  const sellFee = ctx.sellFeePct ?? 0.09;
  const taxReserve = ctx.taxReservePct ?? 20;
  const bandWidth = ctx.bandWidthPct ?? 3.0;
  const gridRangeMax = ctx.gridRangeMaxPct ?? 2.5;
  const enforceCompact = ctx.enforceCompactRange ?? true;
  const effectiveRange = ctx.effectiveRangePct ?? Math.min(bandWidth, gridRangeMax);
  const requestedLevels = ctx.requestedLevels ?? 8;
  const requestedPerSide = Math.ceil(requestedLevels / 2);

  // Alternative A: Lower net profit target
  const newNetProfitA = Math.max(0.3, netProfit - 0.3);
  const minSpacingA = calcMinSpacing(newNetProfitA, buyFee, sellFee, taxReserve);
  const effectiveRangeA = enforceCompact ? Math.min(bandWidth, gridRangeMax) : bandWidth;
  const maxLevelsA = calcMaxLevelsPerSide(effectiveRangeA, minSpacingA);
  const expectedLevelsA = maxLevelsA * 2;

  alternatives.push({
    id: "A",
    label: "Bajar objetivo neto",
    title: `Reducir beneficio neto de ${netProfit.toFixed(2)}% a ${newNetProfitA.toFixed(2)}%`,
    explanation: `Con un objetivo neto menor, la separación mínima rentable baja de ${calcMinSpacing(netProfit, buyFee, sellFee, taxReserve).toFixed(2)}% a ${minSpacingA.toFixed(2)}%. Esto permite que caben más niveles en el mismo rango operativo (${effectiveRangeA.toFixed(2)}%).`,
    patch: { netProfitTargetPct: newNetProfitA },
    expectedLevels: expectedLevelsA,
    expectedRangePct: effectiveRangeA,
    tradeoff: `Menos beneficio por ciclo (${newNetProfitA.toFixed(2)}% en lugar de ${netProfit.toFixed(2)}%), pero más operaciones posibles.`,
  });

  // Alternative B: Wider operational range
  const newRangeMaxB = Math.max(gridRangeMax, bandWidth * 1.1);
  const minSpacingB = calcMinSpacing(netProfit, buyFee, sellFee, taxReserve);
  const effectiveRangeB = Math.min(bandWidth, newRangeMaxB);
  const maxLevelsB = calcMaxLevelsPerSide(effectiveRangeB, minSpacingB);
  const expectedLevelsB = maxLevelsB * 2;

  alternatives.push({
    id: "B",
    label: "Ampliar rango operativo",
    title: `Subir rango máximo de ${gridRangeMax.toFixed(2)}% a ${newRangeMaxB.toFixed(2)}%`,
    explanation: `Con rango compacto activado, el rango operativo estaba limitado a ${gridRangeMax.toFixed(2)}%. Al subir el máximo a ${newRangeMaxB.toFixed(2)}%, el rango efectivo pasa a ${effectiveRangeB.toFixed(2)}% (limitado por la banda de Bollinger). Con la misma separación mínima (${minSpacingB.toFixed(2)}%), caben más niveles.`,
    patch: { gridRangeMaxPct: newRangeMaxB },
    expectedLevels: expectedLevelsB,
    expectedRangePct: effectiveRangeB,
    tradeoff: `Mayor exposición al mercado. Los niveles estarán más separados del precio actual, lo que requiere movimientos de precio más amplios para activarse.`,
  });

  // Alternative C: Combined — moderate profit reduction + wider range + disable compact
  const newNetProfitC = Math.max(0.4, netProfit - 0.2);
  const minSpacingC = calcMinSpacing(newNetProfitC, buyFee, sellFee, taxReserve);
  const newRangeMaxC = Math.max(gridRangeMax, bandWidth);
  const effectiveRangeC = bandWidth;
  const maxLevelsC = calcMaxLevelsPerSide(effectiveRangeC, minSpacingC);
  const expectedLevelsC = maxLevelsC * 2;

  alternatives.push({
    id: "C",
    label: "Combinado (recomendado)",
    title: `Bajar beneficio a ${newNetProfitC.toFixed(2)}% y usar banda completa (${bandWidth.toFixed(2)}%)`,
    explanation: `Combina una reducción moderada del objetivo neto con el uso de toda la banda de Bollinger. La separación mínima baja a ${minSpacingC.toFixed(2)}% y el rango efectivo sube a ${effectiveRangeC.toFixed(2)}%, permitiendo ${maxLevelsC} niveles por lado.`,
    patch: {
      netProfitTargetPct: newNetProfitC,
      gridRangeMaxPct: newRangeMaxC,
      enforceCompactRange: false,
    },
    expectedLevels: expectedLevelsC,
    expectedRangePct: effectiveRangeC,
    tradeoff: `Balance entre beneficio por ciclo y número de operaciones. Usa toda la banda disponible, por lo que requiere aceptar mayor variación de precios.`,
  });

  return alternatives;
}

/**
 * Apply an alternative's patch to a config draft object.
 * Returns a new draft with the patched values.
 */
export function applyAlternativeToDraft(
  draft: Record<string, any>,
  alt: RecommendationAlternative
): Record<string, any> {
  return { ...draft, ...alt.patch };
}

/**
 * Check if the current configuration already produces the requested levels.
 */
export function isConfigOptimal(ctx: RecommendationContext): boolean {
  const actual = ctx.actualLevels ?? 0;
  const requested = ctx.requestedLevels ?? 0;
  return actual >= requested && requested > 0;
}
