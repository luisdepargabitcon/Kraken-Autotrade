/**
 * AMA HWM & Macro Bar — Fase 9
 *
 * High Water Mark bootstrap, ATR computation, ceiling detection,
 * cycle low tracking, rebound measurement, and macro bar zones.
 */

import type { MacroZone } from "./amaTypes";
import { MACRO_ZONE_RANGES } from "./amaTypes";

// ─── Daily Close Observation (R3 — explicit isClosed, R4.9 — mandatory) ──

export interface DailyCloseObservation {
  timestamp: string;
  close: number;
  isClosed: boolean; // R4.9: mandatory, not optional
}

// R4.11: Normalization result with errors
export interface CandleNormalizationError {
  code: string;
  message: string;
  timestamp?: string;
}

export interface NormalizationResult {
  closes: DailyCloseObservation[];
  errors: CandleNormalizationError[];
  valid: boolean;
}

// R4.9: Legacy adapter — explicitly marks observations without isClosed
export function adaptLegacyCloseObservation(
  obs: { timestamp: string; close: number; isClosed?: boolean },
): DailyCloseObservation | null {
  if (obs.isClosed === undefined) {
    return null; // R4.9: Missing isClosed — cannot adapt silently
  }
  return {
    timestamp: new Date(obs.timestamp).toISOString(),
    close: obs.close,
    isClosed: obs.isClosed,
  };
}

// ─── Shared Normalization (R4.10: UTC canonical, R4.11: deterministic duplicates) ──
// R5.1: @deprecated LEGACY_COMPATIBILITY_ONLY NOT_FOR_CANONICAL_HWM_FLOW
// Use normalizeClosedDailyClosesStrict() in all canonical HWM flows.

/** @deprecated R5.1: Use normalizeClosedDailyClosesStrict() instead. Legacy compatibility only. */
export function normalizeClosedDailyCloses(
  closes: { timestamp: string; close: number; isClosed?: boolean }[],
): DailyCloseObservation[] {
  // R4.10: Convert each timestamp to UTC canonical
  const validated = closes.filter((c) => {
    const ts = new Date(c.timestamp).getTime();
    if (Number.isNaN(ts)) return false;
    if (typeof c.close !== "number" || !Number.isFinite(c.close)) return false;
    if (c.close <= 0) return false;
    return true;
  });

  const mapped: DailyCloseObservation[] = validated.map((c) => ({
    timestamp: new Date(c.timestamp).toISOString(), // R4.10: UTC canonical
    close: c.close,
    isClosed: c.isClosed !== false, // Keep backward compat for legacy callers
  }));

  mapped.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // R4.10: Deduplicate by UTC canonical instant
  const seen = new Set<string>();
  return mapped.filter((c) => {
    if (seen.has(c.timestamp)) return false;
    seen.add(c.timestamp);
    return true;
  });
}

// R4.11: Strict normalization with deterministic duplicate policy and error reporting
export function normalizeClosedDailyClosesStrict(
  closes: { timestamp: string; close: number; isClosed?: boolean }[],
): NormalizationResult {
  const errors: CandleNormalizationError[] = [];
  const valid: DailyCloseObservation[] = [];

  // First pass: validate and convert to UTC canonical
  for (const c of closes) {
    const ts = new Date(c.timestamp).getTime();
    if (Number.isNaN(ts)) {
      errors.push({ code: "INVALID_TIMESTAMP", message: `Invalid timestamp: ${c.timestamp}`, timestamp: c.timestamp });
      continue;
    }
    if (typeof c.close !== "number" || !Number.isFinite(c.close) || c.close <= 0) {
      errors.push({ code: "INVALID_PRICE", message: `Invalid price: ${c.close}`, timestamp: c.timestamp });
      continue;
    }
    // R4.9: isClosed is mandatory in strict mode
    if (c.isClosed === undefined) {
      errors.push({ code: "INVALID_CANDLE_MISSING_CLOSED_STATUS", message: `Missing isClosed for ${c.timestamp}`, timestamp: c.timestamp });
      continue;
    }

    valid.push({
      timestamp: new Date(c.timestamp).toISOString(), // R4.10: UTC canonical
      close: c.close,
      isClosed: c.isClosed,
    });
  }

  // Sort by timestamp
  valid.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // R4.11: Deterministic duplicate policy
  const byUtcInstant = new Map<string, DailyCloseObservation[]>();
  for (const c of valid) {
    const key = c.timestamp; // Already UTC canonical
    if (!byUtcInstant.has(key)) {
      byUtcInstant.set(key, []);
    }
    byUtcInstant.get(key)!.push(c);
  }

  const result: DailyCloseObservation[] = [];
  for (const [key, group] of byUtcInstant) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    // R4.11: Policy for duplicates
    const closed = group.filter((c) => c.isClosed);
    const open = group.filter((c) => !c.isClosed);

    if (closed.length === 0) {
      // All open — keep first
      result.push(group[0]);
      continue;
    }

    if (closed.length === 1) {
      // R4.11: Closed prevails over open
      result.push(closed[0]);
      continue;
    }

    // R4.11: Multiple closed — check for conflict
    const prices = new Set(closed.map((c) => c.close));
    if (prices.size === 1) {
      // Same price — deduplicate
      result.push(closed[0]);
    } else {
      // R4.11: Conflicting closed candle
      errors.push({
        code: "CONFLICTING_CLOSED_CANDLE",
        message: `Conflicting closed candles at ${key}: prices ${[...prices].join(", ")}`,
        timestamp: key,
      });
      // Do not include — block confirmation
    }
  }

  return {
    closes: result,
    errors,
    valid: errors.length === 0,
  };
}

// R4.12: UTC day key and consecutive day check
export function utcDayKey(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function areConsecutiveUtcDays(ts1: string, ts2: string): boolean {
  const d1 = new Date(utcDayKey(ts1) + "T00:00:00Z");
  const d2 = new Date(utcDayKey(ts2) + "T00:00:00Z");
  const diffMs = d2.getTime() - d1.getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;
  return Math.abs(diffMs) === oneDayMs;
}

export function areAllConsecutiveUtcDays(closes: DailyCloseObservation[]): boolean {
  if (closes.length < 2) return true;
  for (let i = 1; i < closes.length; i++) {
    if (!areConsecutiveUtcDays(closes[i - 1].timestamp, closes[i].timestamp)) {
      return false;
    }
  }
  return true;
}

// ─── HWM Types ──────────────────────────────────────────────────────

export type HwmStatus =
  | "CANDIDATE"
  | "CONFIRMING"
  | "CONFIRMED"
  | "FROZEN"
  | "SUPERSEDED"
  | "INVALIDATED";

export interface HighWaterMark {
  hwmId: string;
  price: number;
  timestamp: string;
  status: HwmStatus;
  confirmedAt: string | null;
  supersededBy: string | null;
}

// ─── ATR Computation ────────────────────────────────────────────────

export interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function computeATR(
  candles: Candle[],
  period: number = 20,
): number | null {
  if (candles.length < period + 1) return null;

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close),
    );
    trueRanges.push(tr);
  }

  // Simple moving average of last `period` true ranges
  const slice = trueRanges.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

export function computeATRPercentage(
  atr: number | null,
  currentPrice: number,
): number | null {
  if (atr === null || atr <= 0 || currentPrice <= 0) return null;
  return (atr / currentPrice) * 100;
}

// ─── Canonical Confirmation Logic (R2 — shared by bootstrap and incremental) ──

export interface ConfirmationInput {
  hwmPrice: number;
  hwmTimestamp: string;
  // R5.1: isClosed mandatory in canonical flow
  subsequentCloses: DailyCloseObservation[];
  requiredConfirmations: number;
  reversalThresholdPct: number;
}

export interface ConfirmationResult {
  confirmed: boolean;
  status: HwmStatus;
  confirmedAt: string | null;
  reversalThresholdPrice: number;
  confirmationCloses: { timestamp: string; close: number }[];
  // R5.1: Normalization traceability
  normalizationValid: boolean;
  normalizationErrors: CandleNormalizationError[];
  reasonCodes: string[];
}

// R5.13: Find first valid consecutive confirmation window (point-in-time)
export interface ConsecutiveWindowResult {
  window: DailyCloseObservation[];
  confirmedAt: string | null;
  resetCount: number;
  reasonCodes: string[];
}

export function findConsecutiveConfirmationWindow(
  closes: DailyCloseObservation[],
  requiredConfirmations: number,
  reversalThresholdPrice: number,
  hwmPrice: number,
): ConsecutiveWindowResult {
  const reasonCodes: string[] = [];
  let resetCount = 0;
  let window: DailyCloseObservation[] = [];

  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];

    // R5.13: A candle that is open, above threshold, or above HWM resets the sequence
    if (!c.isClosed) {
      if (window.length > 0) { resetCount++; reasonCodes.push("OPEN_CANDLE_RESET"); }
      window = [];
      continue;
    }
    if (c.close > reversalThresholdPrice) {
      if (window.length > 0) { resetCount++; reasonCodes.push("ABOVE_THRESHOLD_RESET"); }
      window = [];
      continue;
    }
    if (c.close >= hwmPrice) {
      if (window.length > 0) { resetCount++; reasonCodes.push("ABOVE_HWM_RESET"); }
      window = [];
      continue;
    }

    // Check consecutiveness with previous candle in window
    if (window.length > 0) {
      if (!areConsecutiveUtcDays(window[window.length - 1].timestamp, c.timestamp)) {
        if (window.length > 0) { resetCount++; reasonCodes.push("GAP_RESET"); }
        window = [];
      }
    }

    window.push(c);

    if (window.length === requiredConfirmations) {
      return {
        window,
        confirmedAt: window[requiredConfirmations - 1].timestamp,
        resetCount,
        reasonCodes,
      };
    }
  }

  if (window.length < requiredConfirmations && window.length > 0) {
    reasonCodes.push("INSUFFICIENT_CLOSED_CANDLES");
  }

  return { window, confirmedAt: null, resetCount, reasonCodes };
}

export function evaluateConfirmation(input: ConfirmationInput): ConfirmationResult {
  const { hwmPrice, hwmTimestamp, subsequentCloses, requiredConfirmations, reversalThresholdPct } = input;
  const reasonCodes: string[] = [];

  // R4.13: Validate parameters — fail-closed
  if (typeof requiredConfirmations !== "number" || !Number.isInteger(requiredConfirmations) || requiredConfirmations <= 0) {
    reasonCodes.push("INVALID_CONFIRMATION_PARAMETERS");
    return {
      confirmed: false,
      status: "CANDIDATE",
      confirmedAt: null,
      reversalThresholdPrice: hwmPrice * (1 - (reversalThresholdPct || 0) / 100),
      confirmationCloses: [],
      normalizationValid: true,
      normalizationErrors: [],
      reasonCodes,
    };
  }
  if (typeof reversalThresholdPct !== "number" || reversalThresholdPct <= 0 || reversalThresholdPct >= 100) {
    reasonCodes.push("INVALID_CONFIRMATION_PARAMETERS");
    return {
      confirmed: false,
      status: "CANDIDATE",
      confirmedAt: null,
      reversalThresholdPrice: hwmPrice,
      confirmationCloses: [],
      normalizationValid: true,
      normalizationErrors: [],
      reasonCodes,
    };
  }
  if (typeof hwmPrice !== "number" || hwmPrice <= 0 || !Number.isFinite(hwmPrice)) {
    reasonCodes.push("INVALID_CONFIRMATION_PARAMETERS");
    return {
      confirmed: false,
      status: "CANDIDATE",
      confirmedAt: null,
      reversalThresholdPrice: 0,
      confirmationCloses: [],
      normalizationValid: true,
      normalizationErrors: [],
      reasonCodes,
    };
  }
  const hwmTs = new Date(hwmTimestamp).getTime();
  if (Number.isNaN(hwmTs)) {
    reasonCodes.push("INVALID_TIMESTAMP");
    return {
      confirmed: false,
      status: "CANDIDATE",
      confirmedAt: null,
      reversalThresholdPrice: hwmPrice * (1 - reversalThresholdPct / 100),
      confirmationCloses: [],
      normalizationValid: true,
      normalizationErrors: [],
      reasonCodes,
    };
  }

  const reversalThresholdPrice = hwmPrice * (1 - reversalThresholdPct / 100);

  // R5.1: Use strict normalization in canonical HWM flow
  const normResult = normalizeClosedDailyClosesStrict(subsequentCloses);
  if (!normResult.valid) {
    reasonCodes.push("NORMALIZATION_FAILED");
    for (const err of normResult.errors) {
      reasonCodes.push(err.code);
    }
    return {
      confirmed: false,
      status: "CANDIDATE",
      confirmedAt: null,
      reversalThresholdPrice,
      confirmationCloses: [],
      normalizationValid: false,
      normalizationErrors: normResult.errors,
      reasonCodes,
    };
  }

  // R6.9: Validate all closes have timestamp > hwmTimestamp
  for (const c of normResult.closes) {
    const cTs = new Date(c.timestamp).getTime();
    if (!Number.isNaN(cTs) && cTs <= hwmTs) {
      reasonCodes.push("INVALID_SUBSEQUENT_CLOSE_TIMESTAMP");
      return {
        confirmed: false,
        status: "CANDIDATE",
        confirmedAt: null,
        reversalThresholdPrice,
        confirmationCloses: [],
        normalizationValid: false,
        normalizationErrors: [],
        reasonCodes,
      };
    }
  }

  // R6.10: Pass ALL observations (open+closed) to findConsecutiveConfirmationWindow
  // so that open candles actually reset the sequence
  const allCloses = normResult.closes;
  const closedCloses = normResult.closes.filter((c) => c.isClosed);

  // R4.13: Prevent every([]) from confirming with zero observations
  if (closedCloses.length === 0 || closedCloses.length < requiredConfirmations) {
    reasonCodes.push("INSUFFICIENT_CLOSED_CANDLES");
    return {
      confirmed: false,
      status: "CANDIDATE",
      confirmedAt: null,
      reversalThresholdPrice,
      confirmationCloses: [],
      normalizationValid: true,
      normalizationErrors: [],
      reasonCodes,
    };
  }

  // R5.13: Use findConsecutiveConfirmationWindow with ALL observations (R6.10)
  const windowResult = findConsecutiveConfirmationWindow(
    allCloses,
    requiredConfirmations,
    reversalThresholdPrice,
    hwmPrice,
  );

  if (windowResult.confirmedAt !== null && windowResult.window.length === requiredConfirmations) {
    return {
      confirmed: true,
      status: "CONFIRMED",
      confirmedAt: windowResult.confirmedAt,
      reversalThresholdPrice,
      confirmationCloses: windowResult.window.map((c) => ({ timestamp: c.timestamp, close: c.close })),
      normalizationValid: true,
      normalizationErrors: [],
      reasonCodes: windowResult.reasonCodes,
    };
  }

  reasonCodes.push(...windowResult.reasonCodes);
  if (windowResult.window.length > 0 && windowResult.window.length < requiredConfirmations) {
    reasonCodes.push("NON_CONSECUTIVE_DAILY_SEQUENCE");
  }

  return {
    confirmed: false,
    status: "CONFIRMING",
    confirmedAt: null,
    reversalThresholdPrice,
    confirmationCloses: windowResult.window.map((c) => ({ timestamp: c.timestamp, close: c.close })),
    normalizationValid: true,
    normalizationErrors: [],
    reasonCodes,
  };
}

// ─── HWM Bootstrap (R5.1: strict normalization, isClosed mandatory) ──

export function bootstrapHWM(
  dailyCloses: DailyCloseObservation[],
  requiredConfirmations: number = 3,
  reversalThresholdPct: number = 5.0,
): HighWaterMark | null {
  // R5.1: Use strict normalization
  const normResult = normalizeClosedDailyClosesStrict(dailyCloses);
  if (!normResult.valid || normResult.closes.length === 0) return null;

  // R3: Only consider closed candles for HWM detection
  const closedOnly = normResult.closes.filter((c) => c.isClosed);
  if (closedOnly.length === 0) return null;

  // Find the highest close among closed candles
  let highestIdx = 0;
  for (let i = 1; i < closedOnly.length; i++) {
    if (closedOnly[i].close > closedOnly[highestIdx].close) {
      highestIdx = i;
    }
  }

  const hwmPrice = closedOnly[highestIdx].close;
  const hwmTimestamp = closedOnly[highestIdx].timestamp;
  // R7.9: Pass ALL observations (open+closed) after HWM for confirmation
  // so that open candles can reset the sequence (parity with processIncrementalClose)
  const hwmTsMs = new Date(hwmTimestamp).getTime();
  const subsequentAll = normResult.closes.filter((c) => new Date(c.timestamp).getTime() > hwmTsMs);

  // R2: Use canonical shared evaluation function (R5.1: strict, R7.9: pass all observations)
  const result = evaluateConfirmation({
    hwmPrice,
    hwmTimestamp,
    subsequentCloses: subsequentAll,
    requiredConfirmations,
    reversalThresholdPct,
  });

  // R5.14: Use UTC canonical timestamp for hwmId
  const canonicalTs = new Date(hwmTimestamp).toISOString();

  return {
    hwmId: `hwm-${canonicalTs}`,
    price: hwmPrice,
    timestamp: canonicalTs,
    status: result.status,
    confirmedAt: result.confirmedAt,
    supersededBy: null,
  };
}

export function supersedeHWM(
  oldHwm: HighWaterMark,
  newHwm: HighWaterMark,
): { oldHwm: HighWaterMark; newHwm: HighWaterMark } {
  // R6.11: Unify supersession semantics — new HWM is CANDIDATE, not CONFIRMED
  return {
    oldHwm: { ...oldHwm, status: "SUPERSEDED" as HwmStatus, supersededBy: newHwm.hwmId },
    newHwm: { ...newHwm, status: "CANDIDATE" as HwmStatus },
  };
}

export function invalidateHWM(hwm: HighWaterMark): HighWaterMark {
  return { ...hwm, status: "INVALIDATED" as HwmStatus };
}

export function freezeHWM(hwm: HighWaterMark): HighWaterMark {
  return { ...hwm, status: "FROZEN" as HwmStatus };
}

// ─── Ceiling Detection ──────────────────────────────────────────────

export function isCeilingConfirmed(
  hwm: HighWaterMark,
  currentPrice: number,
  atr: number | null,
  reversalThresholdPct: number = 10,
): boolean {
  if (hwm.status !== "CONFIRMED") return false;
  if (atr === null) return false;

  const dropPct = ((hwm.price - currentPrice) / hwm.price) * 100;
  return dropPct >= reversalThresholdPct;
}

// ─── Cycle Low Tracking ─────────────────────────────────────────────

export interface CycleLow {
  price: number;
  timestamp: string;
  confirmedAt: string | null;
}

export function detectCycleLow(
  dailyCloses: { timestamp: string; close: number }[],
  sinceTimestamp: string,
): CycleLow | null {
  const relevant = dailyCloses.filter(
    (c) => c.timestamp >= sinceTimestamp,
  );
  if (relevant.length === 0) return null;

  let lowestIdx = 0;
  for (let i = 1; i < relevant.length; i++) {
    if (relevant[i].close < relevant[lowestIdx].close) {
      lowestIdx = i;
    }
  }

  return {
    price: relevant[lowestIdx].close,
    timestamp: relevant[lowestIdx].timestamp,
    confirmedAt: relevant.length > lowestIdx + 1 ? relevant[relevant.length - 1].timestamp : null,
  };
}

export function computeDropPct(hwm: number, currentPrice: number): number {
  if (hwm <= 0) return 0;
  return ((hwm - currentPrice) / hwm) * 100;
}

export function computeReboundPct(cycleLow: number, currentPrice: number): number {
  if (cycleLow <= 0) return 0;
  return ((currentPrice - cycleLow) / cycleLow) * 100;
}

// ─── Macro Bar Zones ────────────────────────────────────────────────

export function getMacroZone(dropPct: number): MacroZone {
  for (const range of MACRO_ZONE_RANGES) {
    if (dropPct >= range.minPct && dropPct < range.maxPct) {
      return range.zone;
    }
  }
  if (dropPct >= 80) return "CAPITULACION_EXTREMA";
  return "NORMAL";
}

export function getZoneRange(zone: MacroZone): { minPct: number; maxPct: number } | null {
  const range = MACRO_ZONE_RANGES.find((r) => r.zone === zone);
  return range ? { minPct: range.minPct, maxPct: range.maxPct } : null;
}

export function isValueZone(zone: MacroZone): boolean {
  return zone === "VALUE" || zone === "DEEP_VALUE" || zone === "CAPITULACION" || zone === "CAPITULACION_EXTREMA";
}

export function isCapitulation(zone: MacroZone): boolean {
  return zone === "CAPITULACION" || zone === "CAPITULACION_EXTREMA";
}

// ─── Reversal Threshold ─────────────────────────────────────────────

export function computeReversalThreshold(
  hwm: number,
  atr: number | null,
  atrMultiplier: number = 3.0,
  fixedThresholdPct: number = 10.0,
  minimumReversalPct: number = 5.0,
  maximumReversalPct: number = 50.0,
): number {
  if (hwm <= 0) return hwm;

  let thresholdPct: number;
  if (atr === null || atr <= 0) {
    thresholdPct = fixedThresholdPct;
  } else {
    const atrPct = (atr / hwm) * 100;
    thresholdPct = Math.max(fixedThresholdPct, atrPct * atrMultiplier);
  }

  // Clamp between minimum and maximum
  thresholdPct = Math.max(minimumReversalPct, Math.min(thresholdPct, maximumReversalPct));

  return hwm * (1 - thresholdPct / 100);
}

// ─── Incremental HWM Processing (R5.1: strict, R5.14: HwmTransition) ──

// R5.14: Explicit transition result
export interface HwmTransition {
  previous: HighWaterMark;
  current: HighWaterMark;
  transition: "UNCHANGED" | "UPDATED" | "CONFIRMED" | "SUPERSEDED" | "REJECTED";
  reasonCodes: string[];
}

export function processIncrementalClose(
  hwm: HighWaterMark,
  newClose: DailyCloseObservation,
  closesAvailableAsOfNewClose: DailyCloseObservation[],
  requiredConfirmations: number,
  reversalThresholdPct: number,
): HwmTransition {
  const reasonCodes: string[] = [];

  if (hwm.status === "FROZEN" || hwm.status === "INVALIDATED") {
    reasonCodes.push("HWM_FROZEN_OR_INVALIDATED");
    return { previous: hwm, current: hwm, transition: "REJECTED", reasonCodes };
  }

  // R4.14: Validate newClose before using it
  const newCloseTs = new Date(newClose.timestamp).getTime();
  if (Number.isNaN(newCloseTs)) {
    reasonCodes.push("INVALID_TIMESTAMP");
    return { previous: hwm, current: hwm, transition: "REJECTED", reasonCodes };
  }
  if (typeof newClose.close !== "number" || !Number.isFinite(newClose.close) || newClose.close <= 0) {
    reasonCodes.push("INVALID_PRICE");
    return { previous: hwm, current: hwm, transition: "REJECTED", reasonCodes };
  }
  // R5.1: isClosed must be present (mandatory in DailyCloseObservation)
  if (newClose.isClosed === undefined) {
    reasonCodes.push("INVALID_CANDLE_MISSING_CLOSED_STATUS");
    return { previous: hwm, current: hwm, transition: "REJECTED", reasonCodes };
  }

  const hwmTimestamp = new Date(hwm.timestamp).getTime();
  // R4.14: Reject timestamp <= HWM timestamp
  if (newCloseTs <= hwmTimestamp) {
    reasonCodes.push("TIMESTAMP_BEFORE_HWM");
    return { previous: hwm, current: hwm, transition: "REJECTED", reasonCodes };
  }

  // R3: No look-ahead — only use closes up to newClose timestamp
  const asOf = newCloseTs;

  // R3: Validate no future closes in the provided array
  const validCloses = closesAvailableAsOfNewClose.filter((c) => {
    const ts = new Date(c.timestamp).getTime();
    return ts <= asOf;
  });

  // R5.1: Use strict normalization
  const normResult = normalizeClosedDailyClosesStrict(validCloses);
  if (!normResult.valid) {
    for (const err of normResult.errors) {
      reasonCodes.push(err.code);
    }
    return { previous: hwm, current: hwm, transition: "REJECTED", reasonCodes };
  }
  const closedOnly = normResult.closes.filter((c) => c.isClosed);

  // R5.14: If new close exceeds HWM, HWM is superseded (only if closed)
  if (newClose.isClosed === true && newClose.close > hwm.price) {
    // R5.14: Normalize timestamp to UTC canonical for hwmId
    const canonicalTs = new Date(newClose.timestamp).toISOString();
    const newHwm: HighWaterMark = {
      hwmId: `hwm-${canonicalTs}`,
      price: newClose.close,
      timestamp: canonicalTs,
      status: "CANDIDATE",
      confirmedAt: null,
      supersededBy: null,
    };
    const previousHwm: HighWaterMark = {
      ...hwm,
      status: "SUPERSEDED" as HwmStatus,
      supersededBy: newHwm.hwmId,
    };
    reasonCodes.push("HWM_SUPERSEDED");
    return { previous: previousHwm, current: newHwm, transition: "SUPERSEDED", reasonCodes };
  }

  if (hwm.status === "CONFIRMED" || hwm.status === "SUPERSEDED") {
    reasonCodes.push("HWM_ALREADY_CONFIRMED_OR_SUPERSEDED");
    return { previous: hwm, current: hwm, transition: "UNCHANGED", reasonCodes };
  }

  // R7.9: Pass ALL observations (open+closed) after HWM for confirmation
  // so that open candles can reset the sequence (parity with bootstrapHWM)
  const subsequentAll = normResult.closes.filter(
    (c) => new Date(c.timestamp).getTime() > hwmTimestamp,
  );

  const result = evaluateConfirmation({
    hwmPrice: hwm.price,
    hwmTimestamp: hwm.timestamp,
    subsequentCloses: subsequentAll,
    requiredConfirmations,
    reversalThresholdPct,
  });

  const updatedHwm: HighWaterMark = {
    ...hwm,
    status: result.status,
    confirmedAt: result.confirmedAt,
  };

  const transition = result.confirmed ? "CONFIRMED" : "UPDATED";
  reasonCodes.push(...result.reasonCodes);

  return { previous: hwm, current: updatedHwm, transition, reasonCodes };
}

// ─── Weekly Confirmation (R2 — explicitly disabled) ──────────────────

export interface WeeklyConfirmationConfig {
  weeklyOverrideEnabled: boolean;
  requiredWeeklyCloses: number;
  weeklyBoundaryUtc: string;
  weeklyThresholdPrice: number | null;
}

export const DEFAULT_WEEKLY_CONFIG: WeeklyConfirmationConfig = {
  weeklyOverrideEnabled: false,
  requiredWeeklyCloses: 0,
  weeklyBoundaryUtc: "00:00:00Z",
  weeklyThresholdPrice: null,
};

export function isWeeklyConfirmationEnabled(config: WeeklyConfirmationConfig): boolean {
  return config.weeklyOverrideEnabled && config.requiredWeeklyCloses > 0;
}

// ─── Reversal Confirmation (R5.15: proper contract, delegates to strict engine) ──

export function isReversalConfirmed(
  hwmPrice: number,
  hwmTimestamp: string,
  reversalThresholdPct: number,
  requiredDailyCloses: number,
  dailyCloses: DailyCloseObservation[],
): boolean {
  // R5.15: Delegate to same strict engine as evaluateConfirmation
  const result = evaluateConfirmation({
    hwmPrice,
    hwmTimestamp,
    subsequentCloses: dailyCloses,
    requiredConfirmations: requiredDailyCloses,
    reversalThresholdPct,
  });

  return result.confirmed;
}
