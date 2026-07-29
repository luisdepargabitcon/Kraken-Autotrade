/**
 * AMA HWM & Macro Bar — Fase 9
 *
 * High Water Mark bootstrap, ATR computation, ceiling detection,
 * cycle low tracking, rebound measurement, and macro bar zones.
 */

import type { MacroZone } from "./amaTypes";
import { MACRO_ZONE_RANGES } from "./amaTypes";

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

// ─── HWM Bootstrap ──────────────────────────────────────────────────

export function bootstrapHWM(
  dailyCloses: { timestamp: string; close: number }[],
  requiredConfirmations: number = 3,
): HighWaterMark | null {
  if (dailyCloses.length === 0) return null;

  // Find the highest close
  let highestIdx = 0;
  for (let i = 1; i < dailyCloses.length; i++) {
    if (dailyCloses[i].close > dailyCloses[highestIdx].close) {
      highestIdx = i;
    }
  }

  const subsequentCloses = dailyCloses.slice(highestIdx + 1);

  // Not enough subsequent closes to confirm → CANDIDATE
  if (subsequentCloses.length < requiredConfirmations) {
    return {
      hwmId: `hwm-${Date.now()}`,
      price: dailyCloses[highestIdx].close,
      timestamp: dailyCloses[highestIdx].timestamp,
      status: "CANDIDATE",
      confirmedAt: null,
      supersededBy: null,
    };
  }

  // Check if the high is confirmed by `requiredConfirmations` subsequent lower closes
  const confirmationCloses = subsequentCloses.slice(0, requiredConfirmations);
  const allLower = confirmationCloses.every((c) => c.close < dailyCloses[highestIdx].close);

  if (allLower) {
    return {
      hwmId: `hwm-${Date.now()}`,
      price: dailyCloses[highestIdx].close,
      timestamp: dailyCloses[highestIdx].timestamp,
      status: "CONFIRMED",
      confirmedAt: confirmationCloses[requiredConfirmations - 1].timestamp,
      supersededBy: null,
    };
  }

  // Enough subsequent closes but not all are lower → CONFIRMING
  return {
    hwmId: `hwm-${Date.now()}`,
    price: dailyCloses[highestIdx].close,
    timestamp: dailyCloses[highestIdx].timestamp,
    status: "CONFIRMING",
    confirmedAt: null,
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
): number {
  if (atr === null || hwm <= 0) {
    return hwm * (1 - fixedThresholdPct / 100);
  }
  const atrThreshold = hwm - (atr * atrMultiplier);
  const fixedThreshold = hwm * (1 - fixedThresholdPct / 100);
  return Math.max(atrThreshold, fixedThreshold);
}

export function isReversalConfirmed(
  hwm: number,
  currentPrice: number,
  reversalThreshold: number,
  requiredDailyCloses: number = 3,
  dailyCloses: { timestamp: string; close: number }[] = [],
): boolean {
  if (currentPrice > reversalThreshold) return false;

  // Check for required consecutive closes below threshold
  const recentCloses = dailyCloses.slice(-requiredDailyCloses);
  if (recentCloses.length < requiredDailyCloses) return false;

  return recentCloses.every((c) => c.close <= reversalThreshold);
}
