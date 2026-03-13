/**
 * EntryDecisionContext.ts
 *
 * Single source of truth for the entry decision pipeline.
 * Built ONCE per pair per analysis cycle from raw closed-candle data.
 *
 * All detectors, guards, and snapshot builders MUST read from this object
 * instead of recalculating indicators independently.
 *
 * Flow:
 *   buildEntryDecisionContext()  →  attach to pipeline
 *   validateEntryMetrics()       →  set dataComplete + missingMetrics
 *   evaluateHardGuards()         →  structural blockers before BUY
 */

import { calculateEMA, calculateMACD, type OHLCCandle } from "./indicators";
import type { MomentumExpansionResult } from "./MomentumExpansionDetector";

// ─── Context Type ─────────────────────────────────────────────────────────────

export interface EntryDecisionContext {
  // Identity
  pair: string;
  strategy: string;
  timeframe: string;
  regime: string | null;
  decisionId: string;

  // Current price (from candle.close — the candle that triggered analysis)
  currentPrice: number;

  // === Indicators — computed ONCE, unified bases ===

  /** EMA10 of last 10 closed-candle closes */
  ema10: number | null;
  /** EMA20 of last 20 closed-candle closes */
  ema20: number | null;
  /** EMA10 of the previous cycle (closes.slice(0,-1).slice(-10)) */
  prevEma10: number | null;
  /** EMA20 of the previous cycle (closes.slice(0,-1).slice(-20)) */
  prevEma20: number | null;

  /** MACD histogram value of the current cycle */
  macdHist: number | null;
  /** MACD histogram value of the previous cycle */
  prevMacdHist: number | null;
  /** macdHist - prevMacdHist  (positive = accelerating, negative = decelerating) */
  macdHistSlope: number | null;

  /** Average volume of the last 20 closed candles (unified basis) */
  avgVolume20: number | null;
  /** lastCandle.volume / avgVolume20  (unified 20-candle basis) */
  volumeRatio: number | null;

  /** (currentPrice - ema20) / ema20 */
  priceVsEma20Pct: number | null;

  /** ATR% over last 14 periods */
  atrPct: number | null;

  // === Candle references ===
  lastCandle: OHLCCandle | null;
  prevCandle: OHLCCandle | null;

  // === Detector results (populated after detection phase) ===
  expansionResult: MomentumExpansionResult | null;
  /** MTF alignment score (-1..+1) */
  mtfAlignment: number | null;

  // === Integrity ===
  /** True when all indicators required by the selected strategy are valid */
  dataComplete: boolean;
  /** List of metric names that are null / NaN / Infinite */
  missingMetrics: string[];

  // === Decision state ===
  /** Hard blockers added by guards — a non-empty list prevents BUY */
  blockers: string[];
  /** Non-blocking observations logged and included in snapshots */
  warnings: string[];
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Computes all entry indicators from `closedCandles` exactly once.
 * This is the authoritative source for EMA10/EMA20/MACD/volumeRatio/ATR.
 */
export function buildEntryDecisionContext(
  pair: string,
  strategy: string,
  timeframe: string,
  regime: string | null,
  closedCandles: OHLCCandle[],
  currentPrice: number,
  mtfAlignment: number | null
): EntryDecisionContext {
  const decisionId = `edc-${pair.replace("/", "_")}-${Date.now()}`;
  const missing: string[] = [];

  let ema10: number | null = null;
  let ema20: number | null = null;
  let prevEma10: number | null = null;
  let prevEma20: number | null = null;
  let macdHist: number | null = null;
  let prevMacdHist: number | null = null;
  let macdHistSlope: number | null = null;
  let avgVolume20: number | null = null;
  let volumeRatio: number | null = null;
  let priceVsEma20Pct: number | null = null;
  let atrPct: number | null = null;
  let lastCandle: OHLCCandle | null = null;
  let prevCandle: OHLCCandle | null = null;

  if (closedCandles.length >= 20) {
    const closes = closedCandles.map(c => c.close);
    lastCandle = closedCandles[closedCandles.length - 1];
    prevCandle = closedCandles[closedCandles.length - 2] ?? null;

    // EMA10 / EMA20 — UNIFIED slice sizes
    ema20 = calculateEMA(closes.slice(-20), 20);
    ema10 = calculateEMA(closes.slice(-10), 10);

    // priceVsEma20
    priceVsEma20Pct = ema20 > 0 ? (currentPrice - ema20) / ema20 : null;

    // volumeRatio — UNIFIED 20-candle basis
    // (strategies.ts uses 10-candle; we use 20 here to match expansion detector)
    const volumes20 = closedCandles.slice(-20).map(c => c.volume);
    avgVolume20 = volumes20.reduce((a, b) => a + b, 0) / volumes20.length;
    volumeRatio = avgVolume20 > 0 ? lastCandle.volume / avgVolume20 : null;

    // Previous cycle EMAs (for emaSpreadPctDelta in expansion detector)
    if (closedCandles.length >= 21) {
      const prevCloses = closes.slice(0, -1);
      prevEma10 = calculateEMA(prevCloses.slice(-10), 10);
      prevEma20 = calculateEMA(prevCloses.slice(-20), 20);
    }

    // ATR%
    if (closedCandles.length >= 15) {
      const slice = closedCandles.slice(-15);
      const trValues = slice.slice(1).map((c, i) => {
        const prev = slice[i];
        return Math.max(
          c.high - c.low,
          Math.abs(c.high - prev.close),
          Math.abs(c.low - prev.close)
        );
      });
      const atrVal = trValues.reduce((a, b) => a + b, 0) / trValues.length;
      const lastClose = lastCandle.close;
      atrPct = isFinite(atrVal) && lastClose > 0 ? (atrVal / lastClose) * 100 : null;
    }
  } else {
    missing.push("ema10", "ema20", "volumeRatio", "priceVsEma20Pct");
  }

  // MACD requires >= 27 candles (26 for ema26 + 1 for history)
  if (closedCandles.length >= 27) {
    const closes = closedCandles.map(c => c.close);
    const macdNow = calculateMACD(closes);
    const macdPrev = calculateMACD(closes.slice(0, -1));
    macdHist = macdNow.histogram;
    prevMacdHist = macdPrev.histogram;
    macdHistSlope = macdNow.histogram - macdPrev.histogram;
  } else {
    missing.push("macdHist", "macdHistSlope");
  }

  // dataComplete = all indicators needed for momentum_candles strategy are valid
  const requiredForMomentum = ["ema10", "ema20", "volumeRatio", "priceVsEma20Pct"];
  const dataComplete = requiredForMomentum.every(m => !missing.includes(m));

  return {
    pair,
    strategy,
    timeframe,
    regime,
    decisionId,
    currentPrice,
    ema10,
    ema20,
    prevEma10,
    prevEma20,
    macdHist,
    prevMacdHist,
    macdHistSlope,
    avgVolume20,
    volumeRatio,
    priceVsEma20Pct,
    atrPct,
    lastCandle,
    prevCandle,
    expansionResult: null,
    mtfAlignment,
    dataComplete,
    missingMetrics: missing,
    blockers: [],
    warnings: [],
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Verifies that all required metrics are valid numbers.
 * Mutates `ctx.dataComplete` and `ctx.missingMetrics` in place.
 */
export function validateEntryMetrics(ctx: EntryDecisionContext): void {
  const checks: Array<{ name: string; value: number | null | undefined }> = [
    { name: "ema10",           value: ctx.ema10 },
    { name: "ema20",           value: ctx.ema20 },
    { name: "volumeRatio",     value: ctx.volumeRatio },
    { name: "priceVsEma20Pct", value: ctx.priceVsEma20Pct },
  ];

  for (const { name, value } of checks) {
    if (value === null || value === undefined || !isFinite(value as number)) {
      if (!ctx.missingMetrics.includes(name)) ctx.missingMetrics.push(name);
      ctx.dataComplete = false;
    }
  }
}

// ─── Hard Guards ──────────────────────────────────────────────────────────────

export interface HardGuardResult {
  blocked: boolean;
  blockers: string[];
  warnings: string[];
}

/**
 * Structural entry guards evaluated against the EntryDecisionContext.
 * Called AFTER the strategy returns BUY, BEFORE order execution.
 *
 * Blockers (prevent BUY):
 *  1. DATA_INCOMPLETE          — required metrics missing/invalid
 *  2. MACD_STRONGLY_NEGATIVE   — macdHistSlope < -0.003 in TRANSITION regime
 *  3. LOW_VOL_EXTENDED_PRICE   — volumeRatio < 0.8 and price > 0.5% above EMA20
 *  4. MTF_STRONGLY_NEGATIVE    — mtfAlignment < -0.6
 *
 * Warnings (logged, included in snapshot, non-blocking):
 *  - MACD_DECLINING
 *  - LOW_VOLUME
 *  - NO_EXPANSION
 */
export function evaluateHardGuards(ctx: EntryDecisionContext): HardGuardResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Guard 1: Data integrity
  if (!ctx.dataComplete) {
    blockers.push(`DATA_INCOMPLETE: missing=[${ctx.missingMetrics.join(",")}]`);
  }

  // Guard 2: MACD strongly negative in TRANSITION regime (high-risk entry)
  if (
    ctx.macdHistSlope !== null &&
    ctx.macdHistSlope < -0.003 &&
    ctx.regime === "TRANSITION"
  ) {
    blockers.push(
      `MACD_STRONGLY_NEGATIVE_TRANSITION: slope=${ctx.macdHistSlope.toFixed(6)}`
    );
  }

  // Guard 3: Volume contradiction — price extended above EMA20 but volume weak
  if (
    ctx.volumeRatio !== null &&
    ctx.volumeRatio < 0.8 &&
    ctx.priceVsEma20Pct !== null &&
    ctx.priceVsEma20Pct > 0.005
  ) {
    blockers.push(
      `LOW_VOL_EXTENDED_PRICE: vol=${ctx.volumeRatio.toFixed(2)}x priceVsEma20=${(ctx.priceVsEma20Pct * 100).toFixed(2)}%`
    );
  }

  // Guard 4: MTF strongly negative
  if (ctx.mtfAlignment !== null && ctx.mtfAlignment < -0.6) {
    blockers.push(`MTF_STRONGLY_NEGATIVE: alignment=${ctx.mtfAlignment.toFixed(3)}`);
  }

  // === Warnings (non-blocking) ===

  if (ctx.macdHistSlope !== null && ctx.macdHistSlope < 0) {
    warnings.push(`MACD_DECLINING: slope=${ctx.macdHistSlope.toFixed(6)}`);
  }
  if (ctx.volumeRatio !== null && ctx.volumeRatio < 1.0) {
    warnings.push(`LOW_VOLUME: ratio=${ctx.volumeRatio.toFixed(2)}x`);
  }
  if (ctx.expansionResult && !ctx.expansionResult.isExpansion) {
    warnings.push(`NO_EXPANSION: score=${ctx.expansionResult.score}`);
  }

  // Attach to context (mutable state)
  ctx.blockers.push(...blockers);
  ctx.warnings.push(...warnings);

  return { blocked: blockers.length > 0, blockers, warnings };
}
