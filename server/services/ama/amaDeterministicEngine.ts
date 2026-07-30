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

// ─── Candidate Generation ───────────────────────────────────────────

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

// ─── Deterministic Tranche Planner ──────────────────────────────────

export function planTranches(
  input: TranchePlanInput,
  pricePoints: number[],
): AmaTranchePlan | null {
  const { budgetUsd, parameters, cycleId } = input;

  const candidates: AmaTrancheCandidate[] = [];
  let previousPrice = input.previousTranchePrice;
  let trancheIndex = 0;

  for (const price of pricePoints) {
    const candidate = generateTrancheCandidate(
      { ...input, previousTranchePrice: previousPrice },
      price,
      trancheIndex,
    );

    if (candidate === null) continue;

    candidates.push(candidate);
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

// ─── Idempotency Check ──────────────────────────────────────────────

export function isDuplicatePlan(
  newPlan: AmaTranchePlan,
  existingPlans: AmaTranchePlan[],
): boolean {
  const newHash = computePlanHash(newPlan);
  return existingPlans.some((p) => computePlanHash(p) === newHash);
}
