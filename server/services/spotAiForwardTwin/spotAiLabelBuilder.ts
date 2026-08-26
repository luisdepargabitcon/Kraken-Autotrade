/**
 * spotAiLabelBuilder — Compute entry and giveback labels from trade outcomes.
 *
 * Labels are computed ONLY after a trade is closed.
 * They are NEVER exposed as features (no lookahead).
 *
 * Entry labels measure: did the trade reach R targets before stop?
 * Giveback labels measure: did an open position give back profit?
 */

import type { SpotAiEntryLabels, SpotAiGivebackLabels } from "./spotAiForwardTwinTypes";

export interface TradeOutcomeForLabel {
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  mfe: number;
  mae: number;
  mfeR: number;
  maeR: number;
  entryTime: number;
  exitTime: number;
  netPnlUsd: number;
  riskUsd: number;
}

export function buildEntryLabels(outcome: TradeOutcomeForLabel): SpotAiEntryLabels {
  const r = outcome.riskUsd > 0 ? outcome.riskUsd : 1;
  const mfeR = outcome.mfeR;
  const maeR = outcome.maeR;
  const finalR = outcome.netPnlUsd / r;
  const holdMs = outcome.exitTime - outcome.entryTime;

  const reached = (target: number) => mfeR >= target;

  return {
    reached_0_5R_before_stop: reached(0.5),
    reached_1R_before_stop: reached(1.0),
    reached_1_5R_before_stop: reached(1.5),
    reached_2R_before_stop: reached(2.0),
    final_net_profitable: outcome.netPnlUsd > 0,
    final_R: finalR,
    mfe_R: mfeR,
    mae_R: maeR,
    time_to_0_5R: mfeR >= 0.5 ? holdMs : null,
    time_to_1R: mfeR >= 1.0 ? holdMs : null,
    time_to_exit: holdMs,
  };
}

export interface GivebackOutcomeForLabel {
  currentUnrealizedR: number;
  mfeR: number;
  maeR: number;
  finalR: number;
  futureMfeR: number;
  futureMaeR: number;
}

export function buildGivebackLabels(outcome: GivebackOutcomeForLabel): SpotAiGivebackLabels {
  const peakR = outcome.mfeR;
  const currentR = outcome.currentUnrealizedR;
  const finalR = outcome.finalR;

  const givebackPct = (from: number, to: number) => {
    if (from <= 0) return false;
    return (from - to) / from >= 0.25;
  };

  return {
    profit_to_loss: currentR > 0 && finalR < 0,
    giveback_25pct: givebackPct(peakR, finalR),
    giveback_50pct: peakR > 0 && (peakR - finalR) / peakR >= 0.50,
    giveback_75pct: peakR > 0 && (peakR - finalR) / peakR >= 0.75,
    final_R: finalR,
    future_MFE_R: outcome.futureMfeR,
    future_MAE_R: outcome.futureMaeR,
    expected_giveback_R: peakR - finalR,
  };
}
