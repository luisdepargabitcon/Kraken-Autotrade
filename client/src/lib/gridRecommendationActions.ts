/**
 * Grid Recommendation Actions — pure helpers that encode the UX flow for
 * applying recommendations from the audit to the draft configuration.
 *
 * Keeping this logic in pure functions makes it easy to test without jsdom.
 */

export interface RecommendationAction {
  mainTab: string;
  settingsSubTab: string;
  patch: Record<string, any> | null;
  focusField: string | null;
  notice?: string;
}

export function buildTryRecommendationAction(recommendation: any): RecommendationAction {
  return {
    mainTab: "ajustes",
    settingsSubTab: "avanzado",
    patch: recommendation?.recommendedPatch ?? {},
    focusField: recommendation?.targetField ?? null,
    notice: "Cambio aplicado en pantalla. Todavía no está guardado.",
  };
}

export function buildGoToRecommendationTargetAction(recommendation: any): RecommendationAction {
  return {
    mainTab: "ajustes",
    settingsSubTab: "avanzado",
    patch: null,
    focusField: recommendation?.targetField ?? null,
  };
}

export function getRecommendationPrimaryButtonLabel(): string {
  return "Probar este ajuste";
}

export function getRecommendationSecondaryButtonLabel(): string {
  return "Ir al ajuste";
}

export interface DiagnosticBandUiShape {
  lowerPrice?: number | null;
  upperPrice?: number | null;
  centerPrice?: number | null;
  finalRangePct?: number | null;
  widthPct?: number | null;
  priceSource?: string | null;
  [key: string]: any;
}

export function sanitizeDiagnosticBandPricesForUi(band: DiagnosticBandUiShape | null | undefined): DiagnosticBandUiShape | null | undefined {
  if (!band) return band;

  const center = Number(band.centerPrice);
  const finalRangePct = Number(band.finalRangePct);

  const lowerInvalid = band.lowerPrice == null || Number(band.lowerPrice) <= 0;
  const upperInvalid = band.upperPrice == null || Number(band.upperPrice) <= 0;

  if (
    Number.isFinite(center) &&
    center > 0 &&
    Number.isFinite(finalRangePct) &&
    finalRangePct > 0 &&
    (lowerInvalid || upperInvalid)
  ) {
    const halfPct = finalRangePct / 200;
    return {
      ...band,
      lowerPrice: center * (1 - halfPct),
      upperPrice: center * (1 + halfPct),
      widthPct: finalRangePct,
      priceSource: "diagnostic_orientative",
    };
  }

  return band;
}
