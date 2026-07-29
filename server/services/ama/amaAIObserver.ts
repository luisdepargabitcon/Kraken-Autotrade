/**
 * AMA AI Observer — Fase 15
 *
 * Observes cycle data, generates insights, detects anomalies,
 * provides recommendations. No execution. No orders. Advisory only.
 */

import type { AmaCycle, AmaResolvedParameters } from "./amaTypes";
import { computeDropPct, computeReboundPct, getMacroZone } from "./amaHwmBar";

// ─── Insight Types ──────────────────────────────────────────────────

export type InsightType =
  | "INFO"
  | "WARNING"
  | "ALERT"
  | "OPPORTUNITY"
  | "ANOMALY";

export type InsightCategory =
  | "PRICE_ACTION"
  | "BUDGET_UTILIZATION"
  | "RISK_MANAGEMENT"
  | "CYCLE_HEALTH"
  | "DATA_QUALITY"
  | "MARKET_CONDITION";

export interface AIInsight {
  insightId: string;
  type: InsightType;
  category: InsightCategory;
  title: string;
  message: string;
  cycleId: string | null;
  confidence: number; // 0-1
  actionable: boolean;
  recommendation: string | null;
  createdAt: string;
}

// ─── Anomaly Detection ──────────────────────────────────────────────

export interface AnomalyDetection {
  isAnomaly: boolean;
  anomalyType: string | null;
  severity: "LOW" | "MEDIUM" | "HIGH";
  details: string;
}

export function detectPriceAnomaly(
  currentPrice: number,
  previousPrice: number,
  thresholdPct: number = 15,
): AnomalyDetection {
  const changePct = Math.abs((currentPrice - previousPrice) / previousPrice) * 100;

  if (changePct >= thresholdPct * 2) {
    return {
      isAnomaly: true,
      anomalyType: "EXTREME_PRICE_MOVEMENT",
      severity: "HIGH",
      details: `Price moved ${changePct.toFixed(1)}% (threshold: ${thresholdPct}%)`,
    };
  }

  if (changePct >= thresholdPct) {
    return {
      isAnomaly: true,
      anomalyType: "LARGE_PRICE_MOVEMENT",
      severity: "MEDIUM",
      details: `Price moved ${changePct.toFixed(1)}% (threshold: ${thresholdPct}%)`,
    };
  }

  return {
    isAnomaly: false,
    anomalyType: null,
    severity: "LOW",
    details: `Price moved ${changePct.toFixed(1)}% (within normal range)`,
  };
}

export function detectBudgetAnomaly(
  cycle: AmaCycle,
): AnomalyDetection {
  const utilizationPct = cycle.budgetUsd > 0
    ? (cycle.deployedUsd / cycle.budgetUsd) * 100
    : 0;

  if (utilizationPct > 90) {
    return {
      isAnomaly: true,
      anomalyType: "BUDGET_NEARLY_EXHAUSTED",
      severity: "HIGH",
      details: `Budget utilization at ${utilizationPct.toFixed(1)}%`,
    };
  }

  if (utilizationPct > 75) {
    return {
      isAnomaly: true,
      anomalyType: "BUDGET_HIGH_UTILIZATION",
      severity: "MEDIUM",
      details: `Budget utilization at ${utilizationPct.toFixed(1)}%`,
    };
  }

  return {
    isAnomaly: false,
    anomalyType: null,
    severity: "LOW",
    details: `Budget utilization at ${utilizationPct.toFixed(1)}%`,
  };
}

// ─── Insight Generation ─────────────────────────────────────────────

export function generateCycleInsights(
  cycle: AmaCycle,
  currentPrice: number,
  parameters: AmaResolvedParameters,
): AIInsight[] {
  const insights: AIInsight[] = [];
  const now = new Date().toISOString();

  const dropPct = cycle.highWaterMark !== null
    ? computeDropPct(cycle.highWaterMark, currentPrice)
    : 0;
  const macroZone = getMacroZone(dropPct);

  // Price action insight
  if (dropPct > 0) {
    insights.push({
      insightId: `insight-${Date.now()}-1`,
      type: dropPct > 40 ? "ALERT" : dropPct > 20 ? "WARNING" : "INFO",
      category: "PRICE_ACTION",
      title: `Drop: ${dropPct.toFixed(1)}%`,
      message: `Current price ${currentPrice} is ${dropPct.toFixed(1)}% below HWM ${cycle.highWaterMark}`,
      cycleId: cycle.cycleId,
      confidence: 0.95,
      actionable: dropPct > 20,
      recommendation: dropPct > 40
        ? "Consider de-risking or emergency exit"
        : dropPct > 20
        ? "Monitor closely, pause new tranches if needed"
        : null,
      createdAt: now,
    });
  }

  // Macro zone insight
  if (macroZone === "VALUE" || macroZone === "DEEP_VALUE") {
    insights.push({
      insightId: `insight-${Date.now()}-2`,
      type: "OPPORTUNITY",
      category: "MARKET_CONDITION",
      title: `Value zone: ${macroZone}`,
      message: `Price is in ${macroZone} zone, potential accumulation opportunity`,
      cycleId: cycle.cycleId,
      confidence: 0.7,
      actionable: true,
      recommendation: "Evaluate tranche eligibility based on spacing and cooldown",
      createdAt: now,
    });
  }

  if (macroZone === "CAPITULACION" || macroZone === "CAPITULACION_EXTREMA") {
    insights.push({
      insightId: `insight-${Date.now()}-3`,
      type: "ALERT",
      category: "MARKET_CONDITION",
      title: `Capitulation zone: ${macroZone}`,
      message: `Price is in ${macroZone} zone, high risk but potential max opportunity`,
      cycleId: cycle.cycleId,
      confidence: 0.8,
      actionable: true,
      recommendation: "Exercise extreme caution. Check thesis validity.",
      createdAt: now,
    });
  }

  // Budget utilization insight
  const budgetAnomaly = detectBudgetAnomaly(cycle);
  if (budgetAnomaly.isAnomaly) {
    insights.push({
      insightId: `insight-${Date.now()}-4`,
      type: budgetAnomaly.severity === "HIGH" ? "ALERT" : "WARNING",
      category: "BUDGET_UTILIZATION",
      title: budgetAnomaly.anomalyType!,
      message: budgetAnomaly.details,
      cycleId: cycle.cycleId,
      confidence: 0.9,
      actionable: true,
      recommendation: budgetAnomaly.severity === "HIGH"
        ? "Consider closing cycle or requesting budget increase"
        : "Monitor deployment rate closely",
      createdAt: now,
    });
  }

  // Rebound insight
  if (cycle.cycleLow !== null) {
    const reboundPct = computeReboundPct(cycle.cycleLow, currentPrice);
    if (reboundPct > 15) {
      insights.push({
        insightId: `insight-${Date.now()}-5`,
        type: "INFO",
        category: "CYCLE_HEALTH",
        title: `Rebound: ${reboundPct.toFixed(1)}%`,
        message: `Price has rebounded ${reboundPct.toFixed(1)}% from cycle low ${cycle.cycleLow}`,
        cycleId: cycle.cycleId,
        confidence: 0.85,
        actionable: false,
        recommendation: null,
        createdAt: now,
      });
    }
  }

  // Reserve maintenance insight
  const reserveUsd = cycle.budgetUsd * (parameters.mandatoryReservePct / 100);
  if (cycle.freeUsd < reserveUsd) {
    insights.push({
      insightId: `insight-${Date.now()}-6`,
      type: "ALERT",
      category: "RISK_MANAGEMENT",
      title: "Mandatory reserve breached",
      message: `Free budget $${cycle.freeUsd} is below mandatory reserve $${reserveUsd}`,
      cycleId: cycle.cycleId,
      confidence: 1.0,
      actionable: true,
      recommendation: "Stop new tranches immediately. Reserve must be maintained.",
      createdAt: now,
    });
  }

  return insights;
}

// ─── Cycle Health Score ─────────────────────────────────────────────

export interface CycleHealthScore {
  score: number; // 0-100
  grade: "A" | "B" | "C" | "D" | "F";
  factors: { name: string; score: number; weight: number }[];
}

export function computeCycleHealth(
  cycle: AmaCycle,
  currentPrice: number,
  parameters: AmaResolvedParameters,
): CycleHealthScore {
  const factors: { name: string; score: number; weight: number }[] = [];

  // Factor 1: Budget utilization (lower is better for accumulation phase)
  const utilizationPct = cycle.budgetUsd > 0
    ? (cycle.deployedUsd / cycle.budgetUsd) * 100
    : 0;
  factors.push({
    name: "BUDGET_UTILIZATION",
    score: Math.max(0, 100 - utilizationPct),
    weight: 0.25,
  });

  // Factor 2: Reserve maintenance
  const reserveUsd = cycle.budgetUsd * (parameters.mandatoryReservePct / 100);
  const reserveScore = cycle.freeUsd >= reserveUsd ? 100 : (cycle.freeUsd / reserveUsd) * 100;
  factors.push({
    name: "RESERVE_MAINTENANCE",
    score: Math.max(0, reserveScore),
    weight: 0.30,
  });

  // Factor 3: Position profitability
  const avgCost = cycle.averageCostBasis;
  let profitScore = 50;
  if (avgCost !== null && avgCost > 0 && cycle.btcAccumulated > 0) {
    const profitPct = ((currentPrice - avgCost) / avgCost) * 100;
    profitScore = Math.max(0, Math.min(100, 50 + profitPct * 2));
  }
  factors.push({
    name: "POSITION_PROFITABILITY",
    score: profitScore,
    weight: 0.25,
  });

  // Factor 4: Drop severity (less drop is healthier)
  const dropPct = cycle.highWaterMark !== null
    ? computeDropPct(cycle.highWaterMark, currentPrice)
    : 0;
  factors.push({
    name: "DROP_SEVERITY",
    score: Math.max(0, 100 - dropPct),
    weight: 0.20,
  });

  const totalScore = factors.reduce((sum, f) => sum + f.score * f.weight, 0);
  const grade = totalScore >= 80 ? "A" : totalScore >= 70 ? "B" : totalScore >= 60 ? "C" : totalScore >= 50 ? "D" : "F";

  return { score: totalScore, grade, factors };
}

// ─── Batch Insights ─────────────────────────────────────────────────

export function generatePortfolioInsights(
  cycles: AmaCycle[],
  currentPrices: Map<string, number>,
  parameters: AmaResolvedParameters,
): AIInsight[] {
  const allInsights: AIInsight[] = [];

  for (const cycle of cycles) {
    if (cycle.state === "CLOSED" || cycle.state === "ABANDONED_NO_INVENTORY") continue;
    const price = currentPrices.get(cycle.pair) ?? 0;
    const insights = generateCycleInsights(cycle, price, parameters);
    allInsights.push(...insights);
  }

  return allInsights;
}
