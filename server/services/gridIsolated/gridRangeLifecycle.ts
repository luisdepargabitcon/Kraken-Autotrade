export type RangeLifecycleStatus =
  | "reusable"
  | "audit_only"
  | "stale_pre_adaptive"
  | "stale_market_shift"
  | "stale_age"
  | "invalid_price_outside"
  | "invalid_regime"
  | "protected_by_open_cycles"
  | "needs_adaptive_validation"
  | "unknown";

export interface RangeLifecycleChecks {
  isPreAdaptive: boolean;
  ageHours: number | null;
  priceInsideRange: boolean | null;
  pricePositionPct: number | null;
  centerDriftPct: number | null;
  widthDivergencePct: number | null;
  regimeCompatible: boolean | null;
  hasOpenCycles: boolean;
  adaptiveModeActive: boolean;
  adaptiveDecisionAvailable: boolean;
  adaptiveRangeOk: boolean | null;
}

export interface RangeLifecycleResult {
  status: RangeLifecycleStatus;
  canReuseForAudit: boolean;
  canReuseForNewLevels: boolean;
  canRegenerateNow: boolean;
  shouldSuggestValidation: boolean;
  shouldSuggestManualRegeneration: boolean;
  reasonCode: string;
  naturalReason: string;
  impact: string;
  nextAction: string;
  checks: RangeLifecycleChecks;
}

export interface RangeLifecycleInput {
  mode: string;
  config: any;
  activeRange: any;
  marketContext: any;
  rangeIntelligence: any;
  professionalGenerator: any;
  openCyclesCount: number;
  activeOpenCyclesCount: number;
  globalOpenCyclesCount: number;
  currentPrice: number | null;
  atrPct: number | null;
  marketBollingerWidthPct: number | null;
  operationalRangeWidthPct: number | null;
  activeRangePriceWidthPct: number | null;
  rangeGenerationSource: string | null;
  rangeGenerationMethod: string | null;
  activeRangeCreatedAt: string | null;
  adaptiveDecision: any;
}

const MAX_RANGE_AGE_HOURS = 48;
const MAX_CENTER_DRIFT_PCT_FALLBACK = 2.5;
const WIDTH_DIVERGENCE_WARN_THRESHOLD = 5.0;

export function evaluateActiveRangeLifecycle(input: RangeLifecycleInput): RangeLifecycleResult {
  const {
    mode,
    config,
    activeRange,
    currentPrice,
    atrPct,
    marketBollingerWidthPct,
    activeRangePriceWidthPct,
    rangeGenerationSource,
    rangeGenerationMethod,
    activeRangeCreatedAt,
    adaptiveDecision,
    activeOpenCyclesCount,
    globalOpenCyclesCount,
  } = input;

  const rangeControlMode = config?.gridRangeControlMode ?? "adaptive_smart";
  const adaptiveModeActive = rangeControlMode === "adaptive_smart";
  const hasOpenCycles = (activeOpenCyclesCount ?? 0) > 0 || (globalOpenCyclesCount ?? 0) > 0;

  // Basic checks
  const isPreAdaptive = rangeGenerationSource === "pre_adaptive";
  const adaptiveDecisionAvailable = adaptiveDecision != null;
  const adaptiveRangeOk = adaptiveDecision?.rangeOk ?? null;

  // Age
  let ageHours: number | null = null;
  if (activeRangeCreatedAt) {
    try {
      const created = new Date(activeRangeCreatedAt).getTime();
      if (!isNaN(created)) {
        ageHours = (Date.now() - created) / (1000 * 60 * 60);
      }
    } catch { /* ignore */ }
  }

  // Price inside range
  const lower = activeRange?.lowerPrice ?? activeRange?.activeRangeLowerPrice ?? null;
  const upper = activeRange?.upperPrice ?? activeRange?.activeRangeUpperPrice ?? null;
  const center = activeRange?.centerPrice ?? activeRange?.activeRangeCenterPrice ?? null;

  let priceInsideRange: boolean | null = null;
  let pricePositionPct: number | null = null;
  let centerDriftPct: number | null = null;

  if (currentPrice != null && lower != null && upper != null) {
    priceInsideRange = currentPrice >= lower && currentPrice <= upper;
    if (upper > lower) {
      pricePositionPct = ((currentPrice - lower) / (upper - lower)) * 100;
    }
  }

  if (currentPrice != null && center != null && center > 0) {
    centerDriftPct = Math.abs(currentPrice - center) / center * 100;
  }

  // Width divergence
  let widthDivergencePct: number | null = null;
  if (activeRangePriceWidthPct != null && marketBollingerWidthPct != null) {
    widthDivergencePct = Math.abs(activeRangePriceWidthPct - marketBollingerWidthPct);
  }

  // Regime compatible
  const regimeBucket = adaptiveDecision?.regimeBucket ?? null;
  let regimeCompatible: boolean | null = null;
  if (regimeBucket) {
    regimeCompatible = !["unsuitable_trend", "pump_dump"].includes(regimeBucket);
  }

  const checks: RangeLifecycleChecks = {
    isPreAdaptive,
    ageHours,
    priceInsideRange,
    pricePositionPct,
    centerDriftPct,
    widthDivergencePct,
    regimeCompatible,
    hasOpenCycles,
    adaptiveModeActive,
    adaptiveDecisionAvailable,
    adaptiveRangeOk,
  };

  // ─── Rule A: OFF mode ──────────────────────────────────
  if (mode === "OFF" || mode === "LOCKED_OFF") {
    let status: RangeLifecycleStatus = "audit_only";
    if (isPreAdaptive && adaptiveModeActive) status = "stale_pre_adaptive";
    else if (priceInsideRange === false) status = "invalid_price_outside";
    else if (ageHours != null && ageHours > MAX_RANGE_AGE_HOURS) status = "stale_age";

    return {
      status,
      canReuseForAudit: true,
      canReuseForNewLevels: false,
      canRegenerateNow: false,
      shouldSuggestValidation: isPreAdaptive && adaptiveModeActive,
      shouldSuggestManualRegeneration: false,
      reasonCode: "OFF_MODE",
      naturalReason: "Grid en OFF. El rango se muestra solo para auditoría. No se usa para operar.",
      impact: "Sin impacto operativo. El motor no genera niveles ni abre ciclos.",
      nextAction: isPreAdaptive && adaptiveModeActive
        ? "Validar nuevo rango Adaptive Smart en modo read-only antes de reactivar."
        : "Mantener en OFF hasta que se decida reactivar.",
      checks,
    };
  }

  // ─── Rule B: Pre-adaptive + adaptive_smart ──────────────
  if (isPreAdaptive && adaptiveModeActive) {
    return {
      status: "stale_pre_adaptive",
      canReuseForAudit: true,
      canReuseForNewLevels: false,
      canRegenerateNow: !hasOpenCycles,
      shouldSuggestValidation: true,
      shouldSuggestManualRegeneration: false,
      reasonCode: "PRE_ADAPTIVE_IN_ADAPTIVE_MODE",
      naturalReason: "Este rango fue generado antes de Adaptive Smart Range. Se conserva para auditoría, pero no debería usarse para nuevos niveles Adaptive sin validación.",
      impact: "El rango v18 pre-adaptive puede no reflejar la volatilidad y régimen actuales del mercado.",
      nextAction: "Validar nuevo rango Adaptive Smart en modo read-only.",
      checks,
    };
  }

  // ─── Rule G: Régimen incompatible ──────────────────────
  if (regimeCompatible === false) {
    return {
      status: "invalid_regime",
      canReuseForAudit: true,
      canReuseForNewLevels: false,
      canRegenerateNow: false,
      shouldSuggestValidation: true,
      shouldSuggestManualRegeneration: false,
      reasonCode: "REGIME_UNSUITABLE",
      naturalReason: `El régimen actual (${regimeBucket}) no es apto para generar niveles Grid.`,
      impact: "Nuevas entradas deben pausarse hasta que el mercado vuelva a un régimen apto.",
      nextAction: "Pausar nuevas entradas hasta que el mercado vuelva a régimen apto.",
      checks,
    };
  }

  // ─── Rule D: Precio fuera de rango ─────────────────────
  if (priceInsideRange === false) {
    // Rule H: Protected by open cycles
    if (hasOpenCycles) {
      return {
        status: "protected_by_open_cycles",
        canReuseForAudit: true,
        canReuseForNewLevels: false,
        canRegenerateNow: false,
        shouldSuggestValidation: true,
        shouldSuggestManualRegeneration: false,
        reasonCode: "PRICE_OUTSIDE_WITH_OPEN_CYCLES",
        naturalReason: "El precio actual está fuera del rango operativo, pero hay ciclos abiertos que impiden sustituir el rango.",
        impact: "No se sustituye el rango para no romper compras/ventas en curso.",
        nextAction: "Esperar a que los ciclos abiertos se cierren antes de validar un nuevo rango.",
        checks,
      };
    }
    return {
      status: "invalid_price_outside",
      canReuseForAudit: true,
      canReuseForNewLevels: false,
      canRegenerateNow: true,
      shouldSuggestValidation: true,
      shouldSuggestManualRegeneration: false,
      reasonCode: "PRICE_OUTSIDE_RANGE",
      naturalReason: "El precio actual está fuera del rango operativo. Conviene validar un nuevo rango antes de generar niveles.",
      impact: "Los niveles existentes pueden no ser ejecutables si el precio se ha movido fuera del rango.",
      nextAction: "Validar nuevo rango en modo read-only.",
      checks,
    };
  }

  // ─── Rule E: Desplazamiento fuerte del centro ──────────
  if (centerDriftPct != null) {
    const driftThreshold = atrPct != null
      ? Math.max(2.0, atrPct * 1.5)
      : MAX_CENTER_DRIFT_PCT_FALLBACK;
    if (centerDriftPct > driftThreshold) {
      if (hasOpenCycles) {
        return {
          status: "protected_by_open_cycles",
          canReuseForAudit: true,
          canReuseForNewLevels: false,
          canRegenerateNow: false,
          shouldSuggestValidation: true,
          shouldSuggestManualRegeneration: false,
          reasonCode: "MARKET_SHIFT_WITH_OPEN_CYCLES",
          naturalReason: `El centro del rango se ha desplazado ${centerDriftPct.toFixed(2)}% respecto al precio actual, pero hay ciclos abiertos.`,
          impact: "No se sustituye el rango para no romper compras/ventas en curso.",
          nextAction: "Esperar cierre de ciclos antes de validar nuevo rango.",
          checks,
        };
      }
      return {
        status: "stale_market_shift",
        canReuseForAudit: true,
        canReuseForNewLevels: false,
        canRegenerateNow: true,
        shouldSuggestValidation: true,
        shouldSuggestManualRegeneration: false,
        reasonCode: "CENTER_DRIFT_EXCEEDED",
        naturalReason: `El centro del rango se ha desplazado ${centerDriftPct.toFixed(2)}% respecto al precio actual (umbral ${driftThreshold.toFixed(2)}%).`,
        impact: "El rango puede no reflejar el precio actual del mercado.",
        nextAction: "Validar nuevo rango en modo read-only.",
        checks,
      };
    }
  }

  // ─── Rule C: Edad del rango ────────────────────────────
  if (ageHours != null && ageHours > MAX_RANGE_AGE_HOURS) {
    if (hasOpenCycles) {
      return {
        status: "protected_by_open_cycles",
        canReuseForAudit: true,
        canReuseForNewLevels: false,
        canRegenerateNow: false,
        shouldSuggestValidation: true,
        shouldSuggestManualRegeneration: false,
        reasonCode: "STALE_AGE_WITH_OPEN_CYCLES",
        naturalReason: `El rango tiene ${ageHours.toFixed(1)}h (máximo ${MAX_RANGE_AGE_HOURS}h), pero hay ciclos abiertos.`,
        impact: "No se sustituye el rango para no romper compras/ventas en curso.",
        nextAction: "Esperar cierre de ciclos antes de validar nuevo rango.",
        checks,
      };
    }
    return {
      status: "stale_age",
      canReuseForAudit: true,
      canReuseForNewLevels: false,
      canRegenerateNow: true,
      shouldSuggestValidation: true,
      shouldSuggestManualRegeneration: false,
      reasonCode: "RANGE_TOO_OLD",
      naturalReason: `El rango tiene ${ageHours.toFixed(1)}h (máximo recomendado ${MAX_RANGE_AGE_HOURS}h). Puede estar obsoleto respecto al mercado.`,
      impact: "El rango puede no reflejar las condiciones actuales de volatilidad.",
      nextAction: "Validar nuevo rango en modo read-only.",
      checks,
    };
  }

  // ─── Rule H: Ciclos abiertos sin otras señales ─────────
  if (hasOpenCycles) {
    return {
      status: "protected_by_open_cycles",
      canReuseForAudit: true,
      canReuseForNewLevels: true,
      canRegenerateNow: false,
      shouldSuggestValidation: false,
      shouldSuggestManualRegeneration: false,
      reasonCode: "OPEN_CYCLES_PROTECT",
      naturalReason: "Hay ciclos abiertos. No se sustituye el rango para no romper compras/ventas en curso.",
      impact: "El rango se mantiene activo mientras haya ciclos abiertos.",
      nextAction: "Mantener rango activo hasta que se cierren los ciclos.",
      checks,
    };
  }

  // ─── Rule I: Todo correcto ─────────────────────────────
  if (
    !isPreAdaptive &&
    activeRange != null &&
    priceInsideRange === true &&
    (centerDriftPct == null || centerDriftPct <= (atrPct != null ? Math.max(2.0, atrPct * 1.5) : MAX_CENTER_DRIFT_PCT_FALLBACK)) &&
    (ageHours == null || ageHours <= MAX_RANGE_AGE_HOURS)
  ) {
    return {
      status: "reusable",
      canReuseForAudit: true,
      canReuseForNewLevels: true,
      canRegenerateNow: false,
      shouldSuggestValidation: false,
      shouldSuggestManualRegeneration: false,
      reasonCode: "RANGE_HEALTHY",
      naturalReason: "El rango activo está actualizado, el precio está dentro y el régimen es compatible.",
      impact: "El rango puede usarse para generar nuevos niveles cuando se autorice.",
      nextAction: "Mantener rango activo.",
      checks,
    };
  }

  // ─── Fallback: unknown ─────────────────────────────────
  return {
    status: "unknown",
    canReuseForAudit: true,
    canReuseForNewLevels: false,
    canRegenerateNow: false,
    shouldSuggestValidation: true,
    shouldSuggestManualRegeneration: false,
    reasonCode: "INSUFFICIENT_DATA",
    naturalReason: "No hay datos suficientes para evaluar la validez del rango activo.",
    impact: "Se muestra el rango para auditoría, pero no se recomienda usarlo para nuevos niveles sin validación.",
    nextAction: "Validar nuevo rango en modo read-only cuando sea posible.",
    checks,
  };
}
