/**
 * AMA Policy Resolver — Maps mandate inputs to resolved policy parameters.
 *
 * Uses seed policy profiles (BTC/ETH) as the base and adjusts based on
 * user-selected risk mandate, accumulation style, exit objective, and autonomy.
 *
 * SAFETY: No orders. No exchange calls. Pure function.
 */

import type {
  AmaMandateInput,
  AmaResolvedParameters,
  AmaResolvedPolicy,
  PolicyStatus,
} from "./amaTypes";
import { AMA_STRATEGY_VERSION } from "./amaTypes";
import { createPolicy, activatePolicy } from "./amaDomainPersistent";
import {
  BTC_SEED_POLICY,
  ETH_SEED_POLICY,
  computeEffectiveMaximumTranchePct,
  type AssetSymbol,
} from "./amaSeedTypes";
import { insertPolicy, updatePolicyStatus } from "./amaRepository";

const RESOLVER_VERSION = "1.0.0";

// Risk mandate multipliers — RISK_DOWN_ONLY, never amplifies
const RISK_MANDATE_MULTIPLIERS: Record<string, number> = {
  MUY_PRUDENTE: 0.50,
  PRUDENTE: 0.70,
  EQUILIBRADO: 0.85,
  DINAMICO: 0.95,
  OPORTUNISTA: 1.00,
};

// Accumulation style adjustments
const ACCUMULATION_STYLE_ADJUSTMENTS: Record<string, { deploymentPct: number; reservePct: number }> = {
  ENTRAR_ANTES: { deploymentPct: 80, reservePct: 20 },
  ADAPTATIVO: { deploymentPct: 75, reservePct: 25 },
  ESPERAR_MAS_VALOR: { deploymentPct: 70, reservePct: 30 },
};

export function resolvePolicyParameters(
  input: AmaMandateInput,
): AmaResolvedParameters {
  const asset = input.asset;
  const seedPolicy = asset === "BTC" ? BTC_SEED_POLICY : ETH_SEED_POLICY;

  const riskMultiplier = RISK_MANDATE_MULTIPLIERS[input.riskMandate] ?? 0.70;
  const styleAdjust = ACCUMULATION_STYLE_ADJUSTMENTS[input.accumulationStyle] ?? { deploymentPct: 75, reservePct: 25 };

  // Effective deployment and reserve percentages
  const effectiveDeploymentPct = Math.min(
    seedPolicy.capitalDeploymentPct,
    styleAdjust.deploymentPct,
  );
  const effectiveReservePct = Math.max(
    seedPolicy.capitalReservePct,
    styleAdjust.reservePct,
  );

  // Maximum single tranche percentage (risk-adjusted)
  const baseMaxTranchePct = computeEffectiveMaximumTranchePct(asset, seedPolicy.capitalDeploymentPct);
  const maxSingleTranchePct = baseMaxTranchePct * riskMultiplier;

  // Maximum cycle deployment
  const maxCycleDeploymentPct = effectiveDeploymentPct * riskMultiplier;

  // Spread tolerance (maker-only)
  const spreadTolerancePct = 0.50;

  // Minimum data coverage
  const minimumDataCoveragePct = 90;

  // Maximum candidate tranches
  const maximumCandidateTranches = seedPolicy.trancheCount;

  // ATR multiplier — BTC uses atrMultiplier, ETH uses atrMultiplierCenter
  const atrMultiplier = "atrMultiplier" in seedPolicy
    ? seedPolicy.atrMultiplier
    : seedPolicy.atrMultiplierCenter;

  // Absolute caps
  const absoluteCapitalCapUsd = input.maxCapitalUsd;
  const absoluteTrancheCountCap = seedPolicy.trancheCount;
  const absoluteSafetyCap = absoluteCapitalCapUsd; // deprecated alias

  return {
    mandatoryReservePct: effectiveReservePct,
    maxSingleTranchePct,
    maxCycleDeploymentPct,
    maxWeeklyDeploymentPct: maxCycleDeploymentPct * 0.4,
    maxMonthlyDeploymentPct: maxCycleDeploymentPct * 0.8,
    minimumSpacingPct: 5.0,
    spacingAtrMultiplier: atrMultiplier,
    minimumDataCoveragePct,
    requiredConfirmationStrength: seedPolicy.requiredDailyCloses,
    cooldownPolicy: "ONE_TRANCHE_PER_DAILY_CLOSE",
    maximumCandidateTranches,
    absoluteSafetyCap,
    absoluteCapitalCapUsd,
    absoluteTrancheCountCap,
    spreadTolerancePct,
    crossVenueBasisTolerancePct: 1.0,
    profitRecoveryPolicy: "LAB_HYPOTHESIS",
    deRiskPolicy: "RECOVER_PRINCIPAL_FIRST",
    runnerPolicy: "HOLD_LONG_TERM",
    trailingPolicy: "NO_TRAILING_IN_LAB",
    thesisInvalidationPolicy: "MANUAL_REVIEW_REQUIRED",
    asset,
  };
}

/**
 * Full policy resolution flow: create policy, persist, return.
 */
export async function resolveAndPersistPolicy(
  mandateId: string,
  input: AmaMandateInput,
): Promise<AmaResolvedPolicy> {
  const resolvedParameters = resolvePolicyParameters(input);
  const policy = createPolicy(
    mandateId,
    1,
    input,
    resolvedParameters,
    RESOLVER_VERSION,
  );

  await insertPolicy(policy);
  return policy;
}

/**
 * Activate a resolved policy: update status to ACTIVE, persist.
 */
export async function activatePersistedPolicy(
  policyId: string,
): Promise<void> {
  await updatePolicyStatus(policyId, "ACTIVE" as PolicyStatus);
}
