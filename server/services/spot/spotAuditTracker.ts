/**
 * SpotAuditTracker — MFE/MAE/Profit Capture auditing for SPOT.
 *
 * PROBLEM (FASE 1 audit):
 *   - TradeMetricsTracker.ts samples MFE/MAE every 5 minutes (coarse).
 *   - auditMetrics.ts has pure functions but no integration with position lifecycle.
 *   - No R-multiple MFE/MAE (only USD).
 *   - Profit Capture % not computed consistently.
 *
 * SOLUTION:
 *   SpotAuditTracker updates MFE/MAE on every price evaluation (not just 5min samples).
 *   Computes both USD and R-multiple MFE/MAE.
 *   Profit Capture % = netPnl / MFE × 100 (how much of the max profit was captured).
 *
 *   This is AUDIT ONLY — no trading decisions depend on these metrics.
 */

import type { SpotPosition } from "./spotTypes";
import { computePnlBreakdown } from "./feeModel";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SpotAuditMetrics {
  positionLotId: string;
  // USD metrics
  mfeUsd: number; // max favorable excursion (USD)
  maeUsd: number; // max adverse excursion (USD)
  // R-multiple metrics
  mfeR: number; // MFE in R-multiples
  maeR: number; // MAE in R-multiples
  // Price tracking
  highestPrice: number;
  lowestPrice: number;
  // Timing
  mfeTimestamp: number; // when MFE was reached
  maeTimestamp: number; // when MAE was reached
  // Exit audit (filled at close)
  exitAudit?: ExitAuditMetrics;
}

export interface ExitAuditMetrics {
  exitPrice: number;
  netPnlUsd: number;
  grossPnlUsd: number;
  profitCapturePct: number; // netPnl / MFE × 100
  profitCaptureR: number; // exitR / mfeR
  exitReason: string;
  holdTimeMinutes: number;
  // Efficiency
  mfeToHoldRatio: number; // MFE / hold time (USD per hour)
  exitEfficiency: number; // netPnl / grossPnl × 100
}

// ─── Tracker ────────────────────────────────────────────────────────────────

export class SpotAuditTracker {
  private metrics = new Map<string, SpotAuditMetrics>();

  /**
   * Initialize audit tracking for a new position.
   */
  initPosition(position: SpotPosition): SpotAuditMetrics {
    const m: SpotAuditMetrics = {
      positionLotId: position.lotId,
      mfeUsd: 0,
      maeUsd: 0,
      mfeR: 0,
      maeR: 0,
      highestPrice: position.entryPrice,
      lowestPrice: position.entryPrice,
      mfeTimestamp: position.openedAt,
      maeTimestamp: position.openedAt,
    };
    this.metrics.set(position.lotId, m);
    return m;
  }

  /**
   * Update MFE/MAE on each price evaluation.
   * Called every scan cycle with the current price.
   */
  updatePrice(position: SpotPosition, currentPrice: number, timestamp: number): SpotAuditMetrics {
    let m = this.metrics.get(position.lotId);
    if (!m) {
      m = this.initPosition(position);
    }

    // Update highest/lowest price
    if (currentPrice > m.highestPrice) {
      m.highestPrice = currentPrice;
      m.mfeTimestamp = timestamp;
    }
    if (currentPrice < m.lowestPrice) {
      m.lowestPrice = currentPrice;
      m.maeTimestamp = timestamp;
    }

    // Compute MFE/MAE in USD
    m.mfeUsd = (m.highestPrice - position.entryPrice) * position.amount;
    m.maeUsd = (position.entryPrice - m.lowestPrice) * position.amount;

    // Compute MFE/MAE in R-multiples
    if (position.riskUsd > 0) {
      m.mfeR = m.mfeUsd / position.riskUsd;
      m.maeR = m.maeUsd / position.riskUsd;
    }

    return m;
  }

  /**
   * Finalize audit at position close.
   * Computes Profit Capture % and exit efficiency.
   */
  finalizeExit(
    position: SpotPosition,
    exitPrice: number,
    exitReason: string,
    exitTimestamp: number,
  ): ExitAuditMetrics {
    const m = this.metrics.get(position.lotId);
    const mfeUsd = m?.mfeUsd ?? 0;
    const mfeR = m?.mfeR ?? 0;

    const pnl = computePnlBreakdown({
      entryPrice: position.entryPrice,
      exitPrice,
      volume: position.amount,
      entryFeeUsd: position.entryFee,
    });

    const profitCapturePct = mfeUsd > 0
      ? (pnl.netPnlUsd / mfeUsd) * 100
      : 0;
    const profitCaptureR = mfeR > 0
      ? (pnl.netPnlUsd / position.riskUsd) / mfeR
      : 0;

    const holdTimeMinutes = (exitTimestamp - position.openedAt) / (60 * 1000);
    const mfeToHoldRatio = holdTimeMinutes > 0
      ? mfeUsd / (holdTimeMinutes / 60)
      : 0;
    const exitEfficiency = pnl.grossPnlUsd > 0
      ? (pnl.netPnlUsd / pnl.grossPnlUsd) * 100
      : 0;

    const exitAudit: ExitAuditMetrics = {
      exitPrice,
      netPnlUsd: pnl.netPnlUsd,
      grossPnlUsd: pnl.grossPnlUsd,
      profitCapturePct,
      profitCaptureR,
      exitReason,
      holdTimeMinutes,
      mfeToHoldRatio,
      exitEfficiency,
    };

    if (m) {
      m.exitAudit = exitAudit;
    }

    return exitAudit;
  }

  /**
   * Restore audit metrics from DB on restart.
   * Unlike initPosition which starts at zero, this preserves
   * previously computed MFE/MAE/highest/lowest from DB.
   */
  restorePosition(position: SpotPosition, saved: Partial<SpotAuditMetrics>): SpotAuditMetrics {
    const m: SpotAuditMetrics = {
      positionLotId: position.lotId,
      mfeUsd: saved.mfeUsd ?? 0,
      maeUsd: saved.maeUsd ?? 0,
      mfeR: saved.mfeR ?? 0,
      maeR: saved.maeR ?? 0,
      highestPrice: saved.highestPrice ?? position.entryPrice,
      lowestPrice: saved.lowestPrice ?? position.entryPrice,
      mfeTimestamp: saved.mfeTimestamp ?? position.openedAt,
      maeTimestamp: saved.maeTimestamp ?? position.openedAt,
    };
    this.metrics.set(position.lotId, m);
    return m;
  }

  /**
   * Get current metrics for a position.
   */
  getMetrics(lotId: string): SpotAuditMetrics | null {
    return this.metrics.get(lotId) ?? null;
  }

  /**
   * Remove metrics for a closed position.
   */
  remove(lotId: string): void {
    this.metrics.delete(lotId);
  }

  /**
   * Get all active metrics.
   */
  getAll(): SpotAuditMetrics[] {
    return Array.from(this.metrics.values());
  }
}

// ─── Pure helpers (for batch analysis) ──────────────────────────────────────

/**
 * Compute exit efficiency classification from Profit Capture %.
 *   >80%: EXCELLENT
 *   50-80%: GOOD
 *   20-50%: POOR
 *   <20%: BAD
 */
export function classifyProfitCapture(pct: number): "EXCELLENT" | "GOOD" | "POOR" | "BAD" {
  if (pct >= 80) return "EXCELLENT";
  if (pct >= 50) return "GOOD";
  if (pct >= 20) return "POOR";
  return "BAD";
}

/**
 * Compute aggregate MFE/MAE statistics across multiple closed positions.
 */
export function computeAggregateAudit(exits: ExitAuditMetrics[]): {
  avgMfeCapturePct: number;
  avgExitEfficiency: number;
  avgHoldTimeMinutes: number;
  totalNetPnl: number;
  totalMfe: number;
  captureDistribution: Record<string, number>;
} {
  if (exits.length === 0) {
    return {
      avgMfeCapturePct: 0,
      avgExitEfficiency: 0,
      avgHoldTimeMinutes: 0,
      totalNetPnl: 0,
      totalMfe: 0,
      captureDistribution: { EXCELLENT: 0, GOOD: 0, POOR: 0, BAD: 0 },
    };
  }

  const totalCapture = exits.reduce((s, e) => s + e.profitCapturePct, 0);
  const totalEfficiency = exits.reduce((s, e) => s + e.exitEfficiency, 0);
  const totalHold = exits.reduce((s, e) => s + e.holdTimeMinutes, 0);
  const totalNet = exits.reduce((s, e) => s + e.netPnlUsd, 0);

  const distribution = { EXCELLENT: 0, GOOD: 0, POOR: 0, BAD: 0 };
  for (const e of exits) {
    const cls = classifyProfitCapture(e.profitCapturePct);
    distribution[cls]++;
  }

  return {
    avgMfeCapturePct: totalCapture / exits.length,
    avgExitEfficiency: totalEfficiency / exits.length,
    avgHoldTimeMinutes: totalHold / exits.length,
    totalNetPnl: totalNet,
    totalMfe: 0, // would need MFE from metrics, not just exit
    captureDistribution: distribution,
  };
}
