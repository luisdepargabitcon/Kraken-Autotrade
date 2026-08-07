/**
 * AMA Cycle Protection & Exits — Fases 13-14: tests
 */

import { describe, it, expect } from "vitest";
import {
  assessCycleProtection,
  shouldBlockNewTranche,
  shouldTriggerEmergencyExit,
  shouldSell,
  shouldReduceSize,
  shouldIncreaseConfirmations,
  determineExitPhase,
  computeTrailingStop,
  shouldTriggerTrailingStop,
  computeDistributionSize,
  createExitStrategy,
  type CycleProtectionInput,
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
  absoluteCapitalCapUsd: 10000,
  absoluteTrancheCountCap: 6,
  spreadTolerancePct: 0.5,
  crossVenueBasisTolerancePct: 1.0,
  profitRecoveryPolicy: "trailing",
  deRiskPolicy: "gradual",
  runnerPolicy: "50_pct",
  trailingPolicy: "atr_based",
  thesisInvalidationPolicy: "strict",
  asset: "BTC",
});

const makeCycle = (overrides: Partial<AmaCycle> = {}): AmaCycle => ({
  cycleId: "c1",
  asset: "BTC",
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
  accumulatedQuantity: 0.06,
  averageCostBasis: 50000,
  activePolicyId: null,
  createdAt: "2026-07-29T00:00:00Z",
  closedAt: null,
  ...overrides,
});

const makeProtectionInput = (overrides: Partial<CycleProtectionInput> = {}): CycleProtectionInput => ({
  cycle: makeCycle(),
  currentPrice: 46000,
  parameters: makeParams(),
  ...overrides,
});

describe("Fase 13 — Cycle Protection (R1: separated drawdown types)", () => {
  it("returns NONE for normal range", () => {
    const assessment = assessCycleProtection(makeProtectionInput({ currentPrice: 46000 }));
    expect(assessment.action).toBe("NONE");
    expect(assessment.severity).toBe("LOW");
    expect(assessment.drawdownType).toBe("PRICE_DRAWDOWN_EXPECTED");
  });

  it("returns REDUCE_SIZE for minor price drawdown (20%+)", () => {
    const assessment = assessCycleProtection(makeProtectionInput({ currentPrice: 39000 })); // 22% drop
    expect(assessment.action).toBe("REDUCE_SIZE");
    expect(assessment.drawdownType).toBe("PRICE_DRAWDOWN_EXPECTED");
    expect(assessment.canSell).toBe(false);
  });

  it("returns INCREASE_CONFIRMATIONS for moderate price drawdown (30%+)", () => {
    const assessment = assessCycleProtection(makeProtectionInput({ currentPrice: 34000 })); // 32% drop
    expect(assessment.action).toBe("INCREASE_CONFIRMATIONS");
    expect(assessment.drawdownType).toBe("PRICE_DRAWDOWN_EXPECTED");
    expect(assessment.canSell).toBe(false);
  });

  it("returns REDUCE_SIZE+INCREASE_CONFIRMATIONS for significant price drawdown (40%+)", () => {
    const assessment = assessCycleProtection(makeProtectionInput({ currentPrice: 29000 })); // 42% drop
    expect(assessment.action).toBe("REDUCE_SIZE");
    expect(assessment.drawdownType).toBe("PRICE_DRAWDOWN_EXPECTED");
    expect(assessment.canSell).toBe(false);
    expect(assessment.canReduceSize).toBe(true);
    expect(assessment.canIncreaseConfirmations).toBe(true);
  });

  it("price drawdown alone does NOT trigger EMERGENCY_EXIT even at 52%", () => {
    const assessment = assessCycleProtection(makeProtectionInput({ currentPrice: 24000 })); // 52% drop
    expect(assessment.action).not.toBe("EMERGENCY_EXIT");
    expect(assessment.action).not.toBe("THESIS_INVALIDATED");
    expect(assessment.canSell).toBe(false);
  });

  it("price drawdown alone does NOT trigger THESIS_INVALIDATED even at 64%", () => {
    const assessment = assessCycleProtection(makeProtectionInput({ currentPrice: 18000 })); // 64% drop
    expect(assessment.action).not.toBe("THESIS_INVALIDATED");
    expect(assessment.canSell).toBe(false);
  });

  it("CUSTODY_RISK triggers EMERGENCY_EXIT with canSell=true", () => {
    const assessment = assessCycleProtection(makeProtectionInput({ custodyRiskDetected: true }));
    expect(assessment.action).toBe("EMERGENCY_EXIT");
    expect(assessment.drawdownType).toBe("CUSTODY_RISK");
    expect(assessment.canSell).toBe(true);
  });

  it("PROTOCOL_RISK triggers FREEZE_CYCLE", () => {
    const assessment = assessCycleProtection(makeProtectionInput({ protocolRiskDetected: true }));
    expect(assessment.action).toBe("FREEZE_CYCLE");
    expect(assessment.drawdownType).toBe("PROTOCOL_RISK");
    expect(assessment.canSell).toBe(false);
  });

  it("SYSTEMIC_RISK triggers DE_RISK_TRIGGERED", () => {
    const assessment = assessCycleProtection(makeProtectionInput({ systemicRiskDetected: true }));
    expect(assessment.action).toBe("DE_RISK_TRIGGERED");
    expect(assessment.drawdownType).toBe("SYSTEMIC_RISK");
    expect(assessment.canSell).toBe(false);
  });

  it("DATA_FAILURE triggers PAUSE_ACCUMULATION", () => {
    const assessment = assessCycleProtection(makeProtectionInput({ dataFailureDetected: true }));
    expect(assessment.action).toBe("PAUSE_ACCUMULATION");
    expect(assessment.drawdownType).toBe("DATA_FAILURE");
    expect(assessment.canSell).toBe(false);
  });

  it("does not trigger price drawdown actions with no deployed capital", () => {
    const cycle = makeCycle({ deployedUsd: 0, accumulatedQuantity: 0 });
    const assessment = assessCycleProtection(makeProtectionInput({ cycle, currentPrice: 24000 }));
    expect(assessment.action).toBe("NONE");
  });

  it("shouldBlockNewTranche blocks FREEZE/PAUSE/EMERGENCY/THESIS only", () => {
    const base = { reason: "", severity: "LOW" as const, details: "", drawdownType: "PRICE_DRAWDOWN_EXPECTED" as const, canSell: false, canPause: false, canReduceSize: false, canIncreaseConfirmations: false };
    expect(shouldBlockNewTranche({ ...base, action: "NONE" })).toBe(false);
    expect(shouldBlockNewTranche({ ...base, action: "REDUCE_SIZE" })).toBe(false);
    expect(shouldBlockNewTranche({ ...base, action: "DE_RISK_TRIGGERED" })).toBe(false);
    expect(shouldBlockNewTranche({ ...base, action: "PAUSE_ACCUMULATION" })).toBe(true);
    expect(shouldBlockNewTranche({ ...base, action: "FREEZE_CYCLE" })).toBe(true);
  });

  it("shouldTriggerEmergencyExit for EMERGENCY_EXIT and THESIS_INVALIDATED", () => {
    const base = { reason: "", severity: "CRITICAL" as const, details: "", drawdownType: "CUSTODY_RISK" as const, canSell: true, canPause: true, canReduceSize: true, canIncreaseConfirmations: false };
    expect(shouldTriggerEmergencyExit({ ...base, action: "EMERGENCY_EXIT" })).toBe(true);
    expect(shouldTriggerEmergencyExit({ ...base, action: "THESIS_INVALIDATED" })).toBe(true);
    expect(shouldTriggerEmergencyExit({ ...base, action: "NONE" })).toBe(false);
  });

  it("price drawdown does not cause sell", () => {
    const assessment = assessCycleProtection(makeProtectionInput({ currentPrice: 24000 })); // 52% drop
    expect(shouldSell(assessment)).toBe(false);
  });

  it("custody risk causes sell", () => {
    const assessment = assessCycleProtection(makeProtectionInput({ custodyRiskDetected: true }));
    expect(shouldSell(assessment)).toBe(true);
  });
});

describe("Fase 14 — Exit Phase Determination", () => {
  it("returns EXITED when no BTC", () => {
    const cycle = makeCycle({ accumulatedQuantity: 0 });
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
  it("creates exit strategy with parametrized values", () => {
    const cycle = makeCycle({ deployedUsd: 3000 });
    const strategy = createExitStrategy(cycle, makeParams());
    expect(strategy.profitTargetUsd).toBe(4500); // 3000 * 1.5 (trailing policy)
    expect(strategy.trailingStopPct).toBe(15); // atr_based = 15%
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
