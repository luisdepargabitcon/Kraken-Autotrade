/**
 * KrakenDatasetValidator — Validates OHLCVT data integrity.
 *
 * Checks:
 * - timestamp finite, ascending, unique
 * - OHLC finite, > 0
 * - volume finite >= 0
 * - trades >= 0
 * - OHLC invariant: low <= open <= high, low <= close <= high
 * - Duplicate detection (identical vs conflicting)
 * - Gap detection (missing intervals)
 * - Multi-timeframe cross-check
 */

import type { KrakenDataset, KrakenOHLCRow } from "./krakenHistoricalLoader";
import { PAIR_MAPPINGS, TIMEFRAMES, loadAllCached } from "./krakenHistoricalLoader";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ValidationIssue {
  type: string;
  pair: string;
  timeframe: string;
  index?: number;
  timestamp?: number;
  message: string;
}

export interface GapInfo {
  pair: string;
  timeframe: string;
  expectedIntervals: number;
  observedIntervals: number;
  missingIntervals: number;
  gapCount: number;
  largestGapMinutes: number;
  firstGap: number | null;
  lastGap: number | null;
}

export interface MTFCheck {
  pair: string;
  parentTf: number;
  childTf: number;
  parentIndex: number;
  parentOpen: number;
  parentHigh: number;
  parentLow: number;
  parentClose: number;
  parentVolume: number;
  childOpen: number;
  childHigh: number;
  childLow: number;
  childClose: number;
  childVolume: number;
  openMatch: boolean;
  highMatch: boolean;
  lowMatch: boolean;
  closeMatch: boolean;
  volumeMatch: boolean;
  pass: boolean;
}

export interface ValidationResult {
  pair: string;
  timeframe: string;
  rowCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  issues: ValidationIssue[];
  gaps: GapInfo;
  duplicateIdentical: number;
  duplicateConflicting: number;
  valid: boolean;
}

export interface MTFResult {
  pair: string;
  checksTotal: number;
  checksPass: number;
  checksFail: number;
  checks: MTFCheck[];
}

// ─── Validation ──────────────────────────────────────────────────────────────

const TF_MS: Record<number, number> = {
  5: 5 * 60 * 1000,
  15: 15 * 60 * 1000,
  60: 60 * 60 * 1000,
  240: 240 * 60 * 1000,
};

const VOLUME_TOLERANCE = 0.01; // 1% tolerance for volume cross-check
const PRICE_TOLERANCE = 1e-6;

export function validateDataset(dataset: KrakenDataset): ValidationResult {
  const issues: ValidationIssue[] = [];
  let duplicateIdentical = 0;
  let duplicateConflicting = 0;
  const seenTimestamps = new Map<number, KrakenOHLCRow>();

  for (let i = 0; i < dataset.rows.length; i++) {
    const row = dataset.rows[i];
    const ts = row.timestamp;

    // Finite checks
    if (!Number.isFinite(ts) || ts <= 0) {
      issues.push({ type: "INVALID_TIMESTAMP", pair: dataset.pair, timeframe: `${dataset.timeframeMinutes}m`, index: i, timestamp: ts, message: `Invalid timestamp: ${ts}` });
      continue;
    }
    for (const [field, val] of [["open", row.open], ["high", row.high], ["low", row.low], ["close", row.close]] as [string, number][]) {
      if (!Number.isFinite(val) || val <= 0) {
        issues.push({ type: "INVALID_OHLC", pair: dataset.pair, timeframe: `${dataset.timeframeMinutes}m`, index: i, timestamp: ts, message: `${field}=${val} not finite or <= 0` });
      }
    }
    if (!Number.isFinite(row.volume) || row.volume < 0) {
      issues.push({ type: "INVALID_VOLUME", pair: dataset.pair, timeframe: `${dataset.timeframeMinutes}m`, index: i, timestamp: ts, message: `volume=${row.volume}` });
    }
    if (!Number.isFinite(row.trades) || row.trades < 0) {
      issues.push({ type: "INVALID_TRADES", pair: dataset.pair, timeframe: `${dataset.timeframeMinutes}m`, index: i, timestamp: ts, message: `trades=${row.trades}` });
    }

    // OHLC invariant: low <= open <= high, low <= close <= high
    if (row.low > row.open || row.low > row.close || row.high < row.open || row.high < row.close) {
      issues.push({ type: "OHLC_INVARIANT_VIOLATION", pair: dataset.pair, timeframe: `${dataset.timeframeMinutes}m`, index: i, timestamp: ts, message: `low=${row.low} open=${row.open} high=${row.high} close=${row.close}` });
    }

    // Ascending check
    if (i > 0 && ts <= dataset.rows[i - 1].timestamp) {
      const prev = dataset.rows[i - 1];
      if (ts === prev.timestamp) {
        // Duplicate timestamp
        const existing = seenTimestamps.get(ts);
        if (existing && existing.open === row.open && existing.close === row.close && existing.high === row.high && existing.low === row.low) {
          duplicateIdentical++;
        } else {
          duplicateConflicting++;
          issues.push({ type: "DUPLICATE_CONFLICT", pair: dataset.pair, timeframe: `${dataset.timeframeMinutes}m`, index: i, timestamp: ts, message: `Conflicting duplicate at ${ts}` });
        }
      } else {
        issues.push({ type: "NON_ASCENDING", pair: dataset.pair, timeframe: `${dataset.timeframeMinutes}m`, index: i, timestamp: ts, message: `timestamp ${ts} < prev ${prev.timestamp}` });
      }
    }

    seenTimestamps.set(ts, row);
  }

  // Gap detection
  const tfMs = TF_MS[dataset.timeframeMinutes] ?? dataset.timeframeMinutes * 60 * 1000;
  let missingIntervals = 0;
  let gapCount = 0;
  let largestGapMinutes = 0;
  let firstGap: number | null = null;
  let lastGap: number | null = null;

  for (let i = 1; i < dataset.rows.length; i++) {
    const expected = dataset.rows[i - 1].timestamp + tfMs;
    const actual = dataset.rows[i].timestamp;
    if (actual !== expected) {
      const gapMs = actual - expected;
      if (gapMs > 0) {
        const missingSlots = Math.round(gapMs / tfMs);
        missingIntervals += missingSlots;
        gapCount++;
        const gapMin = gapMs / (60 * 1000);
        if (gapMin > largestGapMinutes) largestGapMinutes = gapMin;
        if (firstGap === null) firstGap = expected;
        lastGap = expected;
      }
    }
  }

  const expectedIntervals = dataset.rows.length > 1
    ? Math.round((dataset.rows[dataset.rows.length - 1].timestamp - dataset.rows[0].timestamp) / tfMs) + 1
    : dataset.rows.length;

  const gaps: GapInfo = {
    pair: dataset.pair,
    timeframe: `${dataset.timeframeMinutes}m`,
    expectedIntervals,
    observedIntervals: dataset.rows.length,
    missingIntervals,
    gapCount,
    largestGapMinutes,
    firstGap,
    lastGap,
  };

  return {
    pair: dataset.pair,
    timeframe: `${dataset.timeframeMinutes}m`,
    rowCount: dataset.rows.length,
    firstTimestamp: dataset.rows.length > 0 ? dataset.rows[0].timestamp : 0,
    lastTimestamp: dataset.rows.length > 0 ? dataset.rows[dataset.rows.length - 1].timestamp : 0,
    issues,
    gaps,
    duplicateIdentical,
    duplicateConflicting,
    valid: duplicateConflicting === 0 && issues.filter(i => i.type === "OHLC_INVARIANT_VIOLATION" || i.type === "INVALID_OHLC" || i.type === "DUPLICATE_CONFLICT").length === 0,
  };
}

// ─── MTF Cross-check ─────────────────────────────────────────────────────────

export function crossCheckMTF(
  pair: string,
  childTf: number,
  parentTf: number,
  childRows: KrakenOHLCRow[],
  parentRows: KrakenOHLCRow[],
): MTFResult {
  const checks: MTFCheck[] = [];
  const ratio = parentTf / childTf;

  if (!Number.isInteger(ratio)) {
    return { pair, checksTotal: 0, checksPass: 0, checksFail: 0, checks };
  }

  const childByTime = new Map<number, KrakenOHLCRow>();
  for (const r of childRows) childByTime.set(r.timestamp, r);

  for (const parent of parentRows) {
    const childStart = parent.timestamp;
    const children: KrakenOHLCRow[] = [];
    for (let i = 0; i < ratio; i++) {
      const childTs = childStart + i * (childTf * 60 * 1000);
      const child = childByTime.get(childTs);
      if (child) children.push(child);
    }

    // Only check if we have all children (no gaps)
    if (children.length !== ratio) continue;

    const childOpen = children[0].open;
    const childHigh = Math.max(...children.map(c => c.high));
    const childLow = Math.min(...children.map(c => c.low));
    const childClose = children[children.length - 1].close;
    const childVolume = children.reduce((s, c) => s + c.volume, 0);

    const openMatch = Math.abs(parent.open - childOpen) < PRICE_TOLERANCE * Math.max(1, Math.abs(parent.open));
    const highMatch = Math.abs(parent.high - childHigh) < PRICE_TOLERANCE * Math.max(1, Math.abs(parent.high));
    const lowMatch = Math.abs(parent.low - childLow) < PRICE_TOLERANCE * Math.max(1, Math.abs(parent.low));
    const closeMatch = Math.abs(parent.close - childClose) < PRICE_TOLERANCE * Math.max(1, Math.abs(parent.close));
    const volumeMatch = Math.abs(parent.volume - childVolume) < VOLUME_TOLERANCE * Math.max(1, parent.volume);

    const pass = openMatch && highMatch && lowMatch && closeMatch && volumeMatch;

    checks.push({
      pair,
      parentTf,
      childTf,
      parentIndex: parentRows.indexOf(parent),
      parentOpen: parent.open,
      parentHigh: parent.high,
      parentLow: parent.low,
      parentClose: parent.close,
      parentVolume: parent.volume,
      childOpen,
      childHigh,
      childLow,
      childClose,
      childVolume,
      openMatch,
      highMatch,
      lowMatch,
      closeMatch,
      volumeMatch,
      pass,
    });
  }

  return {
    pair,
    checksTotal: checks.length,
    checksPass: checks.filter(c => c.pass).length,
    checksFail: checks.filter(c => !c.pass).length,
    checks,
  };
}

// ─── Full validation suite ────────────────────────────────────────────────────

export interface FullValidationReport {
  validations: ValidationResult[];
  mtfResults: MTFResult[];
  allValid: boolean;
  mtfAllPass: boolean;
}

export function validateAllCached(): FullValidationReport {
  const cached = loadAllCached();
  const validations: ValidationResult[] = [];
  const mtfResults: MTFResult[] = [];

  for (const [key, dataset] of cached) {
    const val = validateDataset(dataset);
    validations.push(val);
  }

  // MTF cross-checks: 5m vs 15m, 5m vs 60m, 5m vs 240m, 15m vs 60m, 15m vs 240m, 60m vs 240m
  for (const mapping of PAIR_MAPPINGS) {
    const c5 = cached.get(`${mapping.requested}_5m`);
    const c15 = cached.get(`${mapping.requested}_15m`);
    const c60 = cached.get(`${mapping.requested}_60m`);
    const c240 = cached.get(`${mapping.requested}_240m`);

    if (c5 && c15) mtfResults.push(crossCheckMTF(mapping.requested, 5, 15, c5.rows, c15.rows));
    if (c5 && c60) mtfResults.push(crossCheckMTF(mapping.requested, 5, 60, c5.rows, c60.rows));
    if (c5 && c240) mtfResults.push(crossCheckMTF(mapping.requested, 5, 240, c5.rows, c240.rows));
    if (c15 && c60) mtfResults.push(crossCheckMTF(mapping.requested, 15, 60, c15.rows, c60.rows));
    if (c15 && c240) mtfResults.push(crossCheckMTF(mapping.requested, 15, 240, c15.rows, c240.rows));
    if (c60 && c240) mtfResults.push(crossCheckMTF(mapping.requested, 60, 240, c60.rows, c240.rows));
  }

  return {
    validations,
    mtfResults,
    allValid: validations.every(v => v.valid),
    mtfAllPass: mtfResults.every(m => m.checksFail === 0),
  };
}
