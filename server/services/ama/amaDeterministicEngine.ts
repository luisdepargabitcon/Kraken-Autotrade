/**
 * AMA Deterministic Engine — Fase 10
 *
 * Deterministic tranche planning, guardrail validation, idempotency.
 * No randomness. No external calls. Pure functions.
 * Same inputs → same outputs, always.
 */

import { createHash } from "crypto";
import type {
  AmaResolvedParameters,
  AmaTranchePlan,
  AmaTrancheCandidate,
  MacroZone,
  TrancheType,
} from "./amaTypes";
import { computeDropPct, getMacroZone } from "./amaHwmBar";
import type { ResolvedSeedTranche, AssetSymbol } from "./amaSeedTypes";
import { getSeedTranches, getSeedMaximumTranchePct, isWeightMultiplierValid, validateSeedPolicy, BTC_SEED_POLICY, ETH_SEED_POLICY } from "./amaSeedTypes";

// ─── R5.2: ConfirmedDailyClose ───────────────────────────────────────

export interface ConfirmedDailyClose {
  timestamp: string;
  close: number;
  isClosed: true;
}

export function validateConfirmedDailyClose(
  close: { timestamp: string; close: number; isClosed: boolean },
): { valid: boolean; reasonCodes: string[] } {
  const reasonCodes: string[] = [];

  // Validate isClosed
  if (close.isClosed !== true) {
    reasonCodes.push("CANDLE_NOT_CLOSED");
    return { valid: false, reasonCodes };
  }

  // Validate close price
  if (typeof close.close !== "number" || Number.isNaN(close.close)) {
    reasonCodes.push("INVALID_PRICE_NAN");
    return { valid: false, reasonCodes };
  }
  if (!Number.isFinite(close.close)) {
    reasonCodes.push("INVALID_PRICE_INFINITY");
    return { valid: false, reasonCodes };
  }
  if (close.close <= 0) {
    reasonCodes.push("INVALID_PRICE_ZERO_OR_NEGATIVE");
    return { valid: false, reasonCodes };
  }

  // Validate timestamp
  const ts = new Date(close.timestamp).getTime();
  if (Number.isNaN(ts)) {
    reasonCodes.push("INVALID_TIMESTAMP");
    return { valid: false, reasonCodes };
  }

  return { valid: true, reasonCodes };
}

// ─── R5.3: CanonicalSeedEnvelope ─────────────────────────────────────

export interface CanonicalSeedEnvelope {
  asset: AssetSymbol;
  deploymentPct: number;
  reservePct: number;
  trancheCount: number;
  maxSeedTranchePct: number;
  policyId: string;
  policyVersion: number;
}

export function getCanonicalSeedEnvelope(asset: AssetSymbol): CanonicalSeedEnvelope {
  if (asset === "BTC") {
    return {
      asset: "BTC",
      deploymentPct: BTC_SEED_POLICY.capitalDeploymentPct,
      reservePct: BTC_SEED_POLICY.capitalReservePct,
      trancheCount: BTC_SEED_POLICY.trancheCount,
      maxSeedTranchePct: 18,
      policyId: BTC_SEED_POLICY.policyId,
      policyVersion: 1,
    };
  }
  return {
    asset: "ETH",
    deploymentPct: ETH_SEED_POLICY.capitalDeploymentPct,
    reservePct: ETH_SEED_POLICY.capitalReservePct,
    trancheCount: ETH_SEED_POLICY.trancheCount,
    maxSeedTranchePct: 12,
    policyId: ETH_SEED_POLICY.policyId,
    policyVersion: 1,
  };
}

// R6.6: EffectiveSeedConstraints
export interface EffectiveSeedConstraints {
  deploymentPct: number;
  reservePct: number;
  deployablePct: number;
  trancheCount: number;
}

export function validateAgainstSeedEnvelope(
  input: SeedTranchePlanInput,
): { valid: boolean; effective: EffectiveSeedConstraints; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  const envelope = getCanonicalSeedEnvelope(input.asset);

  // R5.3: Validate asset match
  if (input.parameters.asset !== input.asset) {
    reasonCodes.push("ASSET_MISMATCH");
    return { valid: false, effective: { deploymentPct: 0, reservePct: 0, deployablePct: 0, trancheCount: 0 }, reasonCodes };
  }

  // R5.3: User parameters can only be more conservative
  const effectiveDeploymentPct = Math.min(envelope.deploymentPct, input.parameters.maxCycleDeploymentPct);
  const effectiveReservePct = Math.max(envelope.reservePct, input.parameters.mandatoryReservePct);
  const effectiveTrancheCount = Math.min(envelope.trancheCount, input.parameters.absoluteTrancheCountCap);
  // R6.6: deployablePct = min(effectiveDeployment, 100 - effectiveReserve)
  const effectiveDeployablePct = Math.min(effectiveDeploymentPct, 100 - effectiveReservePct);

  // R5.3: Check that user params don't relax seed
  if (input.parameters.mandatoryReservePct < envelope.reservePct) {
    reasonCodes.push(`RESERVE_BELOW_SEED_MIN:${input.parameters.mandatoryReservePct}<${envelope.reservePct}`);
  }
  if (input.parameters.maxCycleDeploymentPct > envelope.deploymentPct) {
    reasonCodes.push(`DEPLOYMENT_ABOVE_SEED_MAX:${input.parameters.maxCycleDeploymentPct}>${envelope.deploymentPct}`);
  }

  return {
    valid: reasonCodes.length === 0,
    effective: { deploymentPct: effectiveDeploymentPct, reservePct: effectiveReservePct, deployablePct: effectiveDeployablePct, trancheCount: effectiveTrancheCount },
    reasonCodes,
  };
}

// ─── Risk Overlay Validation (R3 — fail-closed) ─────────────────────

export function isValidRiskOverlayMultiplier(value: number): boolean {
  if (typeof value !== "number") return false;
  if (!Number.isFinite(value)) return false;
  if (Number.isNaN(value)) return false;
  if (value <= 0) return false;
  if (value > 1.0) return false;
  return true;
}

export interface SeedTranchePlanInput {
  hwmPrice: number;
  hwmTimestamp: string;
  budgetUsd: number;
  deployedUsd: number;
  reservedUsd: number;
  parameters: AmaResolvedParameters;
  cycleId: string;
  asset: AssetSymbol;
  riskOverlayMultiplier: number;
  previousTranchePrice: number | null;
  atr: number | null;
}

export interface SeedTrancheLevel {
  trancheIndex: number;
  asset: AssetSymbol;
  triggerDropPct: number;
  triggerPrice: number;
  capitalPct: number;
  amountUsd: number;
  trancheType: TrancheType;
  policyId: string;
  policyVersion: number;
}

export interface SeedTrancheEligibilityResult {
  trancheIndex: number;
  eligible: boolean;
  eligibilityReasons: string[];
  confirmedClosePrice: number | null;
}

export function planSeedTranches(input: SeedTranchePlanInput): SeedTrancheLevel[] | null {
  if (!isValidRiskOverlayMultiplier(input.riskOverlayMultiplier)) {
    return null;
  }

  const seedTranches = getSeedTranches(input.asset);
  const { hwmPrice, budgetUsd, riskOverlayMultiplier } = input;

  return seedTranches.map((t) => {
    const triggerPrice = hwmPrice * (1 - t.triggerDropPct / 100);
    const baseAmountUsd = budgetUsd * (t.capitalPct / 100);
    const amountUsd = baseAmountUsd * riskOverlayMultiplier;
    return {
      trancheIndex: t.index,
      asset: t.asset,
      triggerDropPct: t.triggerDropPct,
      triggerPrice,
      capitalPct: t.capitalPct,
      amountUsd,
      trancheType: t.trancheType,
      policyId: t.policyId,
      policyVersion: t.policyVersion,
    };
  });
}

export function evaluateSeedTrancheEligibility(
  levels: SeedTrancheLevel[],
  confirmedClose: { timestamp: string; close: number; isClosed: boolean },
  cumulativeDeployedUsd: number,
  cumulativeEligibleCount: number,
  input: SeedTranchePlanInput,
  effectiveConstraints?: EffectiveSeedConstraints,
): SeedTrancheEligibilityResult[] {
  const { budgetUsd, deployedUsd, reservedUsd, parameters } = input;
  // R6.6: Use effective constraints if provided, otherwise fall back to parameters
  const effectiveDeploymentPct = effectiveConstraints?.deploymentPct ?? parameters.maxCycleDeploymentPct;
  const effectiveReservePct = effectiveConstraints?.reservePct ?? parameters.mandatoryReservePct;
  const mandatoryReserveUsd = budgetUsd * (effectiveReservePct / 100);
  const maxCycleDeploymentUsd = budgetUsd * (effectiveDeploymentPct / 100);
  const results: SeedTrancheEligibilityResult[] = [];
  let runningDeployedUsd = cumulativeDeployedUsd;
  let runningCount = cumulativeEligibleCount;

  for (const level of levels) {
    const reasons: string[] = [];
    let eligible = true;

    if (!confirmedClose.isClosed) {
      eligible = false;
      reasons.push("CANDLE_NOT_CLOSED");
    }

    if (confirmedClose.close > level.triggerPrice) {
      eligible = false;
      reasons.push("TRIGGER_NOT_REACHED");
    }

    if (eligible) {
      const projectedDeployedUsd = deployedUsd + runningDeployedUsd + level.amountUsd;
      const projectedFreeAfterCandidateUsd = budgetUsd - projectedDeployedUsd - reservedUsd;

      if (projectedFreeAfterCandidateUsd < 0) {
        eligible = false;
        reasons.push("INSUFFICIENT_FREE_BUDGET");
      }
      if (projectedDeployedUsd > maxCycleDeploymentUsd) {
        eligible = false;
        reasons.push("CYCLE_DEPLOYMENT_LIMIT_REACHED");
      }
      if (projectedFreeAfterCandidateUsd < mandatoryReserveUsd) {
        eligible = false;
        reasons.push("MANDATORY_RESERVE_WOULD_BE_VIOLATED");
      }
      if (projectedDeployedUsd > parameters.absoluteCapitalCapUsd) {
        eligible = false;
        reasons.push("ABSOLUTE_CAPITAL_CAP_EXCEEDED");
      }
      if (runningCount >= parameters.maximumCandidateTranches) {
        eligible = false;
        reasons.push("MAX_CANDIDATE_TRANCHES_REACHED");
      }
      if (runningCount >= parameters.absoluteTrancheCountCap) {
        eligible = false;
        reasons.push("ABSOLUTE_TRANCHE_COUNT_CAP_EXCEEDED");
      }
    }

    results.push({
      trancheIndex: level.trancheIndex,
      eligible,
      eligibilityReasons: reasons,
      confirmedClosePrice: confirmedClose.isClosed ? confirmedClose.close : null,
    });

    if (eligible) {
      runningDeployedUsd += level.amountUsd;
      runningCount++;
    }
  }

  return results;
}

// ─── Tranche Plan Input ─────────────────────────────────────────────

export interface TranchePlanInput {
  hwmPrice: number;
  currentPrice: number;
  cycleLowPrice: number | null;
  atr: number | null;
  budgetUsd: number;
  deployedUsd: number;
  reservedUsd: number;
  previousTranchePrice: number | null;
  parameters: AmaResolvedParameters;
  cycleId: string;
  asset: AssetSymbol;
  riskOverlayMultiplier: number;
}

// ─── Zone → Tranche Type Mapping ────────────────────────────────────

export function zoneToTrancheType(zone: MacroZone): TrancheType {
  switch (zone) {
    case "NORMAL": return "PROBE";
    case "RETROCESO": return "PROBE";
    case "CORRECCION": return "VALUE";
    case "VALUE": return "VALUE";
    case "DEEP_VALUE": return "DEEP_VALUE";
    case "CAPITULACION": return "CAPITULATION";
    case "CAPITULACION_EXTREMA": return "CAPITULATION";
    default: return "PROBE";
  }
}

function getZoneMultiplier(zone: MacroZone): number {
  switch (zone) {
    case "NORMAL": return 0.5;
    case "RETROCESO": return 0.7;
    case "CORRECCION": return 1.0;
    case "VALUE": return 1.5;
    case "DEEP_VALUE": return 2.0;
    case "CAPITULACION": return 2.5;
    case "CAPITULACION_EXTREMA": return 3.0;
    default: return 1.0;
  }
}

// ─── Seed-based Candidate Generation (R2) ───────────────────────────

export function generateTrancheCandidateFromSeed(
  input: TranchePlanInput,
  pricePoint: number,
  tranche: ResolvedSeedTranche,
  trancheIndex: number,
  cumulativeDeployedUsd: number,
  cumulativeEligibleCount: number,
): AmaTrancheCandidate | null {
  const { hwmPrice, budgetUsd, parameters, cycleId, previousTranchePrice, atr, asset, riskOverlayMultiplier } = input;

  const dropPct = computeDropPct(hwmPrice, pricePoint);
  if (dropPct <= 0) return null;

  // Check minimum spacing from previous tranche
  if (previousTranchePrice !== null) {
    const spacingFromPrevious = computeDropPct(previousTranchePrice, pricePoint);
    if (spacingFromPrevious < parameters.minimumSpacingPct) return null;
  }

  // Check ATR-based spacing
  if (atr !== null && previousTranchePrice !== null) {
    const atrSpacing = (previousTranchePrice - pricePoint) / atr;
    if (atrSpacing < parameters.spacingAtrMultiplier) return null;
  }

  // R3: Validate overlay — no silent clamping
  if (!isValidRiskOverlayMultiplier(riskOverlayMultiplier)) {
    return null;
  }

  // R3: Amount from seed tranche capitalPct, overlay already validated <= 1.0
  const baseAmountUsd = budgetUsd * (tranche.capitalPct / 100);
  const amountUsd = baseAmountUsd * riskOverlayMultiplier;

  const eligibilityReasons: string[] = [];
  let eligible = true;

  // R3: Cumulative budget check — no double discount
  const projectedDeployedUsd = input.deployedUsd + cumulativeDeployedUsd + amountUsd;
  const projectedFreeAfterCandidateUsd = input.budgetUsd - projectedDeployedUsd - input.reservedUsd;
  const mandatoryReserveUsd = budgetUsd * (parameters.mandatoryReservePct / 100);
  const maxCycleDeploymentUsd = budgetUsd * (parameters.maxCycleDeploymentPct / 100);

  if (projectedFreeAfterCandidateUsd < 0) {
    eligible = false;
    eligibilityReasons.push("INSUFFICIENT_FREE_BUDGET");
  }

  if (projectedDeployedUsd > maxCycleDeploymentUsd) {
    eligible = false;
    eligibilityReasons.push("CYCLE_DEPLOYMENT_LIMIT_REACHED");
  }

  if (projectedFreeAfterCandidateUsd < mandatoryReserveUsd) {
    eligible = false;
    eligibilityReasons.push("MANDATORY_RESERVE_WOULD_BE_VIOLATED");
  }

  if (projectedDeployedUsd > parameters.absoluteCapitalCapUsd) {
    eligible = false;
    eligibilityReasons.push("ABSOLUTE_CAPITAL_CAP_EXCEEDED");
  }

  if (cumulativeEligibleCount >= parameters.maximumCandidateTranches) {
    eligible = false;
    eligibilityReasons.push("MAX_CANDIDATE_TRANCHES_REACHED");
  }

  if (cumulativeEligibleCount >= parameters.absoluteTrancheCountCap) {
    eligible = false;
    eligibilityReasons.push("ABSOLUTE_TRANCHE_COUNT_CAP_EXCEEDED");
  }

  return {
    trancheId: `tranche-${cycleId}-${trancheIndex}`,
    type: tranche.trancheType,
    activationZone: getMacroZone(dropPct),
    activationDropPct: dropPct,
    amountUsd,
    spacingPct: parameters.minimumSpacingPct,
    eligible,
    eligibilityReasons,
    // R4.2: Canonical seed metadata
    asset: asset,
    seedTrancheIndex: tranche.index,
    canonicalTriggerDropPct: tranche.triggerDropPct,
    canonicalTriggerPrice: hwmPrice * (1 - tranche.triggerDropPct / 100),
    capitalPct: tranche.capitalPct,
    policyId: tranche.policyId,
    policyVersion: tranche.policyVersion,
    riskOverlayMultiplier: riskOverlayMultiplier,
  };
}

// ─── Legacy Candidate Generation (kept for backward compat) ──────────

export function generateTrancheCandidate(
  input: TranchePlanInput,
  pricePoint: number,
  trancheIndex: number,
): AmaTrancheCandidate | null {
  const { hwmPrice, budgetUsd, parameters, cycleId, previousTranchePrice, atr } = input;

  const dropPct = computeDropPct(hwmPrice, pricePoint);
  if (dropPct <= 0) return null;

  // Check minimum spacing from previous tranche
  if (previousTranchePrice !== null) {
    const spacingFromPrevious = computeDropPct(previousTranchePrice, pricePoint);
    if (spacingFromPrevious < parameters.minimumSpacingPct) return null;
  }

  // Check ATR-based spacing
  if (atr !== null && previousTranchePrice !== null) {
    const atrSpacing = (previousTranchePrice - pricePoint) / atr;
    if (atrSpacing < parameters.spacingAtrMultiplier) return null;
  }

  const macroZone = getMacroZone(dropPct);
  const trancheType = zoneToTrancheType(macroZone);
  const baseTrancheUsd = budgetUsd * (parameters.maxSingleTranchePct / 100);
  const zoneMultiplier = getZoneMultiplier(macroZone);
  const rawAmountUsd = baseTrancheUsd * zoneMultiplier;
  // maxSingleTranchePct is a HARD limit — cannot exceed it
  const amountUsd = Math.min(rawAmountUsd, baseTrancheUsd);

  const eligibilityReasons: string[] = [];
  let eligible = true;

  const freeUsd = input.budgetUsd - input.deployedUsd - input.reservedUsd;
  if (freeUsd < amountUsd) {
    eligible = false;
    eligibilityReasons.push("INSUFFICIENT_FREE_BUDGET");
  }

  const maxCycleDeploymentUsd = budgetUsd * (parameters.maxCycleDeploymentPct / 100);
  if (input.deployedUsd + amountUsd > maxCycleDeploymentUsd) {
    eligible = false;
    eligibilityReasons.push("CYCLE_DEPLOYMENT_LIMIT_REACHED");
  }

  const mandatoryReserveUsd = budgetUsd * (parameters.mandatoryReservePct / 100);
  const freeAfterTranche = freeUsd - amountUsd;
  if (freeAfterTranche < mandatoryReserveUsd) {
    eligible = false;
    eligibilityReasons.push("MANDATORY_RESERVE_WOULD_BE_VIOLATED");
  }

  if (input.deployedUsd + amountUsd > parameters.absoluteCapitalCapUsd) {
    eligible = false;
    eligibilityReasons.push("ABSOLUTE_CAPITAL_CAP_EXCEEDED");
  }

  if (trancheIndex >= parameters.maximumCandidateTranches) {
    eligible = false;
    eligibilityReasons.push("MAX_CANDIDATE_TRANCHES_REACHED");
  }

  if (trancheIndex >= parameters.absoluteTrancheCountCap) {
    eligible = false;
    eligibilityReasons.push("ABSOLUTE_TRANCHE_COUNT_CAP_EXCEEDED");
  }

  return {
    trancheId: `tranche-${cycleId}-${trancheIndex}`,
    type: trancheType,
    activationZone: macroZone,
    activationDropPct: dropPct,
    amountUsd,
    spacingPct: parameters.minimumSpacingPct,
    eligible,
    eligibilityReasons,
  };
}

// ─── Deterministic Tranche Planner (R2 — cumulative + seed-based) ───

export function planTranchesFromSeeds(
  input: TranchePlanInput,
  pricePoints: number[],
): AmaTranchePlan | null {
  // R3: Validate overlay before any planning
  if (!isValidRiskOverlayMultiplier(input.riskOverlayMultiplier)) {
    return null;
  }

  const { budgetUsd, parameters, cycleId, asset, hwmPrice } = input;
  const seedTranches = getSeedTranches(asset);

  const candidates: AmaTrancheCandidate[] = [];
  let previousPrice = input.previousTranchePrice;
  let plannedEligibleUsd = 0;
  let plannedEligibleCount = 0;

  for (let i = 0; i < seedTranches.length && i < pricePoints.length; i++) {
    const tranche = seedTranches[i];
    // R3: Derive trigger price from canonical seed trigger, not from external pricePoint
    const canonicalTriggerPrice = hwmPrice * (1 - tranche.triggerDropPct / 100);
    const price = pricePoints[i];

    const candidate = generateTrancheCandidateFromSeed(
      { ...input, previousTranchePrice: previousPrice },
      price,
      tranche,
      i,
      plannedEligibleUsd,
      plannedEligibleCount,
    );

    if (candidate === null) continue;

    // R3: Verify the price point actually reaches the canonical trigger
    if (candidate.eligible && price > canonicalTriggerPrice + 1e-6) {
      candidate.eligible = false;
      candidate.eligibilityReasons.push("TRIGGER_NOT_REACHED");
    }

    candidates.push(candidate);

    // R3: Only add to cumulative if eligible
    if (candidate.eligible) {
      plannedEligibleUsd += candidate.amountUsd;
      plannedEligibleCount++;
    }

    previousPrice = price;
  }

  if (candidates.length === 0) return null;

  const eligibleCount = candidates.filter((c) => c.eligible).length;
  const mandatoryReserveUsd = budgetUsd * (parameters.mandatoryReservePct / 100);
  const deployableCycleCapitalUsd = budgetUsd - mandatoryReserveUsd;

  const planId = computePlanId(cycleId, candidates);

  return {
    planId,
    cycleId,
    version: 1,
    plannedPurchaseCount: eligibleCount,
    candidateTranches: candidates,
    mandatoryReserveUsd,
    deployableCycleCapitalUsd,
    createdAt: new Date().toISOString(),
    // R7.6: Mandatory HWM/effective fields — defaults for legacy builder
    asOfConfirmedCloseTimestamp: new Date().toISOString(),
    asOfConfirmedClosePrice: 0,
    effectiveDeploymentPct: parameters.maxCycleDeploymentPct,
    effectiveReservePct: parameters.mandatoryReservePct,
    effectiveDeployablePct: 100 - parameters.mandatoryReservePct,
    hwmPrice: input.hwmPrice,
    hwmTimestamp: new Date().toISOString(),
  };
}

// ─── Legacy Tranche Planner (kept for backward compat) ──────────────

export function planTranches(
  input: TranchePlanInput,
  pricePoints: number[],
): AmaTranchePlan | null {
  const { budgetUsd, parameters, cycleId } = input;

  const candidates: AmaTrancheCandidate[] = [];
  let previousPrice = input.previousTranchePrice;
  let trancheIndex = 0;
  // R2: Cumulative tracking
  let plannedEligibleUsd = 0;
  let plannedEligibleCount = 0;

  for (const price of pricePoints) {
    const candidate = generateTrancheCandidate(
      { ...input, previousTranchePrice: previousPrice },
      price,
      trancheIndex,
    );

    if (candidate === null) continue;

    // R3: Re-check eligibility with cumulative amounts — no double discount
    if (candidate.eligible) {
      const projectedDeployedUsd = input.deployedUsd + plannedEligibleUsd + candidate.amountUsd;
      const projectedFreeAfterCandidateUsd = input.budgetUsd - projectedDeployedUsd - input.reservedUsd;
      const mandatoryReserveUsd = budgetUsd * (parameters.mandatoryReservePct / 100);
      const maxCycleDeploymentUsd = budgetUsd * (parameters.maxCycleDeploymentPct / 100);

      if (projectedDeployedUsd > maxCycleDeploymentUsd) {
        candidate.eligible = false;
        candidate.eligibilityReasons.push("CUMULATIVE_CYCLE_DEPLOYMENT_LIMIT");
      }
      if (projectedFreeAfterCandidateUsd < mandatoryReserveUsd) {
        candidate.eligible = false;
        candidate.eligibilityReasons.push("CUMULATIVE_RESERVE_VIOLATION");
      }
      if (projectedDeployedUsd > parameters.absoluteCapitalCapUsd) {
        candidate.eligible = false;
        candidate.eligibilityReasons.push("CUMULATIVE_CAPITAL_CAP_EXCEEDED");
      }
      if (plannedEligibleCount >= parameters.maximumCandidateTranches) {
        candidate.eligible = false;
        candidate.eligibilityReasons.push("CUMULATIVE_MAX_TRANCHES_REACHED");
      }
      if (plannedEligibleCount >= parameters.absoluteTrancheCountCap) {
        candidate.eligible = false;
        candidate.eligibilityReasons.push("CUMULATIVE_TRANCHE_COUNT_CAP_EXCEEDED");
      }
    }

    candidates.push(candidate);

    // R2: Only accumulate if still eligible after cumulative check
    if (candidate.eligible) {
      plannedEligibleUsd += candidate.amountUsd;
      plannedEligibleCount++;
    }

    previousPrice = price;
    trancheIndex++;
  }

  if (candidates.length === 0) return null;

  const eligibleCount = candidates.filter((c) => c.eligible).length;
  const mandatoryReserveUsd = budgetUsd * (parameters.mandatoryReservePct / 100);
  const deployableCycleCapitalUsd = budgetUsd - mandatoryReserveUsd;

  const planId = computePlanId(cycleId, candidates);

  return {
    planId,
    cycleId,
    version: 1,
    plannedPurchaseCount: eligibleCount,
    candidateTranches: candidates,
    mandatoryReserveUsd,
    deployableCycleCapitalUsd,
    createdAt: new Date().toISOString(),
    // R7.6: Mandatory HWM/effective fields — defaults for legacy builder
    asOfConfirmedCloseTimestamp: new Date().toISOString(),
    asOfConfirmedClosePrice: 0,
    effectiveDeploymentPct: parameters.maxCycleDeploymentPct,
    effectiveReservePct: parameters.mandatoryReservePct,
    effectiveDeployablePct: 100 - parameters.mandatoryReservePct,
    hwmPrice: input.hwmPrice,
    hwmTimestamp: new Date().toISOString(),
  };
}

// ─── Guardrail Validation ───────────────────────────────────────────

export interface GuardrailCheck {
  passed: boolean;
  violations: string[];
  warnings: string[];
}

export function validateGuardrails(
  plan: AmaTranchePlan,
  input: TranchePlanInput,
): GuardrailCheck {
  const violations: string[] = [];
  const warnings: string[] = [];
  const { parameters, budgetUsd, deployedUsd } = input;

  for (const candidate of plan.candidateTranches) {
    if (!candidate.eligible) continue;

    const maxSingleTrancheUsd = budgetUsd * (parameters.maxSingleTranchePct / 100);
    if (candidate.amountUsd > maxSingleTrancheUsd * 3) {
      violations.push(`SINGLE_TRANCHE_EXCEEDS_3X_LIMIT:${candidate.trancheId}`);
    }

    const maxCycleDeploymentUsd = budgetUsd * (parameters.maxCycleDeploymentPct / 100);
    if (deployedUsd + candidate.amountUsd > maxCycleDeploymentUsd) {
      violations.push(`CYCLE_DEPLOYMENT_EXCEEDS_LIMIT:${candidate.trancheId}`);
    }

    if (deployedUsd + candidate.amountUsd > parameters.absoluteCapitalCapUsd) {
      violations.push(`ABSOLUTE_CAPITAL_CAP_EXCEEDED:${candidate.trancheId}`);
    }

    if (candidate.activationZone === "CAPITULACION" || candidate.activationZone === "CAPITULACION_EXTREMA") {
      warnings.push(`CAPITULATION_ZONE_HIGH_RISK:${candidate.trancheId}`);
    }

    if (candidate.activationDropPct > 50) {
      warnings.push(`EXTREME_DROP_DETECTED:${candidate.trancheId}`);
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    warnings,
  };
}

// ─── Deterministic Hash ─────────────────────────────────────────────

function canonicalPlanPayload(plan: AmaTranchePlan): string {
  const payload = {
    cycleId: plan.cycleId,
    version: plan.version,
    plannedPurchaseCount: plan.plannedPurchaseCount,
    candidateTranches: plan.candidateTranches.map((c) => ({
      // R4.2: Include canonical seed metadata in hash
      asset: c.asset,
      seedTrancheIndex: c.seedTrancheIndex,
      canonicalTriggerDropPct: c.canonicalTriggerDropPct,
      canonicalTriggerPrice: c.canonicalTriggerPrice !== undefined ? Number(c.canonicalTriggerPrice.toFixed(8)) : undefined,
      capitalPct: c.capitalPct,
      policyId: c.policyId,
      policyVersion: c.policyVersion,
      riskOverlayMultiplier: c.riskOverlayMultiplier,
      type: c.type,
      activationZone: c.activationZone,
      activationDropPct: c.activationDropPct,
      amountUsd: Number(c.amountUsd.toFixed(8)),
      eligible: c.eligible,
      // R4.2: Exclude createdAt, planId, timestamps
    })),
    mandatoryReserveUsd: Number(plan.mandatoryReserveUsd.toFixed(8)),
    deployableCycleCapitalUsd: Number(plan.deployableCycleCapitalUsd.toFixed(8)),
  };
  return JSON.stringify(payload);
}

// R6.8/R7.7: Unified canonical plan identity payload — single source of truth
export function buildCanonicalPlanIdentityPayload(plan: AmaTranchePlan): string {
  const payload = {
    cycleId: plan.cycleId,
    version: plan.version,
    asset: plan.candidateTranches[0]?.asset,
    policyId: plan.candidateTranches[0]?.policyId,
    policyVersion: plan.candidateTranches[0]?.policyVersion,
    hwmPrice: plan.hwmPrice,
    hwmTimestamp: plan.hwmTimestamp,
    confirmedClosePrice: plan.asOfConfirmedClosePrice !== undefined ? Number(plan.asOfConfirmedClosePrice.toFixed(8)) : undefined,
    confirmedCloseTimestamp: plan.asOfConfirmedCloseTimestamp,
    effectiveDeploymentPct: plan.effectiveDeploymentPct,
    effectiveReservePct: plan.effectiveReservePct,
    effectiveDeployablePct: plan.effectiveDeployablePct,
    riskOverlayMultiplier: plan.candidateTranches[0]?.riskOverlayMultiplier,
    candidates: plan.candidateTranches
      .slice()
      .sort((a, b) => (a.seedTrancheIndex ?? 0) - (b.seedTrancheIndex ?? 0))
      .map((c) => ({
        trancheId: c.trancheId,
        seedTrancheIndex: c.seedTrancheIndex,
        plannedAmountUsd: c.plannedAmountUsd !== undefined ? Number(c.plannedAmountUsd.toFixed(8)) : undefined,
        executedAmountUsd: c.executedAmountUsd !== undefined ? Number(c.executedAmountUsd.toFixed(8)) : undefined,
        remainingAmountUsd: c.remainingAmountUsd !== undefined ? Number(c.remainingAmountUsd.toFixed(8)) : undefined,
        executionState: c.executionState,
        eligible: c.eligible,
        eligibilityReasons: [...c.eligibilityReasons].sort(),
        canonicalTriggerDropPct: c.canonicalTriggerDropPct,
        canonicalTriggerPrice: c.canonicalTriggerPrice !== undefined ? Number(c.canonicalTriggerPrice.toFixed(8)) : undefined,
        capitalPct: c.capitalPct,
        amountUsd: Number(c.amountUsd.toFixed(8)),
      })),
  };
  return JSON.stringify(payload);
}

// R7.7: computePlanId derives from the same hash as computePlanHash
export function computePlanId(cycleId: string, candidates: AmaTrancheCandidate[], confirmedClose?: { timestamp: string; close: number }): string {
  // R7.7: Build a temporary plan to compute hash via unified payload
  // This is used only by legacy callers; canonical flow uses finalizePlanIdentity
  const tempPlan: AmaTranchePlan = {
    planId: "",
    cycleId,
    version: 1,
    plannedPurchaseCount: candidates.filter((c) => c.eligible).length,
    candidateTranches: candidates,
    mandatoryReserveUsd: 0,
    deployableCycleCapitalUsd: 0,
    createdAt: new Date().toISOString(),
    asOfConfirmedCloseTimestamp: confirmedClose?.timestamp ?? "",
    asOfConfirmedClosePrice: confirmedClose?.close ?? 0,
    effectiveDeploymentPct: 0,
    effectiveReservePct: 0,
    effectiveDeployablePct: 0,
    hwmPrice: 0,
    hwmTimestamp: "",
  };
  const hash = computePlanHash(tempPlan);
  return `plan-${cycleId}-${hash.slice(0, 24)}`;
}

export function computePlanHash(plan: AmaTranchePlan): string {
  // R6.8: Use unified identity payload
  const payload = buildCanonicalPlanIdentityPayload(plan);
  return createHash("sha256").update(payload).digest("hex");
}

// ─── Idempotency Key (R7.8: derived from planHash, not independent params) ──

export function computeIdempotencyKey(
  planHash: string,
  trancheId: string,
  action: string,
  canonicalAsOfTimestamp: string,
): string {
  const payload = JSON.stringify({
    planHash,
    trancheId,
    action,
    canonicalAsOfTimestamp,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 24);
}

// ─── Idempotency Check ──────────────────────────────────────────────

export function isDuplicatePlan(
  newPlan: AmaTranchePlan,
  existingPlans: AmaTranchePlan[],
): boolean {
  const newHash = computePlanHash(newPlan);
  return existingPlans.some((p) => computePlanHash(p) === newHash);
}

// ─── R4.16: Validate Seed before planning ───────────────────────────

export function validateSeedBeforePlanning(input: SeedTranchePlanInput): string[] {
  const errors: string[] = [];

  // Validate seed policy
  const seedErrors = validateSeedPolicy(input.asset);
  errors.push(...seedErrors);

  // Validate asset match
  if (input.asset !== "BTC" && input.asset !== "ETH") {
    errors.push(`Invalid asset: ${input.asset}`);
  }

  // Validate budget
  if (typeof input.budgetUsd !== "number" || !Number.isFinite(input.budgetUsd) || input.budgetUsd <= 0) {
    errors.push("Budget must be > 0 and finite");
  }

  // Validate HWM
  if (typeof input.hwmPrice !== "number" || !Number.isFinite(input.hwmPrice) || input.hwmPrice <= 0) {
    errors.push("HWM must be > 0 and finite");
  }

  // R6.7: Validate hwmTimestamp
  if (typeof input.hwmTimestamp !== "string" || Number.isNaN(Date.parse(input.hwmTimestamp))) {
    errors.push("hwmTimestamp must be a valid timestamp");
  }

  // Validate deployed
  if (typeof input.deployedUsd !== "number" || !Number.isFinite(input.deployedUsd) || input.deployedUsd < 0) {
    errors.push("Deployed must be >= 0 and finite");
  }

  // Validate reserved
  if (typeof input.reservedUsd !== "number" || !Number.isFinite(input.reservedUsd) || input.reservedUsd < 0) {
    errors.push("Reserved must be >= 0 and finite");
  }

  // Validate deployed + reserved <= budget
  if (Number.isFinite(input.deployedUsd) && Number.isFinite(input.reservedUsd) && Number.isFinite(input.budgetUsd)) {
    if (input.deployedUsd + input.reservedUsd > input.budgetUsd) {
      errors.push("deployed + reserved > budget");
    }
  }

  // Validate overlay
  if (!isValidRiskOverlayMultiplier(input.riskOverlayMultiplier)) {
    errors.push("Invalid riskOverlayMultiplier");
  }

  return errors;
}

// ─── R4.1: buildCanonicalSeedPlan — canonical constructor ──────────

export function buildCanonicalSeedPlan(
  input: SeedTranchePlanInput,
  confirmedClose: { timestamp: string; close: number; isClosed: boolean },
): AmaTranchePlan | null {
  // R5.2: Validate confirmedClose before planning
  const closeValidation = validateConfirmedDailyClose(confirmedClose);
  if (!closeValidation.valid) {
    return null;
  }

  // R6.7: Validate confirmedClose.timestamp > hwmTimestamp
  const confirmedCloseTs = new Date(confirmedClose.timestamp).getTime();
  const hwmTs = new Date(input.hwmTimestamp).getTime();
  if (!Number.isNaN(hwmTs) && confirmedCloseTs <= hwmTs) {
    return null;
  }
  // R6.7: Normalize confirmedClose timestamp to UTC canonical
  const canonicalConfirmedCloseTimestamp = new Date(confirmedClose.timestamp).toISOString();

  // R4.16: Validate seed before planning
  const validationErrors = validateSeedBeforePlanning(input);
  if (validationErrors.length > 0) {
    return null;
  }

  // R5.3: Validate against canonical seed envelope
  const envelopeCheck = validateAgainstSeedEnvelope(input);
  if (!envelopeCheck.valid) {
    return null;
  }

  // R6.6: Use effective constraints
  const effectiveConstraints = envelopeCheck.effective;

  // R4.1: Plan seed tranches
  const levels = planSeedTranches(input);
  if (levels === null) return null;

  // R4.1: Evaluate eligibility with effective constraints
  const eligibilityResults = evaluateSeedTrancheEligibility(
    levels,
    confirmedClose,
    0, // cumulativeDeployedUsd
    0, // cumulativeEligibleCount
    input,
    effectiveConstraints,
  );

  // Build candidates with canonical metadata
  const candidates: AmaTrancheCandidate[] = levels.map((level, i) => {
    const eligibility = eligibilityResults[i];
    return {
      trancheId: `tranche-${input.cycleId}-${level.trancheIndex}`,
      type: level.trancheType,
      activationZone: getMacroZone(computeDropPct(input.hwmPrice, confirmedClose.close)),
      activationDropPct: computeDropPct(input.hwmPrice, confirmedClose.close),
      amountUsd: level.amountUsd,
      spacingPct: input.parameters.minimumSpacingPct,
      eligible: eligibility.eligible,
      eligibilityReasons: eligibility.eligibilityReasons,
      // R4.2: Canonical seed metadata
      asset: level.asset,
      seedTrancheIndex: level.trancheIndex,
      canonicalTriggerDropPct: level.triggerDropPct,
      canonicalTriggerPrice: level.triggerPrice,
      capitalPct: level.capitalPct,
      policyId: level.policyId,
      policyVersion: level.policyVersion,
      riskOverlayMultiplier: input.riskOverlayMultiplier,
      confirmedCloseTimestamp: confirmedClose.isClosed ? canonicalConfirmedCloseTimestamp : undefined,
      // R5.4: Fill tracking — initial state
      plannedAmountUsd: level.amountUsd,
      executedAmountUsd: 0,
      remainingAmountUsd: level.amountUsd,
      executionState: "NOT_EXECUTED" as const,
    };
  });

  const eligibleCount = candidates.filter((c) => c.eligible).length;
  // R6.6: Use effective constraints for reserve and deployable
  const mandatoryReserveUsd = input.budgetUsd * (effectiveConstraints.reservePct / 100);
  const deployableCycleCapitalUsd = input.budgetUsd * (effectiveConstraints.deployablePct / 100);

  // R5.8/R7.7: Compute planId from the final plan (unified identity)
  const finalPlan: AmaTranchePlan = {
    planId: "",
    cycleId: input.cycleId,
    version: 1,
    plannedPurchaseCount: eligibleCount,
    candidateTranches: candidates,
    mandatoryReserveUsd,
    deployableCycleCapitalUsd,
    createdAt: new Date().toISOString(),
    asOfConfirmedCloseTimestamp: canonicalConfirmedCloseTimestamp,
    asOfConfirmedClosePrice: confirmedClose.close,
    effectiveDeploymentPct: effectiveConstraints.deploymentPct,
    effectiveReservePct: effectiveConstraints.reservePct,
    effectiveDeployablePct: effectiveConstraints.deployablePct,
    hwmPrice: input.hwmPrice,
    hwmTimestamp: new Date(input.hwmTimestamp).toISOString(),
  };
  const planHash = computePlanHash(finalPlan);
  const planId = `plan-${input.cycleId}-${planHash.slice(0, 24)}`;

  return {
    ...finalPlan,
    planId,
  };
}
