/**
 * AMA Seed Types V2.2 — Asset Profiles, Seed Policies, Envelopes, HWM, Risk Overlay, Sources
 *
 * Cambio de alcance: AMA-CC-2026-07-29-SEED-V2.2
 *
 * Safety:
 * - BTC/USD = LAB_ONLY
 * - ETH/USD = RESEARCH_ONLY
 * - ETH cannot reserve real capital, create executable intents, create orders,
 *   use Revolut X executor, share BTC capital/inventory/cycles, or inherit BTC promotion.
 * - Coin Metrics decisionImpactAllowed = false
 * - Risk overlay = RISK_DOWN_ONLY (never amplifies)
 */

// ─── Asset Profiles ──────────────────────────────────────────────────

export type AssetSymbol = "BTC" | "ETH";

export type AssetMode = "LAB_ONLY" | "RESEARCH_ONLY" | "SHADOW" | "REAL_LIMITED" | "REAL_FULL";

export type AnalysisVenue = "KRAKEN";
/** @deprecated R6.16: Use TargetExecutionVenue instead. */
export type FutureExecutionVenue = "REVOLUT_X" | "DISABLED";
export type TargetExecutionVenue = "REVOLUT_X" | null;
export type ExecutionStatus = "LAB_ONLY" | "RESEARCH_ONLY" | "SHADOW_READY" | "REAL_READY";
export type CurrentAdapter = "SHADOW" | null;

export interface AmaAssetProfile {
  asset: AssetSymbol;
  pair: string;
  mode: AssetMode;
  analysisVenue: AnalysisVenue;
  /** @deprecated R6.16: Use targetExecutionVenue instead. LEGACY_COMPATIBILITY_ONLY NOT_FOR_CANONICAL_SEED_FLOW */
  futureExecutionVenue: FutureExecutionVenue;
  targetExecutionVenue: TargetExecutionVenue;
  executionEnabled: boolean;
  executionStatus: ExecutionStatus;
  pipeline: "BTC_LAB" | "ETH_RESEARCH";
  canReserveCapital: boolean;
  canCreateIntents: boolean;
  canExecute: boolean;
  canUseRevolutX: boolean;
  sharesBtcCapital: boolean;
  inheritsBtcPromotion: boolean;
  makerOnly: boolean;
  postOnly: boolean;
  takerFallback: boolean;
  currentAdapter: CurrentAdapter;
  realAdapterConfigured: boolean;
  realAdapterAuthorized: boolean;
}

export const BTC_ASSET_PROFILE: AmaAssetProfile = {
  asset: "BTC",
  pair: "BTC/USD",
  mode: "LAB_ONLY",
  analysisVenue: "KRAKEN",
  futureExecutionVenue: "REVOLUT_X",
  targetExecutionVenue: "REVOLUT_X",
  executionEnabled: false,
  executionStatus: "LAB_ONLY",
  pipeline: "BTC_LAB",
  canReserveCapital: false,
  canCreateIntents: false,
  canExecute: false,
  canUseRevolutX: false,
  sharesBtcCapital: false,
  inheritsBtcPromotion: false,
  makerOnly: true,
  postOnly: true,
  takerFallback: false,
  currentAdapter: "SHADOW",
  realAdapterConfigured: false,
  realAdapterAuthorized: false,
};

export const ETH_ASSET_PROFILE: AmaAssetProfile = {
  asset: "ETH",
  pair: "ETH/USD",
  mode: "RESEARCH_ONLY",
  analysisVenue: "KRAKEN",
  futureExecutionVenue: "DISABLED",
  targetExecutionVenue: null,
  executionEnabled: false,
  executionStatus: "RESEARCH_ONLY",
  pipeline: "ETH_RESEARCH",
  canReserveCapital: false,
  canCreateIntents: false,
  canExecute: false,
  canUseRevolutX: false,
  sharesBtcCapital: false,
  inheritsBtcPromotion: false,
  makerOnly: true,
  postOnly: true,
  takerFallback: false,
  currentAdapter: null,
  realAdapterConfigured: false,
  realAdapterAuthorized: false,
};

export const ASSET_PROFILES: Record<AssetSymbol, AmaAssetProfile> = {
  BTC: BTC_ASSET_PROFILE,
  ETH: ETH_ASSET_PROFILE,
};

// ─── Seed Policy Status ─────────────────────────────────────────────

export type SeedPolicyStatus = "DRAFT" | "SIMULATED" | "VALIDATED" | "ACTIVE" | "SUPERSEDED" | "REVOKED";

// ─── Seed Policy BTC ─────────────────────────────────────────────────

export interface SeedPolicyBtc {
  policyId: string;
  asset: "BTC";
  pair: string;
  status: AssetMode;
  analysisVenue: AnalysisVenue;
  /** @deprecated R6.16: Use targetExecutionVenue instead. */
  futureExecutionVenue: FutureExecutionVenue;
  targetExecutionVenue: TargetExecutionVenue;
  executionEnabled: boolean;
  makerOnly: boolean;
  postOnly: boolean;
  takerFallback: boolean;
  capitalDeploymentPct: number; // 75
  capitalReservePct: number; // 25
  trancheCount: number; // 6
  fixedReversalCenterPct: number; // 10.0
  atrMultiplier: number; // 3.0
  requiredDailyCloses: number; // 3
}

export const BTC_SEED_POLICY: SeedPolicyBtc = {
  policyId: "AMA_BTC_SEED_V1_RESEARCH",
  asset: "BTC",
  pair: "BTC/USD",
  status: "LAB_ONLY",
  analysisVenue: "KRAKEN",
  futureExecutionVenue: "REVOLUT_X",
  targetExecutionVenue: "REVOLUT_X",
  executionEnabled: false,
  makerOnly: true,
  postOnly: true,
  takerFallback: false,
  capitalDeploymentPct: 75,
  capitalReservePct: 25,
  trancheCount: 6,
  fixedReversalCenterPct: 10.0,
  atrMultiplier: 3.0,
  requiredDailyCloses: 3,
};

// ─── Seed Policy ETH ─────────────────────────────────────────────────

export interface SeedPolicyEth {
  policyId: string;
  asset: "ETH";
  pair: string;
  status: AssetMode;
  analysisVenue: AnalysisVenue;
  /** @deprecated R6.16: Use targetExecutionVenue instead. */
  futureExecutionVenue: FutureExecutionVenue;
  targetExecutionVenue: TargetExecutionVenue;
  executionEnabled: boolean;
  makerOnly: boolean;
  postOnly: boolean;
  takerFallback: boolean;
  capitalDeploymentPct: number; // 65
  capitalReservePct: number; // 35
  trancheCount: number; // 7
  fixedReversalCenterPct: number; // 14.0
  atrMultiplierCenter: number; // 3.5
  requiredDailyCloses: number; // 5
  ethBtcFilterRequired: boolean;
  relativePair: string;
}

export const ETH_SEED_POLICY: SeedPolicyEth = {
  policyId: "AMA_ETH_SEED_V1_RESEARCH_ONLY",
  asset: "ETH",
  pair: "ETH/USD",
  status: "RESEARCH_ONLY",
  analysisVenue: "KRAKEN",
  futureExecutionVenue: "DISABLED",
  targetExecutionVenue: null,
  executionEnabled: false,
  makerOnly: true,
  postOnly: true,
  takerFallback: false,
  capitalDeploymentPct: 65,
  capitalReservePct: 35,
  trancheCount: 7,
  fixedReversalCenterPct: 14.0,
  atrMultiplierCenter: 3.5,
  requiredDailyCloses: 5,
  ethBtcFilterRequired: true,
  relativePair: "ETH/BTC",
};

// ─── Resolved Seed Tranches (R2) ─────────────────────────────────────

import type { TrancheType } from "./amaTypes";

export interface ResolvedSeedTranche {
  index: number;
  asset: AssetSymbol;
  triggerDropPct: number;
  capitalPct: number;
  trancheType: TrancheType;
  policyId: string;
  policyVersion: number;
}

export const BTC_SEED_TRANCHES: ResolvedSeedTranche[] = [
  { index: 0, asset: "BTC", triggerDropPct: 18, capitalPct: 7,  trancheType: "PROBE",        policyId: "AMA_BTC_SEED_V1_RESEARCH", policyVersion: 1 },
  { index: 1, asset: "BTC", triggerDropPct: 25, capitalPct: 9,  trancheType: "PROBE",        policyId: "AMA_BTC_SEED_V1_RESEARCH", policyVersion: 1 },
  { index: 2, asset: "BTC", triggerDropPct: 33, capitalPct: 12, trancheType: "VALUE",        policyId: "AMA_BTC_SEED_V1_RESEARCH", policyVersion: 1 },
  { index: 3, asset: "BTC", triggerDropPct: 42, capitalPct: 14, trancheType: "VALUE",        policyId: "AMA_BTC_SEED_V1_RESEARCH", policyVersion: 1 },
  { index: 4, asset: "BTC", triggerDropPct: 52, capitalPct: 15, trancheType: "DEEP_VALUE",   policyId: "AMA_BTC_SEED_V1_RESEARCH", policyVersion: 1 },
  { index: 5, asset: "BTC", triggerDropPct: 63, capitalPct: 18, trancheType: "CAPITULATION", policyId: "AMA_BTC_SEED_V1_RESEARCH", policyVersion: 1 },
];

export const ETH_SEED_TRANCHES: ResolvedSeedTranche[] = [
  { index: 0, asset: "ETH", triggerDropPct: 24, capitalPct: 5,  trancheType: "PROBE",        policyId: "AMA_ETH_SEED_V1_RESEARCH_ONLY", policyVersion: 1 },
  { index: 1, asset: "ETH", triggerDropPct: 32, capitalPct: 7,  trancheType: "PROBE",        policyId: "AMA_ETH_SEED_V1_RESEARCH_ONLY", policyVersion: 1 },
  { index: 2, asset: "ETH", triggerDropPct: 41, capitalPct: 8,  trancheType: "VALUE",        policyId: "AMA_ETH_SEED_V1_RESEARCH_ONLY", policyVersion: 1 },
  { index: 3, asset: "ETH", triggerDropPct: 51, capitalPct: 10, trancheType: "VALUE",        policyId: "AMA_ETH_SEED_V1_RESEARCH_ONLY", policyVersion: 1 },
  { index: 4, asset: "ETH", triggerDropPct: 61, capitalPct: 11, trancheType: "DEEP_VALUE",   policyId: "AMA_ETH_SEED_V1_RESEARCH_ONLY", policyVersion: 1 },
  { index: 5, asset: "ETH", triggerDropPct: 71, capitalPct: 12, trancheType: "CAPITULATION", policyId: "AMA_ETH_SEED_V1_RESEARCH_ONLY", policyVersion: 1 },
  { index: 6, asset: "ETH", triggerDropPct: 80, capitalPct: 12, trancheType: "CAPITULATION", policyId: "AMA_ETH_SEED_V1_RESEARCH_ONLY", policyVersion: 1 },
];

export const SEED_TRANCHES: Record<AssetSymbol, ResolvedSeedTranche[]> = {
  BTC: BTC_SEED_TRANCHES,
  ETH: ETH_SEED_TRANCHES,
};

export function getSeedTranches(asset: AssetSymbol): ResolvedSeedTranche[] {
  return SEED_TRANCHES[asset];
}

// ─── Seed Maximum Tranche Pct (R2) ───────────────────────────────────

export const SEED_MAXIMUM_TRANCHE_PCT: Record<AssetSymbol, number> = {
  BTC: 18,
  ETH: 12,
};

export function getSeedMaximumTranchePct(asset: AssetSymbol): number {
  return SEED_MAXIMUM_TRANCHE_PCT[asset];
}

export function computeEffectiveMaximumTranchePct(
  asset: AssetSymbol,
  userConfiguredMaximumTranchePct: number,
): number {
  const seedMax = SEED_MAXIMUM_TRANCHE_PCT[asset];
  return Math.min(seedMax, userConfiguredMaximumTranchePct);
}

// ─── Seed Policy Validation (R2 — fail-closed) ──────────────────────

export function validateSeedPolicy(asset: AssetSymbol): string[] {
  const errors: string[] = [];
  const tranches = getSeedTranches(asset);
  const policy = asset === "BTC" ? BTC_SEED_POLICY : ETH_SEED_POLICY;

  if (tranches.length !== policy.trancheCount) {
    errors.push(`Tranche count mismatch: expected ${policy.trancheCount}, got ${tranches.length}`);
  }

  const capitalPcts = tranches.map((t) => t.capitalPct);
  const sumCapital = capitalPcts.reduce((a, b) => a + b, 0);
  if (sumCapital !== policy.capitalDeploymentPct) {
    errors.push(`Capital sum mismatch: expected ${policy.capitalDeploymentPct}, got ${sumCapital}`);
  }

  if (policy.capitalDeploymentPct + policy.capitalReservePct !== 100) {
    errors.push(`Deployment + reserve != 100: ${policy.capitalDeploymentPct} + ${policy.capitalReservePct}`);
  }

  const triggers = tranches.map((t) => t.triggerDropPct);
  if (new Set(triggers).size !== triggers.length) {
    errors.push("Triggers must be unique");
  }

  for (let i = 1; i < triggers.length; i++) {
    if (triggers[i] <= triggers[i - 1]) {
      errors.push(`Trigger at index ${i} must be strictly greater (deeper) than index ${i - 1}`);
    }
  }

  if (asset === "ETH" && policy.executionEnabled) {
    errors.push("ETH must not have execution enabled");
  }

  const maxTranche = Math.max(...capitalPcts);
  if (maxTranche > SEED_MAXIMUM_TRANCHE_PCT[asset]) {
    errors.push(`Max tranche ${maxTranche} exceeds seed maximum ${SEED_MAXIMUM_TRANCHE_PCT[asset]}`);
  }

  return errors;
}

// ─── Envelopes ───────────────────────────────────────────────────────

/**
 * Envelopes are CALIBRATION INTERVALS, not simultaneous execution bands.
 * Each tranche has a unique, descending trigger.
 * Maximum one tranche per confirmed daily close.
 */

export interface EnvelopeTranche {
  trancheIndex: number;
  triggerDropPct: number;
  trancheType: "PROBE" | "VALUE" | "DEEP_VALUE" | "CAPITULATION";
  weightMultiplier: number; // <= 1.0 in active overlay
}

export interface Envelope {
  policyId: string;
  asset: AssetSymbol;
  tranches: EnvelopeTranche[];
}

export function validateEnvelope(envelope: Envelope): string[] {
  const errors: string[] = [];
  const triggers = envelope.tranches.map((t) => t.triggerDropPct);

  // Triggers must be unique
  if (new Set(triggers).size !== triggers.length) {
    errors.push("Triggers must be unique");
  }

  // Triggers must be descending
  for (let i = 1; i < triggers.length; i++) {
    if (triggers[i] <= triggers[i - 1]) {
      errors.push(`Trigger at index ${i} must be less than trigger at index ${i - 1}`);
    }
  }

  // Weight multiplier must be <= 1.0 in active overlay
  for (const t of envelope.tranches) {
    if (t.weightMultiplier > 1.0) {
      errors.push(`Tranche ${t.trancheIndex} weightMultiplier > 1.0 is prohibited in active overlay`);
    }
  }

  return errors;
}

// ─── HWM (High-Water Mark) ───────────────────────────────────────────

export type HwmState = "CANDIDATE" | "CONFIRMING" | "CONFIRMED" | "FROZEN" | "SUPERSEDED" | "INVALIDATED";

export const HWM_STATES: HwmState[] = [
  "CANDIDATE",
  "CONFIRMING",
  "CONFIRMED",
  "FROZEN",
  "SUPERSEDED",
  "INVALIDATED",
];

export interface HwmRecord {
  cycleId: string;
  authoritativeCycleHwm: number;
  rollingHigh: number;
  state: HwmState;
  confirmedAt: string | null;
  supersededAt: string | null;
  invalidatedAt: string | null;
}

export function canHwmGoDown(state: HwmState, field: "authoritativeCycleHwm" | "rollingHigh"): boolean {
  if (field === "authoritativeCycleHwm") {
    // authoritativeCycleHwm never goes down once CONFIRMED → FROZEN
    return state === "CANDIDATE" || state === "CONFIRMING";
  }
  // rollingHigh can go down
  return true;
}

// ─── Risk Overlay ────────────────────────────────────────────────────

export type RiskOverlayType = "RISK_DOWN_ONLY" | "CHALLENGER_RESEARCH_ONLY";

export const ACTIVE_SEED_OVERLAY: RiskOverlayType = "RISK_DOWN_ONLY";

export interface RiskOverlayConfig {
  overlay: RiskOverlayType;
  minimumWeightMultiplier: Record<AssetSymbol, number>;
  maximumWeightMultiplier: Record<AssetSymbol, number>;
}

export const RISK_OVERLAY_CONFIG: RiskOverlayConfig = {
  overlay: "RISK_DOWN_ONLY",
  minimumWeightMultiplier: {
    BTC: 0.50,
    ETH: 0.35,
  },
  maximumWeightMultiplier: {
    BTC: 1.00,
    ETH: 1.00,
  },
};

export function isWeightMultiplierValid(asset: AssetSymbol, multiplier: number): boolean {
  const config = RISK_OVERLAY_CONFIG;
  return (
    multiplier >= config.minimumWeightMultiplier[asset] &&
    multiplier <= config.maximumWeightMultiplier[asset]
  );
}

export function isChallengerMultiplier(multiplier: number): boolean {
  return multiplier > 1.0;
}

// ─── Source Taxonomy ─────────────────────────────────────────────────

export type SourceClass = "EXCHANGE" | "ONCHAIN" | "MACRO" | "REGULATORY" | "DERIVATIVES" | "RESEARCH";

export type SourceAuthority = "AUTHORITATIVE" | "RESEARCH_ONLY" | "DISABLED";

export type SourceCapability =
  | "OHLC"
  | "HWM"
  | "ATR"
  | "VOLUME"
  | "ONCHAIN"
  | "MACRO"
  | "EXECUTION"
  | "FILLS"
  | "BALANCE"
  | "ORDERBOOK";

export type LicenseStatus = "OK" | "REVIEW_REQUIRED" | "BLOCKED" | "NOT_APPLICABLE";

export type FreshnessStatus =
  | "FRESH"
  | "DELAYED"
  | "STALE"
  | "PARTIAL"
  | "UNAVAILABLE"
  | "SCHEMA_DRIFT"
  | "REVISION_DETECTED"
  | "LICENSE_BLOCKED";

export interface SourceTaxonomy {
  sourceId: string;
  sourceClass: SourceClass;
  capabilities: SourceCapability[];
  authority: SourceAuthority;
  modeAllowance: AssetMode;
  licenseStatus: LicenseStatus;
  freshnessStatus: FreshnessStatus;
}

export const KRAKEN_SOURCE: SourceTaxonomy = {
  sourceId: "KRAKEN",
  sourceClass: "EXCHANGE",
  capabilities: ["OHLC", "HWM", "ATR", "VOLUME"],
  authority: "AUTHORITATIVE",
  modeAllowance: "LAB_ONLY",
  licenseStatus: "OK",
  freshnessStatus: "FRESH",
};

export const REVOLUT_X_SOURCE: SourceTaxonomy = {
  sourceId: "REVOLUT_X",
  sourceClass: "EXCHANGE",
  capabilities: ["EXECUTION", "FILLS", "BALANCE", "ORDERBOOK"],
  authority: "AUTHORITATIVE",
  modeAllowance: "LAB_ONLY",
  licenseStatus: "OK",
  freshnessStatus: "FRESH",
};

export const COIN_METRICS_ARCHIVE_SOURCE: SourceTaxonomy = {
  sourceId: "COINMETRICS_GITHUB_ARCHIVE",
  sourceClass: "RESEARCH",
  capabilities: ["ONCHAIN"],
  authority: "RESEARCH_ONLY",
  modeAllowance: "RESEARCH_ONLY",
  licenseStatus: "REVIEW_REQUIRED",
  freshnessStatus: "FRESH",
};

export const COIN_METRICS_PRO_SOURCE: SourceTaxonomy = {
  sourceId: "COINMETRICS_PRO",
  sourceClass: "RESEARCH",
  capabilities: ["ONCHAIN", "MACRO"],
  authority: "DISABLED",
  modeAllowance: "RESEARCH_ONLY",
  licenseStatus: "BLOCKED",
  freshnessStatus: "UNAVAILABLE",
};

export const SOURCE_TAXONOMIES: Record<string, SourceTaxonomy> = {
  KRAKEN: KRAKEN_SOURCE,
  REVOLUT_X: REVOLUT_X_SOURCE,
  COINMETRICS_GITHUB_ARCHIVE: COIN_METRICS_ARCHIVE_SOURCE,
  COINMETRICS_PRO: COIN_METRICS_PRO_SOURCE,
};

// ─── Coin Metrics Snapshot ──────────────────────────────────────────

export interface CoinMetricsSourceSnapshot {
  metricId: string;
  assetId: string;
  timestamp: string;
  value: number;
  revisionHash: string;
  sourceRevision: string;
  lastRowTime: string;
  lastCompleteRowTime: string;
  freshnessStatus: FreshnessStatus;
  licenseStatus: LicenseStatus;
  commercialUseStatus: "REVIEW_REQUIRED";
  decisionImpactAllowed: false;
}

// ─── Time Contract ───────────────────────────────────────────────────

export interface AmaTimeContract {
  timezone: "UTC";
  dailyBoundary: string; // "00:00:00Z"
  cycleRef: string;
  asOf: string;
}

export function createUtcTimeContract(cycleRef: string, asOf: string): AmaTimeContract {
  return {
    timezone: "UTC",
    dailyBoundary: "00:00:00Z",
    cycleRef,
    asOf,
  };
}

export function isTimestampFuture(timestamp: string, asOf: string): boolean {
  return new Date(timestamp).getTime() > new Date(asOf).getTime();
}

// ─── Ethereum Eras ───────────────────────────────────────────────────

export type EthereumEra =
  | "PRE_EIP1559"
  | "EIP1559"
  | "MERGE"
  | "SHANGHAI"
  | "CANCUN"
  | "PECTRA"
  | "POST_FUSAKA"
  | "GLAMSTERDAM";

export const ETHEREUM_ERAS: EthereumEra[] = [
  "PRE_EIP1559",
  "EIP1559",
  "MERGE",
  "SHANGHAI",
  "CANCUN",
  "PECTRA",
  "POST_FUSAKA",
  "GLAMSTERDAM",
];

export const GLAMSTERDAM_STATUS: "PLANNED" | "ACTIVE" = "PLANNED";

export function isEraActive(era: EthereumEra): boolean {
  if (era === "GLAMSTERDAM") return false; // PLANNED, NOT_ACTIVE
  return true;
}

// ─── ETH/BTC Filter ──────────────────────────────────────────────────

export interface EthBtcFilterState {
  filterRequired: boolean;
  relativePair: string;
  ethBtcTrend: "UP" | "DOWN" | "FLAT" | "UNKNOWN";
  riskReductionMultiplier: number; // <= 1.0
}

export function applyEthBtcFilter(
  filter: EthBtcFilterState,
  baseWeight: number,
): number {
  if (!filter.filterRequired) return baseWeight;
  return baseWeight * filter.riskReductionMultiplier;
}

// ─── Exit Status (LAB_HYPOTHESIS) ────────────────────────────────────

export type ExitStatus = "NOT_ACTIVE" | "LAB_HYPOTHESIS";

export const BTC_EXIT_STATUS: ExitStatus = "LAB_HYPOTHESIS";
export const ETH_EXIT_STATUS: ExitStatus = "LAB_HYPOTHESIS";

// ─── Retention ───────────────────────────────────────────────────────

export const AMA_RETENTION_CLASS = "RESEARCH_LONG_TERM" as const;

export const RETENTION_AUTO_DELETE_PROHIBITED = [
  "OHLC",
  "HWM",
  "policies",
  "manifests",
  "macro_vintages",
  "datasets_replay",
] as const;
