/**
 * exitReasonClassifier.ts
 * FASE 2/3/8 — Classifies free-text exit reasons into normalized categories
 * for exit audit grouping and statistics.
 *
 * Used by:
 *  - tradingEngine.ts (populate normalizedReason on dry-run SELL insert)
 *  - dryrun.routes.ts (exit-audit endpoint grouping)
 */

export type NormalizedExitReason =
  | "TIME_STOP"
  | "BREAK_EVEN"
  | "TRAILING_STOP"
  | "SCALE_OUT"
  | "SMART_EXIT"
  | "STOP_LOSS"
  | "EMERGENCY_SL"
  | "TAKE_PROFIT"
  | "UNKNOWN";

/**
 * Classifies a free-text exit reason string into a normalized category.
 * Matching is case-insensitive and order-matters (most specific first).
 */
export function classifyExitReason(reason: string | null | undefined): NormalizedExitReason {
  if (!reason) return "UNKNOWN";
  const r = reason.toLowerCase();

  // Emergency SL — must come before generic "stop-loss"
  if (
    r.includes("emergencia") ||
    r.includes("sl_emergency") ||
    r.includes("emergency") ||
    r.includes("stop-loss emergencia")
  ) return "EMERGENCY_SL";

  // Scale-out
  if (r.includes("scale-out") || r.includes("scale out") || r.includes("scaleout")) return "SCALE_OUT";

  // Smart Exit
  if (r.includes("smart exit") || r.includes("smart_exit")) return "SMART_EXIT";

  // TimeStop (various spellings in reason text)
  if (
    r.includes("timestop") ||
    r.includes("time-stop") ||
    r.includes("time stop") ||
    r.includes("time_stop")
  ) return "TIME_STOP";

  // Trailing stop (before break-even so "trailing" wins over generic stop)
  if (r.includes("trailing") || r.includes("trail_hit") || r.includes("trail hit")) return "TRAILING_STOP";

  // Break-even
  if (r.includes("break-even") || r.includes("breakeven") || r.includes("break even") || r.includes("be_hit")) return "BREAK_EVEN";

  // Take-profit
  if (
    r.includes("take-profit") ||
    r.includes("take profit") ||
    r.includes("tp fijo") ||
    r.includes("tp_fixed")
  ) return "TAKE_PROFIT";

  // Generic stop-loss
  if (r.includes("stop-loss") || r.includes("stoploss") || r.includes("stop loss")) return "STOP_LOSS";

  return "UNKNOWN";
}
