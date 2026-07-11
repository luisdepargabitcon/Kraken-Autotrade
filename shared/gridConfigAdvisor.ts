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
  currentValue?: string;
  recommendedValue?: string;
}

export interface BtcProfile {
  id: string;
  label: string;
  description: string;
  patch: Record<string, any>;
}

export const BTC_PROFILES: BtcProfile[] = [
  {
    id: "prudente",
    label: "Prudente BTC",
    description: "Menos beneficio por ciclo, más facilidad para que entren niveles.",
    patch: {
      netProfitTargetPct: 0.50,
      adaptiveRangeMinPct: 2.50,
      adaptiveRangeMaxPct: 5.50,
      adaptiveRangeLowVolMaxPct: 3.00,
      adaptiveRangeNormalMaxPct: 5.50,
      adaptiveRangeHighVolMaxPct: 7.00,
      adaptiveRangeMinViableLevels: 2,
      adaptiveRangeTargetFullLevels: false,
    },
  },
  {
    id: "equilibrado",
    label: "Equilibrado BTC",
    description: "Recomendado para empezar en SHADOW. Busca aprovechar oscilaciones normales sin forzar todos los niveles.",
    patch: {
      netProfitTargetPct: 0.70,
      adaptiveRangeMinPct: 3.00,
      adaptiveRangeMaxPct: 7.00,
      adaptiveRangeLowVolMaxPct: 4.00,
      adaptiveRangeNormalMaxPct: 6.00,
      adaptiveRangeHighVolMaxPct: 8.00,
      adaptiveRangeMinViableLevels: 3,
      adaptiveRangeTargetFullLevels: false,
    },
  },
  {
    id: "amplio",
    label: "Amplio BTC",
    description: "Más espacio para mercado volátil. Más exposición, pero evita que el Grid quede bloqueado por rango demasiado pequeño.",
    patch: {
      netProfitTargetPct: 0.80,
      adaptiveRangeMinPct: 3.50,
      adaptiveRangeMaxPct: 9.00,
      adaptiveRangeLowVolMaxPct: 4.50,
      adaptiveRangeNormalMaxPct: 7.00,
      adaptiveRangeHighVolMaxPct: 9.00,
      adaptiveRangeMinViableLevels: 3,
      adaptiveRangeTargetFullLevels: false,
    },
  },
];

export function getBtcProfile(id: string): BtcProfile | undefined {
  return BTC_PROFILES.find(p => p.id === id);
}

export function buildRangeExplanation(allowedPct: number | null, requiredPct: number | null, netProfitPct: number | null): string {
  if (allowedPct == null || requiredPct == null) return "";
  let text = "BTC sí puede servir para Grid. El problema es la configuración actual.\n\n";
  if (netProfitPct != null) {
    text += "Ahora el Grid intenta ganar " + netProfitPct.toFixed(2) + "% neto por cada tramo. Para conseguir eso necesita separar mucho las compras y ventas.\n\n";
  }
  text += "Con los niveles pedidos, necesita aproximadamente un " + requiredPct.toFixed(2) + "% de anchura para montar una banda completa.\n\n";
  text += "Pero tu ajuste actual solo permite " + allowedPct.toFixed(2) + "%, así que no caben niveles suficientes.\n\n";
  text += "Solución recomendada para probar en SHADOW:\n";
  text += "- Bajar objetivo neto a 0.70%–0.90%\n";
  text += "- Ampliar rango normal a 6.00%–7.00%\n";
  text += "- Mantener mínimo viable en 3 niveles\n";
  text += "- No forzar todos los niveles";
  return text;
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
    const newNetProfit = Math.max(0.5, netProfit - 0.3);
    recs.push({
      id: "high_net_profit",
      severity: "warning",
      title: "Objetivo exigente",
      plainExplanation: `Ahora pides ${netProfit.toFixed(2)}% neto por nivel. Eso obliga a separar mucho los niveles y puede hacer que no quepan en el rango.`,
      recommendedPatch: { netProfitTargetPct: newNetProfit },
      recommendedLabel: `Bajar a ${newNetProfit.toFixed(2)}%`,
      expectedImpact: "Más niveles caben en el rango. Menos beneficio por ciclo pero más operaciones posibles.",
      targetSection: "Ajustes finos",
      targetField: "netProfitTargetPct",
      ctaApply: "Probar este ajuste",
      ctaGoTo: "Ir al objetivo neto",
      currentValue: `${netProfit.toFixed(2)}%`,
      recommendedValue: `${newNetProfit.toFixed(2)}%`,
    });
  }

  // 2) Máximo global menor que algún máximo por régimen
  if (rangeMax < normalMax || rangeMax < highVolMax) {
    const newRangeMax = Math.max(rangeMax, normalMax, highVolMax);
    recs.push({
      id: "range_max_below_regime",
      severity: "danger",
      title: "El máximo global es menor que algún máximo por régimen",
      plainExplanation: `El rango máximo global (${rangeMax.toFixed(2)}%) es menor que el máximo para lateral normal (${normalMax.toFixed(2)}%) o alta volatilidad (${highVolMax.toFixed(2)}%). Estos regímenes nunca podrán usar su rango completo.`,
      recommendedPatch: { adaptiveRangeMaxPct: newRangeMax },
      recommendedLabel: `Alinear a ${newRangeMax.toFixed(2)}%`,
      expectedImpact: "Cada régimen podrá usar su rango completo. Más niveles posibles en mercados volátiles.",
      targetSection: "Ajustes finos",
      targetField: "adaptiveRangeMaxPct",
      ctaApply: "Probar este ajuste",
      ctaGoTo: "Ir al ajuste",
      currentValue: `${rangeMax.toFixed(2)}%`,
      recommendedValue: `${newRangeMax.toFixed(2)}%`,
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
      recommendedLabel: `Igualar a ${newHighVol.toFixed(2)}%`,
      expectedImpact: "El Grid podrá operar mejor en mercados volátiles sin quedarse sin espacio.",
      targetSection: "Ajustes finos",
      targetField: "adaptiveRangeHighVolMaxPct",
      ctaApply: "Probar este ajuste",
      ctaGoTo: "Ir al ajuste",
      currentValue: `${highVolMax.toFixed(2)}%`,
      recommendedValue: `${newHighVol.toFixed(2)}%`,
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
      ctaApply: "Probar este ajuste",
      ctaGoTo: "Ir al ajuste",
      currentValue: `${stepMax.toFixed(2)}%`,
      recommendedValue: `${newStepMax.toFixed(2)}%`,
    });
  }

  // 5) Rango no viable
  if (adaptiveDecision && !adaptiveOk) {
    const finalRangePct = adaptiveDecision.finalRangePct;
    const regimeMaxPct = adaptiveDecision.regimeMaxPct;
    if (finalRangePct != null && regimeMaxPct != null && finalRangePct >= regimeMaxPct) {
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
        ctaApply: "Probar este ajuste",
        ctaGoTo: "Ir al ajuste",
        currentValue: `${rangeMax.toFixed(2)}%`,
        recommendedValue: `${newRangeMax.toFixed(2)}%`,
      });
    }

    // 5b) Auto-recommend Equilibrado profile when not viable
    const equilibrado = getBtcProfile("equilibrado");
    if (equilibrado) {
      recs.push({
        id: "range_not_viable_equilibrado",
        severity: "warning",
        title: "Probar configuración Equilibrada BTC",
        plainExplanation: "Esta configuración baja el beneficio por ciclo y amplía la banda para que puedan caber niveles en oscilaciones normales de BTC.",
        recommendedPatch: equilibrado.patch,
        recommendedLabel: "Aplicar perfil Equilibrado BTC",
        expectedImpact: "Baja el beneficio por ciclo y amplía la banda. Más niveles caben en el rango.",
        targetSection: "Ajustes finos",
        targetField: "netProfitTargetPct",
        ctaApply: "Probar Equilibrado BTC",
        ctaGoTo: "Ir al ajuste",
        currentValue: "Configuración actual",
        recommendedValue: "Perfil Equilibrado BTC",
      });
    }

    const minSpacing = adaptiveDecision.minSpacingPctReal;
    if (minSpacing != null && netProfit > 0.5) {
      const newNetProfit = Math.max(0.3, netProfit - 0.3);
      recs.push({
        id: "range_not_viable_lower_profit",
        severity: "warning",
        title: "Rango no viable: bajar el beneficio neto",
        plainExplanation: `La separación mínima rentable es ${minSpacing.toFixed(2)}% porque el beneficio neto objetivo (${netProfit.toFixed(2)}%) exige mucha separación. Bajándolo caben más niveles.`,
        recommendedPatch: { netProfitTargetPct: newNetProfit },
        recommendedLabel: `Bajar a ${newNetProfit.toFixed(2)}%`,
        expectedImpact: "Más niveles caben en el rango. Menos beneficio por ciclo pero más viabilidad.",
        targetSection: "Ajustes finos",
        targetField: "netProfitTargetPct",
        ctaApply: "Probar este ajuste",
        ctaGoTo: "Ir al ajuste",
        currentValue: `${netProfit.toFixed(2)}%`,
        recommendedValue: `${newNetProfit.toFixed(2)}%`,
      });
    }
  }

  // 6) No hay rango activo
  if (diagnostic && !diagnostic.hasActiveRange) {
    recs.push({
      id: "no_active_range",
      severity: "info",
      title: "No hay rango activo ahora",
      plainExplanation: diagnostic.humanProblem || "El Grid no tiene un rango activo en memoria. Esto es normal tras un reinicio o si no ha habido evaluación reciente.",
      recommendedPatch: {},
      recommendedLabel: "",
      expectedImpact: "Pulsa \"Analizar mercado ahora\" para que el motor evalúe y proponga un rango.",
      targetSection: "Bandas",
      targetField: "",
      ctaApply: "",
      ctaGoTo: "Ir a Bandas",
      currentValue: "Sin rango",
      recommendedValue: "Analizar mercado ahora",
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
      ctaApply: "Probar este ajuste",
      ctaGoTo: "Ir al ajuste",
      currentValue: `${lowVolMax.toFixed(2)}%`,
      recommendedValue: newLowVol.toFixed(2) + "%",
    });
  }

  // 8) Target full levels con rango máximo bajo
  if (targetFull && rangeMax < 6) {
    recs.push({
      id: "target_full_low_range",
      severity: "warning",
      title: "Pides todos los niveles pero el rango máximo puede no ser suficiente",
      plainExplanation: "Tienes activado \"Forzar todos los niveles\" pero el rango máximo es solo " + rangeMax.toFixed(2) + "%. Puede que no quepan todos los niveles solicitados.",
      recommendedPatch: { adaptiveRangeMaxPct: 8.0 },
      recommendedLabel: "Subir rango máximo a 8.00%",
      expectedImpact: "Más espacio para acomodar todos los niveles solicitados.",
      targetSection: "Ajustes finos",
      targetField: "adaptiveRangeMaxPct",
      ctaApply: "Probar este ajuste",
      ctaGoTo: "Ir al ajuste",
      currentValue: rangeMax.toFixed(2) + "%",
      recommendedValue: "8.00%",
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
