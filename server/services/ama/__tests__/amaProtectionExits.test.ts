/**
 * AMA Cycle Protection & Exits — Fases 13-14: tests
 */

import { describe, it, expect } from "vitest";
import {
  assessCycleProtection,
  shouldBlockNewTranche,
  shouldTriggerEmergencyExit,
  determineExitPhase,
  computeTrailingStop,
  shouldTriggerTrailingStop,
  computeDistributionSize,
  createExitStrategy,
} from "../amaProtectionExits";
import type { AmaCycle, AmaResolvedParameters } from "../amaTypes";

const makeParams = (): AmaResolvedParameters => ({
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
  absoluteSafetyCap: 10000,
  spreadTolerancePct: 0.5,
  crossVenueBasisTolerancePct: 1.0,
  profitRecoveryPolicy: "trailing",
  deRiskPolicy: "gradual",
  runnerPolicy: "50_pct",
  trailingPolicy: "atr_based",
  thesisInvalidationPolicy: "strict",
});

const makeCycle = (overrides: Partial<AmaCycle> = {}): AmaCycle => ({
  cycleId: "c1",
  pair: "BTC/USD",
  mode: "REPLAY",
  state: "ACCUMULATING",
  highWaterMark: 50000,
  ceilingConfirmedAt: null,
  cycleLow: 42000,
  cycleLowAt: null,
  maxDropPct: 16,
  currentDropPct: 10,
  reboundFromLowPct: 5,
  budgetUsd: 10000,
  deployedUsd: 3000,
  reservedUsd: 500,
  freeUsd: 6500,
  btcAccumulated: 0.06,
  averageCostBasis: 50000,
  createdAt: "2026-07-29T00:00:00Z",
  closedAt: null,
  ...overrides,
});

describe("Fase 13 — Cycle Protection", () => {
  it("returns NONE for normal range", () => {
    const cycle = makeCycle();
    const assessment = assessCycleProtection(cycle, 46000, makeParams());
    expect(assessment.action).toBe("NONE");
    expect(assessment.severity).toBe("LOW");
  });

  it("returns PAUSE for minor drawdown", () => {
    const cycle = makeCycle();
    const assessment = assessCycleProtection(cycle, 39000, makeParams()); // 22% drop
    expect(assessment.action).toBe("PAUSE_ACCUMULATION");
    expect(assessment.severity).toBe("LOW");
  });

  it("returns FREEZE for moderate drawdown", () => {
    const cycle = makeCycle();
    const assessment = assessCycleProtection(cycle, 34000, makeParams()); // 32% drop
    expect(assessment.action).toBe("FREEZE_CYCLE");
    expect(assessment.severity).toBe("MEDIUM");
  });

  it("returns DE_RISK for significant drawdown", () => {
    const cycle = makeCycle();
    const assessment = assessCycleProtection(cycle, 29000, makeParams()); // 42% drop
    expect(assessment.action).toBe("DE_RISK_TRIGGERED");
    expect(assessment.severity).toBe("HIGH");
  });

  it("returns EMERGENCY_EXIT for severe drawdown", () => {
    const cycle = makeCycle();
    const assessment = assessCycleProtection(cycle, 24000, makeParams()); // 52% drop
    expect(assessment.action).toBe("EMERGENCY_EXIT");
    expect(assessment.severity).toBe("CRITICAL");
  });

  it("returns THESIS_INVALIDATED for extreme drawdown", () => {
    const cycle = makeCycle();
    const assessment = assessCycleProtection(cycle, 18000, makeParams(), 60); // 64% drop
    expect(assessment.action).toBe("THESIS_INVALIDATED");
    expect(assessment.severity).toBe("CRITICAL");
  });

  it("does not trigger actions with no deployed capital", () => {
    const cycle = makeCycle({ deployedUsd: 0, btcAccumulated: 0 });
    const assessment = assessCycleProtection(cycle, 24000, makeParams()); // 52% drop
    expect(assessment.action).toBe("NONE"); // No deployed capital, no protection needed
  });

  it("shouldBlockNewTranche blocks except NONE and DE_RISK", () => {
    expect(shouldBlockNewTranche({ action: "NONE", reason: "", severity: "LOW", details: "" })).toBe(false);
    expect(shouldBlockNewTranche({ action: "DE_RISK_TRIGGERED", reason: "", severity: "HIGH", details: "" })).toBe(false);
    expect(shouldBlockNewTranche({ action: "PAUSE_ACCUMULATION", reason: "", severity: "LOW", details: "" })).toBe(true);
    expect(shouldBlockNewTranche({ action: "FREEZE_CYCLE", reason: "", severity: "MEDIUM", details: "" })).toBe(true);
  });

  it("shouldTriggerEmergencyExit for critical actions", () => {
    expect(shouldTriggerEmergencyExit({ action: "EMERGENCY_EXIT", reason: "", severity: "CRITICAL", details: "" })).toBe(true);
    expect(shouldTriggerEmergencyExit({ action: "THESIS_INVALIDATED", reason: "", severity: "CRITICAL", details: "" })).toBe(true);
    expect(shouldTriggerEmergencyExit({ action: "NONE", reason: "", severity: "LOW", details: "" })).toBe(false);
  });
});

describe("Fase 14 — Exit Phase Determination", () => {
  it("returns EXITED when no BTC", () => {
    const cycle = makeCycle({ btcAccumulated: 0 });
    expect(determineExitPhase(cycle, 50000, makeParams())).toBe("EXITED");
  });

  it("returns DISTRIBUTING when cycle state is DISTRIBUTING", () => {
    const cycle = makeCycle({ state: "DISTRIBUTING" });
    expect(determineExitPhase(cycle, 55000, makeParams())).toBe("DISTRIBUTING");
  });

  it("returns EXITED when cycle is CLOSED", () => {
    const cycle = makeCycle({ state: "CLOSED" });
    expect(determineExitPhase(cycle, 55000, makeParams())).toBe("EXITED");
  });

  it("returns ACCUMULATING when no profit", () => {
    const cycle = makeCycle({ averageCostBasis: 50000 });
    expect(determineExitPhase(cycle, 45000, makeParams())).toBe("ACCUMULATING");
  });

  it("returns HOLDING for small profit", () => {
    const cycle = makeCycle({ averageCostBasis: 50000 });
    expect(determineExitPhase(cycle, 53000, makeParams())).toBe("HOLDING"); // 6% profit
  });

  it("returns TRAILING_ACTIVE for 10%+ profit with ATR policy", () => {
    const cycle = makeCycle({ averageCostBasis: 50000 });
    expect(determineExitPhase(cycle, 56000, makeParams())).toBe("TRAILING_ACTIVE"); // 12% profit
  });

  it("returns DISTRIBUTING for 20%+ profit", () => {
    const cycle = makeCycle({ averageCostBasis: 50000 });
    expect(determineExitPhase(cycle, 61000, makeParams())).toBe("DISTRIBUTING"); // 22% profit
  });

  it("returns RUNNER_ACTIVE for 100% runner policy", () => {
    const params = makeParams();
    params.runnerPolicy = "100_pct";
    const cycle = makeCycle({ averageCostBasis: 50000 });
    expect(determineExitPhase(cycle, 56000, params)).toBe("RUNNER_ACTIVE");
  });
});

describe("Fase 14 — Trailing Stop", () => {
  it("computes trailing stop price", () => {
    expect(computeTrailingStop(55000, 10)).toBe(49500);
  });

  it("triggers trailing stop when price falls below", () => {
    expect(shouldTriggerTrailingStop(49000, 55000, 10)).toBe(true);
    expect(shouldTriggerTrailingStop(50000, 55000, 10)).toBe(false);
  });
});

describe("Fase 14 — Distribution Size", () => {
  it("distributes in DISTRIBUTING phase with runner", () => {
    const result = computeDistributionSize(1.0, "DISTRIBUTING", 50);
    expect(result.distributeBtc).toBe(0.5);
    expect(result.runnerBtc).toBe(0.5);
  });

  it("distributes everything when runner is 0%", () => {
    const result = computeDistributionSize(1.0, "DISTRIBUTING", 0);
    expect(result.distributeBtc).toBe(1.0);
    expect(result.runnerBtc).toBe(0);
  });

  it("keeps all as runner in RUNNER_ACTIVE", () => {
    const result = computeDistributionSize(1.0, "RUNNER_ACTIVE", 100);
    expect(result.distributeBtc).toBe(0);
    expect(result.runnerBtc).toBe(1.0);
  });

  it("distributes nothing in ACCUMULATING", () => {
    const result = computeDistributionSize(1.0, "ACCUMULATING", 50);
    expect(result.distributeBtc).toBe(0);
    expect(result.runnerBtc).toBe(0);
  });
});

describe("Fase 14 — Exit Strategy", () => {
  it("creates exit strategy with correct defaults", () => {
    const cycle = makeCycle({ deployedUsd: 3000 });
    const strategy = createExitStrategy(cycle, makeParams());
    expect(strategy.profitTargetUsd).toBe(4500); // 3000 * 1.5
    expect(strategy.trailingStopPct).toBe(10);
    expect(strategy.runnerPct).toBe(50);
    expect(strategy.distributionRate).toBe("GRADUAL");
  });

  it("creates immediate distribution for immediate policy", () => {
    const params = makeParams();
    params.profitRecoveryPolicy = "immediate";
    const strategy = createExitStrategy(makeCycle(), params);
    expect(strategy.distributionRate).toBe("IMMEDIATE");
  });

  it("creates DCA_OUT for hold policy", () => {
    const params = makeParams();
    params.profitRecoveryPolicy = "hold";
    const strategy = createExitStrategy(makeCycle(), params);
    expect(strategy.distributionRate).toBe("DCA_OUT");
  });
});
