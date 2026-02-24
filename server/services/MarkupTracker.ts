/**
 * MarkupTracker — Learns real RevolutX entry cost per pair from executed fills.
 * Uses an EMA (exponential moving average) of realEntryCostPct to produce a
 * dynamic markup estimate without any extra API calls to RevolutX.
 *
 * Usage:
 *   markupTracker.recordEntry(pair, realEntryCostPct);
 *   const markup = markupTracker.getDynamicMarkupPct(pair, fallbackFixed);
 */

import { log } from "../utils/logger";

// --- Config ---
const EMA_ALPHA = 0.3;           // Weight for newest observation (higher = more reactive)
const MIN_SAMPLES = 3;           // Minimum samples before trusting EMA
const MAX_HISTORY_PER_PAIR = 50; // Cap raw history per pair (memory bound)
const MARKUP_FLOOR_PCT = 0.10;   // Never estimate below this (noise floor)
const MARKUP_CAP_PCT = 5.00;     // Never estimate above this (sanity cap)

interface PairMarkupState {
  ema: number;
  sampleCount: number;
  history: number[];  // raw realEntryCostPct values (most recent last)
  lastUpdated: number;
}

class MarkupTrackerClass {
  private state: Map<string, PairMarkupState> = new Map();

  /**
   * Record a real entry cost observation after a BUY fill.
   * @param pair  e.g. "BTC/USD"
   * @param realEntryCostPct  (executedPrice - krakenMid) / krakenMid * 100
   *        Can be negative if RevolutX was cheaper (rare).
   *        We clamp to [0, CAP] for markup estimation (negative = bonus, not penalized).
   */
  recordEntry(pair: string, realEntryCostPct: number): void {
    if (!Number.isFinite(realEntryCostPct)) return;

    // For markup estimation we only care about positive cost (negative = favorable)
    const clamped = Math.max(0, Math.min(realEntryCostPct, MARKUP_CAP_PCT));

    let s = this.state.get(pair);
    if (!s) {
      s = { ema: clamped, sampleCount: 0, history: [], lastUpdated: Date.now() };
      this.state.set(pair, s);
    }

    s.sampleCount++;
    if (s.sampleCount === 1) {
      s.ema = clamped;
    } else {
      s.ema = EMA_ALPHA * clamped + (1 - EMA_ALPHA) * s.ema;
    }

    s.history.push(realEntryCostPct); // store raw (unclamped) for diagnostics
    if (s.history.length > MAX_HISTORY_PER_PAIR) {
      s.history.shift();
    }
    s.lastUpdated = Date.now();

    log(`[MARKUP_TRACKER] ${pair}: recorded realEntryCostPct=${realEntryCostPct.toFixed(4)}%, ema=${s.ema.toFixed(4)}%, samples=${s.sampleCount}`, "trading");
  }

  /**
   * Get dynamic markup estimate for a pair.
   * Returns the EMA if enough samples, otherwise fallback.
   * Result is clamped to [FLOOR, CAP].
   */
  getDynamicMarkupPct(pair: string, fallbackFixedPct: number): { markupPct: number; source: "dynamic" | "fixed"; samples: number; ema: number } {
    const s = this.state.get(pair);

    if (!s || s.sampleCount < MIN_SAMPLES) {
      return {
        markupPct: Math.max(MARKUP_FLOOR_PCT, Math.min(fallbackFixedPct, MARKUP_CAP_PCT)),
        source: "fixed",
        samples: s?.sampleCount ?? 0,
        ema: s?.ema ?? 0,
      };
    }

    const markupPct = Math.max(MARKUP_FLOOR_PCT, Math.min(s.ema, MARKUP_CAP_PCT));
    return {
      markupPct,
      source: "dynamic",
      samples: s.sampleCount,
      ema: s.ema,
    };
  }

  /**
   * Get diagnostics for a pair (for UI/logs).
   */
  getDiagnostics(pair: string): { ema: number; samples: number; history: number[]; lastUpdated: number } | null {
    const s = this.state.get(pair);
    if (!s) return null;
    return { ema: s.ema, samples: s.sampleCount, history: [...s.history], lastUpdated: s.lastUpdated };
  }

  /**
   * Get all tracked pairs' diagnostics (for API endpoint).
   */
  getAllDiagnostics(): Record<string, { ema: number; samples: number; lastUpdated: number }> {
    const result: Record<string, { ema: number; samples: number; lastUpdated: number }> = {};
    for (const [pair, s] of this.state) {
      result[pair] = { ema: s.ema, samples: s.sampleCount, lastUpdated: s.lastUpdated };
    }
    return result;
  }
}

// Singleton
export const markupTracker = new MarkupTrackerClass();
