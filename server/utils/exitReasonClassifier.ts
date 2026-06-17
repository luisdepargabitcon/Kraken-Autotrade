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
  | "TIME_STOP_HANDOFF_TO_TRAILING"
  | "TIME_STOP_ARMED_TRAILING"
  | "TIME_STOP_TIGHTEN_TRAILING"
  | "TIME_STOP_PROFIT_LOCK_PARTIAL"
  | "TIME_STOP_PROFIT_EXIT_WEAK_MOMENTUM"
  | "TIME_STOP_DEFERRED"
  | "TIME_STOP_DEFENSIVE_EXIT"
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

  // Smart TimeStop V2 decisions — must come before generic TIME_STOP
  if (r.includes("handoff_to_trailing") || r.includes("handoff to trailing")) return "TIME_STOP_HANDOFF_TO_TRAILING";
  if (r.includes("arm_trailing")   || r.includes("arm trailing"))   return "TIME_STOP_ARMED_TRAILING";
  if (r.includes("tighten_trailing") || r.includes("tighten trailing")) return "TIME_STOP_TIGHTEN_TRAILING";
  if (r.includes("profit_lock_partial") || r.includes("profit lock partial")) return "TIME_STOP_PROFIT_LOCK_PARTIAL";
  if (r.includes("profit_exit_weak_momentum") || r.includes("profit exit weak momentum")) return "TIME_STOP_PROFIT_EXIT_WEAK_MOMENTUM";
  if (r.includes("defer_negative")  || r.includes("defer negative"))  return "TIME_STOP_DEFERRED";
  if (r.includes("defensive_exit")  || r.includes("defensive exit"))  return "TIME_STOP_DEFENSIVE_EXIT";

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
