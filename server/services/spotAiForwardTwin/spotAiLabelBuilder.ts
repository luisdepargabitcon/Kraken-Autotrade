/**
 * spotAiLabelBuilder — SINGLE canonical implementation for entry and giveback labels.
 *
 * Labels are computed ONLY after a trade is closed (entry labels) or from a
 * supervisor snapshot's future path (giveback labels).
 * They are NEVER exposed as features (no lookahead).
 *
 * R3 UNIFICATION: this is the ONLY label builder. spotAiDatasetBuilder uses
 * these functions. The previous duplicate logic in the dataset builder was
 * removed.
 *
 * Entry labels measure: did the trade reach R targets before stop?
 *   - time_to_0_5R / time_to_1R are computed from the SUPERVISOR path
 *     (first snapshot where running mfeR >= target), NOT from holdMs.
 *   - If no supervisor snapshot reaches the target, time_to_*R = null.
 *
 * Giveback labels measure: from a supervisor snapshot at time T, how much
 * profit was given back AFTER T?
 *   - futurePeakR / futureWorstR / finalR are computed from the supervisor
 *     path with timestamp > T (strictly after), NOT from aggregate outcome
 *     MFE/MAE which may include excursions before T.
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
 * time_to_0_5R and time_to_1R use the SUPERVISOR path: the first supervisor
 * snapshot (chronological) where running mfeR >= target. If the target was
 * never reached in the supervisor path, time_to_*R = null (even if the
 * aggregate outcome.mfeR >= target, because we need the path to confirm
 * WHEN it happened).
 */
export function buildEntryLabels(
  outcome: TradeOutcomeEntry,
  supervisorSnapshots: ForwardTwinSnapshot[],
): SpotAiEntryLabels {
  const r = outcome.riskUsd > 0 ? outcome.riskUsd : 1;
  const mfeR = outcome.mfeR;
  const maeR = outcome.maeR;
  const finalR = outcome.netPnlUsd / r;
  const holdMs = outcome.exitTime - outcome.entryTime;

  const timeTo0_5R = computeTimeToTarget(outcome, supervisorSnapshots, 0.5);
  const timeTo1R = computeTimeToTarget(outcome, supervisorSnapshots, 1.0);

  return {
    reached_0_5R_before_stop: mfeR >= 0.5,
    reached_1R_before_stop: mfeR >= 1.0,
    reached_1_5R_before_stop: mfeR >= 1.5,
    reached_2R_before_stop: mfeR >= 2.0,
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
 * FUTURE means strictly AFTER T (timestamp > T). The future path is the
 * chronological sequence of supervisor snapshots for the same lotId+pair
 * with timestamp > T, plus the final outcome (exit).
 *
 * Definitions:
 *   - futurePeakR   = max running mfeR in the future path (snapshots > T).
 *                     If no future supervisor snapshots, the exit outcome's
 *                     finalR is the only future data point.
 *   - futureWorstR  = min running maeR in the future path (snapshots > T).
 *   - finalR        = outcome.netPnlUsd / riskUsd (the trade's final result).
 *   - profitToLoss  = the position was profitable at T (currentR > 0) but
 *                     closed at a loss (finalR < 0).
 *   - futureGivebackR = futurePeakR - finalR (how much was given back from
 *                     the future peak to the final result).
 *
 * A position that reached +2R BEFORE T and never returns to +2R after T
 * will NOT have +2R in futurePeakR — futurePeakR only counts excursions
 * strictly after T.
 */
export interface GivebackLabelInput {
  lotId: string;
  pair: string;
  /** Timestamp T of the supervisor snapshot (prediction time). */
  timestamp: number;
  /** Current unrealized R at time T (from the supervisor snapshot). */
  currentR: number;
  /** Completed trade outcome (for finalR). */
  outcome: TradeOutcomeEntry;
  /** All supervisor snapshots for this lotId+pair (used to compute future path). */
  supervisorSnapshots: ForwardTwinSnapshot[];
}

export function buildGivebackLabels(input: GivebackLabelInput): SpotAiGivebackLabels | null {
  const { lotId, pair, timestamp, currentR, outcome, supervisorSnapshots } = input;

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

  // futurePeakR: max running mfeR in future path. If no future snapshots,
  // the only future data is the exit itself → futurePeakR = finalR.
  let futurePeakR = finalR;
  let futureWorstR = finalR;
  for (const snap of futurePath) {
    if (snap.position) {
      if (snap.position.mfeR > futurePeakR) futurePeakR = snap.position.mfeR;
      if (snap.position.maeR < futureWorstR) futureWorstR = snap.position.maeR;
    }
  }

  // profit_to_loss: profitable at T but closed at a loss.
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
