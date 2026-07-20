/**
 * buildGridOperationalViewModel.ts
 *
 * Single source of truth for the new, simplified Grid UX.
 * It receives the same raw data as the audit view model and returns
 * a canonical, UI-ready object that every new React component must consume.
 *
 * This module is intentionally pure: no DB access, no side effects,
 * no order placement, no state mutation. It only classifies and labels data.
 */

import { executionPolicyLabel, type ExecutionPolicy, type GridCycleRiskState, type GridClosePath } from "./gridIsolatedTypes";
import { buildGridMarketViewModel, type GridMarketViewModel } from "./buildGridMarketViewModel";

export type CycleRangeRelation = "current" | "previous" | "unknown";

export interface OperationalHeader {
  title: string;
  pair: string;
  mode: string;
  modeLabel: string;
  isActive: boolean;
  isRunning: boolean;
  stateLabel: string;
  currentPrice: number | null;
  currentBid: number | null;
  currentAsk: number | null;
  priceSource: string | null;
  priceFresh: boolean;
  priceAgeMs: number | null;
  priceMaxAgeMs: number | null;
  openCycles: number;
  totalNetPnlUsd: number;
  realizedNetPnlUsd: number;
  openEstimatedNetPnlUsd: number;
  realOpenOrdersCount: number;
  executionPolicy: ExecutionPolicy;
  executionPolicyLabel: string;
  takerFallbackEnabled: boolean;
  takerFallbackAllowed: boolean;
  makerOnly: boolean;
}

export interface OperationalOverview {
  statusKey: string;
  title: string;
  summary: string;
  problem: string | null;
  nextAction: string;
  hasOpenCycles: boolean;
  openCycles: number;
  hasActiveRange: boolean;
  canAnalyzeNow: boolean;
  primaryRecommendation: OperationalRecommendation | null;
}

export interface OperationalRecommendation {
  id: string;
  title: string;
  explanation: string;
  severity: "info" | "warning" | "error" | "success";
  ctaLabel?: string;
  ctaTarget?: string;
}

export interface OperationalOpenCycle {
  id: string;
  cycleNumber: number;
  pair: string;
  status: string;
  statusLabel: string;
  color: "green" | "cyan" | "amber" | "red";
  buyPrice: number | null;
  quantity: number | null;
  targetSellPrice: number | null;
  targetSellQuantity: number | null;
  currentPrice: number | null;
  currentBid: number | null;
  progressPct: number | null;
  distanceUsd: number | null;
  distancePct: number | null;
  estimatedGrossPnl: number | null;
  estimatedFee: number | null;
  estimatedTax: number | null;
  estimatedNetPnl: number | null;
  /** Operational cost estimate (spread + safety buffer) from the V2 target calculation. */
  estimatedOperationalCost: number | null;
  openedAt: string | null;
  durationLabel: string;
  rangeVersionId: string | null;
  rangeRelation: CycleRangeRelation;
  rangeLabel: string;
  targetSource: string | null;
  exitPolicyVersion: string | null;
  targetKind: string | null;
  targetRungLevelId: string | null;
  requiresReview: boolean;
  targetReached: boolean;
  executable: boolean;
  riskState: GridCycleRiskState | null;
  riskStateLabel: string | null;
  activeExitRoute: GridClosePath | null;
  activeExitRouteLabel: string | null;
  buyLevelId: string | null;
  sellLevelId: string | null;
  targetSellLevelId: string | null;
}

export interface OperationalLevel {
  id: string;
  levelIndex: number | null;
  side: "BUY" | "SELL" | string;
  price: number | null;
  quantity: number | null;
  status: string;
  statusLabel: string;
  rangeVersionId: string | null;
  rangeRelation: CycleRangeRelation;
  cycleNumber: number | null;
  cycleId: string | null;
  targetOfOpenCycle: boolean;
  estimatedNetProfit: number | null;
  createdAt: string | null;
}

export interface OperationalLevels {
  activeRangeLevels: OperationalLevel[];
  openCycleTargetLevels: OperationalLevel[];
  historicalLevels: OperationalLevel[];
  allLevels: OperationalLevel[];
}

export interface OperationalCapital {
  configuredInitial: number;
  configuredMax: number;
  reservedUsd: number;
  freeUsd: number;
  accumulatedProfit: number;
  currency: string;
}

export interface OperationalNotificationGroup {
  severity: "info" | "warning" | "error" | "success" | "shadow";
  title: string;
  count: number;
  items: OperationalNotification[];
}

export interface OperationalNotification {
  id: string;
  severity: OperationalNotificationGroup["severity"];
  title: string;
  shortText: string;
  explanation: string;
  consequence: string;
  recommendedAction: string;
  technicalReason: string | null;
  count?: number;
  lastAt?: string | null;
  ctaLabel?: string;
  ctaTarget?: string;
}

export interface OperationalSettingsProfile {
  simple: {
    capitalMax: number;
    minViableLevels: number;
    netProfitTargetPct: number;
    rangeProfile: string;
    protection: "hold" | "stop";
    reinvestProfits: boolean;
  };
  expertBlocks: ExpertBlockConfig[];
}

export interface ExpertBlockConfig {
  id: string;
  title: string;
  description: string;
  fields: string[];
}

export interface GridOperationalViewModel {
  header: OperationalHeader;
  overview: OperationalOverview;
  openCycles: OperationalOpenCycle[];
  closedCycles: OperationalOpenCycle[];
  cancelledCycles: OperationalOpenCycle[];
  currentRange: {
    exists: boolean;
    message: string;
    subtitle: string | null;
    lowerPrice: number | null;
    centerPrice: number | null;
    upperPrice: number | null;
    widthPct: number | null;
  };
  levels: OperationalLevels;
  capital: OperationalCapital;
  notifications: OperationalNotificationGroup[];
  execution: {
    policy: ExecutionPolicy;
    policyLabel: string;
    storedPolicy: string | null;
    takerFallbackEnabled: boolean;
    takerFallbackAllowed: boolean;
    makerOnly: boolean;
    takerFallbackLabel: string;
  };
  settings: OperationalSettingsProfile;
  market: GridMarketViewModel;
}

const FEE_BUY_PCT = 0.09;
const FEE_SELL_PCT = 0.09;
const TAX_RESERVE_PCT = 20;

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function fmtDuration(fromIso: string | null, toMs: number | null = null): string {
  if (!fromIso) return "—";
  const d = new Date(fromIso).getTime();
  if (Number.isNaN(d)) return "—";
  const diffMs = Math.max(0, (toMs ?? Date.now()) - d);
  const totalMin = Math.floor(diffMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h === 0) parts.push(`${m}m`);
  return parts.join(" ");
}

function toRangeRelation(
  cycle: any,
  activeRangeVersionId: string | null
): CycleRangeRelation {
  if (!cycle?.rangeVersionId || !activeRangeVersionId) return "previous";
  return cycle.rangeVersionId === activeRangeVersionId ? "current" : "previous";
}

function statusColor(status: string, requiresReview: boolean): OperationalOpenCycle["color"] {
  if (requiresReview) return "red";
  if (status === "completed") return "green";
  if (["open", "active", "buy_filled", "buy_placed", "sell_placed"].includes(status)) return "cyan";
  if (["cancelled", "error"].includes(status)) return "red";
  return "amber";
}

function cycleRangeLabel(relation: CycleRangeRelation): string {
  if (relation === "current") return "Rango vigente";
  return "Rango anterior (gestión activa)";
}

function feeUsd(amountUsd: number): number {
  return amountUsd * ((FEE_BUY_PCT + FEE_SELL_PCT) / 100);
}

function taxReserve(grossPnl: number): number {
  if (grossPnl <= 0) return 0;
  return grossPnl * (TAX_RESERVE_PCT / 100);
}

function extractTargetCalculation(cycle: any): { operationalCostsUsd?: number; exchangeFeesUsd?: number } | null {
  if (!cycle?.targetCalculationJson) return null;
  try {
    return typeof cycle.targetCalculationJson === "string"
      ? JSON.parse(cycle.targetCalculationJson)
      : cycle.targetCalculationJson;
  } catch {
    return null;
  }
}

function parseRiskState(cycle: any): GridCycleRiskState | null {
  if (!cycle?.riskStateJson) return null;
  try {
    const parsed = typeof cycle.riskStateJson === "string" ? JSON.parse(cycle.riskStateJson) : cycle.riskStateJson;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as GridCycleRiskState;
  } catch {
    return null;
  }
}

function riskStateSummary(risk: GridCycleRiskState | null): string | null {
  if (!risk) return null;
  if (risk.hodl?.active) return "HODL recovery";
  if (risk.trailing?.activated) return "Trailing activo";
  if (risk.stopLoss?.some(l => l.triggered)) return "Stop-loss disparado";
  if (risk.lastAction) return risk.lastAction;
  return null;
}

function closePathLabel(path: GridClosePath | null): string | null {
  switch (path) {
    case "NORMAL_TARGET": return "Target normal";
    case "TRAILING_MAKER": return "Trailing maker";
    case "PROTECTIVE_MAKER": return "Stop-loss maker";
    case "HODL_RECOVERY": return "Recuperación HODL";
    default: return null;
  }
}

function translateStatus(status: string): string {
  switch (status) {
    case "open":
    case "active":
    case "buy_placed":
    case "sell_placed":
    case "cycle_open":
      return "Esperando venta";
    case "buy_filled":
      return "Esperando precio de venta";
    case "completed":
    case "closed":
      return "Venta simulada completada";
    case "stop_loss_hit":
      return "Stop-loss ejecutado";
    case "trailing_closed":
      return "Cerrado por trailing";
    case "hodl_recovery":
      return "Recuperación HODL";
    case "cancelled":
      return "Cancelado";
    case "error":
      return "Error";
    default:
      return status || "Desconocido";
  }
}

function computeCycleEstimates(
  cycle: any,
  currentPrice: number | null,
  currentBid: number | null
): Pick<
  OperationalOpenCycle,
  | "estimatedGrossPnl"
  | "estimatedFee"
  | "estimatedTax"
  | "estimatedNetPnl"
  | "estimatedOperationalCost"
  | "progressPct"
  | "distanceUsd"
  | "distancePct"
  | "targetReached"
> {
  const buy = toNum(cycle?.buyPrice);
  const qty = toNum(cycle?.quantity);
  const sell = toNum(cycle?.targetSellPrice ?? cycle?.sellPrice);
  const price = currentBid ?? currentPrice;

  if (buy == null || qty == null || sell == null) {
    return {
      estimatedGrossPnl: null,
      estimatedFee: null,
      estimatedTax: null,
      estimatedNetPnl: null,
      estimatedOperationalCost: null,
      progressPct: null,
      distanceUsd: null,
      distancePct: null,
      targetReached: false,
    };
  }

  const capital = buy * qty;
  const grossIfSold = (sell - buy) * qty;
  const fee = feeUsd(capital + sell * qty);
  const tax = taxReserve(Math.max(0, grossIfSold));
  const net = grossIfSold - fee - tax;

  const targetCalc = extractTargetCalculation(cycle);
  const operationalCost = targetCalc?.operationalCostsUsd ?? null;

  const distanceUsd = sell - (price ?? buy);
  const distancePct = buy > 0 ? (distanceUsd / buy) * 100 : null;
  const progressUsd = price != null ? price - buy : 0;
  const totalDistanceUsd = sell - buy;
  const progressPct = totalDistanceUsd > 0 ? Math.max(0, Math.min(100, (progressUsd / totalDistanceUsd) * 100)) : null;
  const targetReached = price != null && price >= sell;

  return {
    estimatedGrossPnl: grossIfSold,
    estimatedFee: fee,
    estimatedTax: tax,
    estimatedNetPnl: net,
    estimatedOperationalCost: operationalCost,
    progressPct,
    distanceUsd,
    distancePct,
    targetReached,
  };
}

function buildOpenCycle(
  cycle: any,
  activeRangeVersionId: string | null,
  currentPrice: number | null,
  currentBid: number | null
): OperationalOpenCycle {
  const relation = toRangeRelation(cycle, activeRangeVersionId);
  const buy = toNum(cycle?.buyPrice);
  const qty = toNum(cycle?.quantity);
  const estimates = computeCycleEstimates(cycle, currentPrice, currentBid);
  const status = cycle?.status ?? "unknown";
  const requiresReview = cycle?.requiresReview === true;

  const targetKind = cycle?.targetKind ?? null;
  const exitPolicyVersion = cycle?.exitPolicyVersion ?? null;
  const targetSource =
    cycle?.targetSource ??
    (targetKind === "SYNTHETIC_RUNG"
      ? "synthetic_rung"
      : targetKind === "PERSISTED_SELL"
        ? "persisted_sell"
        : cycle?.targetSellLevelId
          ? "range"
          : null);

  const risk = parseRiskState(cycle);

  return {
    id: cycle?.id ?? String(cycle?.cycleNumber ?? "?"),
    cycleNumber: cycle?.cycleNumber ?? 0,
    pair: cycle?.pair ?? "BTC/USD",
    status,
    statusLabel: translateStatus(status),
    color: statusColor(status, requiresReview),
    buyPrice: buy,
    quantity: qty,
    targetSellPrice: toNum(cycle?.targetSellPrice ?? cycle?.sellPrice),
    targetSellQuantity: toNum(cycle?.targetSellQuantity ?? cycle?.quantity),
    currentPrice,
    currentBid,
    progressPct: estimates.progressPct,
    distanceUsd: estimates.distanceUsd,
    distancePct: estimates.distancePct,
    estimatedGrossPnl: estimates.estimatedGrossPnl,
    estimatedFee: estimates.estimatedFee,
    estimatedTax: estimates.estimatedTax,
    estimatedNetPnl: estimates.estimatedNetPnl,
    estimatedOperationalCost: estimates.estimatedOperationalCost,
    openedAt: cycle?.openedAt ?? cycle?.buyFilledAt ?? cycle?.createdAt ?? null,
    durationLabel: fmtDuration(cycle?.openedAt ?? cycle?.buyFilledAt ?? cycle?.createdAt ?? null),
    rangeVersionId: cycle?.rangeVersionId ?? null,
    rangeRelation: relation,
    rangeLabel: cycleRangeLabel(relation),
    targetSource,
    exitPolicyVersion,
    targetKind,
    targetRungLevelId: cycle?.targetRungLevelId ?? null,
    requiresReview,
    targetReached: estimates.targetReached,
    executable: status === "buy_filled" || status === "open" || status === "active" || status === "sell_placed" || status === "hodl_recovery",
    riskState: risk,
    riskStateLabel: riskStateSummary(risk),
    activeExitRoute: risk?.activeExitRoute ?? null,
    activeExitRouteLabel: closePathLabel(risk?.activeExitRoute ?? null),
    buyLevelId: cycle?.buyLevelId ?? null,
    sellLevelId: cycle?.sellLevelId ?? null,
    targetSellLevelId: cycle?.targetSellLevelId ?? null,
  };
}

function buildOperationalLevel(
  level: any,
  activeRangeVersionId: string | null,
  openCycleTargetLevelIds: Set<string>,
  cycleById: Map<string, any>
): OperationalLevel {
  const relation: CycleRangeRelation =
    !level?.rangeVersionId || !activeRangeVersionId
      ? "previous"
      : level.rangeVersionId === activeRangeVersionId
        ? "current"
        : "previous";

  const side = (level?.side ?? "BUY").toUpperCase();
  const targetOfOpenCycle = openCycleTargetLevelIds.has(level?.id);
  const cycleId = level?.cycleId ?? level?.associatedCycleId ?? null;
  const cycle = cycleId ? cycleById.get(cycleId) : undefined;

  return {
    id: level?.id ?? "",
    levelIndex: toNum(level?.levelIndex) ?? null,
    side,
    price: toNum(level?.price ?? level?.buyPrice ?? level?.sellPrice),
    quantity: toNum(level?.quantity),
    status: level?.status ?? "planned",
    statusLabel: translateLevelStatus(level?.status),
    rangeVersionId: level?.rangeVersionId ?? null,
    rangeRelation: relation,
    cycleNumber: cycle?.cycleNumber ?? null,
    cycleId: cycleId ?? null,
    targetOfOpenCycle,
    estimatedNetProfit: toNum(level?.netProfitTargetUsd ?? level?.netProfitUsd),
    createdAt: level?.createdAt ?? null,
  };
}

function translateLevelStatus(status: string | null): string {
  switch (status) {
    case "planned":
      return "Planificado";
    case "open":
    case "active":
      return "Activo";
    case "filled":
      return "Ejecutado";
    case "replaced":
      return "Reemplazado";
    case "cancelled":
      return "Cancelado";
    case "expired":
      return "Expirado";
    default:
      return status || "—";
  }
}

function buildCapital(config: any, status: any, openCycles: OperationalOpenCycle[]): OperationalCapital {
  const initial = toNum(config?.gridWalletInitialUsd) ?? 1000;
  const max = toNum(config?.gridWalletMaxUsd) ?? 5000;
  const reserved = openCycles.reduce((sum, c) => {
    const buy = c.buyPrice ?? 0;
    const qty = c.quantity ?? 0;
    return sum + buy * qty;
  }, 0);
  const accumulated = toNum(status?.totalNetPnlUsd) ?? 0;
  const free = Math.max(0, max - reserved);

  return {
    configuredInitial: initial,
    configuredMax: max,
    reservedUsd: reserved,
    freeUsd: free,
    accumulatedProfit: accumulated,
    currency: "USD",
  };
}

function deduplicateEvents(events: any[]): OperationalNotificationGroup[] {
  const groups = new Map<string, OperationalNotification>();

  for (const ev of events || []) {
    const type = ev?.eventType ?? "UNKNOWN";
    const severity = eventSeverity(type);
    const key = `${severity}:${type}`;
    const existing = groups.get(key);
    const createdAt = ev?.createdAt ? new Date(ev.createdAt).toISOString() : null;
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
      if (createdAt && (existing.lastAt == null || createdAt > existing.lastAt)) {
        existing.lastAt = createdAt;
      }
      continue;
    }

    const { title, shortText, explanation, consequence, action } = eventMeta(type, ev);
    groups.set(key, {
      id: `event-${type}`,
      severity,
      title,
      shortText,
      explanation,
      consequence,
      recommendedAction: action,
      technicalReason: type,
      count: 1,
      lastAt: createdAt,
    });
  }

  const groupedBySeverity = new Map<OperationalNotificationGroup["severity"], OperationalNotification[]>();
  for (const n of groups.values()) {
    const list = groupedBySeverity.get(n.severity) || [];
    list.push(n);
    groupedBySeverity.set(n.severity, list);
  }

  const order: OperationalNotificationGroup["severity"][] = ["error", "warning", "info", "success", "shadow"];
  return order
    .filter((s) => (groupedBySeverity.get(s) || []).length > 0)
    .map((severity) => {
      const items = groupedBySeverity.get(severity) || [];
      return {
        severity,
        title: groupTitle(severity),
        count: items.reduce((sum, n) => sum + (n.count ?? 1), 0),
        items,
      };
    });
}

function eventSeverity(eventType: string): OperationalNotification["severity"] {
  if (eventType.includes("ERROR") || eventType.includes("FAIL") || eventType.includes("BREAKER")) return "error";
  if (eventType.includes("NOT_VIABLE") || eventType.includes("COMPACT") || eventType.includes("WARNING") || eventType.includes("STALE")) return "warning";
  if (eventType.includes("SUCCESS") || eventType.includes("COMPLETED") || eventType.includes("CLOSED")) return "success";
  if (eventType.includes("SHADOW")) return "shadow";
  return "info";
}

function groupTitle(severity: OperationalNotification["severity"]): string {
  switch (severity) {
    case "error":
      return "Requiere atención";
    case "warning":
      return "Recomendaciones";
    case "success":
      return "Completado";
    case "shadow":
      return "Información";
    default:
      return "Información";
  }
}

function eventMeta(eventType: string, ev: any) {
  switch (eventType) {
    case "GRID_PROFESSIONAL_GENERATOR_NOT_VIABLE":
      return {
        title: "Rango no viable",
        shortText: "El mercado no permite un rango rentable con los ajustes actuales.",
        explanation: "El motor evaluó el mercado y no pudo construir una banda que cumpla el objetivo neto y la separación mínima.",
        consequence: "No se generarán nuevas compras hasta que cambien el mercado o la configuración.",
        action: "Revisa el objetivo neto o amplía el rango máximo.",
      };
    case "GRID_PROFESSIONAL_GENERATOR_COMPACT":
      return {
        title: "Rango muy estrecho",
        shortText: "El rango calculado es demasiado estrecho para el número de niveles deseado.",
        explanation: "La configuración pide más niveles de los que caben rentablemente en la banda actual.",
        consequence: "El motor reduce niveles o no activa el rango.",
        action: "Reduce el número de niveles o amplía el rango.",
      };
    case "GRID_SHADOW_CYCLE_COMPLETED":
      return {
        title: "Ciclo completado en SHADOW",
        shortText: `Ciclo #${ev?.cycleNumber ?? "?"} cerrado en simulación.`,
        explanation: "Una operación simulada alcanzó el objetivo de venta.",
        consequence: "Se contabiliza PnL de simulación, sin ordenes reales.",
        action: "Revisa el historial de ciclos.",
      };
    case "GRID_CYCLE_TARGET_REVIEW_REQUIRED":
      return {
        title: "Ciclo requiere revisión",
        shortText: `Ciclo #${ev?.cycleNumber ?? "?"} no pudo resolver su target de venta automáticamente.`,
        explanation: "El sistema no encontró un único candidato SELL válido en el rango histórico.",
        consequence: "El ciclo no se cerrará solo hasta que se revise.",
        action: "Revisa el ciclo y su rango de origen.",
      };
    default:
      return {
        title: eventType,
        shortText: ev?.message || "Evento del motor Grid.",
        explanation: "Evento interno del motor.",
        consequence: "Sin acción requerida salvo indicación contraria.",
        action: "Consulta el detalle técnico si es necesario.",
      };
  }
}

export interface BuildGridOperationalViewModelInput {
  mode: string;
  config: any;
  status: any;
  levels: any[];
  cycles: any[];
  events: any[];
  marketContext: any;
  currentOperationalState: any;
  recommendations: any[];
  resolvedRange?: any;
  adaptiveDecision?: any;
  professionalGenerator?: any;
  lastProfessionalValidationAt?: Date | string | null;
  lastShadowValidationAt?: Date | string | null;
}

export function buildGridOperationalViewModel(input: BuildGridOperationalViewModelInput): GridOperationalViewModel {
  const {
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
    lastProfessionalValidationAt,
    lastShadowValidationAt,
  } = input;

  const currentPrice = toNum(marketContext?.currentPrice ?? status?.currentPrice ?? status?.lastPrice);
  const currentBid = toNum(marketContext?.currentBid ?? status?.currentBid);
  const currentAsk = toNum(marketContext?.currentAsk ?? status?.currentAsk);
  const priceSource = marketContext?.priceSource ?? status?.priceSource ?? null;
  const priceFresh = marketContext?.priceFresh ?? status?.priceFresh ?? false;
  const priceAgeMs = toNum(marketContext?.priceAgeMs ?? status?.priceAgeMs);
  const priceMaxAgeMs = toNum(marketContext?.priceMaxAgeMs ?? status?.priceMaxAgeMs);

  const activeRangeVersionId = status?.activeRangeVersionId ?? null;
  const realOpenOrdersCount = status?.realOpenOrdersCount ?? 0;

  const storedPolicy: ExecutionPolicy = config?.executionPolicy ?? "MAKER_ONLY";
  const policy: ExecutionPolicy = mode === "SHADOW" ? "MAKER_ONLY" : storedPolicy;
  const takerFallbackEnabled = mode === "SHADOW" ? false : config?.takerFallbackEnabled === true;
  const takerFallbackAllowed = takerFallbackEnabled;
  const makerOnly = policy === "MAKER_ONLY";

  const openCycleObjects = cycles
    .filter((c: any) =>
      ["open", "active", "buy_filled", "buy_placed", "sell_placed", "cycle_open"].includes(c?.status)
    )
    .map((c: any) => buildOpenCycle(c, activeRangeVersionId, currentPrice, currentBid));

  const closedCycleObjects = cycles
    .filter((c: any) => c?.status === "completed")
    .map((c: any) => buildOpenCycle(c, activeRangeVersionId, currentPrice, currentBid));

  const cancelledCycleObjects = cycles
    .filter((c: any) => c?.status === "cancelled" || c?.status === "error")
    .map((c: any) => buildOpenCycle(c, activeRangeVersionId, currentPrice, currentBid));

  const openEstimatedNetPnlUsd = openCycleObjects.reduce((sum, c) => sum + (c.estimatedNetPnl ?? 0), 0);

  const header: OperationalHeader = {
    title: "GRID AISLADO BTC/USD",
    pair: config?.pair ?? "BTC/USD",
    mode,
    modeLabel: mode === "SHADOW" ? "Simulación (SHADOW)" : mode,
    isActive: config?.isActive ?? false,
    isRunning: status?.isRunning ?? false,
    stateLabel: mode === "OFF" ? "Detenido" : config?.isActive ? "Activo" : "Pausado",
    currentPrice,
    currentBid,
    currentAsk,
    priceSource,
    priceFresh,
    priceAgeMs,
    priceMaxAgeMs,
    openCycles: openCycleObjects.length,
    totalNetPnlUsd: toNum(status?.totalNetPnlUsd) ?? 0,
    realizedNetPnlUsd: toNum(status?.totalNetPnlUsd) ?? 0,
    openEstimatedNetPnlUsd,
    realOpenOrdersCount,
    executionPolicy: policy,
    executionPolicyLabel: executionPolicyLabel(policy),
    takerFallbackEnabled,
    takerFallbackAllowed,
    makerOnly,
  };

  const primaryRec = (recommendations || [])[0];
  const overview: OperationalOverview = {
    statusKey: currentOperationalState?.status ?? "unknown",
    title: currentOperationalState?.title ?? "Estado del Grid",
    summary: currentOperationalState?.plainSummary ?? "Sin información de estado.",
    problem: currentOperationalState?.plainProblem ?? null,
    nextAction: currentOperationalState?.plainNextAction ?? "—",
    hasOpenCycles: openCycleObjects.length > 0,
    openCycles: openCycleObjects.length,
    hasActiveRange: currentOperationalState?.hasActiveRange ?? false,
    canAnalyzeNow: currentOperationalState?.canAnalyzeNow ?? false,
    primaryRecommendation: primaryRec
      ? {
          id: primaryRec.id ?? "rec-1",
          title: primaryRec.title ?? "Recomendación",
          explanation: primaryRec.plainExplanation ?? primaryRec.expectedImpact ?? "",
          severity: mapSeverity(primaryRec.severity),
          ctaLabel: primaryRec.ctaApply || "Analizar mercado ahora",
          ctaTarget: primaryRec.targetSection || "ajustes",
        }
      : null,
  };

  const activeRangeExists = currentOperationalState?.hasActiveRange ?? false;
  const activeRange = activeRangeExists
    ? {
        exists: true,
        message: "Rango activo cargado.",
        subtitle: "El Grid está evaluando el mercado dentro de este rango.",
        lowerPrice: toNum(status?.activeRangeLowerPrice) ?? null,
        centerPrice: toNum(status?.activeRangeCenterPrice) ?? null,
        upperPrice: toNum(status?.activeRangeUpperPrice) ?? null,
        widthPct: toNum(status?.activeRangeWidthPct) ?? null,
      }
    : {
        exists: false,
        message: "No hay un rango nuevo de compras activo.",
        subtitle:
          openCycleObjects.length > 0
            ? `El Grid continúa gestionando ${openCycleObjects.length} ${openCycleObjects.length === 1 ? "operación abierta" : "operaciones abiertas"} de rangos anteriores.`
            : "No hay operaciones abiertas.",
        lowerPrice: null,
        centerPrice: null,
        upperPrice: null,
        widthPct: null,
      };

  const cycleById = new Map<string, any>();
  for (const c of cycles || []) {
    if (c?.id) cycleById.set(c.id, c);
    if (c?.buyLevelId) cycleById.set(c.buyLevelId, c);
    if (c?.sellLevelId) cycleById.set(c.sellLevelId, c);
    if (c?.targetSellLevelId) cycleById.set(c.targetSellLevelId, c);
  }

  const openCycleTargetLevelIds = new Set<string>();
  for (const c of openCycleObjects) {
    if (c.targetSellLevelId) openCycleTargetLevelIds.add(c.targetSellLevelId);
  }

  const operationalLevels = (levels || []).map((l) =>
    buildOperationalLevel(l, activeRangeVersionId, openCycleTargetLevelIds, cycleById)
  );

  const activeRangeLevels = operationalLevels.filter(
    (l) => l.rangeRelation === "current" || (activeRangeVersionId == null && l.targetOfOpenCycle)
  );
  const openCycleTargetLevels = operationalLevels.filter((l) => l.targetOfOpenCycle);
  const historicalLevels = operationalLevels.filter(
    (l) => !activeRangeLevels.includes(l) && !openCycleTargetLevels.includes(l)
  );

  const levelsView: OperationalLevels = {
    activeRangeLevels: activeRangeExists ? activeRangeLevels : [],
    openCycleTargetLevels,
    historicalLevels,
    allLevels: operationalLevels,
  };

  const capital = buildCapital(config, status, openCycleObjects);

  const notifications = deduplicateEvents(events);

  const executionView = {
    policy,
    policyLabel: executionPolicyLabel(policy),
    storedPolicy: storedPolicy ?? null,
    takerFallbackEnabled,
    takerFallbackAllowed,
    makerOnly,
    takerFallbackLabel: makerOnly
      ? "Solo maker — fallback taker desactivado"
      : takerFallbackEnabled
        ? "Fallback taker activo"
        : "Fallback taker desactivado",
  };

  const market = buildGridMarketViewModel({
    pair: config?.pair ?? "BTC/USD",
    mode,
    config,
    status,
    marketContext,
    resolvedRange,
    adaptiveDecision,
    professionalGenerator,
    currentOperationalState,
    recommendations,
    openCycles: openCycleObjects,
    levels,
    lastProfessionalValidationAt: lastProfessionalValidationAt ?? null,
    lastShadowValidationAt: lastShadowValidationAt ?? null,
  });

  const settings: OperationalSettingsProfile = {
    simple: {
      capitalMax: toNum(config?.gridWalletMaxUsd) ?? 5000,
      minViableLevels: toNum(config?.adaptiveRangeMinViableLevels) ?? 4,
      netProfitTargetPct: toNum(config?.netProfitTargetPct) ?? 0.8,
      rangeProfile: config?.adaptiveRangeProfile ?? config?.capitalProfile ?? "balanced",
      protection: config?.hodlRecoveryEnabled ? "hold" : "stop",
      reinvestProfits: config?.gridWalletCompoundProfits ?? true,
    },
    expertBlocks: [
      { id: "capital", title: "Capital y distribución", description: "Cartera Grid, reserva y reinversión.", fields: ["gridWalletMode", "gridWalletInitialUsd", "gridWalletMaxUsd", "gridWalletUseProfits", "gridWalletCompoundProfits", "gridMaxCapitalPerCycleUsd", "gridMaxCapitalPerCyclePct", "gridReservePct", "gridAllocationMode", "gridCapitalDeploymentMode"] },
      { id: "range", title: "Rango y volatilidad", description: "Cálculo de banda, ATR, Bollinger y rango inteligente.", fields: ["gridRangeControlMode", "adaptiveRangeEnabled", "adaptiveRangeProfile", "adaptiveRangeMinPct", "adaptiveRangeMaxPct", "adaptiveRangeLowVolMaxPct", "adaptiveRangeNormalMaxPct", "adaptiveRangeHighVolMaxPct", "adaptiveRangeTargetFullLevels", "adaptiveRangeMinViableLevels", "bandPeriod", "bandStdDevMultiplier", "atrPeriod", "atrTimeframe"] },
      { id: "spacing", title: "Separación de niveles", description: "Distancia mínima/máxima entre niveles.", fields: ["gridStepMinPct", "gridStepMaxPct", "gridStepAtrMultiplier", "gridMaxLevelPct", "gridMinLevelUsd"] },
      { id: "protection", title: "Protección Pump/Dump", description: "Bloqueo de compras ante movimientos bruscos.", fields: ["pumpGuardDeviationPct", "pumpGuardVolumeSpikeRatio", "pumpGuardCooldownMinutes", "dumpGuardDeviationPct", "dumpGuardVolumeSpikeRatio", "dumpGuardCooldownMinutes"] },
      { id: "exits", title: "Salidas y HODL", description: "Stop loss y recuperación de posiciones.", fields: ["hodlRecoveryEnabled", "stopLossSoftPct", "stopLossHardPct", "stopLossEmergencyPct", "trailingActivationPct", "trailingStopPct"] },
      { id: "limits", title: "Límites operativos", description: "Máximos de ciclos y órdenes diarias.", fields: ["maxOpenCycles", "maxDailyOrders"] },
      { id: "simulation", title: "Simulación y diagnóstico", description: "Beneficio neto objetivo y parámetros de validación.", fields: ["netProfitTargetPct", "enforceCompactRange", "gridRangeMaxPct", "maxDistanceFromCenterPct", "maxSellDistanceFromNearestBuyPct"] },
    ],
  };

  return {
    header,
    overview,
    openCycles: openCycleObjects,
    closedCycles: closedCycleObjects,
    cancelledCycles: cancelledCycleObjects,
    currentRange: activeRange,
    levels: levelsView,
    capital,
    notifications,
    execution: executionView,
    settings,
    market,
  };
}

function mapSeverity(severity: string): OperationalRecommendation["severity"] {
  if (severity === "error") return "error";
  if (severity === "warning") return "warning";
  if (severity === "success") return "success";
  return "info";
}
