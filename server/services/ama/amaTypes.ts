/**
 * AMA — Acumulación Macro Adaptativa
 * Type definitions, enums, and constants.
 *
 * This module is INDEPENDENT from Spot Normal, IDCA, Grid Isolated, and FISCO.
 * It does NOT share inventories, capital, or state with any other strategy.
 *
 * Safety: REAL_LIMITED and REAL_FULL modes are LOCKED until explicit authorization.
 */

import type { AssetSymbol } from "./amaSeedTypes";

// ─── Identity ────────────────────────────────────────────────────────

export const AMA_DISPLAY_NAME = "AMA — Acumulación Macro Adaptativa";
export const AMA_SHORT_NAME = "AMA";
export const AMA_MODE = "AMA" as const;
export const AMA_STRATEGY_CODE = "ADAPTIVE_MACRO_ACCUMULATION";
export const AMA_STRATEGY_VERSION = "1.0.0";
export const AMA_ROUTE = "/ama";
export const AMA_API_PREFIX = "/api/ama";
export const AMA_DB_PREFIX = "ama_";
export const AMA_PAIR = "BTC/USD";

// ─── Operational Modes ───────────────────────────────────────────────

export type AmaMode = "OFF" | "REPLAY" | "SHADOW" | "REAL_LIMITED" | "REAL_FULL";

export const AMA_MODE_VALUES: AmaMode[] = ["OFF", "REPLAY", "SHADOW", "REAL_LIMITED", "REAL_FULL"];

export function isModeReal(mode: AmaMode): boolean {
  return mode === "REAL_LIMITED" || mode === "REAL_FULL";
}

export function isModeActive(mode: AmaMode): boolean {
  return mode !== "OFF";
}

export function isModeExecutionEnabled(mode: AmaMode): boolean {
  return mode === "REAL_LIMITED" || mode === "REAL_FULL";
}

// ─── State Machine ──────────────────────────────────────────────────

export type AmaState =
  | "OBSERVING"
  | "CEILING_BOOTSTRAPPING"
  | "CEILING_CANDIDATE"
  | "CEILING_CONFIRMING"
  | "VALUE_ZONE"
  | "PLAN_ELIGIBLE"
  | "ACCUMULATING"
  | "POSITION_OPEN"
  | "RECOVERY_MONITORING"
  | "DISTRIBUTING"
  | "CLOSING"
  | "CLOSED"
  | "ABANDONED_NO_INVENTORY";

export const AMA_STATE_VALUES: AmaState[] = [
  "OBSERVING",
  "CEILING_BOOTSTRAPPING",
  "CEILING_CANDIDATE",
  "CEILING_CONFIRMING",
  "VALUE_ZONE",
  "PLAN_ELIGIBLE",
  "ACCUMULATING",
  "POSITION_OPEN",
  "RECOVERY_MONITORING",
  "DISTRIBUTING",
  "CLOSING",
  "CLOSED",
  "ABANDONED_NO_INVENTORY",
];

export type AmaProtectionState =
  | "DATA_DEGRADED"
  | "CEILING_REVIEW_REQUIRED"
  | "EXECUTION_BLOCKED"
  | "RECONCILIATION_REQUIRED"
  | "THESIS_REVIEW_REQUIRED"
  | "CAPITAL_DEPLOYMENT_PAUSED"
  | "KILL_SWITCH_ACTIVE";

// ─── Tranche Types ───────────────────────────────────────────────────

export type TrancheType = "PROBE" | "VALUE" | "DEEP_VALUE" | "CAPITULATION" | "RECOVERY";

export const TRANCHE_TYPES: TrancheType[] = ["PROBE", "VALUE", "DEEP_VALUE", "CAPITULATION", "RECOVERY"];

// ─── Macro Zones (Barra Macro) ───────────────────────────────────────

export type MacroZone =
  | "NORMAL"
  | "RETROCESO"
  | "CORRECCION"
  | "VALUE"
  | "DEEP_VALUE"
  | "CAPITULACION"
  | "CAPITULACION_EXTREMA";

export const MACRO_ZONE_RANGES: { zone: MacroZone; minPct: number; maxPct: number }[] = [
  { zone: "NORMAL", minPct: 0, maxPct: 10 },
  { zone: "RETROCESO", minPct: 10, maxPct: 20 },
  { zone: "CORRECCION", minPct: 20, maxPct: 30 },
  { zone: "VALUE", minPct: 30, maxPct: 40 },
  { zone: "DEEP_VALUE", minPct: 40, maxPct: 50 },
  { zone: "CAPITULACION", minPct: 50, maxPct: 60 },
  { zone: "CAPITULACION_EXTREMA", minPct: 60, maxPct: 80 },
];

export function getZoneFromDropPct(dropPct: number): MacroZone {
  for (const entry of MACRO_ZONE_RANGES) {
    if (dropPct >= entry.minPct && dropPct < entry.maxPct) return entry.zone;
  }
  return "CAPITULACION_EXTREMA";
}

// ─── Mandate Controls ───────────────────────────────────────────────

export type RiskMandate = "MUY_PRUDENTE" | "PRUDENTE" | "EQUILIBRADO" | "DINAMICO" | "OPORTUNISTA";
export type AccumulationStyle = "ENTRAR_ANTES" | "ADAPTATIVO" | "ESPERAR_MAS_VALOR";
export type ExitObjective = "RECUPERAR_CAPITAL" | "EQUILIBRADO" | "ACUMULAR_BTC";
export type AutonomyLevel = "SOLO_ANALISIS" | "SUPERVISADO" | "AUTOPILOT";

export const RISK_MANDATES: RiskMandate[] = ["MUY_PRUDENTE", "PRUDENTE", "EQUILIBRADO", "DINAMICO", "OPORTUNISTA"];
export const ACCUMULATION_STYLES: AccumulationStyle[] = ["ENTRAR_ANTES", "ADAPTATIVO", "ESPERAR_MAS_VALOR"];
export const EXIT_OBJECTIVES: ExitObjective[] = ["RECUPERAR_CAPITAL", "EQUILIBRADO", "ACUMULAR_BTC"];
export const AUTONOMY_LEVELS: AutonomyLevel[] = ["SOLO_ANALISIS", "SUPERVISADO", "AUTOPILOT"];

export function isAutonomyAllowed(mode: AmaMode, autonomy: AutonomyLevel): boolean {
  if (mode === "REPLAY" || mode === "SHADOW") return true;
  if (mode === "REAL_LIMITED") return autonomy === "SUPERVISADO";
  if (mode === "REAL_FULL") return false;
  return false;
}

// ─── Policy States ──────────────────────────────────────────────────

export type PolicyStatus =
  | "DRAFT"
  | "SIMULATED"
  | "VALIDATED"
  | "PENDING_APPROVAL"
  | "ACTIVE"
  | "SUPERSEDED"
  | "REVOKED";

export const POLICY_STATUSES: PolicyStatus[] = [
  "DRAFT",
  "SIMULATED",
  "VALIDATED",
  "PENDING_APPROVAL",
  "ACTIVE",
  "SUPERSEDED",
  "REVOKED",
];

// ─── Sleeves ─────────────────────────────────────────────────────────

export type SleeveType = "RECOVER_PRINCIPAL" | "DE_RISK" | "LONG_TERM_RUNNER";

export const SLEEVE_TYPES: SleeveType[] = ["RECOVER_PRINCIPAL", "DE_RISK", "LONG_TERM_RUNNER"];

// ─── Order Intent / Execution States ─────────────────────────────────

export type OrderIntentStatus =
  | "CREATED"
  | "VALIDATED"
  | "SUBMITTING"
  | "ACCEPTED_PENDING_FILL"
  | "PARTIALLY_FILLED"
  | "COMPLETED"
  | "CANCELED"
  | "REJECTED"
  | "EXPIRED"
  | "UNKNOWN_RECONCILIATION_REQUIRED";

export const ORDER_INTENT_STATUSES: OrderIntentStatus[] = [
  "CREATED",
  "VALIDATED",
  "SUBMITTING",
  "ACCEPTED_PENDING_FILL",
  "PARTIALLY_FILLED",
  "COMPLETED",
  "CANCELED",
  "REJECTED",
  "EXPIRED",
  "UNKNOWN_RECONCILIATION_REQUIRED",
];

// ─── Reservation States ──────────────────────────────────────────────

export type ReservationState =
  | "PENDING"
  | "ACTIVE"
  | "PARTIALLY_CONSUMED"
  | "CONSUMED"
  | "RELEASED"
  | "EXPIRED"
  | "RECONCILIATION_REQUIRED";

// ─── Ledger Entry Types ──────────────────────────────────────────────

export type LedgerEntryType =
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "TRADE_BUY"
  | "TRADE_SELL"
  | "FEE"
  | "MODE_ALLOCATION"
  | "MODE_TRANSFER"
  | "MANUAL_ATTRIBUTION"
  | "RECONCILIATION_ADJUSTMENT";

// ─── Portfolio Mode Categories ───────────────────────────────────────

export type PortfolioMode =
  | "AMA"
  | "IDCA"
  | "GRID"
  | "MOMENTUM_NORMAL"
  | "MANUAL_EXTERNAL"
  | "UNATTRIBUTED"
  | "DUST";

export const PORTFOLIO_MODES: PortfolioMode[] = [
  "AMA",
  "IDCA",
  "GRID",
  "MOMENTUM_NORMAL",
  "MANUAL_EXTERNAL",
  "UNATTRIBUTED",
  "DUST",
];

// ─── Budget Allocation Types ─────────────────────────────────────────

export type AllocationType = "MANUAL_FIXED_ALLOCATION" | "BOUNDED_DYNAMIC_ALLOCATION";

export type BudgetFields = "BUDGETED" | "DEPLOYED" | "RESERVED" | "FREE";

// ─── Valuation Price Types ───────────────────────────────────────────

export type PriceType =
  | "EXECUTABLE_BID"
  | "EXECUTABLE_ASK"
  | "MID"
  | "LAST"
  | "REFERENCE"
  | "EXTERNAL_ESTIMATE"
  | "UNAVAILABLE";

// ─── Retention Classes ──────────────────────────────────────────────

export type RetentionClass =
  | "EPHEMERAL"
  | "OPERATIONAL"
  | "DIAGNOSTIC"
  | "RESEARCH"
  | "DOMAIN_HISTORY"
  | "FINANCIAL_PROTECTED"
  | "SECURITY_PROTECTED"
  | "MANUAL_HOLD";

// ─── Data Quality States ─────────────────────────────────────────────

export type DataQualityState = "FRESH" | "STALE" | "UNAVAILABLE" | "ERROR" | "DISABLED" | "REVISION_RISK";

// ─── Assessment Types ────────────────────────────────────────────────

export type AssessmentType =
  | "StructuralValueAssessment"
  | "CapitulationAssessment"
  | "RecoveryAssessment"
  | "FlowAssessment"
  | "NetworkAssessment"
  | "DistributionAssessment"
  | "DataConfidenceAssessment";

// ─── AI States ───────────────────────────────────────────────────────

export type AiState =
  | "AI_UNCERTAIN"
  | "AI_INSUFFICIENT_DATA"
  | "AI_OUT_OF_DISTRIBUTION"
  | "AI_PROVIDER_UNAVAILABLE";

// ─── Execution Policy ───────────────────────────────────────────────

export const AMA_EXECUTION_POLICY = "POST_ONLY_MAKER_ONLY" as const;

// ─── Guardrails ──────────────────────────────────────────────────────

export const AMA_GUARDRAILS = [
  "Solo maker/post-only",
  "Sin compras ilimitadas",
  "Sin martingala",
  "Sin usar capital de otros modos",
  "Sin superar capital autorizado",
  "Maximo un tramo por cierre diario",
  "Sin operar con datos degradados",
  "Sin operar con reconciliacion pendiente",
  "Sin aumentar riesgo tras el primer fill",
  "Sin ampliar presupuesto mediante IA",
  "Sin modificar una politica ACTIVE",
] as const;

// ─── Cycle Abandon Reasons ───────────────────────────────────────────

export type CycleAbandonReason =
  | "CEILING_RECOVERED"
  | "NEW_HIGH_WATER_MARK"
  | "VALUE_DISAPPEARED"
  | "MAX_TIME_NO_FILL";

// ─── Core Interfaces (Phase 1 contracts) ────────────────────────────

export interface AmaStatus {
  mode: AmaMode;
  state: AmaState;
  protectionState: AmaProtectionState | null;
  pair: string;
  strategyVersion: string;
  cycleId: string | null;
  activePolicyId: string | null;
  mandateId: string | null;
  killSwitchActive: boolean;
  lastUpdated: string;
}

export interface AmaMarketView {
  pair: string;
  analysisPrice: number | null;
  analysisTimestamp: string | null;
  executionBid: number | null;
  executionAsk: number | null;
  executionMid: number | null;
  spreadPct: number | null;
  crossVenueBasisPct: number | null;
  executionTimestamp: string | null;
  highWaterMark: number | null;
  cycleLow: number | null;
  currentDropPct: number | null;
  maxDropPct: number | null;
  reboundFromLowPct: number | null;
  macroZone: MacroZone | null;
  daysSinceCeiling: number | null;
  daysSinceLow: number | null;
  dataQuality: DataQualityState;
}

export interface AmaMandateInput {
  asset: AssetSymbol;
  maxCapitalUsd: number;
  riskMandate: RiskMandate;
  accumulationStyle: AccumulationStyle;
  exitObjective: ExitObjective;
  autonomyLevel: AutonomyLevel;
}

export interface AmaResolvedPolicy {
  mandateId: string;
  policyId: string;
  policyVersion: number;
  userInputs: AmaMandateInput;
  resolvedParameters: AmaResolvedParameters;
  resolverVersion: string;
  strategyVersion: string;
  policyHash: string;
  status: PolicyStatus;
  createdAt: string;
  approvedAt: string | null;
  activatedAt: string | null;
}

export interface AmaResolvedParameters {
  mandatoryReservePct: number;
  maxSingleTranchePct: number;
  maxCycleDeploymentPct: number;
  maxWeeklyDeploymentPct: number;
  maxMonthlyDeploymentPct: number;
  minimumSpacingPct: number;
  spacingAtrMultiplier: number;
  minimumDataCoveragePct: number;
  requiredConfirmationStrength: number;
  cooldownPolicy: string;
  maximumCandidateTranches: number;
  absoluteSafetyCap: number; // deprecated alias
  absoluteCapitalCapUsd: number;
  absoluteTrancheCountCap: number;
  spreadTolerancePct: number;
  crossVenueBasisTolerancePct: number;
  profitRecoveryPolicy: string;
  deRiskPolicy: string;
  runnerPolicy: string;
  trailingPolicy: string;
  thesisInvalidationPolicy: string;
  asset: AssetSymbol;
}

export interface AmaTranchePlan {
  planId: string;
  cycleId: string;
  version: number;
  plannedPurchaseCount: number;
  candidateTranches: AmaTrancheCandidate[];
  mandatoryReserveUsd: number;
  deployableCycleCapitalUsd: number;
  createdAt: string;
}

export interface AmaTrancheCandidate {
  trancheId: string;
  type: TrancheType;
  activationZone: MacroZone;
  activationDropPct: number;
  amountUsd: number;
  spacingPct: number;
  eligible: boolean;
  eligibilityReasons: string[];
  // R4.2: Canonical seed metadata
  asset?: string;
  seedTrancheIndex?: number;
  canonicalTriggerDropPct?: number;
  canonicalTriggerPrice?: number;
  capitalPct?: number;
  policyId?: string;
  policyVersion?: number;
  riskOverlayMultiplier?: number;
  confirmedCloseTimestamp?: string;
}

export interface AmaCycle {
  cycleId: string;
  asset: AssetSymbol;
  pair: string;
  mode: AmaMode;
  state: AmaState;
  highWaterMark: number | null;
  ceilingConfirmedAt: string | null;
  cycleLow: number | null;
  cycleLowAt: string | null;
  maxDropPct: number | null;
  currentDropPct: number | null;
  reboundFromLowPct: number | null;
  budgetUsd: number;
  deployedUsd: number;
  reservedUsd: number;
  freeUsd: number;
  accumulatedQuantity: number;
  averageCostBasis: number | null;
  activePolicyId: string | null;
  createdAt: string;
  closedAt: string | null;
}

export interface AmaTranche {
  trancheId: string;
  cycleId: string;
  type: TrancheType;
  status: OrderIntentStatus;
  plannedAmountUsd: number;
  executedAmountUsd: number;
  assetQuantity: number;
  fillPrice: number | null;
  costBasis: number | null;
  sleeveAllocation: SleeveType;
  remainingQuantity: number;
  realizedQuantity: number;
  createdAt: string;
  filledAt: string | null;
}

export interface AmaPortfolioSummary {
  mode: AmaMode;
  budgetUsd: number;
  deployedUsd: number;
  reservedUsd: number;
  freeUsd: number;
  accumulatedQuantity: number;
  averageCostBasis: number | null;
  currentValueUsd: number | null;
  unrealizedPnlUsd: number | null;
  realizedPnlUsd: number | null;
  sleeves: AmaSleeveSummary[];
}

export interface AmaSleeveSummary {
  sleeve: SleeveType;
  assetQuantity: number;
  realizedQuantity: number;
  remainingQuantity: number;
  costBasisUsd: number;
}

export interface AmaReplayConfig {
  mode: AmaMode;
  startDate: string;
  endDate: string;
  pair: string;
  initialCapitalUsd: number;
}

export interface AmaApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}
