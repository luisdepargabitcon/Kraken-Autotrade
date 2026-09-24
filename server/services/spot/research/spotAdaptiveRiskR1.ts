/**
 * spotAdaptiveRiskR1.ts — Risk R1 research-only adaptive risk REDUCTION.
 *
 * effectiveRiskUsd = baseRiskUsd × riskMultiplier, with 0 < multiplier <= 1.0.
 * The policy can ONLY maintain or reduce risk — never increase it.
 *
 * Reduction sources (max 2-3, justified by the R0 forensic):
 *   A) weak setup quality   — low V4 qualityScore near the acceptance floor
 *   B) abnormal volatility  — high ATR% at entry
 *   C) elevated exposure    — open risk already deployed across positions
 *
 * The multiplier is the MINIMUM of all triggered reductions (most conservative
 * wins). Every input exists BEFORE the entry executes — no lookahead.
 */

import type { RiskScalerInput } from "./fastResearchReplay";

export interface SpotRiskR1Config {
  /** A) If V4 qualityScore < lowQualityBelow → apply lowQualityMult. */
  lowQualityBelow?: number;
  lowQualityMult?: number;
  /** B) If atrPct at entry > highAtrPctAbove → apply highVolMult. */
  highAtrPctAbove?: number;
  highVolMult?: number;
  /** C) If openRiskUsd > openRiskAboveUsd → apply exposureMult. */
  openRiskAboveUsd?: number;
  exposureMult?: number;
}

export const RISK_R1_DISABLED: SpotRiskR1Config = {};

/** Absolute floor for any multiplier — even maximum reduction keeps a real position. */
export const RISK_MIN_MULTIPLIER = 0.25;

/**
 * Pure multiplier computation. Always returns a value in
 * [RISK_MIN_MULTIPLIER, 1.0]. Never > 1.
 */
export function riskMultiplierR1(
  cfg: SpotRiskR1Config,
  input: RiskScalerInput,
): number {
  let m = 1.0;

  if (cfg.lowQualityBelow !== undefined && cfg.lowQualityMult !== undefined) {
    const q = input.v4Scores?.qualityScore;
    if (q !== undefined && q !== null && q < cfg.lowQualityBelow) {
      m = Math.min(m, cfg.lowQualityMult);
    }
  }

  if (cfg.highAtrPctAbove !== undefined && cfg.highVolMult !== undefined) {
    if (input.ctx.regimeContext.atrPct > cfg.highAtrPctAbove) {
      m = Math.min(m, cfg.highVolMult);
    }
  }

  if (cfg.openRiskAboveUsd !== undefined && cfg.exposureMult !== undefined) {
    if (input.openRiskUsd > cfg.openRiskAboveUsd) {
      m = Math.min(m, cfg.exposureMult);
    }
  }

  // Clamp: never above 1.0, never below the absolute floor (except explicit 0 rules don't exist)
  return Math.min(1, Math.max(RISK_MIN_MULTIPLIER, m));
}

/** Factory matching FastReplayOpts.riskScaler. Stateless per replay. */
export function createRiskScalerR1(
  cfg: SpotRiskR1Config,
): (input: RiskScalerInput) => number {
  return (input) => riskMultiplierR1(cfg, input);
}

/** Uniform control scalers — the mandatory comparison baseline. */
export function uniformScaler(mult: number): (input: RiskScalerInput) => number {
  const m = Math.min(1, Math.max(0, mult));
  return () => m;
}
