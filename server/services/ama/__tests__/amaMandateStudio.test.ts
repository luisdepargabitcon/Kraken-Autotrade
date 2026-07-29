/**
 * AMA Mandate Studio — Fase 8: tests
 */

import { describe, it, expect } from "vitest";
import {
  validateMandate,
  resolvePolicyParameters,
  generateMandatePreview,
  simulateMandate,
  createMandateApproval,
  previewMandate,
  simulateMandateApproval,
  approveMandate,
  rejectMandate,
  activateMandate,
  canTransitionToApprovalState,
} from "../amaMandateStudio";
import type { AmaMandateInput } from "../amaTypes";


const makeInput = (overrides: Partial<AmaMandateInput> = {}): AmaMandateInput => ({
  maxCapitalUsd: 10000,
  riskMandate: "PRUDENTE",
  accumulationStyle: "ADAPTATIVO",
  exitObjective: "EQUILIBRADO",
  autonomyLevel: "SOLO_ANALISIS",
  ...overrides,
});

// ─── Validation ─────────────────────────────────────────────────────

describe("Fase 8 — Mandate Validation", () => {
  it("validates correct mandate", () => {
    expect(validateMandate(makeInput())).toHaveLength(0);
  });

  it("rejects negative capital", () => {
    expect(validateMandate(makeInput({ maxCapitalUsd: -1 }))).toContain("NEGATIVE_CAPITAL");
  });

  it("rejects capital exceeding safety limit", () => {
    expect(validateMandate(makeInput({ maxCapitalUsd: 2000000 }))).toContain("CAPITAL_EXCEEDS_SAFETY_LIMIT");
  });

  it("rejects AUTOPILOT without REAL authorization", () => {
    expect(validateMandate(makeInput({ autonomyLevel: "AUTOPILOT" }))).toContain("AUTOPILOT_REQUIRES_REAL_AUTHORIZATION");
  });
});

// ─── Policy Resolver ────────────────────────────────────────────────

describe("Fase 8 — Policy Resolver", () => {
  it("resolves MUY_PRUDENTE with conservative params", () => {
    const params = resolvePolicyParameters(makeInput({ riskMandate: "MUY_PRUDENTE" }));
    expect(params.mandatoryReservePct).toBe(30);
    expect(params.maxSingleTranchePct).toBe(10);
    expect(params.spacingAtrMultiplier).toBe(4.0);
    expect(params.requiredConfirmationStrength).toBe(5);
    expect(params.maximumCandidateTranches).toBe(4);
  });

  it("resolves PRUDENTE with moderate params", () => {
    const params = resolvePolicyParameters(makeInput({ riskMandate: "PRUDENTE" }));
    expect(params.mandatoryReservePct).toBe(25);
    expect(params.maxSingleTranchePct).toBe(15);
    expect(params.spacingAtrMultiplier).toBe(3.0);
  });

  it("resolves OPORTUNISTA with aggressive params", () => {
    const params = resolvePolicyParameters(makeInput({ riskMandate: "OPORTUNISTA" }));
    expect(params.mandatoryReservePct).toBe(10);
    expect(params.maxSingleTranchePct).toBe(30);
    expect(params.spacingAtrMultiplier).toBe(1.5);
    expect(params.requiredConfirmationStrength).toBe(1);
    expect(params.maximumCandidateTranches).toBe(12);
  });

  it("adjusts for ENTRAR_ANTES style", () => {
    const params = resolvePolicyParameters(makeInput({ accumulationStyle: "ENTRAR_ANTES" }));
    expect(params.minimumSpacingPct).toBeLessThanOrEqual(5);
  });

  it("adjusts for ESPERAR_MAS_VALOR style", () => {
    const params = resolvePolicyParameters(makeInput({ accumulationStyle: "ESPERAR_MAS_VALOR" }));
    expect(params.minimumSpacingPct).toBeGreaterThanOrEqual(5);
    expect(params.spacingAtrMultiplier).toBeGreaterThan(3.0);
  });

  it("adjusts for RECUPERAR_CAPITAL exit", () => {
    const params = resolvePolicyParameters(makeInput({ exitObjective: "RECUPERAR_CAPITAL" }));
    expect(params.profitRecoveryPolicy).toBe("immediate");
    expect(params.runnerPolicy).toBe("0_pct");
  });

  it("adjusts for ACUMULAR_BTC exit", () => {
    const params = resolvePolicyParameters(makeInput({ exitObjective: "ACUMULAR_BTC" }));
    expect(params.profitRecoveryPolicy).toBe("hold");
    expect(params.runnerPolicy).toBe("100_pct");
  });

  it("sets absoluteSafetyCap to maxCapitalUsd", () => {
    const params = resolvePolicyParameters(makeInput({ maxCapitalUsd: 25000 }));
    expect(params.absoluteSafetyCap).toBe(25000);
  });
});

// ─── Preview ────────────────────────────────────────────────────────

describe("Fase 8 — Mandate Preview", () => {
  it("generates preview with warnings", () => {
    const preview = generateMandatePreview(makeInput({ riskMandate: "OPORTUNISTA" }));
    expect(preview.warnings).toContain("Riesgo OPORTUNISTA: alta exposición por tranche");
    expect(preview.estimatedMaxDeploymentUsd).toBe(9000); // 90% of 10000
    expect(preview.estimatedReserveUsd).toBe(1000); // 10% of 10000
    expect(preview.estimatedTrancheCount).toBe(12);
  });

  it("warns on high capital", () => {
    const preview = generateMandatePreview(makeInput({ maxCapitalUsd: 60000 }));
    expect(preview.warnings).toContain("Capital elevado: verificar tolerancia personal");
  });

  it("warns on AUTOPILOT", () => {
    const preview = generateMandatePreview(makeInput({ autonomyLevel: "AUTOPILOT" }));
    expect(preview.warnings).toContain("AUTOPILOT requiere autorización REAL explícita");
  });
});

// ─── Simulation ─────────────────────────────────────────────────────

describe("Fase 8 — Mandate Simulation", () => {
  it("simulates multiple scenarios", () => {
    const result = simulateMandate(makeInput());
    expect(result.scenarios).toHaveLength(4);
    expect(result.scenarios[0].name).toBe("CORRECCION");
    expect(result.scenarios[3].name).toBe("CAPITULACION");
  });

  it("respects max deployment cap", () => {
    const result = simulateMandate(makeInput({ maxCapitalUsd: 10000, riskMandate: "PRUDENTE" }));
    const maxDeployed = Math.max(...result.scenarios.map((s) => s.deployedUsd));
    expect(maxDeployed).toBeLessThanOrEqual(7500); // 75% of 10000
  });

  it("maintains reserve in conservative mandates", () => {
    const result = simulateMandate(makeInput({ riskMandate: "MUY_PRUDENTE" }));
    expect(result.summary.reserveMaintained).toBe(true);
  });

  it("generates unique simulation ID", () => {
    const result = simulateMandate(makeInput());
    expect(result.simulationId).toMatch(/^sim-/);
  });
});

// ─── Approval Flow ──────────────────────────────────────────────────

describe("Fase 8 — Approval Flow", () => {
  it("creates mandate approval from valid input", () => {
    const approval = createMandateApproval(makeInput());
    expect(approval).not.toBeNull();
    expect(approval!.state).toBe("DRAFT");
    expect(approval!.mandateId).toMatch(/^mandate-/);
  });

  it("rejects invalid mandate", () => {
    const approval = createMandateApproval(makeInput({ maxCapitalUsd: -1 }));
    expect(approval).toBeNull();
  });

  it("flows DRAFT → PREVIEWED → SIMULATED → APPROVED → ACTIVATED", () => {
    const draft = createMandateApproval(makeInput())!;
    const previewed = previewMandate(draft);
    expect(previewed.state).toBe("PREVIEWED");
    expect(previewed.preview).not.toBeNull();

    const simulated = simulateMandateApproval(previewed);
    expect(simulated.state).toBe("SIMULATED");
    expect(simulated.simulation).not.toBeNull();

    const approved = approveMandate(simulated);
    expect(approved.state).toBe("APPROVED");
    expect(approved.approvedAt).not.toBeNull();

    const { approval: activated, policy } = activateMandate(approved);
    expect(activated.state).toBe("ACTIVATED");
    expect(activated.policyId).not.toBeNull();
    expect(policy.status).toBe("ACTIVE");
  });

  it("rejects approval without simulation", () => {
    const draft = createMandateApproval(makeInput())!;
    expect(() => approveMandate(draft)).toThrow();
  });

  it("rejects activation without approval", () => {
    const draft = createMandateApproval(makeInput())!;
    const previewed = previewMandate(draft);
    const simulated = simulateMandateApproval(previewed);
    expect(() => activateMandate(simulated)).toThrow();
  });

  it("can reject at any pre-activation state", () => {
    const draft = createMandateApproval(makeInput())!;
    const rejected = rejectMandate(draft, "Too risky");
    expect(rejected.state).toBe("REJECTED");
    expect(rejected.rejectionReason).toBe("Too risky");
  });

  it("validates state transitions", () => {
    expect(canTransitionToApprovalState("DRAFT", "PREVIEWED")).toBe(true);
    expect(canTransitionToApprovalState("PREVIEWED", "SIMULATED")).toBe(true);
    expect(canTransitionToApprovalState("SIMULATED", "APPROVED")).toBe(true);
    expect(canTransitionToApprovalState("APPROVED", "ACTIVATED")).toBe(true);
    expect(canTransitionToApprovalState("DRAFT", "APPROVED")).toBe(false);
    expect(canTransitionToApprovalState("REJECTED", "DRAFT")).toBe(false);
    expect(canTransitionToApprovalState("ACTIVATED", "DRAFT")).toBe(false);
  });
});
