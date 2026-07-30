/**
 * AMA Mandate Studio — Fase 8
 *
 * Mandate controls, policy resolver, preview, simulation, approval.
 * No REAL mode. No order execution. Simulation only.
 */

import type {
  AmaMandateInput,
  AmaResolvedPolicy,
  AmaResolvedParameters,
  RiskMandate,
  AccumulationStyle,
  ExitObjective,
  AutonomyLevel,
  PolicyStatus,
} from "./amaTypes";
import { AMA_STRATEGY_VERSION } from "./amaTypes";
import { createPolicy, activatePolicy, supersedePolicy } from "./amaDomainPersistent";
import { BTC_SEED_POLICY, ETH_SEED_POLICY } from "./amaSeedTypes";

// ─── Asset Envelope ──────────────────────────────────────────────────

export interface AssetEnvelope {
  minReservePct: number;
  maxDeploymentPct: number;
  maxTrancheCount: number;
  maxSingleTranchePct: number;
}

export function getAssetEnvelope(asset: "BTC" | "ETH"): AssetEnvelope {
  if (asset === "BTC") {
    return {
      minReservePct: BTC_SEED_POLICY.capitalReservePct,
      maxDeploymentPct: BTC_SEED_POLICY.capitalDeploymentPct,
      maxTrancheCount: BTC_SEED_POLICY.trancheCount,
      maxSingleTranchePct: 15,
    };
  }
  return {
    minReservePct: ETH_SEED_POLICY.capitalReservePct,
    maxDeploymentPct: ETH_SEED_POLICY.capitalDeploymentPct,
    maxTrancheCount: ETH_SEED_POLICY.trancheCount,
    maxSingleTranchePct: 15,
  };
}

export interface EnvelopeValidationResult {
  withinEnvelope: boolean;
  violations: string[];
  classification: "ACTIVE_POLICY" | "CHALLENGER_RESEARCH_ONLY";
}

export function validateAgainstEnvelope(
  params: AmaResolvedParameters,
  asset: "BTC" | "ETH",
): EnvelopeValidationResult {
  const envelope = getAssetEnvelope(asset);
  const violations: string[] = [];

  if (params.mandatoryReservePct < envelope.minReservePct) {
    violations.push(`RESERVE_BELOW_ENVELOPE: ${params.mandatoryReservePct}% < ${envelope.minReservePct}%`);
  }
  if (params.maxCycleDeploymentPct > envelope.maxDeploymentPct) {
    violations.push(`DEPLOYMENT_ABOVE_ENVELOPE: ${params.maxCycleDeploymentPct}% > ${envelope.maxDeploymentPct}%`);
  }
  if (params.maximumCandidateTranches > envelope.maxTrancheCount) {
    violations.push(`TRANCHE_COUNT_ABOVE_ENVELOPE: ${params.maximumCandidateTranches} > ${envelope.maxTrancheCount}`);
  }
  if (params.absoluteTrancheCountCap > envelope.maxTrancheCount) {
    violations.push(`TRANCHE_CAP_ABOVE_ENVELOPE: ${params.absoluteTrancheCountCap} > ${envelope.maxTrancheCount}`);
  }
  if (params.maxSingleTranchePct > envelope.maxSingleTranchePct) {
    violations.push(`SINGLE_TRANCHE_ABOVE_ENVELOPE: ${params.maxSingleTranchePct}% > ${envelope.maxSingleTranchePct}%`);
  }

  return {
    withinEnvelope: violations.length === 0,
    violations,
    classification: violations.length === 0 ? "ACTIVE_POLICY" : "CHALLENGER_RESEARCH_ONLY",
  };
}

// ─── Mandate Validation ─────────────────────────────────────────────

export function validateMandate(input: AmaMandateInput): string[] {
  const errors: string[] = [];

  if (input.maxCapitalUsd < 0) errors.push("NEGATIVE_CAPITAL");
  if (input.maxCapitalUsd > 1000000) errors.push("CAPITAL_EXCEEDS_SAFETY_LIMIT");

  const validRiskMandates: RiskMandate[] = ["MUY_PRUDENTE", "PRUDENTE", "EQUILIBRADO", "DINAMICO", "OPORTUNISTA"];
  if (!validRiskMandates.includes(input.riskMandate)) errors.push("INVALID_RISK_MANDATE");

  const validStyles: AccumulationStyle[] = ["ENTRAR_ANTES", "ADAPTATIVO", "ESPERAR_MAS_VALOR"];
  if (!validStyles.includes(input.accumulationStyle)) errors.push("INVALID_ACCUMULATION_STYLE");

  const validObjectives: ExitObjective[] = ["RECUPERAR_CAPITAL", "EQUILIBRADO", "ACUMULAR_BTC"];
  if (!validObjectives.includes(input.exitObjective)) errors.push("INVALID_EXIT_OBJECTIVE");

  const validAutonomy: AutonomyLevel[] = ["SOLO_ANALISIS", "SUPERVISADO", "AUTOPILOT"];
  if (!validAutonomy.includes(input.autonomyLevel)) errors.push("INVALID_AUTONOMY_LEVEL");

  // AUTOPILOT requires REAL mode which is blocked
  if (input.autonomyLevel === "AUTOPILOT") {
    errors.push("AUTOPILOT_REQUIRES_REAL_AUTHORIZATION");
  }

  return errors;
}

// ─── Policy Resolver ────────────────────────────────────────────────

export function resolvePolicyParameters(
  input: AmaMandateInput,
): AmaResolvedParameters {
  const baseParams: AmaResolvedParameters = {
    mandatoryReservePct: 25,
    maxSingleTranchePct: 15,
    maxCycleDeploymentPct: 75,
    maxWeeklyDeploymentPct: 30,
    maxMonthlyDeploymentPct: 60,
    minimumSpacingPct: 5,
    spacingAtrMultiplier: 3.0,
    minimumDataCoveragePct: 90,
    requiredConfirmationStrength: 3,
    cooldownPolicy: "1_daily",
    maximumCandidateTranches: 6,
    absoluteSafetyCap: input.maxCapitalUsd,
    absoluteCapitalCapUsd: input.maxCapitalUsd,
    absoluteTrancheCountCap: 6,
    spreadTolerancePct: 0.5,
    crossVenueBasisTolerancePct: 1.0,
    profitRecoveryPolicy: "trailing",
    deRiskPolicy: "gradual",
    runnerPolicy: "50_pct",
    trailingPolicy: "atr_based",
    thesisInvalidationPolicy: "strict",
    asset: input.asset,
  };

  // Adjust based on risk mandate
  switch (input.riskMandate) {
    case "MUY_PRUDENTE":
      baseParams.mandatoryReservePct = 30;
      baseParams.maxSingleTranchePct = 10;
      baseParams.maxCycleDeploymentPct = 60;
      baseParams.maxWeeklyDeploymentPct = 20;
      baseParams.spacingAtrMultiplier = 4.0;
      baseParams.requiredConfirmationStrength = 5;
      baseParams.maximumCandidateTranches = 4;
      baseParams.absoluteTrancheCountCap = 4;
      break;
    case "PRUDENTE":
      baseParams.mandatoryReservePct = 25;
      baseParams.maxSingleTranchePct = 15;
      baseParams.maxCycleDeploymentPct = 75;
      baseParams.spacingAtrMultiplier = 3.0;
      baseParams.requiredConfirmationStrength = 3;
      baseParams.maximumCandidateTranches = 6;
      baseParams.absoluteTrancheCountCap = 6;
      break;
    case "EQUILIBRADO":
      baseParams.mandatoryReservePct = 20;
      baseParams.maxSingleTranchePct = 20;
      baseParams.maxCycleDeploymentPct = 80;
      baseParams.spacingAtrMultiplier = 2.5;
      baseParams.requiredConfirmationStrength = 2;
      baseParams.maximumCandidateTranches = 8;
      baseParams.absoluteTrancheCountCap = 8;
      break;
    case "DINAMICO":
      baseParams.mandatoryReservePct = 15;
      baseParams.maxSingleTranchePct = 25;
      baseParams.maxCycleDeploymentPct = 85;
      baseParams.spacingAtrMultiplier = 2.0;
      baseParams.requiredConfirmationStrength = 2;
      baseParams.maximumCandidateTranches = 10;
      baseParams.absoluteTrancheCountCap = 10;
      break;
    case "OPORTUNISTA":
      baseParams.mandatoryReservePct = 10;
      baseParams.maxSingleTranchePct = 30;
      baseParams.maxCycleDeploymentPct = 90;
      baseParams.spacingAtrMultiplier = 1.5;
      baseParams.requiredConfirmationStrength = 1;
      baseParams.maximumCandidateTranches = 12;
      baseParams.absoluteTrancheCountCap = 12;
      break;
  }

  // Clamp to asset envelope — parameters outside envelope are capped, not silently passed
  const envelope = getAssetEnvelope(input.asset);
  if (baseParams.mandatoryReservePct < envelope.minReservePct) {
    baseParams.mandatoryReservePct = envelope.minReservePct;
  }
  if (baseParams.maxCycleDeploymentPct > envelope.maxDeploymentPct) {
    baseParams.maxCycleDeploymentPct = envelope.maxDeploymentPct;
  }
  if (baseParams.maximumCandidateTranches > envelope.maxTrancheCount) {
    baseParams.maximumCandidateTranches = envelope.maxTrancheCount;
  }
  if (baseParams.absoluteTrancheCountCap > envelope.maxTrancheCount) {
    baseParams.absoluteTrancheCountCap = envelope.maxTrancheCount;
  }
  if (baseParams.maxSingleTranchePct > envelope.maxSingleTranchePct) {
    baseParams.maxSingleTranchePct = envelope.maxSingleTranchePct;
  }

  // Adjust based on accumulation style
  if (input.accumulationStyle === "ENTRAR_ANTES") {
    baseParams.minimumSpacingPct = Math.max(3, baseParams.minimumSpacingPct - 2);
  } else if (input.accumulationStyle === "ESPERAR_MAS_VALOR") {
    baseParams.minimumSpacingPct = Math.min(10, baseParams.minimumSpacingPct + 3);
    baseParams.spacingAtrMultiplier += 0.5;
  }

  // Adjust based on exit objective
  if (input.exitObjective === "RECUPERAR_CAPITAL") {
    baseParams.profitRecoveryPolicy = "immediate";
    baseParams.runnerPolicy = "0_pct";
  } else if (input.exitObjective === "ACUMULAR_BTC") {
    baseParams.profitRecoveryPolicy = "hold";
    baseParams.runnerPolicy = "100_pct";
  }

  return baseParams;
}

// ─── Mandate Preview ────────────────────────────────────────────────

export interface MandatePreview {
  input: AmaMandateInput;
  resolvedParameters: AmaResolvedParameters;
  warnings: string[];
  estimatedMaxDeploymentUsd: number;
  estimatedReserveUsd: number;
  estimatedTrancheCount: number;
}

export function generateMandatePreview(
  input: AmaMandateInput,
): MandatePreview {
  const params = resolvePolicyParameters(input);
  const warnings: string[] = [];

  if (input.riskMandate === "OPORTUNISTA") {
    const envelopeCheck = validateAgainstEnvelope(params, input.asset);
    if (!envelopeCheck.withinEnvelope) {
      warnings.push(`OPORTUNISTA clamped to asset envelope: ${envelopeCheck.violations.join(", ")}`);
    }
    warnings.push("Riesgo OPORTUNISTA: alta exposición por tranche");
  }
  if (input.autonomyLevel === "AUTOPILOT") {
    warnings.push("AUTOPILOT requiere autorización REAL explícita");
  }
  if (input.maxCapitalUsd > 50000) {
    warnings.push("Capital elevado: verificar tolerancia personal");
  }

  const estimatedMaxDeploymentUsd = input.maxCapitalUsd * (params.maxCycleDeploymentPct / 100);
  const estimatedReserveUsd = input.maxCapitalUsd * (params.mandatoryReservePct / 100);

  return {
    input,
    resolvedParameters: params,
    warnings,
    estimatedMaxDeploymentUsd,
    estimatedReserveUsd,
    estimatedTrancheCount: params.maximumCandidateTranches,
  };
}

// ─── Mandate Simulation ─────────────────────────────────────────────

export interface SimulationResult {
  simulationId: string;
  input: AmaMandateInput;
  parameters: AmaResolvedParameters;
  scenarios: SimulationScenario[];
  summary: {
    maxDrawdownPct: number;
    maxExposureUsd: number;
    expectedTranches: number;
    reserveMaintained: boolean;
  };
}

export interface SimulationScenario {
  name: string;
  dropPct: number;
  tranchesTriggered: number;
  deployedUsd: number;
  remainingUsd: number;
}

export function simulateMandate(
  input: AmaMandateInput,
  scenarios: { name: string; dropPct: number }[] = [
    { name: "CORRECCION", dropPct: 20 },
    { name: "VALUE", dropPct: 35 },
    { name: "DEEP_VALUE", dropPct: 50 },
    { name: "CAPITULACION", dropPct: 60 },
  ],
): SimulationResult {
  const params = resolvePolicyParameters(input);
  const simScenarios: SimulationScenario[] = [];

  for (const scenario of scenarios) {
    const trancheSize = input.maxCapitalUsd * (params.maxSingleTranchePct / 100);
    const maxDeployable = input.maxCapitalUsd * (params.maxCycleDeploymentPct / 100);
    const tranchesTriggered = Math.min(
      Math.floor(scenario.dropPct / params.minimumSpacingPct),
      params.maximumCandidateTranches,
    );
    const deployedUsd = Math.min(tranchesTriggered * trancheSize, maxDeployable);
    const remainingUsd = input.maxCapitalUsd - deployedUsd;

    simScenarios.push({
      name: scenario.name,
      dropPct: scenario.dropPct,
      tranchesTriggered,
      deployedUsd,
      remainingUsd,
    });
  }

  const maxExposure = Math.max(...simScenarios.map((s) => s.deployedUsd));
  const maxDrawdownPct = (maxExposure / input.maxCapitalUsd) * 100;
  const reserveMaintained = simScenarios.every(
    (s) => s.remainingUsd >= input.maxCapitalUsd * (params.mandatoryReservePct / 100),
  );

  return {
    simulationId: `sim-${Date.now()}`,
    input,
    parameters: params,
    scenarios: simScenarios,
    summary: {
      maxDrawdownPct,
      maxExposureUsd: maxExposure,
      expectedTranches: params.maximumCandidateTranches,
      reserveMaintained,
    },
  };
}

// ─── Mandate Approval Flow ──────────────────────────────────────────

export type ApprovalState = "DRAFT" | "PREVIEWED" | "SIMULATED" | "APPROVED" | "REJECTED" | "ACTIVATED";

export interface MandateApproval {
  mandateId: string;
  state: ApprovalState;
  input: AmaMandateInput;
  preview: MandatePreview | null;
  simulation: SimulationResult | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  policyId: string | null;
}

export function createMandateApproval(input: AmaMandateInput): MandateApproval | null {
  const errors = validateMandate(input);
  if (errors.length > 0) return null;

  return {
    mandateId: `mandate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    state: "DRAFT",
    input,
    preview: null,
    simulation: null,
    approvedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    policyId: null,
  };
}

export function previewMandate(approval: MandateApproval): MandateApproval {
  const preview = generateMandatePreview(approval.input);
  return { ...approval, preview, state: "PREVIEWED" };
}

export function simulateMandateApproval(approval: MandateApproval): MandateApproval {
  const simulation = simulateMandate(approval.input);
  return { ...approval, simulation, state: "SIMULATED" };
}

export function approveMandate(approval: MandateApproval): MandateApproval {
  if (approval.state !== "SIMULATED") {
    throw new Error("Mandate must be SIMULATED before approval");
  }
  return {
    ...approval,
    state: "APPROVED",
    approvedAt: new Date().toISOString(),
  };
}

export function rejectMandate(approval: MandateApproval, reason: string): MandateApproval {
  return {
    ...approval,
    state: "REJECTED",
    rejectedAt: new Date().toISOString(),
    rejectionReason: reason,
  };
}

export function activateMandate(approval: MandateApproval): { approval: MandateApproval; policy: AmaResolvedPolicy } {
  if (approval.state !== "APPROVED") {
    throw new Error("Mandate must be APPROVED before activation");
  }

  const params = resolvePolicyParameters(approval.input);
  const policy = createPolicy(
    approval.mandateId,
    1,
    approval.input,
    params,
    "1.0.0",
  );
  const activated = activatePolicy(policy);

  return {
    approval: { ...approval, state: "ACTIVATED", policyId: activated.policyId },
    policy: activated,
  };
}

export function canTransitionToApprovalState(from: ApprovalState, to: ApprovalState): boolean {
  const flow: Record<ApprovalState, ApprovalState[]> = {
    DRAFT: ["PREVIEWED", "REJECTED"],
    PREVIEWED: ["SIMULATED", "REJECTED"],
    SIMULATED: ["APPROVED", "REJECTED"],
    APPROVED: ["ACTIVATED", "REJECTED"],
    REJECTED: [],
    ACTIVATED: [],
  };
  return flow[from]?.includes(to) ?? false;
}
