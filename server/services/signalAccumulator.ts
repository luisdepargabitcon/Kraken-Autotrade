/**
 * SignalAccumulator — FASE 3
 * Persists signal evidence across consecutive scan cycles per pair.
 * BUY/SELL → add +1 to the corresponding score.
 * HOLD     → decay both scores by ACCUMULATOR_DECAY (10%).
 * When score >= ACCUMULATOR_THRESHOLD, `isAccumulated()` returns true
 * and `getConfidenceBoost()` returns a small positive confidence delta.
 * Gated by featureFlags.signalAccumulatorEnabled (defaults=false → no-op).
 */

export const ACCUMULATOR_THRESHOLD = 3;            // Scans needed to qualify as "accumulated"
const ACCUMULATOR_DECAY = 0.9;                     // Per-HOLD decay factor (−10%)
const ACCUMULATOR_MAX_AGE_MS = 15 * 60 * 1000;    // Reset state after 15min inactivity

export interface AccumulatedSignal {
  pair: string;
  buyScore: number;          // Running buy-evidence score [0..10]
  sellScore: number;         // Running sell-evidence score [0..10]
  lastUpdated: number;       // ms timestamp of last update
  consecutiveBuy: number;    // Consecutive BUY-signal cycles
  consecutiveSell: number;   // Consecutive SELL-signal cycles
  consecutiveHold: number;   // Consecutive HOLD-signal cycles
}

export class SignalAccumulator {
  private state: Map<string, AccumulatedSignal> = new Map();

  // Returns current state, resetting if stale
  getState(pair: string): AccumulatedSignal {
    const existing = this.state.get(pair);
    if (!existing || Date.now() - existing.lastUpdated > ACCUMULATOR_MAX_AGE_MS) {
      return this.resetState(pair);
    }
    return existing;
  }

  // Update accumulator with the latest signal result
  update(pair: string, signal: "BUY" | "SELL" | "NONE"): AccumulatedSignal {
    const state = this.getState(pair);

    if (signal === "BUY") {
      state.buyScore  = Math.min(10, state.buyScore + 1);
      state.sellScore = Math.max(0, state.sellScore * ACCUMULATOR_DECAY);
      state.consecutiveBuy++;
      state.consecutiveSell = 0;
      state.consecutiveHold = 0;
    } else if (signal === "SELL") {
      state.sellScore = Math.min(10, state.sellScore + 1);
      state.buyScore  = Math.max(0, state.buyScore  * ACCUMULATOR_DECAY);
      state.consecutiveSell++;
      state.consecutiveBuy  = 0;
      state.consecutiveHold = 0;
    } else {
      // HOLD: decay both directions
      state.buyScore  = Math.max(0, state.buyScore  * ACCUMULATOR_DECAY);
      state.sellScore = Math.max(0, state.sellScore * ACCUMULATOR_DECAY);
      state.consecutiveHold++;
      state.consecutiveBuy  = 0;
      state.consecutiveSell = 0;
    }

    state.lastUpdated = Date.now();
    this.state.set(pair, state);
    return state;
  }

  // True when evidence has accumulated above the threshold
  isAccumulated(pair: string, signal: "BUY" | "SELL"): boolean {
    const state = this.getState(pair);
    return signal === "BUY"
      ? state.buyScore  >= ACCUMULATOR_THRESHOLD
      : state.sellScore >= ACCUMULATOR_THRESHOLD;
  }

  // Confidence bonus: +0.00 to +0.10 proportional to score/10
  getConfidenceBoost(pair: string, signal: "BUY" | "SELL"): number {
    const state = this.getState(pair);
    const score = signal === "BUY" ? state.buyScore : state.sellScore;
    return Math.min(0.10, (score / 10) * 0.10);
  }

  reset(pair: string): void {
    this.resetState(pair);
  }

  private resetState(pair: string): AccumulatedSignal {
    const fresh: AccumulatedSignal = {
      pair,
      buyScore: 0,
      sellScore: 0,
      lastUpdated: Date.now(),
      consecutiveBuy: 0,
      consecutiveSell: 0,
      consecutiveHold: 0,
    };
    this.state.set(pair, fresh);
    return fresh;
  }
}

// Singleton — shared across all scan cycles
export const signalAccumulator = new SignalAccumulator();
