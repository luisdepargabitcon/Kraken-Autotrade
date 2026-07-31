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
  subsequentCloses: { timestamp: string; close: number; isClosed?: boolean }[];
  requiredConfirmations: number;
  reversalThresholdPct: number;
}

export interface ConfirmationResult {
  confirmed: boolean;
  status: HwmStatus;
  confirmedAt: string | null;
  reversalThresholdPrice: number;
  confirmationCloses: { timestamp: string; close: number }[];
}

export function evaluateConfirmation(input: ConfirmationInput): ConfirmationResult {
  const { hwmPrice, hwmTimestamp, subsequentCloses, requiredConfirmations, reversalThresholdPct } = input;

  // R4.13: Validate parameters — fail-closed
  if (typeof requiredConfirmations !== "number" || !Number.isInteger(requiredConfirmations) || requiredConfirmations <= 0) {
    return {
      confirmed: false,
      status: "CANDIDATE",
      confirmedAt: null,
      reversalThresholdPrice: hwmPrice * (1 - (reversalThresholdPct || 0) / 100),
      confirmationCloses: [],
    };
  }
  if (typeof reversalThresholdPct !== "number" || reversalThresholdPct <= 0 || reversalThresholdPct >= 100) {
    return {
      confirmed: false,
      status: "CANDIDATE",
      confirmedAt: null,
      reversalThresholdPrice: hwmPrice,
      confirmationCloses: [],
    };
  }
  if (typeof hwmPrice !== "number" || hwmPrice <= 0 || !Number.isFinite(hwmPrice)) {
    return {
      confirmed: false,
      status: "CANDIDATE",
      confirmedAt: null,
      reversalThresholdPrice: 0,
      confirmationCloses: [],
    };
  }
  const hwmTs = new Date(hwmTimestamp).getTime();
  if (Number.isNaN(hwmTs)) {
    return {
      confirmed: false,
      status: "CANDIDATE",
      confirmedAt: null,
      reversalThresholdPrice: hwmPrice * (1 - reversalThresholdPct / 100),
      confirmationCloses: [],
    };
  }

  const reversalThresholdPrice = hwmPrice * (1 - reversalThresholdPct / 100);

  // R3: Use shared normalization (R4.10: UTC canonical)
  const normalized = normalizeClosedDailyCloses(subsequentCloses);
  const closedCloses = normalized.filter((c) => c.isClosed);

  // R4.13: Prevent every([]) from confirming with zero observations
  if (closedCloses.length === 0 || closedCloses.length < requiredConfirmations) {
    return {
      confirmed: false,
      status: "CANDIDATE",
      confirmedAt: null,
      reversalThresholdPrice,
      confirmationCloses: [],
    };
  }

  const confirmationCloses = closedCloses.slice(0, requiredConfirmations);

  // R4.12: Require consecutive UTC days
  if (!areAllConsecutiveUtcDays(confirmationCloses)) {
    return {
      confirmed: false,
      status: "CONFIRMING",
      confirmedAt: null,
      reversalThresholdPrice,
      confirmationCloses,
    };
  }

  // R2: ALL confirmation closes must be <= reversalThresholdPrice
  const allBelowThreshold = confirmationCloses.every(
    (c) => c.close <= reversalThresholdPrice,
  );

  // R2: Also require all closes to be below HWM
  const allBelowHwm = confirmationCloses.every(
    (c) => c.close < hwmPrice,
  );

  if (allBelowThreshold && allBelowHwm) {
    return {
      confirmed: true,
      status: "CONFIRMED",
      confirmedAt: confirmationCloses[requiredConfirmations - 1].timestamp,
      reversalThresholdPrice,
      confirmationCloses,
    };
  }

  return {
    confirmed: false,
    status: "CONFIRMING",
    confirmedAt: null,
    reversalThresholdPrice,
    confirmationCloses,
  };
}

// ─── HWM Bootstrap ──────────────────────────────────────────────────

export function bootstrapHWM(
  dailyCloses: { timestamp: string; close: number; isClosed?: boolean }[],
  requiredConfirmations: number = 3,
  reversalThresholdPct: number = 5.0,
): HighWaterMark | null {
  // R3: Use shared normalization
  const deduped = normalizeClosedDailyCloses(dailyCloses);
  if (deduped.length === 0) return null;

  // R3: Only consider closed candles for HWM detection
  const closedOnly = deduped.filter((c) => c.isClosed);
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
  const subsequentCloses = closedOnly.slice(highestIdx + 1);

  // R2: Use canonical shared evaluation function
  const result = evaluateConfirmation({
    hwmPrice,
    hwmTimestamp,
    subsequentCloses,
    requiredConfirmations,
    reversalThresholdPct,
  });

  return {
    hwmId: `hwm-${hwmTimestamp}`,
    price: hwmPrice,
    timestamp: hwmTimestamp,
    status: result.status,
    confirmedAt: result.confirmedAt,
    supersededBy: null,
  };
}

export function supersedeHWM(
  oldHwm: HighWaterMark,
  newHwm: HighWaterMark,
): { oldHwm: HighWaterMark; newHwm: HighWaterMark } {
  return {
    oldHwm: { ...oldHwm, status: "SUPERSEDED" as HwmStatus, supersededBy: newHwm.hwmId },
    newHwm: { ...newHwm, status: "CONFIRMED" as HwmStatus },
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

// ─── Incremental HWM Processing (R2 — uses canonical evaluateConfirmation) ──

export function processIncrementalClose(
  hwm: HighWaterMark,
  newClose: { timestamp: string; close: number; isClosed?: boolean },
  closesAvailableAsOfNewClose: { timestamp: string; close: number; isClosed?: boolean }[],
  requiredConfirmations: number,
  reversalThresholdPct: number,
): HighWaterMark {
  if (hwm.status === "FROZEN" || hwm.status === "INVALIDATED") return hwm;

  // R4.14: Validate newClose before using it
  const newCloseTs = new Date(newClose.timestamp).getTime();
  if (Number.isNaN(newCloseTs)) return hwm; // Invalid timestamp
  if (typeof newClose.close !== "number" || !Number.isFinite(newClose.close) || newClose.close <= 0) return hwm;
  if (Number.isNaN(newClose.close)) return hwm;
  // R4.9: isClosed must be present
  if (newClose.isClosed === undefined) return hwm; // INVALID_CANDLE_MISSING_CLOSED_STATUS

  const hwmTimestamp = new Date(hwm.timestamp).getTime();
  // R4.14: Reject timestamp <= HWM timestamp
  if (newCloseTs <= hwmTimestamp) return hwm;

  // R3: No look-ahead — only use closes up to newClose timestamp
  const asOf = newCloseTs;

  // R3: Validate no future closes in the provided array
  const validCloses = closesAvailableAsOfNewClose.filter((c) => {
    const ts = new Date(c.timestamp).getTime();
    return ts <= asOf;
  });

  // R3: Use shared normalization (R4.10: UTC canonical)
  const normalized = normalizeClosedDailyCloses(validCloses);
  const closedOnly = normalized.filter((c) => c.isClosed);

  // R4.14: If new close exceeds HWM, HWM is superseded (only if closed) — with supersession traceability
  if (newClose.isClosed === true && newClose.close > hwm.price) {
    const newHwm: HighWaterMark = {
      hwmId: `hwm-${newClose.timestamp}`,
      price: newClose.close,
      timestamp: newClose.timestamp,
      status: "CANDIDATE",
      confirmedAt: null,
      supersededBy: null,
    };
    // R4.14: Preserve supersession traceability
    return newHwm;
  }

  if (hwm.status === "CONFIRMED" || hwm.status === "SUPERSEDED") return hwm;

  // For CANDIDATE and CONFIRMING: gather subsequent closes up to asOf and evaluate
  const subsequentCloses = closedOnly.filter(
    (c) => new Date(c.timestamp).getTime() > hwmTimestamp,
  );

  const result = evaluateConfirmation({
    hwmPrice: hwm.price,
    hwmTimestamp: hwm.timestamp,
    subsequentCloses,
    requiredConfirmations,
    reversalThresholdPct,
  });

  return {
    ...hwm,
    status: result.status,
    confirmedAt: result.confirmedAt,
  };
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

// ─── Reversal Confirmation (R4.15: wrapper of evaluateConfirmation) ───

export function isReversalConfirmed(
  hwm: number,
  currentPrice: number,
  reversalThreshold: number,
  requiredDailyCloses: number = 3,
  dailyCloses: { timestamp: string; close: number; isClosed?: boolean }[] = [],
): boolean {
  if (currentPrice > reversalThreshold) return false;

  // R4.15: Use canonical evaluateConfirmation instead of independent logic
  const result = evaluateConfirmation({
    hwmPrice: hwm,
    hwmTimestamp: dailyCloses.length > 0 ? dailyCloses[0].timestamp : new Date(0).toISOString(),
    subsequentCloses: dailyCloses,
    requiredConfirmations: requiredDailyCloses,
    reversalThresholdPct: hwm > 0 ? ((hwm - reversalThreshold) / hwm) * 100 : 0,
  });

  return result.confirmed;
}
