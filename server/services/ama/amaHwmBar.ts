/**
 * AMA HWM & Macro Bar — Fase 9
 *
 * High Water Mark bootstrap, ATR computation, ceiling detection,
 * cycle low tracking, rebound measurement, and macro bar zones.
 */

import type { MacroZone } from "./amaTypes";
import { MACRO_ZONE_RANGES } from "./amaTypes";

// ─── Daily Close Observation (R3 — explicit isClosed) ────────────────

export interface DailyCloseObservation {
  timestamp: string;
  close: number;
  isClosed: boolean;
}

// ─── Shared Normalization (R3 — used by bootstrap, incremental, evaluate) ──

export function normalizeClosedDailyCloses(
  closes: { timestamp: string; close: number; isClosed?: boolean }[],
): DailyCloseObservation[] {
  const validated = closes.filter((c) => {
    const ts = new Date(c.timestamp).getTime();
    if (Number.isNaN(ts)) return false;
    if (typeof c.close !== "number" || !Number.isFinite(c.close)) return false;
    if (c.close <= 0) return false;
    return true;
  });

  const mapped: DailyCloseObservation[] = validated.map((c) => ({
    timestamp: c.timestamp,
    close: c.close,
    isClosed: c.isClosed !== false,
  }));

  mapped.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const seen = new Set<string>();
  return mapped.filter((c) => {
    if (seen.has(c.timestamp)) return false;
    seen.add(c.timestamp);
    return true;
  });
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
  subsequentCloses: { timestamp: string; close: number }[];
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

  const reversalThresholdPrice = hwmPrice * (1 - reversalThresholdPct / 100);

  // R3: Use shared normalization
  const normalized = normalizeClosedDailyCloses(subsequentCloses);
  const closedCloses = normalized.filter((c) => c.isClosed);

  if (closedCloses.length < requiredConfirmations) {
    return {
      confirmed: false,
      status: "CANDIDATE",
      confirmedAt: null,
      reversalThresholdPrice,
      confirmationCloses: [],
    };
  }

  const confirmationCloses = closedCloses.slice(0, requiredConfirmations);

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

  // R3: No look-ahead — only use closes up to newClose timestamp
  const asOf = new Date(newClose.timestamp).getTime();
  const hwmTimestamp = new Date(hwm.timestamp).getTime();

  // R3: Validate no future closes in the provided array
  const validCloses = closesAvailableAsOfNewClose.filter((c) => {
    const ts = new Date(c.timestamp).getTime();
    return ts <= asOf;
  });

  // R3: Use shared normalization
  const normalized = normalizeClosedDailyCloses(validCloses);
  const closedOnly = normalized.filter((c) => c.isClosed);

  // If new close exceeds HWM, HWM is superseded (only if closed)
  if (newClose.isClosed !== false && newClose.close > hwm.price) {
    return {
      hwmId: `hwm-${newClose.timestamp}`,
      price: newClose.close,
      timestamp: newClose.timestamp,
      status: "CANDIDATE",
      confirmedAt: null,
      supersededBy: null,
    };
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

// ─── Reversal Confirmation (uses canonical logic) ───────────────────

export function isReversalConfirmed(
  hwm: number,
  currentPrice: number,
  reversalThreshold: number,
  requiredDailyCloses: number = 3,
  dailyCloses: { timestamp: string; close: number }[] = [],
): boolean {
  if (currentPrice > reversalThreshold) return false;

  const recentCloses = dailyCloses.slice(-requiredDailyCloses);
  if (recentCloses.length < requiredDailyCloses) return false;

  return recentCloses.every((c) => c.close <= reversalThreshold);
}
