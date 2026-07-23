/**
 * GridAuditViewModel — Single source of truth for audit/export/JSON contract.
 * Returns the canonical fields that every UI tab and export must use:
 * - currentOperationalState
 * - activeRange
 * - counters
 * - latestGridDiagnostic
 * - recommendations
 *
 * This module is intentionally pure: it receives engine/runtime data and
 * returns a serializable view model. It does not read the DB, place orders,
 * or modify state.
 */

import { buildGridConfigRecommendations } from "@shared/gridConfigAdvisor";
import { evaluateActiveRangeLifecycle } from "./gridRangeLifecycle";
import {
  buildGridOperationalViewModel,
  type GridOperationalViewModel,
} from "./buildGridOperationalViewModel";

export interface GridDiagnosticBand {
  exists: boolean;
  status: "active" | "calculated_not_active" | "not_viable" | "not_enough_data" | "market_unsuitable";
  lowerPrice: number | null;
  centerPrice: number | null;
  upperPrice: number | null;
  widthPct: number | null;
  requiredRangePct: number | null;
  allowedRangePct: number | null;
  finalRangePct: number | null;
  buyLevelsWouldFit: number | null;
  sellLevelsWouldFit: number | null;
  requestedBuyLevels: number | null;
  requestedSellLevels: number | null;
  generatedBuyLevels: number | null;
  generatedSellLevels: number | null;
  reason: string;
  plainExplanation: string;
  nextAction: string;
  source: "active_range" | "last_adaptive_decision" | "last_shadow_validation" | "professional_generator" | "none";
}

export interface GridAuditViewModel {
  currentOperationalState: GridOperationalState;
  activeRange: GridActiveRangeView;
  counters: GridCounters;
  latestGridDiagnostic: GridLatestDiagnostic;
  recommendations: any[];
  diagnosticBand: GridDiagnosticBand;
  operational: GridOperationalViewModel;
}

export interface GridOperationalState {
  status:
    | "shadow_waiting_for_range"
    | "shadow_has_range"
    | "shadow_no_levels"
    | "shadow_compact_not_viable"
    | "shadow_market_unsuitable"
    | "shadow_inactive"
    | "off"
    | "real_blocked"
    | "unknown";
  title: string;
  plainSummary: string;
  plainProblem: string | null;
  plainNextAction: string;
  canAnalyzeNow: boolean;
  canGenerateSimulatedRange: boolean;
  canTradeReal: false;
  safe: boolean;
  hasRealOrders: boolean;
  hasOpenCycles: boolean;
  hasActiveRange: boolean;
}

export interface GridActiveRangeView {
  exists: boolean;
  id: string | null;
  versionNumber: number | null;
  status: string | null;
  lowerPrice: number | null;
  centerPrice: number | null;
  upperPrice: number | null;
  createdAt: string | null;
  source: "adaptive" | "legacy" | "pre_adaptive" | "unknown" | null;
  pricePositionPct: number | null;
  widthPct: number | null;
}

export interface GridCounters {
  currentLevels: number;
  currentPlannedLevels: number;
  historicalLevels: number;
  orphanPlannedLevels: number;
  historicalCycles: number;
  cancelledCycles: number;
  completedCycles: number;
  openCycles: number;
}

export interface GridLatestDiagnostic {
  available: boolean;
  source: string;
  generatedAt: string | null;
  hasActiveRange: boolean;
  levelsGenerated: number;
  levelsWouldGenerate: number;
  reasonNoLevels: string | null;
  realOrdersPlaced: boolean;
  repeatedCompactEventsCount: number;
  notViableEventsCount: number;
  humanSummary: string;
  humanProblem: string | null;
  humanNextStep: string;
  lastTickReason: string | null;
  lastTickAt: string | null;
  professionalGeneratorViabilityStatus: string | null;
  rangeLifecycleStatus: string | null;
  rangeLifecycleReason: string | null;
  rangeLifecycleNextAction: string | null;
  // Legacy / compatibility fields retained for existing UI and export consumers
  mode: string;
  isActive: boolean;
  isRunning: boolean;
  lastShadowValidationAt: string | null;
  lastShadowValidationResult: any;
  lastProfessionalValidationAt: string | null;
  lastProfessionalValidationResult: any;
  professionalGeneratorAvailable: boolean;
  professionalGeneratorReason: string | null;
  professionalGeneratorGeneratedLevels: number;
}

function toNum(v: any): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonSafe(v: any): any {
  if (!v) return {};
  if (typeof v === "object") return v;
  try {
    const parsed = JSON.parse(v);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function extractProfessionalGeneratorFromEvents(events: any[], activeRangeId: string | null): any {
  const professionalEvents = events.filter((ev: any) =>
    ev.eventType === "GRID_PROFESSIONAL_GENERATOR_USED" ||
    ev.eventType === "GRID_PROFESSIONAL_GENERATOR_COMPACT" ||
    ev.eventType === "GRID_PROFESSIONAL_GENERATOR_NOT_VIABLE"
  );
  if (professionalEvents.length === 0) {
    return { available: false, reason: "No professional generator event found" };
  }
  const activeRangeEvent = activeRangeId
    ? professionalEvents.find((ev: any) => ev.rangeVersionId === activeRangeId)
    : undefined;
  const event = activeRangeEvent || professionalEvents[0];
  const meta = parseJsonSafe(event.metadataJson);
  const pg = meta.professionalGenerator || {};
  return {
    available: true,
    source: "event",
    mode: pg.mode || "shadow_generation",
    formula: pg.formula || "accumulated_spacing",
    legacyGeneratorUsed: pg.legacyGeneratorUsed || false,
    viabilityStatus: pg.viabilityStatus,
    minSpacingPctReal: pg.minSpacingPctReal,
    spacingPct: pg.spacingPct,
    centerPrice: pg.centerPrice,
    operationalLower: pg.operationalLower,
    operationalUpper: pg.operationalUpper,
    operationalBandWidthPct: pg.operationalBandWidthPct,
    operationalSemiRangePct: pg.operationalSemiRangePct,
    requestedBuyLevels: pg.requestedBuyLevels,
    requestedSellLevels: pg.requestedSellLevels,
    generatedBuyLevels: pg.generatedBuyLevels,
    generatedSellLevels: pg.generatedSellLevels,
    reductionApplied: pg.reductionApplied,
    reason: pg.reason,
    rangeAudit: pg.rangeAudit || null,
    eventId: event.id,
    eventCreatedAt: event.createdAt,
    rangeVersionId: event.rangeVersionId,
    stale: activeRangeId ? !activeRangeEvent : true,
  };
}

function buildRangeLifecycle(
  mode: string,
  config: any,
  resolvedRange: any,
  marketContext: any,
  professionalGenerator: any,
  openCyclesCount: number,
  activeOpenCyclesCount: number,
  globalOpenCyclesCount: number,
  adaptiveDecision: any
): any {
  if (!resolvedRange || resolvedRange.status === "sin_rango_activo") {
    return null;
  }
  const r = resolvedRange;
  const lower = toNum(r.lowerPrice);
  const upper = toNum(r.upperPrice);
  const center = toNum(r.centerPrice);
  const activeRangePriceWidthPct = lower != null && upper != null && center != null && center > 0
    ? ((upper - lower) / center) * 100 : null;
  const marketBollingerWidthPct = toNum(r.widthPct);
  const pgAny = professionalGenerator as any;
  const operationalRangeWidthPct = pgAny?.available && pgAny.operationalBandWidthPct != null ? pgAny.operationalBandWidthPct : null;
  const rGenMethod = r.method ?? null;
  const rGenSource = rGenMethod === "professional_accumulated_spacing" ? "pre_adaptive"
    : rGenMethod === "adaptive_smart" ? "adaptive_smart"
    : rGenMethod ?? "unknown";

  return evaluateActiveRangeLifecycle({
    mode,
    config,
    activeRange: r,
    marketContext,
    rangeIntelligence: null,
    professionalGenerator,
    openCyclesCount,
    activeOpenCyclesCount,
    globalOpenCyclesCount,
    currentPrice: marketContext?.currentPrice ?? null,
    atrPct: marketContext?.atrPct ?? null,
    marketBollingerWidthPct,
    operationalRangeWidthPct,
    activeRangePriceWidthPct,
    rangeGenerationSource: rGenSource,
    rangeGenerationMethod: rGenMethod,
    activeRangeCreatedAt: r.createdAt ?? null,
    adaptiveDecision,
  });
}

function buildLatestGridDiagnostic(
  mode: string,
  config: any,
  status: any,
  events: any[],
  levels: any[],
  cycles: any[],
  resolvedRange: any,
  marketContext: any,
  lastShadowValidation: { at: Date | null; result: any },
  lastProfessionalValidation: { at: Date | null; result: any },
  rangeLifecycle: any
): GridLatestDiagnostic {
  const sv = lastShadowValidation.result || {};
  const svAt = lastShadowValidation.at;
  const activeRangeId = status?.activeRangeVersionId ?? null;
  const professionalGenerator = extractProfessionalGeneratorFromEvents(events, activeRangeId);
  const pg = professionalGenerator as any;
  const compactEvents = events.filter((ev: any) => ev.eventType === "GRID_PROFESSIONAL_GENERATOR_COMPACT");
  const notViableEvents = events.filter((ev: any) => ev.eventType === "GRID_PROFESSIONAL_GENERATOR_NOT_VIABLE");
  const repeatedCompactEventsCount = compactEvents.length;
  const notViableEventsCount = notViableEvents.length;

  const hasActiveRange = !!activeRangeId;
  const reasonNoLevels = sv?.reasonNoLevels ?? null;
  const blockedByNoRange = sv?.blockedByNoRange ?? false;
  const blockedByUnsuitableMarket = sv?.blockedByUnsuitableMarket ?? false;
  const blockedByIsActive = sv?.blockedByIsActive ?? false;
  const blockedByNoMarketData = sv?.blockedByNoMarketData ?? false;
  const blockedByRiskGuard = sv?.blockedByRiskGuard ?? false;

  const levelsGenerated = levels.filter((l: any) => l?.rangeVersionId === activeRangeId && l?.status !== "replaced").length;
  const levelsWouldGenerate = pg?.available
    ? (pg.generatedBuyLevels || 0) + (pg.generatedSellLevels || 0)
    : 0;

  let humanSummary = "";
  let humanProblem: string | null = null;
  let humanNextStep = "";

  if (mode === "OFF") {
    humanSummary = "El Grid está apagado (OFF). No evalúa el mercado ni genera niveles.";
    humanProblem = null;
    humanNextStep = "Cambia el modo a SHADOW y activa el motor si quieres simular.";
  } else if (!config?.isActive) {
    humanSummary = `El Grid está en modo ${mode} pero el motor está inactivo (isActive=false).`;
    humanProblem = "El motor no evalúa el mercado ni genera niveles porque está desactivado.";
    humanNextStep = "Activa el motor desde la UI para que empiece a evaluar.";
  } else if (hasActiveRange) {
    humanSummary = `El Grid tiene un rango activo (versión ${status?.activeRangeVersionNumber ?? "?"}). El motor está en modo ${mode}.`;
    if (levelsGenerated > 0) {
      humanProblem = null;
      humanNextStep = "El rango está activo y generó niveles. Revisa la pestaña Niveles.";
    } else if (reasonNoLevels) {
      humanProblem = reasonNoLevels;
      humanNextStep = sv?.nextAction || "Revisa las condiciones del mercado y la configuración.";
    } else {
      humanProblem = "El rango está activo pero todavía no hay niveles generados.";
      humanNextStep = "Espera al siguiente tick o pulsa Analizar mercado ahora.";
    }
  } else {
    humanSummary = `El motor analizó el mercado, pero no activó ninguna banda. El modo actual es ${mode}.`;
    if (blockedByNoRange) {
      humanProblem = "El motor no tiene una banda activa en memoria. Esto puede ocurrir tras un reinicio o si no ha habido evaluación reciente.";
      humanNextStep = "Pulsa \"Analizar mercado ahora\" para que el motor evalúe el mercado y proponga una banda.";
    } else if (blockedByUnsuitableMarket) {
      humanProblem = sv?.marketUnsuitableReason || "Las condiciones de mercado no son aptas para el Grid.";
      humanNextStep = "Espera a que el mercado cambie o ajusta la configuración del rango.";
    } else if (blockedByIsActive) {
      humanProblem = "El motor está en SHADOW pero isActive=false. No se generan niveles automáticos.";
      humanNextStep = "Activa el motor Grid desde la UI para que empiece a evaluar.";
    } else if (blockedByNoMarketData) {
      humanProblem = "No hay datos de mercado disponibles para evaluar.";
      humanNextStep = "Verificar la conectividad con el exchange.";
    } else if (blockedByRiskGuard) {
      humanProblem = "El guardián de seguridad está activo (pump/dump o cortocircuito).";
      humanNextStep = "Espera a que el guardián se reinicie automáticamente.";
    } else if (repeatedCompactEventsCount > 0) {
      humanProblem = `El motor de cálculo ha producido ${repeatedCompactEventsCount} evaluación(es) recientes donde el rango queda demasiado estrecho. La configuración actual no permite crear una banda rentable.`;
      humanNextStep = "Revisa las recomendaciones de configuración: bajar el objetivo neto o ampliar el rango máximo.";
    } else if (notViableEvents.length > 0) {
      humanProblem = "El motor de cálculo marcó la banda como no viable en la última evaluación.";
      humanNextStep = "Ajusta la configuración: bajar el objetivo neto o ampliar el rango máximo.";
    } else {
      humanProblem = "No hay suficiente información de diagnóstico todavía.";
      humanNextStep = "Pulsa \"Analizar mercado ahora\" para generar un diagnóstico.";
    }
  }

  const source = lastShadowValidation.at ? "lastShadowValidation" : "engineStatus";
  const generatedAt = svAt ? new Date(svAt).toISOString() : null;

  return {
    available: true,
    source,
    generatedAt,
    hasActiveRange,
    levelsGenerated,
    levelsWouldGenerate,
    reasonNoLevels,
    realOrdersPlaced: false,
    repeatedCompactEventsCount,
    notViableEventsCount,
    humanSummary,
    humanProblem,
    humanNextStep,
    lastTickReason: status?.lastTickReason ?? null,
    lastTickAt: status?.lastTickAt ? new Date(status.lastTickAt).toISOString() : null,
    professionalGeneratorViabilityStatus: pg?.viabilityStatus ?? null,
    rangeLifecycleStatus: rangeLifecycle?.status ?? null,
    rangeLifecycleReason: rangeLifecycle?.naturalReason ?? null,
    rangeLifecycleNextAction: rangeLifecycle?.nextAction ?? null,
    mode,
    isActive: config?.isActive ?? false,
    isRunning: status?.isRunning ?? false,
    lastShadowValidationAt: svAt ? new Date(svAt).toISOString() : null,
    lastShadowValidationResult: sv || null,
    lastProfessionalValidationAt: lastProfessionalValidation.at ? new Date(lastProfessionalValidation.at).toISOString() : null,
    lastProfessionalValidationResult: lastProfessionalValidation.result || null,
    professionalGeneratorAvailable: pg?.available ?? false,
    professionalGeneratorReason: pg?.available ? null : (pg?.reason ?? null),
    professionalGeneratorGeneratedLevels: pg?.available ? (pg.generatedBuyLevels || 0) + (pg.generatedSellLevels || 0) : 0,
  };
}

function buildActiveRangeView(
  status: any,
  resolvedRange: any,
  currentPrice: number | null
): GridActiveRangeView {
  const r = resolvedRange;
  const exists = !!status?.activeRangeVersionId && r?.status !== "sin_rango_activo";
  if (!exists) {
    return {
      exists: false,
      id: null,
      versionNumber: null,
      status: null,
      lowerPrice: null,
      centerPrice: null,
      upperPrice: null,
      createdAt: null,
      source: null,
      pricePositionPct: null,
      widthPct: null,
    };
  }

  const lower = toNum(r.lowerPrice);
  const upper = toNum(r.upperPrice);
  const center = toNum(r.centerPrice);
  const widthPct = lower != null && upper != null && center != null && center > 0
    ? ((upper - lower) / center) * 100
    : null;
  const pricePositionPct = currentPrice != null && lower != null && upper != null && upper > lower
    ? ((currentPrice - lower) / (upper - lower)) * 100
    : null;

  const method = r.method ?? null;
  const source: GridActiveRangeView["source"] =
    method === "adaptive_smart" ? "adaptive"
    : method === "professional_accumulated_spacing" ? "pre_adaptive"
    : "unknown";

  return {
    exists: true,
    id: status.activeRangeVersionId || null,
    versionNumber: status.activeRangeVersionNumber ?? null,
    status: r.status || status.activeRangeStatus || null,
    lowerPrice: lower,
    centerPrice: center,
    upperPrice: upper,
    createdAt: r.createdAt ?? status.activeRangeCreatedAt ?? null,
    source,
    pricePositionPct,
    widthPct,
  };
}

function buildCounters(status: any, levels: any[], cycles: any[]): GridCounters {
  const activeRangeId = status?.activeRangeVersionId ?? null;
  const currentLevels = activeRangeId
    ? levels.filter((l: any) => l?.rangeVersionId === activeRangeId).length
    : 0;
  const currentPlannedLevels = activeRangeId
    ? levels.filter((l: any) => l?.rangeVersionId === activeRangeId && l?.status === "planned").length
    : 0;
  const historicalLevels = activeRangeId
    ? levels.filter((l: any) => l?.rangeVersionId !== activeRangeId).length
    : levels.length;
  const orphanPlannedLevels = status?.orphanPlannedLevelsCount ?? levels.filter((l: any) => l?.status === "planned" && (!activeRangeId || l?.rangeVersionId !== activeRangeId)).length;
  const openCycles = cycles.filter((c: any) => ["open", "active", "buy_filled", "buy_placed", "sell_placed", "cycle_open", "hodl_recovery"].includes(c?.status)).length;
  const historicalCycles = cycles.filter((c: any) => ["completed", "closed", "stop_loss_hit", "trailing_closed"].includes(c?.status)).length;
  const cancelledCycles = cycles.filter((c: any) => c?.status === "cancelled").length;
  const completedCycles = cycles.filter((c: any) => c?.status === "completed").length;

  return {
    currentLevels,
    currentPlannedLevels,
    historicalLevels,
    orphanPlannedLevels,
    historicalCycles,
    cancelledCycles,
    completedCycles,
    openCycles,
  };
}

function buildCurrentOperationalState(
  mode: string,
  config: any,
  status: any,
  diagnostic: GridLatestDiagnostic,
  counters: GridCounters,
  events: any[]
): GridOperationalState {
  const isActive = config?.isActive ?? false;
  const isRunning = status?.isRunning ?? false;
  const realOrdersCount = status?.realOpenOrdersCount ?? 0;
  const openCycles = counters.openCycles;
  const hasActiveRange = diagnostic.hasActiveRange;
  const hasLevels = diagnostic.levelsGenerated > 0;
  const repeatedCompactEventsCount = diagnostic.repeatedCompactEventsCount;
  const notViableEventsCount = diagnostic.notViableEventsCount;
  const lastTickReason = diagnostic.lastTickReason ?? "";
  const blockedByUnsuitableMarket = lastTickReason.startsWith("Condiciones de mercado no válidas para Grid");

  let statusKey: GridOperationalState["status"] = "unknown";
  let title = "";
  let plainSummary = "";
  let plainProblem: string | null = null;
  let plainNextAction = "";
  let canAnalyzeNow = false;
  let canGenerateSimulatedRange = false;

  if (mode === "OFF") {
    statusKey = "off";
    title = "Grid apagado";
    plainSummary = "El Grid está en modo OFF. No evalúa el mercado, no genera niveles y no envía órdenes.";
    plainProblem = null;
    plainNextAction = "Cambia el modo a SHADOW y activa el motor si quieres simular.";
  } else if (!isActive) {
    statusKey = "shadow_inactive";
    title = "Motor inactivo";
    plainSummary = `El Grid está en modo ${mode} pero el motor está inactivo (isActive=false). No evalúa el mercado ni genera niveles automáticos. Sin embargo, no hay órdenes reales ni capital ejecutado.`;
    plainProblem = "El motor está desactivado.";
    plainNextAction = "Activa el motor en el panel principal para que empiece a evaluar.";
  } else if (mode !== "OFF" && mode !== "SHADOW" && realOrdersCount === 0) {
    statusKey = "real_blocked";
    title = "Modo real bloqueado";
    plainSummary = `El Grid está configurado en modo ${mode}, pero los modos reales están bloqueados por seguridad. No hay órdenes reales.`;
    plainProblem = "Los modos reales necesitan que se cumplan todas las condiciones de seguridad.";
    plainNextAction = "Pasa primero a SHADOW, valida el funcionamiento y luego desbloquea los modos reales si aplica.";
  } else if (blockedByUnsuitableMarket) {
    statusKey = "shadow_market_unsuitable";
    title = "Mercado no apto";
    plainSummary = "El Grid está activo y en SHADOW, pero las condiciones de mercado no son aptas para generar un rango.";
    plainProblem = diagnostic.humanProblem;
    plainNextAction = diagnostic.humanNextStep;
    canAnalyzeNow = true;
    canGenerateSimulatedRange = true;
  } else if (repeatedCompactEventsCount > 0 || notViableEventsCount > 0) {
    statusKey = "shadow_compact_not_viable";
    title = "Rango no viable";
    plainSummary = "El Grid está activo y en SHADOW, pero la configuración actual no permite encajar un rango rentable.";
    plainProblem = diagnostic.humanProblem;
    plainNextAction = diagnostic.humanNextStep;
    canAnalyzeNow = true;
    canGenerateSimulatedRange = true;
  } else if (hasActiveRange && hasLevels) {
    statusKey = "shadow_has_range";
    title = "Rango activo";
    plainSummary = `El Grid está activo, en SHADOW y tiene un rango activo con ${diagnostic.levelsGenerated} niveles. No hay órdenes reales.`;
    plainProblem = null;
    plainNextAction = "Revisa la pestaña Niveles y Actividad para ver el estado de la simulación.";
    canAnalyzeNow = true;
    canGenerateSimulatedRange = true;
  } else if (hasActiveRange && !hasLevels) {
    statusKey = "shadow_no_levels";
    title = "Rango activo, sin niveles";
    plainSummary = "El Grid tiene un rango activo pero todavía no ha generado niveles.";
    plainProblem = diagnostic.humanProblem;
    plainNextAction = diagnostic.humanNextStep;
    canAnalyzeNow = true;
    canGenerateSimulatedRange = true;
  } else {
    statusKey = "shadow_waiting_for_range";
    title = "Esperando rango";
    plainSummary = "El Grid está activo y en SHADOW, pero ahora mismo no tiene un rango de precios cargado.";
    plainProblem = diagnostic.humanProblem;
    plainNextAction = diagnostic.humanNextStep;
    canAnalyzeNow = true;
    canGenerateSimulatedRange = true;
  }

  return {
    status: statusKey,
    title,
    plainSummary,
    plainProblem,
    plainNextAction,
    canAnalyzeNow,
    canGenerateSimulatedRange,
    canTradeReal: false,
    safe: realOrdersCount === 0 && openCycles === 0,
    hasRealOrders: realOrdersCount > 0,
    hasOpenCycles: openCycles > 0,
    hasActiveRange,
  };
}

function buildDiagnosticBand(
  activeRange: GridActiveRangeView,
  adaptiveDecision: any,
  professionalGenerator: any,
  marketContext: any,
  config: any,
  diagnostic: GridLatestDiagnostic
): GridDiagnosticBand {
  const currentPrice = toNum(marketContext?.currentPrice);
  const netProfitTargetPct = toNum(config?.netProfitTargetPct) ?? 0.8;
  const minSpacingPctReal = toNum(adaptiveDecision?.minSpacingPctReal) ?? toNum(professionalGenerator?.minSpacingPctReal);

  // CASE A: activeRange exists
  if (activeRange.exists && activeRange.lowerPrice != null && activeRange.upperPrice != null) {
    return {
      exists: true,
      status: "active",
      lowerPrice: activeRange.lowerPrice,
      centerPrice: activeRange.centerPrice,
      upperPrice: activeRange.upperPrice,
      widthPct: activeRange.widthPct,
      requiredRangePct: adaptiveDecision?.rangeNeededForMinViableLevelsPct ?? null,
      allowedRangePct: adaptiveDecision?.regimeMaxPct ?? null,
      finalRangePct: adaptiveDecision?.finalRangePct ?? activeRange.widthPct,
      buyLevelsWouldFit: adaptiveDecision?.buyLevelsWouldFit ?? null,
      sellLevelsWouldFit: adaptiveDecision?.sellLevelsWouldFit ?? null,
      requestedBuyLevels: adaptiveDecision?.requestedBuyLevels ?? null,
      requestedSellLevels: adaptiveDecision?.requestedSellLevels ?? null,
      generatedBuyLevels: professionalGenerator?.generatedBuyLevels ?? null,
      generatedSellLevels: professionalGenerator?.generatedSellLevels ?? null,
      reason: "Rango activo cargado en el motor.",
      plainExplanation: "El Grid tiene un rango activo y está operando en modo simulación (SHADOW).",
      nextAction: "Revisa los niveles y la actividad para ver el estado de la simulación.",
      source: "active_range",
    };
  }

  // CASE B/C: no activeRange, but adaptiveDecision exists
  if (adaptiveDecision) {
    const finalRangePct = toNum(adaptiveDecision.finalRangePct);
    const adaptiveOk = adaptiveDecision.adaptiveRangeOk === true;
    const regimeMaxPct = toNum(adaptiveDecision.regimeMaxPct);
    const rangeNeededForMinViable = toNum(adaptiveDecision.rangeNeededForMinViableLevelsPct);

    // Try to get lower/center/upper from operational fields
    // Treat 0 as invalid (not null) — 0 means the field was sent but has no real value
    let lowerPrice = toNum(adaptiveDecision.operationalLower);
    let upperPrice = toNum(adaptiveDecision.operationalUpper);
    let centerPrice = toNum(adaptiveDecision.centerPrice) ?? toNum(professionalGenerator?.centerPrice);

    // Treat 0 prices as invalid
    if (lowerPrice != null && lowerPrice <= 0) lowerPrice = null;
    if (upperPrice != null && upperPrice <= 0) upperPrice = null;
    if (centerPrice != null && centerPrice <= 0) centerPrice = null;

    // If no valid operational prices, calculate from centerPrice or currentPrice + finalRangePct
    if ((lowerPrice == null || upperPrice == null) && (centerPrice != null || currentPrice != null) && finalRangePct != null && finalRangePct > 0) {
      const refPrice = centerPrice ?? currentPrice!;
      const halfPct = finalRangePct / 200;
      lowerPrice = refPrice * (1 - halfPct);
      upperPrice = refPrice * (1 + halfPct);
      centerPrice = centerPrice ?? refPrice;
    }

    const widthPct = lowerPrice != null && upperPrice != null && centerPrice != null && centerPrice > 0
      ? ((upperPrice - lowerPrice) / centerPrice) * 100 : finalRangePct;

    const hasCalculatedBand = lowerPrice != null && upperPrice != null && centerPrice != null;

    if (adaptiveOk) {
      // Band is viable but not activated
      return {
        exists: true,
        status: "calculated_not_active",
        lowerPrice,
        centerPrice,
        upperPrice,
        widthPct,
        requiredRangePct: rangeNeededForMinViable,
        allowedRangePct: regimeMaxPct,
        finalRangePct,
        buyLevelsWouldFit: adaptiveDecision.buyLevelsWouldFit ?? null,
        sellLevelsWouldFit: adaptiveDecision.sellLevelsWouldFit ?? null,
        requestedBuyLevels: adaptiveDecision.requestedBuyLevels ?? null,
        requestedSellLevels: adaptiveDecision.requestedSellLevels ?? null,
        generatedBuyLevels: professionalGenerator?.generatedBuyLevels ?? null,
        generatedSellLevels: professionalGenerator?.generatedSellLevels ?? null,
        reason: adaptiveDecision.reason ?? "El motor calculó una banda viable pero no la activó automáticamente.",
        plainExplanation: "El Grid ha calculado una zona orientativa viable, pero no la ha activado porque necesita confirmación o aún no se han dado las condiciones para activarla.",
        nextAction: "Pulsa \"Analizar mercado ahora\" para forzar una nueva evaluación, o ajusta la configuración si quieres que el motor active el rango.",
        source: "last_adaptive_decision",
      };
    }

    // Not viable
    if (hasCalculatedBand) {
      const requiredRangePct = rangeNeededForMinViable;
      const allowedRangePct = regimeMaxPct;
      const difference = requiredRangePct != null && allowedRangePct != null
        ? requiredRangePct - allowedRangePct : null;

      let plainExplanation = "Con los ajustes actuales, el Grid no puede crear una banda rentable y segura.";
      if (difference != null && difference > 0 && requiredRangePct != null && allowedRangePct != null) {
        plainExplanation += ` El rango que permite la configuración (${Number(allowedRangePct).toFixed(2)}%) es menor que el rango necesario para el mínimo de niveles (${Number(requiredRangePct).toFixed(2)}%).`;
      }
      if (minSpacingPctReal != null && netProfitTargetPct != null) {
        plainExplanation += ` El objetivo neto de ${Number(netProfitTargetPct).toFixed(2)}% exige una separación mínima de ${Number(minSpacingPctReal).toFixed(2)}% entre niveles.`;
      }

      return {
        exists: true,
        status: "not_viable",
        lowerPrice,
        centerPrice,
        upperPrice,
        widthPct,
        requiredRangePct,
        allowedRangePct,
        finalRangePct,
        buyLevelsWouldFit: adaptiveDecision.buyLevelsWouldFit ?? null,
        sellLevelsWouldFit: adaptiveDecision.sellLevelsWouldFit ?? null,
        requestedBuyLevels: adaptiveDecision.requestedBuyLevels ?? null,
        requestedSellLevels: adaptiveDecision.requestedSellLevels ?? null,
        generatedBuyLevels: professionalGenerator?.generatedBuyLevels ?? null,
        generatedSellLevels: professionalGenerator?.generatedSellLevels ?? null,
        reason: adaptiveDecision.reason ?? "No viable con la configuración actual.",
        plainExplanation,
        nextAction: "Revisa las recomendaciones de configuración: bajar el objetivo neto o ampliar el rango máximo.",
        source: "last_adaptive_decision",
      };
    }
  }

  // Check professionalGenerator for compact/not_viable
  if (professionalGenerator?.available) {
    const pgLower = toNum(professionalGenerator.operationalLower);
    const pgUpper = toNum(professionalGenerator.operationalUpper);
    const pgCenter = toNum(professionalGenerator.centerPrice);
    const viability = professionalGenerator.viabilityStatus;

    if (pgLower != null && pgUpper != null && pgCenter != null && pgLower > 0 && pgUpper > pgLower) {
      const widthPct = ((pgUpper - pgLower) / pgCenter) * 100;
      return {
        exists: true,
        status: viability === "compact" || viability === "not_viable" ? "not_viable" : "calculated_not_active",
        lowerPrice: pgLower,
        centerPrice: pgCenter,
        upperPrice: pgUpper,
        widthPct,
        requiredRangePct: adaptiveDecision?.rangeNeededForMinViableLevelsPct ?? null,
        allowedRangePct: adaptiveDecision?.regimeMaxPct ?? null,
        finalRangePct: toNum(professionalGenerator.operationalBandWidthPct) ?? widthPct,
        buyLevelsWouldFit: adaptiveDecision?.buyLevelsWouldFit ?? null,
        sellLevelsWouldFit: adaptiveDecision?.sellLevelsWouldFit ?? null,
        requestedBuyLevels: professionalGenerator.requestedBuyLevels ?? null,
        requestedSellLevels: professionalGenerator.requestedSellLevels ?? null,
        generatedBuyLevels: professionalGenerator.generatedBuyLevels ?? null,
        generatedSellLevels: professionalGenerator.generatedSellLevels ?? null,
        reason: professionalGenerator.reason ?? "El rango permitido solo deja espacio para muy pocos niveles.",
        plainExplanation: "El motor de cálculo evaluó el mercado, pero el rango permitido es demasiado estrecho para crear una estructura completa de niveles rentables.",
        nextAction: "Revisa las recomendaciones: bajar el objetivo neto o ampliar el rango máximo permitiría más niveles.",
        source: "professional_generator",
      };
    }
  }

  // Check if market is unsuitable
  if (diagnostic.professionalGeneratorViabilityStatus === "market_unsuitable" || diagnostic.lastTickReason?.startsWith("Condiciones de mercado no válidas")) {
    return {
      exists: false,
      status: "market_unsuitable",
      lowerPrice: null,
      centerPrice: null,
      upperPrice: null,
      widthPct: null,
      requiredRangePct: null,
      allowedRangePct: null,
      finalRangePct: null,
      buyLevelsWouldFit: null,
      sellLevelsWouldFit: null,
      requestedBuyLevels: null,
      requestedSellLevels: null,
      generatedBuyLevels: null,
      generatedSellLevels: null,
      reason: "Las condiciones de mercado no son aptas para el Grid en este momento.",
      plainExplanation: "El motor analizó el mercado, pero las condiciones actuales no son adecuadas para crear una banda.",
      nextAction: "Espera a que el mercado cambie o ajusta la configuración del rango.",
      source: "none",
    };
  }

  // CASE D: no diagnostic at all
  return {
    exists: false,
    status: "not_enough_data",
    lowerPrice: null,
    centerPrice: null,
    upperPrice: null,
    widthPct: null,
    requiredRangePct: null,
    allowedRangePct: null,
    finalRangePct: null,
    buyLevelsWouldFit: null,
    sellLevelsWouldFit: null,
    requestedBuyLevels: null,
    requestedSellLevels: null,
    generatedBuyLevels: null,
    generatedSellLevels: null,
    reason: "No hay análisis de banda todavía.",
    plainExplanation: "El motor aún no ha evaluado el mercado. Pulsa \"Analizar mercado ahora\" para generar un diagnóstico.",
    nextAction: "Pulsa \"Analizar mercado ahora\" para que el motor evalúe el mercado y calcule una banda.",
    source: "none",
  };
}

function buildRecommendations(
  config: any,
  auditData: any,
  diagnostic: GridLatestDiagnostic
): any[] {
  return buildGridConfigRecommendations({
    config: config || {},
    draft: {},
    auditData: auditData || {},
    diagnostic,
  });
}

export function buildGridAuditViewModel(
  mode: string,
  config: any,
  status: any,
  levels: any[],
  cycles: any[],
  events: any[],
  resolvedRange: any,
  marketContext: any,
  lastShadowValidation: { at: Date | null; result: any },
  lastProfessionalValidation: { at: Date | null; result: any },
  providedProfessionalGenerator: any = null,
  providedRangeLifecycle: any = null
): GridAuditViewModel {
  const activeRange = buildActiveRangeView(status, resolvedRange, marketContext?.currentPrice ?? null);
  const counters = buildCounters(status, levels, cycles);
  const adaptiveDecision = (lastProfessionalValidation.result as any)?.adaptiveRangeDecision ?? null;

  const openCyclesCount = cycles.filter((c: any) => c?.status === "open" || c?.status === "active").length;
  const activeOpenCyclesCount = activeRange.id
    ? cycles.filter((c: any) => c?.rangeVersionId === activeRange.id && ["open", "active", "buy_filled", "buy_placed", "sell_placed", "cycle_open"].includes(c?.status)).length
    : 0;
  const globalOpenCyclesCount = openCyclesCount;

  const professionalGenerator = providedProfessionalGenerator ?? extractProfessionalGeneratorFromEvents(events, status?.activeRangeVersionId ?? null);

  const rangeLifecycle = providedRangeLifecycle ?? (
    marketContext
      ? buildRangeLifecycle(
          mode,
          config,
          resolvedRange,
          marketContext,
          professionalGenerator,
          openCyclesCount,
          activeOpenCyclesCount,
          globalOpenCyclesCount,
          adaptiveDecision
        )
      : null
  );

  const latestGridDiagnostic = buildLatestGridDiagnostic(
    mode,
    config,
    status,
    events,
    levels,
    cycles,
    resolvedRange,
    marketContext,
    lastShadowValidation,
    lastProfessionalValidation,
    rangeLifecycle
  );

  const currentOperationalState = buildCurrentOperationalState(mode, config, status, latestGridDiagnostic, counters, events);

  const auditDataForRecommendations = {
    professionalGenerator,
    rangeIntelligence: {
      lastAdaptiveRangeDecision: adaptiveDecision,
    },
    marketContext,
    summary: status,
    latestGridDiagnostic,
    activeRange,
  };

  const recommendations = buildRecommendations(config, auditDataForRecommendations, latestGridDiagnostic);

  const diagnosticBand = buildDiagnosticBand(
    activeRange,
    adaptiveDecision,
    professionalGenerator,
    marketContext,
    config,
    latestGridDiagnostic
  );

  const operational = buildGridOperationalViewModel({
    mode,
    config,
    status,
    levels,
    cycles,
    events,
    marketContext,
    currentOperationalState,
    recommendations,
    resolvedRange,
    adaptiveDecision,
    professionalGenerator,
    lastProfessionalValidationAt: lastProfessionalValidation.at,
    lastShadowValidationAt: lastShadowValidation.at,
  });

  return {
    currentOperationalState,
    activeRange,
    counters,
    latestGridDiagnostic,
    recommendations,
    diagnosticBand,
    operational,
  };
}
