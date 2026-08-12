/**
 * SpotNoAutoOptimization — Policy enforcement: no auto-optimization post-deploy.
 *
 * D10: SPOT_POLICY_VERSION congelado post-deploy.
 *
 * This module enforces that strategy parameters cannot be automatically
 * optimized or changed after deployment. Any parameter change requires:
 *   1. Explicit user authorization
 *   2. A new SPOT_POLICY_VERSION bump
 *   3. Documentation of what changed and why
 *
 * The bot must NOT:
 *   - Automatically adjust risk parameters based on recent performance
 *   - Re-tune strategy thresholds from live results
 *   - Modify stop distances or profit targets dynamically
 *   - Change entry conditions based on win/loss streaks
 */

export const AUTO_OPTIMIZATION_BLOCKED = true;
export const POLICY_FROZEN_SINCE = "2026-08-12";
export const POLICY_VERSION = "SPOT-1.0.0-20260812";

export interface OptimizationAttempt {
  blocked: boolean;
  reason: string;
  currentVersion: string;
  attemptedBy: string;
  timestamp: number;
}

/**
 * Guard function: any attempt to auto-optimize SPOT parameters is blocked.
 * Returns an OptimizationAttempt with blocked=true.
 */
export function blockAutoOptimization(attemptedBy: string): OptimizationAttempt {
  console.warn(
    `[SPOT] Auto-optimization BLOCKED. Policy ${POLICY_VERSION} frozen since ${POLICY_FROZEN_SINCE}. ` +
    `Attempted by: ${attemptedBy}. Manual authorization required to change parameters.`
  );
  return {
    blocked: true,
    reason: `Auto-optimization is blocked. Policy ${POLICY_VERSION} is frozen. ` +
      `Manual authorization + version bump required.`,
    currentVersion: POLICY_VERSION,
    attemptedBy,
    timestamp: Date.now(),
  };
}

/**
 * Verify that a parameter change is authorized.
 * In production, this would check a manual authorization flag.
 * During refactor, all changes are blocked.
 */
export function isParameterChangeAuthorized(
  _paramName: string,
  _oldValue: number | string | boolean,
  _newValue: number | string | boolean,
): boolean {
  return false;
}
