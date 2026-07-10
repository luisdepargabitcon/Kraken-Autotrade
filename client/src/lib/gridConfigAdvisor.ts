/**
 * Grid Config Advisor — Generates actionable configuration recommendations
 * based on current config, draft, audit data, and diagnostics.
 *
 * Recommendations are NEVER applied automatically. The UI must call
 * applyRecommendation() to update the draft, then the user must
 * explicitly press "Guardar cambios".
 */

export interface GridRecommendation {
  id: string;
  severity: "warning" | "danger" | "info";
  title: string;
  plainExplanation: string;
  recommendedPatch: Record<string, any>;
  recommendedLabel: string;
  expectedImpact: string;
  targetSection: string;
  targetField: string;
  ctaApply: string;
  ctaGoTo: string;
}

interface AdvisorInput {
  config: any;
  draft: Record<string, any>;
  auditData: any;
  diagnostic: any;
}

function eff(key: string, input: AdvisorInput, fallback: any): any {
  if (input.draft[key] !== undefined) return input.draft[key];
  if (input.config?.[key] !== undefined) return input.config[key];
  return fallback;
}

export function buildGridConfigRecommendations(input: AdvisorInput): GridRecommendation[] {
  const recs: GridRecommendation[] = [];
  const { config, auditData, diagnostic } = input;

  const netProfit = eff("netProfitTargetPct", input, 0.8);
  const stepMax = eff("gridStepMaxPct", input, 3.0);
  const rangeMax = eff("adaptiveRangeMaxPct", input, 7.0);
  const lowVolMax = eff("adaptiveRangeLowVolMaxPct", input, 3.0);
  const normalMax = eff("adaptiveRangeNormalMaxPct", input, 5.0);
  const highVolMax = eff("adaptiveRangeHighVolMaxPct", input, 7.0);
  const targetFull = eff("adaptiveRangeTargetFullLevels", input, false);
  const minViable = eff("adaptiveRangeMinViableLevels", input, 4);

  const pg = auditData?.professionalGenerator;
  const minSpacingPctReal = pg?.available ? pg.minSpacingPctReal : null;
  const adaptiveDecision = auditData?.rangeIntelligence?.lastAdaptiveRangeDecision;
  const adaptiveOk = adaptiveDecision?.adaptiveRangeOk ?? false;
  const levelsWouldFit = adaptiveDecision?.levelsWouldFitAtFinalRange ?? null;

  // 1) Objetivo exigente
  if (netProfit >= 1.2) {
    recs.push({
      id: "high_net_profit",
      severity: "warning",
      title: "Objetivo neto exigente",
      plainExplanation: `Tu beneficio neto objetivo es ${netProfit.toFixed(2)}%. Es alto: el Grid necesita más separación entre compra y venta, lo que reduce los niveles que caben en el rango y puede hacer que el rango no sea viable en mercados poco volátiles.`,
      recommendedPatch: { netProfitTargetPct: Math.max(0.5, netProfit - 0.3) },
      recommendedLabel: `Bajar a ${Math.max(0.5, netProfit - 0.3).toFixed(2)}%`,
      expectedImpact: "Más niveles caben en el rango. Menos beneficio por ciclo pero más operaciones posibles.",
      targetSection: "Ajustes finos",
      targetField: "netProfitTargetPct",
      ctaApply: "Aplicar recomendación",
      ctaGoTo: "Ir al ajuste",
    });
  }

  // 2) Máximo global menor que algún máximo por régimen
  if (rangeMax < normalMax || rangeMax < highVolMax) {
    const newRangeMax = Math.max(rangeMax, normalMax, highVolMax);
    recs.push({
      id: "range_max_below_regime",
      severity: "danger",
      title: "El rango máximo global es menor que algún máximo por régimen",
      plainExplanation: `El rango máximo global (${rangeMax.toFixed(2)}%) es menor que el máximo para lateral normal (${normalMax.toFixed(2)}%) o alta volatilidad (${highVolMax.toFixed(2)}%). Esto significa que esos regímenes nunca pueden usar su rango completo.`,
      recommendedPatch: { adaptiveRangeMaxPct: newRangeMax },
      recommendedLabel: `Subir a ${newRangeMax.toFixed(2)}%`,
      expectedImpact: "Cada régimen podrá usar su rango completo. Más niveles posibles en mercados volátiles.",
      targetSection: "Ajustes finos",
      targetField: "adaptiveRangeMaxPct",
      ctaApply: "Aplicar recomendación",
      ctaGoTo: "Ir al ajuste",
    });
  }

  // 3) Alta volatilidad menor que lateral normal
  if (normalMax > highVolMax) {
    const newHighVol = normalMax;
    recs.push({
      id: "high_vol_below_normal",
      severity: "warning",
      title: "Alta volatilidad debería permitir igual o más rango que lateral normal",
      plainExplanation: `El máximo para alta volatilidad (${highVolMax.toFixed(2)}%) es menor que para lateral normal (${normalMax.toFixed(2)}%). En mercados volátiles el Grid necesita más espacio, no menos.`,
      recommendedPatch: { adaptiveRangeHighVolMaxPct: newHighVol },
      recommendedLabel: `Subir a ${newHighVol.toFixed(2)}%`,
      expectedImpact: "El Grid podrá operar mejor en mercados volátiles sin quedarse sin espacio.",
      targetSection: "Ajustes finos",
      targetField: "adaptiveRangeHighVolMaxPct",
      ctaApply: "Aplicar recomendación",
      ctaGoTo: "Ir al ajuste",
    });
  }

  // 4) Separación máxima menor que separación mínima rentable
  if (minSpacingPctReal != null && stepMax < minSpacingPctReal) {
    const newStepMax = Math.ceil(minSpacingPctReal * 2) / 2;
    recs.push({
      id: "step_max_below_min_spacing",
      severity: "danger",
      title: "La separación máxima es menor que la separación mínima rentable",
      plainExplanation: `Tu separación máxima (${stepMax.toFixed(2)}%) es menor que la separación mínima rentable (${minSpacingPctReal.toFixed(2)}%). El motor no puede generar niveles porque no caben.`,
      recommendedPatch: { gridStepMaxPct: newStepMax },
      recommendedLabel: `Subir a ${newStepMax.toFixed(2)}%`,
      expectedImpact: "El motor podrá generar niveles con suficiente separación para ser rentables.",
      targetSection: "Ajustes finos",
      targetField: "gridStepMaxPct",
      ctaApply: "Aplicar recomendación",
      ctaGoTo: "Ir al ajuste",
    });
  }

  // 5) Rango no viable
  if (adaptiveDecision && !adaptiveOk) {
    const finalRangePct = adaptiveDecision.finalRangePct;
    const regimeMaxPct = adaptiveDecision.regimeMaxPct;
    if (finalRangePct != null && regimeMaxPct != null && finalRangePct >= regimeMaxPct) {
      // El rango necesario excede el máximo del régimen
      const newRangeMax = Math.min(15, Math.ceil(finalRangePct * 1.2 * 2) / 2);
      recs.push({
        id: "range_not_viable_max_too_low",
        severity: "danger",
        title: "Rango no viable: el rango máximo es demasiado bajo",
        plainExplanation: `El rango necesario para los niveles solicitados (${finalRangePct.toFixed(2)}%) excede el máximo permitido (${regimeMaxPct.toFixed(2)}%). El Grid no puede generar niveles.`,
        recommendedPatch: { adaptiveRangeMaxPct: newRangeMax },
        recommendedLabel: `Subir rango máximo a ${newRangeMax.toFixed(2)}%`,
        expectedImpact: "El Grid podrá usar un rango más amplio para acomodar los niveles solicitados.",
        targetSection: "Ajustes finos",
        targetField: "adaptiveRangeMaxPct",
        ctaApply: "Aplicar recomendación",
        ctaGoTo: "Ir al ajuste",
      });
    }

    // Also suggest lowering net profit if that's the bottleneck
    const minSpacing = adaptiveDecision.minSpacingPctReal;
    if (minSpacing != null && netProfit > 0.5) {
      recs.push({
        id: "range_not_viable_lower_profit",
        severity: "warning",
        title: "Rango no viable: bajar el beneficio neto",
        plainExplanation: `La separación mínima rentable es ${minSpacing.toFixed(2)}% porque el beneficio neto objetivo (${netProfit.toFixed(2)}%) exige mucha separación. Bajándolo caben más niveles.`,
        recommendedPatch: { netProfitTargetPct: Math.max(0.3, netProfit - 0.3) },
        recommendedLabel: `Bajar a ${Math.max(0.3, netProfit - 0.3).toFixed(2)}%`,
        expectedImpact: "Más niveles caben en el rango. Menos beneficio por ciclo pero más viabilidad.",
        targetSection: "Ajustes finos",
        targetField: "netProfitTargetPct",
        ctaApply: "Aplicar recomendación",
        ctaGoTo: "Ir al ajuste",
      });
    }
  }

  // 6) No hay rango activo
  if (diagnostic && !diagnostic.hasActiveRange) {
    recs.push({
      id: "no_active_range",
      severity: "info",
      title: "No hay rango activo cargado",
      plainExplanation: diagnostic.humanProblem || "El Grid no tiene un rango activo en memoria. Esto es normal tras un reinicio o si no ha habido evaluación reciente.",
      recommendedPatch: {},
      recommendedLabel: "",
      expectedImpact: "Pulsa \"Analizar ahora sin operar\" para que el motor evalúe y proponga un rango.",
      targetSection: "Bandas",
      targetField: "",
      ctaApply: "",
      ctaGoTo: "Ir a Bandas",
    });
  }

  // 7) Baja volatilidad mayor que lateral normal
  if (lowVolMax > normalMax) {
    const newLowVol = normalMax;
    recs.push({
      id: "low_vol_above_normal",
      severity: "warning",
      title: "Baja volatilidad no debería tener más rango que lateral normal",
      plainExplanation: `El máximo para baja volatilidad (${lowVolMax.toFixed(2)}%) es mayor que para lateral normal (${normalMax.toFixed(2)}%). En mercados tranquilos el Grid necesita menos espacio, no más.`,
      recommendedPatch: { adaptiveRangeLowVolMaxPct: newLowVol },
      recommendedLabel: `Bajar a ${newLowVol.toFixed(2)}%`,
      expectedImpact: "El Grid usará rangos más apropiados en mercados tranquilos.",
      targetSection: "Ajustes finos",
      targetField: "adaptiveRangeLowVolMaxPct",
      ctaApply: "Aplicar recomendación",
      ctaGoTo: "Ir al ajuste",
    });
  }

  // 8) Target full levels con rango máximo bajo
  if (targetFull && rangeMax < 6) {
    recs.push({
      id: "target_full_low_range",
      severity: "warning",
      title: "Pides todos los niveles pero el rango máximo puede no ser suficiente",
      plainExplanation: `Tienes activado \"Forzar todos los niveles\" pero el rango máximo es solo ${rangeMax.toFixed(2)}%. Puede que no quepan todos los niveles solicitados.`,
      recommendedPatch: { adaptiveRangeMaxPct: 8.0 },
      recommendedLabel: "Subir rango máximo a 8.00%",
      expectedImpact: "Más espacio para acomodar todos los niveles solicitados.",
      targetSection: "Ajustes finos",
      targetField: "adaptiveRangeMaxPct",
      ctaApply: "Aplicar recomendación",
      ctaGoTo: "Ir al ajuste",
    });
  }

  return recs;
}

/**
 * Apply a recommendation's patch to a draft object.
 * Returns a new draft with the patched values.
 */
export function applyRecommendationToDraft(
  draft: Record<string, any>,
  rec: GridRecommendation
): Record<string, any> {
  return { ...draft, ...rec.recommendedPatch };
}
