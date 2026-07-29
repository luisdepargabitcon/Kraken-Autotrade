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
  | "PAUSE_ACCUMULATION"
  | "FREEZE_CYCLE"
  | "EMERGENCY_EXIT"
  | "THESIS_INVALIDATED"
  | "DE_RISK_TRIGGERED";

export interface ProtectionAssessment {
  action: ProtectionAction;
  reason: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  details: string;
}

export function assessCycleProtection(
  cycle: AmaCycle,
  currentPrice: number,
  parameters: AmaResolvedParameters,
  maxDrawdownPct: number = 60,
): ProtectionAssessment {
  const dropPct = cycle.highWaterMark !== null
    ? computeDropPct(cycle.highWaterMark, currentPrice)
    : 0;

  // Thesis invalidation: extreme drop
  if (dropPct >= maxDrawdownPct) {
    return {
      action: "THESIS_INVALIDATED",
      reason: "EXTREME_DRAWDOWN_EXCEEDED",
      severity: "CRITICAL",
      details: `Drop ${dropPct.toFixed(1)}% exceeds max drawdown ${maxDrawdownPct}%`,
    };
  }

  // Emergency exit: severe drop with deployed capital
  if (dropPct >= 50 && cycle.deployedUsd > 0) {
    return {
      action: "EMERGENCY_EXIT",
      reason: "SEVERE_DRAWDOWN_WITH_POSITION",
      severity: "CRITICAL",
      details: `Drop ${dropPct.toFixed(1)}% with $${cycle.deployedUsd} deployed`,
    };
  }

  // De-risk: significant drop
  if (dropPct >= 40 && cycle.deployedUsd > 0) {
    return {
      action: "DE_RISK_TRIGGERED",
      reason: "SIGNIFICANT_DRAWDOWN",
      severity: "HIGH",
      details: `Drop ${dropPct.toFixed(1)}%, de-risk policy: ${parameters.deRiskPolicy}`,
    };
  }

  // Freeze: moderate drop with deployed capital
  if (dropPct >= 30 && cycle.deployedUsd > 0) {
    return {
      action: "FREEZE_CYCLE",
      reason: "MODERATE_DRAWDOWN_FREEZE",
      severity: "MEDIUM",
      details: `Drop ${dropPct.toFixed(1)}%, freezing new tranches`,
    };
  }

  // Pause: minor drop with deployed capital
  if (dropPct >= 20 && cycle.deployedUsd > 0) {
    return {
      action: "PAUSE_ACCUMULATION",
      reason: "MINOR_DRAWDOWN_PAUSE",
      severity: "LOW",
      details: `Drop ${dropPct.toFixed(1)}%, pausing accumulation`,
    };
  }

  return {
    action: "NONE",
    reason: "WITHIN_NORMAL_RANGE",
    severity: "LOW",
    details: `Drop ${dropPct.toFixed(1)}% within normal parameters`,
  };
}

export function shouldBlockNewTranche(assessment: ProtectionAssessment): boolean {
  return assessment.action !== "NONE" && assessment.action !== "DE_RISK_TRIGGERED";
}

export function shouldTriggerEmergencyExit(assessment: ProtectionAssessment): boolean {
  return assessment.action === "EMERGENCY_EXIT" || assessment.action === "THESIS_INVALIDATED";
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
  if (cycle.btcAccumulated <= 0) return "EXITED";
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
  const profitTargetUsd = cycle.deployedUsd * 1.5; // 50% profit target
  const trailingStopPct = 10; // 10% trailing
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
