/**
 * AMA Cycle Protection, Exits & Trailing — Fases 13-14
 *
 * Cycle protection: drawdown limits, thesis invalidation, emergency exit.
 * Exits & trailing: profit targets, trailing stops, runner management.
 * No real orders. Simulation only.
 */

import type { AmaCycle, AmaResolvedParameters } from "./amaTypes";
import { computeDropPct, computeReboundPct } from "./amaHwmBar";

// ─── Cycle Protection (Fase 13) ─────────────────────────────────────

export type ProtectionAction =
  | "NONE"
  | "REDUCE_SIZE"
  | "INCREASE_CONFIRMATIONS"
  | "PAUSE_ACCUMULATION"
  | "FREEZE_CYCLE"
  | "EMERGENCY_EXIT"
  | "THESIS_INVALIDATED"
  | "DE_RISK_TRIGGERED";

export type DrawdownType =
  | "PRICE_DRAWDOWN_EXPECTED"
  | "SYSTEMIC_RISK"
  | "PROTOCOL_RISK"
  | "CUSTODY_RISK"
  | "DATA_FAILURE"
  | "THESIS_INVALIDATION";

export interface ProtectionAssessment {
  action: ProtectionAction;
  reason: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  details: string;
  drawdownType: DrawdownType;
  canSell: boolean;
  canPause: boolean;
  canReduceSize: boolean;
  canIncreaseConfirmations: boolean;
}

export interface CycleProtectionInput {
  cycle: AmaCycle;
  currentPrice: number;
  parameters: AmaResolvedParameters;
  maxDrawdownPct?: number;
  systemicRiskDetected?: boolean;
  protocolRiskDetected?: boolean;
  custodyRiskDetected?: boolean;
  dataFailureDetected?: boolean;
}

export function assessCycleProtection(
  input: CycleProtectionInput,
): ProtectionAssessment {
  const { cycle, currentPrice, parameters, maxDrawdownPct = 60 } = input;
  const dropPct = cycle.highWaterMark !== null
    ? computeDropPct(cycle.highWaterMark, currentPrice)
    : 0;

  // Non-price risks can trigger severe actions
  if (input.custodyRiskDetected) {
    return {
      action: "EMERGENCY_EXIT",
      reason: "CUSTODY_RISK_DETECTED",
      severity: "CRITICAL",
      details: "Custody risk detected — emergency exit warranted",
      drawdownType: "CUSTODY_RISK",
      canSell: true,
      canPause: true,
      canReduceSize: true,
      canIncreaseConfirmations: false,
    };
  }

  if (input.protocolRiskDetected) {
    return {
      action: "FREEZE_CYCLE",
      reason: "PROTOCOL_RISK_DETECTED",
      severity: "CRITICAL",
      details: "Protocol risk detected — freezing cycle",
      drawdownType: "PROTOCOL_RISK",
      canSell: false,
      canPause: true,
      canReduceSize: true,
      canIncreaseConfirmations: true,
    };
  }

  if (input.systemicRiskDetected) {
    return {
      action: "DE_RISK_TRIGGERED",
      reason: "SYSTEMIC_RISK_DETECTED",
      severity: "HIGH",
      details: "Systemic risk detected — de-risking position",
      drawdownType: "SYSTEMIC_RISK",
      canSell: false,
      canPause: true,
      canReduceSize: true,
      canIncreaseConfirmations: true,
    };
  }

  if (input.dataFailureDetected) {
    return {
      action: "PAUSE_ACCUMULATION",
      reason: "DATA_FAILURE_DETECTED",
      severity: "HIGH",
      details: "Data failure detected — pausing accumulation",
      drawdownType: "DATA_FAILURE",
      canSell: false,
      canPause: true,
      canReduceSize: false,
      canIncreaseConfirmations: true,
    };
  }

  // Price drawdown alone: can reduce size, increase confirmations, respect reserve
  // but CANNOT sell, invalidate thesis, or activate emergency exit
  if (dropPct >= 40 && cycle.deployedUsd > 0) {
    return {
      action: "REDUCE_SIZE",
      reason: "SIGNIFICANT_PRICE_DRAWDOWN",
      severity: "HIGH",
      details: `Price drop ${dropPct.toFixed(1)}% — reducing tranche size, increasing confirmations`,
      drawdownType: "PRICE_DRAWDOWN_EXPECTED",
      canSell: false,
      canPause: false,
      canReduceSize: true,
      canIncreaseConfirmations: true,
    };
  }

  if (dropPct >= 30 && cycle.deployedUsd > 0) {
    return {
      action: "INCREASE_CONFIRMATIONS",
      reason: "MODERATE_PRICE_DRAWDOWN",
      severity: "MEDIUM",
      details: `Price drop ${dropPct.toFixed(1)}% — increasing confirmation requirements`,
      drawdownType: "PRICE_DRAWDOWN_EXPECTED",
      canSell: false,
      canPause: false,
      canReduceSize: true,
      canIncreaseConfirmations: true,
    };
  }

  if (dropPct >= 20 && cycle.deployedUsd > 0) {
    return {
      action: "REDUCE_SIZE",
      reason: "MINOR_PRICE_DRAWDOWN",
      severity: "LOW",
      details: `Price drop ${dropPct.toFixed(1)}% — reducing tranche size`,
      drawdownType: "PRICE_DRAWDOWN_EXPECTED",
      canSell: false,
      canPause: false,
      canReduceSize: true,
      canIncreaseConfirmations: false,
    };
  }

  return {
    action: "NONE",
    reason: "WITHIN_NORMAL_RANGE",
    severity: "LOW",
    details: `Drop ${dropPct.toFixed(1)}% within normal parameters`,
    drawdownType: "PRICE_DRAWDOWN_EXPECTED",
    canSell: false,
    canPause: false,
    canReduceSize: false,
    canIncreaseConfirmations: false,
  };
}

export function shouldBlockNewTranche(assessment: ProtectionAssessment): boolean {
  return assessment.action === "FREEZE_CYCLE" || assessment.action === "PAUSE_ACCUMULATION" || assessment.action === "EMERGENCY_EXIT" || assessment.action === "THESIS_INVALIDATED";
}

export function shouldTriggerEmergencyExit(assessment: ProtectionAssessment): boolean {
  return assessment.action === "EMERGENCY_EXIT" || assessment.action === "THESIS_INVALIDATED";
}

export function shouldSell(assessment: ProtectionAssessment): boolean {
  return assessment.canSell;
}

export function shouldReduceSize(assessment: ProtectionAssessment): boolean {
  return assessment.canReduceSize;
}

export function shouldIncreaseConfirmations(assessment: ProtectionAssessment): boolean {
  return assessment.canIncreaseConfirmations;
}

// ─── Exits & Trailing (Fase 14) ─────────────────────────────────────

export type ExitPhase =
  | "ACCUMULATING"
  | "HOLDING"
  | "TRAILING_ACTIVE"
  | "DISTRIBUTING"
  | "RUNNER_ACTIVE"
  | "EXITED";

export interface ExitStrategy {
  phase: ExitPhase;
  profitTargetUsd: number;
  trailingStopPct: number;
  runnerPct: number;
  distributionRate: "IMMEDIATE" | "GRADUAL" | "DCA_OUT";
}

export function determineExitPhase(
  cycle: AmaCycle,
  currentPrice: number,
  parameters: AmaResolvedParameters,
): ExitPhase {
  if (cycle.accumulatedQuantity <= 0) return "EXITED";
  if (cycle.state === "DISTRIBUTING") return "DISTRIBUTING";
  if (cycle.state === "CLOSING" || cycle.state === "CLOSED") return "EXITED";

  const avgCost = cycle.averageCostBasis;
  if (avgCost === null || avgCost <= 0) return "ACCUMULATING";

  const profitPct = ((currentPrice - avgCost) / avgCost) * 100;

  if (profitPct <= 0) return "ACCUMULATING";
  if (profitPct < 10) return "HOLDING";
  if (parameters.profitRecoveryPolicy === "immediate") return "DISTRIBUTING";
  if (parameters.runnerPolicy === "100_pct") return "RUNNER_ACTIVE";
  if (profitPct >= 20) return "DISTRIBUTING";
  if (parameters.trailingPolicy === "atr_based" && profitPct >= 10) return "TRAILING_ACTIVE";
  return "HOLDING";
}

export function computeTrailingStop(
  highestSinceEntry: number,
  trailingPct: number,
): number {
  return highestSinceEntry * (1 - trailingPct / 100);
}

export function shouldTriggerTrailingStop(
  currentPrice: number,
  highestSinceEntry: number,
  trailingPct: number,
): boolean {
  const stop = computeTrailingStop(highestSinceEntry, trailingPct);
  return currentPrice <= stop;
}

export function computeDistributionSize(
  totalBtc: number,
  phase: ExitPhase,
  runnerPct: number,
): { distributeBtc: number; runnerBtc: number } {
  if (phase === "DISTRIBUTING") {
    const runnerBtc = totalBtc * (runnerPct / 100);
    return {
      distributeBtc: totalBtc - runnerBtc,
      runnerBtc,
    };
  }
  if (phase === "RUNNER_ACTIVE") {
    return { distributeBtc: 0, runnerBtc: totalBtc };
  }
  return { distributeBtc: 0, runnerBtc: 0 };
}

export function createExitStrategy(
  cycle: AmaCycle,
  parameters: AmaResolvedParameters,
): ExitStrategy {
  const profitMultiplier = parameters.profitRecoveryPolicy === "immediate" ? 1.2
    : parameters.profitRecoveryPolicy === "hold" ? 3.0
    : 1.5;
  const profitTargetUsd = cycle.deployedUsd * profitMultiplier;

  const trailingStopPct = parameters.trailingPolicy === "atr_based" ? 15
    : parameters.trailingPolicy === "fixed" ? 10
    : 10;

  const runnerPct = parameters.runnerPolicy === "100_pct" ? 100
    : parameters.runnerPolicy === "50_pct" ? 50
    : parameters.runnerPolicy === "0_pct" ? 0
    : 50;

  const distributionRate = parameters.profitRecoveryPolicy === "immediate" ? "IMMEDIATE"
    : parameters.profitRecoveryPolicy === "hold" ? "DCA_OUT"
    : "GRADUAL";

  return {
    phase: "ACCUMULATING",
    profitTargetUsd,
    trailingStopPct,
    runnerPct,
    distributionRate,
  };
}
