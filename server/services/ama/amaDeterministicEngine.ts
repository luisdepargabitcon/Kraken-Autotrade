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
import { getSeedTranches, getSeedMaximumTranchePct, isWeightMultiplierValid } from "./amaSeedTypes";

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
): SeedTrancheEligibilityResult[] {
  const { budgetUsd, deployedUsd, reservedUsd, parameters } = input;
  const mandatoryReserveUsd = budgetUsd * (parameters.mandatoryReservePct / 100);
  const maxCycleDeploymentUsd = budgetUsd * (parameters.maxCycleDeploymentPct / 100);
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
      trancheId: c.trancheId,
      type: c.type,
      activationZone: c.activationZone,
      activationDropPct: c.activationDropPct,
      amountUsd: Number(c.amountUsd.toFixed(8)),
      eligible: c.eligible,
    })),
    mandatoryReserveUsd: Number(plan.mandatoryReserveUsd.toFixed(8)),
    deployableCycleCapitalUsd: Number(plan.deployableCycleCapitalUsd.toFixed(8)),
  };
  return JSON.stringify(payload);
}

function computePlanId(cycleId: string, candidates: AmaTrancheCandidate[]): string {
  const payload = JSON.stringify({
    cycleId,
    candidates: candidates.map((c) => ({
      id: c.trancheId,
      amt: Number(c.amountUsd.toFixed(8)),
    })),
  });
  const hash = createHash("sha256").update(payload).digest("hex").slice(0, 16);
  return `plan-${cycleId}-${hash}`;
}

export function computePlanHash(plan: AmaTranchePlan): string {
  const payload = canonicalPlanPayload(plan);
  return createHash("sha256").update(payload).digest("hex");
}

// ─── Idempotency Key (R2 — deterministic, no Date.now()) ─────────────

export function computeIdempotencyKey(
  asset: AssetSymbol,
  cycleId: string,
  policyVersion: number,
  trancheIndex: number,
  confirmedCandleTimestamp: string,
  action: string,
): string {
  const payload = JSON.stringify({
    asset,
    cycleId,
    policyVersion,
    trancheIndex,
    confirmedCandleTimestamp,
    action,
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
