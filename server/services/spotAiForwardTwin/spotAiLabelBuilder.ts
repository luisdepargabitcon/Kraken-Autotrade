/**
 * spotAiLabelBuilder — SINGLE canonical implementation for entry and giveback labels.
 *
 * R4 FIXES:
 *   - Entry labels use the real initialRiskUsd from the causal SCAN sizing
 *     (via TradeOutcomeEntry.riskUsd which is now the immutable initial risk).
 *   - Giveback future labels use INSTANTANEOUS currentR from supervisor
 *     snapshots (schema v2), NOT cumulative running mfeR/maeR.
 *   - For v1 snapshots without currentR, giveback labels are null
 *     (currentRUnavailable=true).
 *   - future_MFE_R = MAX(futureSnapshot.currentR, finalR) for snapshots > T.
 *   - future_MAE_R = MIN(futureSnapshot.currentR, finalR) for snapshots > T.
 *   - A trade that reached +2R BEFORE T does NOT leak +2R into future_MFE_R.
 */

import type {
  SpotAiEntryLabels,
  SpotAiGivebackLabels,
} from "./spotAiForwardTwinTypes";
import type { ForwardTwinSnapshot } from "../spot/spotForwardTwinTypes";
import type { TradeOutcomeEntry } from "./spotAiCompletedTrades";

// ─── Entry labels ────────────────────────────────────────────────────────────

/**
 * Compute entry labels from a completed trade outcome.
 *
 * R4: final_R uses the real initialRiskUsd (from causal SCAN sizing, not
 * from mutable sgCurrentStopPrice). time_to_0_5R / time_to_1R use the
 * SUPERVISOR path (first snapshot where running mfeR >= target).
 */
export function buildEntryLabels(
  outcome: TradeOutcomeEntry,
  supervisorSnapshots: ForwardTwinSnapshot[],
): SpotAiEntryLabels {
  const r = outcome.riskUsd > 0 ? outcome.riskUsd : 1;
  const mfeR = outcome.mfeR;
  const maeR = outcome.maeR;
  // R4: netPnlUsd is now NET (gross - fees). final_R = netPnlUsd / initialRiskUsd.
  const finalR = outcome.netPnlUsd / r;
  const holdMs = outcome.exitTime - outcome.entryTime;

  const timeTo0_5R = computeTimeToTarget(outcome, supervisorSnapshots, 0.5);
  const timeTo1R = computeTimeToTarget(outcome, supervisorSnapshots, 1.0);

  return {
    reached_0_5R_before_stop: mfeR >= 0.5,
    reached_1R_before_stop: mfeR >= 1.0,
    reached_1_5R_before_stop: mfeR >= 1.5,
    reached_2R_before_stop: mfeR >= 2.0,
    // R4: final_net_profitable uses NET PnL (gross - fees).
    final_net_profitable: outcome.netPnlUsd > 0,
    final_R: finalR,
    mfe_R: mfeR,
    mae_R: maeR,
    time_to_0_5R: mfeR >= 0.5 ? timeTo0_5R : null,
    time_to_1R: mfeR >= 1.0 ? timeTo1R : null,
    time_to_exit: holdMs,
  };
}

/**
 * Find the time from entry to the first supervisor snapshot where running
 * mfeR >= targetR. Returns null if no such snapshot exists.
 */
function computeTimeToTarget(
  outcome: TradeOutcomeEntry,
  supervisorSnapshots: ForwardTwinSnapshot[],
  targetR: number,
): number | null {
  const relevant = supervisorSnapshots
    .filter(
      (s) =>
        s.snapshotType === "SUPERVISOR" &&
        s.position?.lotId === outcome.lotId &&
        s.position?.pair === outcome.pair,
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  for (const snap of relevant) {
    if (snap.position && snap.position.mfeR >= targetR) {
      return snap.timestamp - outcome.entryTime;
    }
  }
  return null;
}

// ─── Giveback labels (from supervisor path AFTER time T) ─────────────────────

/**
 * Compute giveback labels for a SUPERVISOR snapshot at time T.
 *
 * R4: future_MFE_R and future_MAE_R use INSTANTANEOUS currentR from future
 * supervisor snapshots (schema v2), NOT cumulative running mfeR/maeR.
 *
 *   future_MFE_R = MAX(futureSnapshot.currentR, finalR) for snapshots > T
 *   future_MAE_R = MIN(futureSnapshot.currentR, finalR) for snapshots > T
 *
 * A trade that reached +2R BEFORE T and never returns to +2R after T
 * will NOT have +2R in future_MFE_R — future_MFE_R only counts the
 * instantaneous unrealized R at each future snapshot.
 *
 * For v1 snapshots without currentR, giveback labels are null
 * (currentRUnavailable=true).
 */
export interface GivebackLabelInput {
  lotId: string;
  pair: string;
  /** Timestamp T of the supervisor snapshot (prediction time). */
  timestamp: number;
  /** R4: instantaneous unrealized R at time T (from schema v2 currentR). */
  currentR: number | null;
  /** Completed trade outcome (for finalR). */
  outcome: TradeOutcomeEntry;
  /** All supervisor snapshots for this lotId+pair (used to compute future path). */
  supervisorSnapshots: ForwardTwinSnapshot[];
}

export function buildGivebackLabels(input: GivebackLabelInput): SpotAiGivebackLabels | null {
  const { lotId, pair, timestamp, currentR, outcome, supervisorSnapshots } = input;

  // R4: if currentR is unavailable (v1 snapshot), cannot compute giveback
  // labels causally. Return null.
  if (currentR === null) return null;

  // Future path: supervisor snapshots strictly AFTER T for this lot+pair.
  const futurePath = supervisorSnapshots
    .filter(
      (s) =>
        s.snapshotType === "SUPERVISOR" &&
        s.position?.lotId === lotId &&
        s.position?.pair === pair &&
        s.timestamp > timestamp,
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  const r = outcome.riskUsd > 0 ? outcome.riskUsd : 1;
  const finalR = outcome.netPnlUsd / r;

  // R4: futurePeakR = MAX(futureSnapshot.currentR, finalR).
  // futureWorstR = MIN(futureSnapshot.currentR, finalR).
  // Use INSTANTANEOUS currentR, NOT cumulative mfeR/maeR.
  let futurePeakR = finalR;
  let futureWorstR = finalR;
  for (const snap of futurePath) {
    if (snap.position) {
      // R4: use currentR (instantaneous) if available (v2).
      // For v2 snapshots, currentR is the instantaneous unrealized R.
      // For v1 snapshots in the future path without currentR, skip them
      // (cannot use cumulative mfeR as a substitute for instantaneous R).
      const snapCurrentR = snap.position.currentR;
      if (snapCurrentR !== undefined && snapCurrentR !== null) {
        if (snapCurrentR > futurePeakR) futurePeakR = snapCurrentR;
        if (snapCurrentR < futureWorstR) futureWorstR = snapCurrentR;
      }
    }
  }

  // profit_to_loss: profitable at T (currentR > 0) but closed at a loss.
  const profitToLoss = currentR > 0 && finalR < 0;

  // giveback from future peak to final.
  const futureGivebackR = futurePeakR - finalR;
  const givebackPctFrom = (from: number, to: number, pct: number): boolean => {
    if (from <= 0) return false;
    return (from - to) / from >= pct;
  };

  return {
    profit_to_loss: profitToLoss,
    giveback_25pct: givebackPctFrom(futurePeakR, finalR, 0.25),
    giveback_50pct: givebackPctFrom(futurePeakR, finalR, 0.50),
    giveback_75pct: givebackPctFrom(futurePeakR, finalR, 0.75),
    final_R: finalR,
    future_MFE_R: futurePeakR,
    future_MAE_R: futureWorstR,
    expected_giveback_R: futureGivebackR,
  };
}
